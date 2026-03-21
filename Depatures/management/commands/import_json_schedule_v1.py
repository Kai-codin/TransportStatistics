"""
Import JsonScheduleV1 NDJSON timetable data into the database.

MySQL-safe rewrite. Key differences from the original:

  ARCHITECTURE
  ────────────
  • Streaming flush — winning records are written to the DB in small bounded
    batches (default 200 rows) so RAM usage stays flat and no single
    transaction ever touches more than ~200 rows.

  MYSQL LOCK FIXES
  ────────────────
  • Timetable inserts use raw  INSERT IGNORE INTO … VALUES …  instead of
    Django's bulk_create(ignore_conflicts=True).  Django's implementation on
    MySQL acquires unnecessary gap locks; INSERT IGNORE does not.
  • Updates use  ON DUPLICATE KEY UPDATE  — one round-trip, no SELECT first.
  • Each timetable batch and its child ScheduleLocation rows are committed in
    separate, short transactions so InnoDB never holds a lock for long.
  • innodb_lock_wait_timeout is raised to 120 s on the connection at startup
    (best-effort; silently ignored if the user lacks SUPER).
  • Exponential-backoff retry wraps every DB write: lock timeouts (1205) and
    deadlocks (1213) are retried up to MAX_RETRIES times before giving up.

  LOCATION INSERTS
  ────────────────
  • ScheduleLocation rows are inserted in sub-batches of LOC_BATCH_SIZE rows,
    each in its own short transaction.
  • sort_time is validated before insert; bad values become NULL instead of
    crashing the whole batch.

  FULL RE-IMPORT
  ──────────────
  • Use --replace to TRUNCATE both tables before importing (much faster than
    DELETE and avoids all lock contention — recommended for weekly re-imports).

  RESUME
  ──────
  • --resume-from N still works: the first N lines are skipped cheaply.
"""

import datetime
import gzip
import json
import logging
import sys
import time
import traceback
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from Depatures.models import ScheduleLocation, Timetable
from main.models import Operator
from Stops.models import Stop

logger = logging.getLogger(__name__)


def p(msg: str, *, prefix: str = "") -> None:
    """Flush-safe print so every line appears immediately even over SSH/pipe."""
    print(f"{prefix}{msg}", flush=True)

# ── Tuning knobs ─────────────────────────────────────────────────────────────
STP_PRIORITY         = {"C": 0, "N": 1, "O": 2, "P": 3}
TIMETABLE_BATCH_SIZE = 200   # timetable rows per DB flush
LOC_BATCH_SIZE       = 500   # ScheduleLocation rows per INSERT statement
MAX_RETRIES          = 5     # retry attempts for lock errors
RETRY_BASE_DELAY     = 0.25  # seconds; doubles each retry
MYSQL_LOCK_ERRORS    = {1205, 1213}  # lock wait timeout, deadlock

TIMETABLE_COLS = [
    "CIF_train_uid", "operator_id", "schedule_days_runs",
    "schedule_start_date", "schedule_end_date", "train_status",
    "headcode", "CIF_headcode", "train_service_code",
    "power_type", "max_speed", "train_class",
]

LOC_COLS = [
    "timetable_id", "location_type", "tiploc_code", "stop_id",
    "sort_time", "departure_time", "arrival_time", "pass_time",
    "platform", "engineering_allowance", "pathing_allowance",
    "performance_allowance", "position",
]


# ── File helpers ──────────────────────────────────────────────────────────────

def open_maybe_gz(path: Path):
    """Open plain or gzip-compressed NDJSON transparently."""
    try:
        fh = gzip.open(path, "rt", encoding="utf-8", errors="replace")
        fh.read(1)
        fh.seek(0)
        p(f"  [file] Opened as gzip: {path}")
        return fh
    except Exception:
        p(f"  [file] Opened as plain text: {path}")
        return open(path, "r", encoding="utf-8", errors="replace")


def iter_records(fh, resume_from: int = 0) -> Iterator[Tuple[int, dict]]:
    bad_json = 0
    for lineno, raw in enumerate(fh, 1):
        if lineno <= resume_from:
            continue
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception as exc:
            bad_json += 1
            p(f"  [parse] Bad JSON on line {lineno} ({exc}) — skipped  "
              f"(total bad: {bad_json})")
            continue
        rec = obj.get("JsonScheduleV1", obj) if isinstance(obj, dict) else obj
        yield lineno, rec


def _int_or_none(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ── STP selection ─────────────────────────────────────────────────────────────

def _pick_best_record(existing: dict, candidate: dict, today: datetime.date) -> dict:
    def is_valid_today(r: dict) -> bool:
        start, end = r["_start"], r["_end"]
        return not (start and today < start) and not (end and today > end)

    ex_valid  = is_valid_today(existing)
    can_valid = is_valid_today(candidate)
    if can_valid != ex_valid:
        return candidate if can_valid else existing

    ex_stp  = STP_PRIORITY.get(existing["_stp"],  99)
    can_stp = STP_PRIORITY.get(candidate["_stp"], 99)
    if can_stp != ex_stp:
        return candidate if can_stp < ex_stp else existing

    ex_start  = existing["_start"]  or datetime.date.min
    can_start = candidate["_start"] or datetime.date.min
    return candidate if can_start >= ex_start else existing


# ── Time helpers ──────────────────────────────────────────────────────────────

def _compute_sort_time(raw: Optional[str]) -> Optional[str]:
    """
    Normalise a CIF time string to HH:MM:SS.
    Returns None (rather than raising) on anything unparseable.
    """
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None

    seconds = "30" if s.endswith("H") else "00"
    if s.endswith("H"):
        s = s[:-1]

    try:
        if ":" in s:
            parts = s.split(":")
            h   = int(parts[0])
            m   = int(parts[1])
            sec = int(parts[2]) if len(parts) >= 3 else int(seconds)
        else:
            s   = s.zfill(4)
            h   = int(s[:2])
            m   = int(s[2:4])
            sec = int(seconds)

        if not (0 <= h <= 23 and 0 <= m <= 59 and 0 <= sec <= 59):
            return None
        return f"{h:02d}:{m:02d}:{sec:02d}"
    except (ValueError, IndexError):
        return None


def _pick_sort_time(dep, arr, pas) -> Optional[str]:
    return _compute_sort_time(dep or arr or pas)


# ── DB caches ─────────────────────────────────────────────────────────────────

class OperatorCache:
    def __init__(self):
        self._cache: Dict[str, Optional[int]] = {
            op.code: op.pk for op in Operator.objects.all()
        }
        p(f"  [cache] OperatorCache loaded {len(self._cache):,} operators")

    def get_pk(self, atoc_code: Optional[str]) -> Optional[int]:
        if not atoc_code:
            return None
        code = str(atoc_code).strip().upper()
        if code not in self._cache:
            p(f"  [operator] Unknown code '{code}' — creating in DB")
            try:
                op, created = Operator.objects.get_or_create(
                    code=code, defaults={"name": ""}
                )
                if created:
                    p(f"  [operator] Created new Operator: {code} (pk={op.pk})")
                else:
                    p(f"  [operator] Found existing Operator: {code} (pk={op.pk})")
                self._cache[code] = op.pk
            except Exception as exc:
                p(f"  [operator] ERROR creating operator '{code}': {exc}")
                self._cache[code] = None
        return self._cache[code]


class StopCache:
    def __init__(self):
        self._cache: Dict[str, Optional[int]] = {}  # tiploc -> pk or None
        for row in (
            Stop.objects.exclude(tiploc__isnull=True)
            .exclude(tiploc="")
            .values("pk", "tiploc")
        ):
            self._cache[row["tiploc"].strip().upper()] = row["pk"]
        p(f"  [cache] StopCache loaded {len(self._cache):,} TIPLOCs")

    def warm_batch(self, tiplocs: List[str]):
        missing = [t for t in tiplocs if t not in self._cache]
        if not missing:
            return
        p(f"  [stops] Warming {len(missing):,} unseen TIPLOCs: {missing[:5]}"
          f"{'…' if len(missing) > 5 else ''}")
        found = 0
        for row in Stop.objects.filter(tiploc__in=missing).values("pk", "tiploc"):
            self._cache[row["tiploc"].strip().upper()] = row["pk"]
            found += 1
        for t in missing:
            self._cache.setdefault(t, None)
        p(f"  [stops] Warmed: {found}/{len(missing)} matched a Stop row"
          f" ({len(missing) - found} will be NULL stop_id)")

    def get_pk(self, tiploc: Optional[str]) -> Optional[int]:
        if not tiploc:
            return None
        return self._cache.get(tiploc.strip().upper())


# ── Retry helper ──────────────────────────────────────────────────────────────

def _is_lock_error(exc: Exception) -> bool:
    """True for MySQL lock-wait-timeout (1205) and deadlock (1213)."""
    cause = getattr(exc, "__cause__", None) or exc
    errno = getattr(cause, "args", [None])[0]
    return errno in MYSQL_LOCK_ERRORS


def _with_retry(fn, *args, **kwargs):
    """
    Call fn(*args, **kwargs), retrying on MySQL lock errors with
    exponential back-off.  Raises on non-lock errors immediately.
    """
    delay = RETRY_BASE_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if attempt == MAX_RETRIES or not _is_lock_error(exc):
                p(f"  [DB ERROR] {fn.__name__} failed (attempt {attempt}/{MAX_RETRIES}): "
                  f"{type(exc).__name__}: {exc}")
                p(f"  [DB ERROR] Full traceback:")
                traceback.print_exc()
                raise
            p(f"  [retry] Lock error in {fn.__name__} "
              f"(attempt {attempt}/{MAX_RETRIES}) — retrying in {delay:.2f}s: {exc}")
            time.sleep(delay)
            delay = min(delay * 2, 30)


# ── Raw-SQL writers ───────────────────────────────────────────────────────────

def _tt_table() -> str:
    return Timetable._meta.db_table


def _loc_table() -> str:
    return ScheduleLocation._meta.db_table


def _row_values(r: dict) -> tuple:
    return (
        r["CIF_train_uid"],
        r["operator_id"],
        r["schedule_days_runs"],
        r["schedule_start_date"],
        r["schedule_end_date"],
        r["train_status"],
        r["headcode"],
        r["CIF_headcode"],
        r["train_service_code"],
        r["power_type"],
        r["max_speed"],
        r["train_class"],
    )


def _insert_timetable_rows(rows: List[dict]) -> None:
    """INSERT IGNORE — skip conflicts without gap locks."""
    if not rows:
        return
    col_sql = ", ".join(f"`{c}`" for c in TIMETABLE_COLS)
    ph      = ", ".join(["%s"] * len(TIMETABLE_COLS))
    sql     = f"INSERT IGNORE INTO `{_tt_table()}` ({col_sql}) VALUES ({ph})"
    params  = [_row_values(r) for r in rows]
    p(f"  [sql] INSERT IGNORE {len(rows)} timetable rows into `{_tt_table()}`")
    p(f"  [sql] First row sample: uid={params[0][0]!r}  operator_id={params[0][1]!r}"
      f"  headcode={params[0][6]!r}")
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.executemany(sql, params)
    p(f"  [sql] INSERT IGNORE committed OK")


def _upsert_timetable_rows(rows: List[dict]) -> None:
    """ON DUPLICATE KEY UPDATE — one round-trip upsert."""
    if not rows:
        return
    update_cols = [c for c in TIMETABLE_COLS if c != "CIF_train_uid"]
    col_sql     = ", ".join(f"`{c}`" for c in TIMETABLE_COLS)
    ph          = ", ".join(["%s"] * len(TIMETABLE_COLS))
    update_sql  = ", ".join(f"`{c}`=VALUES(`{c}`)" for c in update_cols)
    sql = (
        f"INSERT INTO `{_tt_table()}` ({col_sql}) VALUES ({ph}) "
        f"ON DUPLICATE KEY UPDATE {update_sql}"
    )
    params = [_row_values(r) for r in rows]
    p(f"  [sql] UPSERT {len(rows)} timetable rows into `{_tt_table()}`")
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.executemany(sql, params)
    p(f"  [sql] UPSERT committed OK")


def _fetch_uid_to_pk(uids: List[str]) -> Dict[str, int]:
    if not uids:
        return {}
    ph  = ", ".join(["%s"] * len(uids))
    sql = f"SELECT `CIF_train_uid`, `id` FROM `{_tt_table()}` WHERE `CIF_train_uid` IN ({ph})"
    p(f"  [sql] SELECT PKs for {len(uids)} UIDs")
    with connection.cursor() as cur:
        cur.execute(sql, uids)
        result = {row[0]: row[1] for row in cur.fetchall()}
    p(f"  [sql] Got {len(result)}/{len(uids)} PKs back "
      f"({'all found' if len(result) == len(uids) else f'{len(uids) - len(result)} MISSING — were INSERT IGNOREd?'})")
    return result


def _fetch_pks_with_locations(pks: List[int]) -> set:
    if not pks:
        return set()
    ph  = ", ".join(["%s"] * len(pks))
    sql = f"SELECT DISTINCT `timetable_id` FROM `{_loc_table()}` WHERE `timetable_id` IN ({ph})"
    p(f"  [sql] Checking which of {len(pks)} timetable PKs already have locations")
    with connection.cursor() as cur:
        cur.execute(sql, pks)
        result = {row[0] for row in cur.fetchall()}
    p(f"  [sql] {len(result)} already have locations, "
      f"{len(pks) - len(result)} need them written")
    return result


def _delete_locations_for(pks: List[int]) -> None:
    if not pks:
        return
    ph  = ", ".join(["%s"] * len(pks))
    sql = f"DELETE FROM `{_loc_table()}` WHERE `timetable_id` IN ({ph})"
    p(f"  [sql] DELETE existing locations for {len(pks)} timetable PKs")
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute(sql, pks)
    p(f"  [sql] DELETE committed OK")


def _insert_location_rows(loc_rows: List[tuple]) -> None:
    """Insert ScheduleLocation rows in bounded sub-batches."""
    if not loc_rows:
        return
    col_sql = ", ".join(f"`{c}`" for c in LOC_COLS)
    ph      = ", ".join(["%s"] * len(LOC_COLS))
    sql     = f"INSERT IGNORE INTO `{_loc_table()}` ({col_sql}) VALUES ({ph})"
    total_chunks = (len(loc_rows) + LOC_BATCH_SIZE - 1) // LOC_BATCH_SIZE
    p(f"  [sql] Inserting {len(loc_rows):,} location rows "
      f"in {total_chunks} sub-batch(es) of up to {LOC_BATCH_SIZE}")
    for chunk_num, start in enumerate(range(0, len(loc_rows), LOC_BATCH_SIZE), 1):
        chunk = loc_rows[start : start + LOC_BATCH_SIZE]
        p(f"  [sql] Location sub-batch {chunk_num}/{total_chunks}: {len(chunk)} rows  "
          f"timetable_ids={sorted({r[0] for r in chunk})[:3]}…")
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.executemany(sql, chunk)
        p(f"  [sql] Sub-batch {chunk_num} committed OK")


# ── Record helpers ────────────────────────────────────────────────────────────

def _expand_record(uid: str, best: dict, op_cache: OperatorCache) -> dict:
    rec = best["_rec"]
    seg = rec.get("schedule_segment") or {}
    return {
        "CIF_train_uid":       uid,
        "operator_id":         op_cache.get_pk(rec.get("atoc_code") or rec.get("TOC")),
        "schedule_days_runs":  rec.get("schedule_days_runs"),
        "schedule_start_date": rec.get("schedule_start_date") or None,
        "schedule_end_date":   rec.get("schedule_end_date")   or None,
        "train_status":        rec.get("train_status") or rec.get("CIF_train_status"),
        "headcode":            (
            seg.get("signalling_id") or seg.get("CIF_headcode") or rec.get("headcode")
        ),
        "CIF_headcode":        seg.get("CIF_headcode"),
        "train_service_code":  seg.get("CIF_train_service_code"),
        "power_type":          seg.get("CIF_power_type"),
        "max_speed":           _int_or_none(seg.get("CIF_speed")),
        "train_class":         seg.get("CIF_train_class"),
        "schedule_locations":  seg.get("schedule_location") or [],
    }


def _build_location_rows(
    record: dict, timetable_pk: int, stop_cache: StopCache
) -> List[tuple]:
    rows = []
    for pos, loc in enumerate(record["schedule_locations"]):
        raw_tip   = loc.get("tiploc_code") or loc.get("tiploc")
        tiploc    = str(raw_tip).strip().upper() if raw_tip else None
        departure = loc.get("departure")  or loc.get("public_departure")
        arrival   = loc.get("arrival")    or loc.get("public_arrival")
        pas       = loc.get("pass")
        rows.append((
            timetable_pk,
            loc.get("location_type"),
            tiploc,
            stop_cache.get_pk(tiploc),
            _pick_sort_time(departure, arrival, pas),
            departure,
            arrival,
            pas,
            loc.get("platform"),
            loc.get("engineering_allowance"),
            loc.get("pathing_allowance"),
            loc.get("performance_allowance"),
            pos,
        ))
    return rows


# ── Management command ────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = (
        "Import JsonScheduleV1 NDJSON into Timetable and ScheduleLocation "
        "models (MySQL-safe, lock-retry, streaming flush)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--file", default="data/JsonScheduleV1.ndjson",
            help="Path to JsonScheduleV1 ndjson(.gz) file",
        )
        parser.add_argument(
            "--batch-size", type=int, default=TIMETABLE_BATCH_SIZE,
            help=f"Timetable rows per DB flush (default: {TIMETABLE_BATCH_SIZE})",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Parse only — nothing written to DB",
        )
        parser.add_argument(
            "--resume-from", type=int, default=0, metavar="LINE",
            help="Skip the first N lines (for resuming interrupted imports)",
        )
        parser.add_argument(
            "--update", action="store_true",
            help="Upsert existing timetables (ON DUPLICATE KEY UPDATE)",
        )
        parser.add_argument(
            "--replace", action="store_true",
            help=(
                "TRUNCATE both tables before importing. "
                "Fastest option for a full weekly re-import."
            ),
        )

    # ── handle ───────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        file_path   = Path(options["file"])
        batch_size  = options["batch_size"] or TIMETABLE_BATCH_SIZE
        dry_run     = options["dry_run"]
        resume_from = options["resume_from"] or 0
        do_update   = options["update"]
        do_replace  = options["replace"]

        p("=" * 60)
        p("import_json_schedule_v1  —  startup")
        p(f"  file        : {file_path}")
        p(f"  batch-size  : {batch_size}")
        p(f"  dry-run     : {dry_run}")
        p(f"  resume-from : {resume_from}")
        p(f"  --update    : {do_update}")
        p(f"  --replace   : {do_replace}")
        p("=" * 60)

        if not file_path.exists():
            p(f"ERROR: File not found: {file_path}")
            self.stderr.write(f"File not found: {file_path}")
            return

        p(f"  File size: {file_path.stat().st_size / 1_048_576:.1f} MB")

        # ── Session setup ─────────────────────────────────────────────────────
        if not dry_run:
            p("\n[DB] Setting session timeouts ...")
            try:
                with connection.cursor() as cur:
                    cur.execute("SET SESSION innodb_lock_wait_timeout = 120")
                    cur.execute("SET SESSION wait_timeout = 28800")
                p("  innodb_lock_wait_timeout = 120s  ✓")
                p("  wait_timeout             = 28800s  ✓")
            except Exception as e:
                p(f"  WARNING: Could not set session timeouts: {e}")
                p("  (import will continue — but may hit Railway's default 50s lock timeout)")

            # Print what MySQL thinks the values are now
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        "SELECT @@SESSION.innodb_lock_wait_timeout, "
                        "@@SESSION.wait_timeout, @@SESSION.max_allowed_packet"
                    )
                    row = cur.fetchone()
                    p(f"  Confirmed session values: "
                      f"innodb_lock_wait_timeout={row[0]}  "
                      f"wait_timeout={row[1]}  "
                      f"max_allowed_packet={row[2]:,}")
            except Exception as e:
                p(f"  Could not read session vars: {e}")

            # Print DB version & connection info
            try:
                with connection.cursor() as cur:
                    cur.execute("SELECT VERSION(), DATABASE(), USER()")
                    row = cur.fetchone()
                    p(f"\n[DB] Connected: version={row[0]}  db={row[1]}  user={row[2]}")
            except Exception as e:
                p(f"[DB] Could not query connection info: {e}")

        if do_replace and not dry_run:
            self._truncate_tables()

        if resume_from:
            p(f"\nResuming from line {resume_from + 1}")

        today = datetime.date.today()
        p(f"\n[date] Today = {today}  (used for STP validity check)")

        # ── Cache warm-up ─────────────────────────────────────────────────────
        p("\n[cache] Pre-warming caches ...")
        t0 = time.time()
        stop_cache = StopCache()
        op_cache   = OperatorCache()
        p(f"[cache] Done in {time.time() - t0:.1f}s")

        # ── Pass 1: STP selection ─────────────────────────────────────────────
        raw_records: Dict[str, dict] = {}
        total_lines = 0
        no_uid      = 0

        p(f"\n[pass1] Reading {file_path} ...")
        t_read = time.time()
        with open_maybe_gz(file_path) as fh:
            for lineno, rec in iter_records(fh, resume_from=resume_from):
                total_lines += 1

                uid = rec.get("CIF_train_uid")
                if not uid:
                    no_uid += 1
                    continue

                stp       = (rec.get("CIF_stp_indicator") or "P").upper()
                start_raw = rec.get("schedule_start_date")
                end_raw   = rec.get("schedule_end_date")

                try:
                    start = datetime.date.fromisoformat(start_raw) if start_raw else None
                    end   = datetime.date.fromisoformat(end_raw)   if end_raw   else None
                except ValueError as e:
                    p(f"  [pass1] Bad date on line {lineno} uid={uid!r}: {e} — set to None")
                    start = end = None

                candidate = {"_stp": stp, "_start": start, "_end": end, "_rec": rec}
                if uid in raw_records:
                    raw_records[uid] = _pick_best_record(
                        raw_records[uid], candidate, today
                    )
                else:
                    raw_records[uid] = candidate

                if total_lines % 10_000 == 0:
                    elapsed = time.time() - t_read
                    rate    = total_lines / elapsed if elapsed else 0
                    p(f"  [pass1] {total_lines:,} lines  "
                      f"{len(raw_records):,} UIDs  "
                      f"{rate:,.0f} lines/s  "
                      f"({no_uid} missing UIDs so far)")

        elapsed_read = time.time() - t_read
        p(f"\n[pass1] Complete: {total_lines:,} lines in {elapsed_read:.1f}s  "
          f"({total_lines / elapsed_read:,.0f} lines/s)")
        p(f"  Unique UIDs : {len(raw_records):,}")
        p(f"  No-UID rows : {no_uid:,}")

        # STP distribution summary
        stp_counts: Dict[str, int] = {}
        for best in raw_records.values():
            stp_counts[best["_stp"]] = stp_counts.get(best["_stp"], 0) + 1
        p(f"  STP breakdown of winners: {dict(sorted(stp_counts.items()))}")

        # ── Pass 2: flush ─────────────────────────────────────────────────────
        p(f"\n[pass2] Flushing {len(raw_records):,} records to DB "
          f"in batches of {batch_size} ...")
        created_tt = updated_tt = created_loc = skipped_tt = 0
        uid_list   = list(raw_records.keys())
        t_flush    = time.time()

        for batch_start in range(0, len(uid_list), batch_size):
            batch_uids = uid_list[batch_start : batch_start + batch_size]
            batch_num  = batch_start // batch_size + 1
            total_batches = (len(uid_list) + batch_size - 1) // batch_size
            done       = min(batch_start + batch_size, len(uid_list))

            p(f"\n[batch {batch_num}/{total_batches}] UIDs {batch_start+1}–{done}  "
              f"({batch_uids[0]!r} … {batch_uids[-1]!r})")

            records = [
                _expand_record(uid, raw_records[uid], op_cache)
                for uid in batch_uids
            ]
            p(f"  Expanded {len(records)} records OK")

            t_batch = time.time()
            try:
                c, u, s, loc = self._flush_batch(
                    records, dry_run, stop_cache, do_update
                )
            except Exception as exc:
                p(f"\n  !! BATCH FAILED at batch {batch_num}/{total_batches} "
                  f"(UIDs {batch_start+1}–{done})")
                p(f"  !! Exception: {type(exc).__name__}: {exc}")
                p(f"  !! First UID in failed batch: {batch_uids[0]!r}")
                p(f"  !! Full traceback:")
                traceback.print_exc()
                raise

            elapsed_batch = time.time() - t_batch
            created_tt  += c
            updated_tt  += u
            skipped_tt  += s
            created_loc += loc

            elapsed_total = time.time() - t_flush
            rate = done / elapsed_total if elapsed_total else 0
            eta_s = (len(uid_list) - done) / rate if rate else 0

            p(f"  Result: +{c} new  ~{u} updated  ={s} skipped  {loc} locs  "
              f"({elapsed_batch:.2f}s this batch)")
            p(f"  Progress: {done:,}/{len(uid_list):,}  "
              f"({100 * done / len(uid_list):.1f}%)  "
              f"ETA {eta_s / 60:.1f} min")

        elapsed_total = time.time() - t_flush
        p(f"\n{'=' * 60}")
        p(f"Done in {elapsed_total:.1f}s")
        p(f"  Lines read  : {total_lines:,}")
        p(f"  Unique UIDs : {len(raw_records):,}")
        p(f"  Created     : {created_tt:,}")
        p(f"  Updated     : {updated_tt:,}")
        p(f"  Skipped     : {skipped_tt:,}")
        p(f"  Locations   : {created_loc:,}")
        p("=" * 60)
        self.stdout.write(self.style.SUCCESS(
            f"Done — lines: {total_lines:,} | UIDs: {len(raw_records):,} | "
            f"created: {created_tt:,} | updated: {updated_tt:,} | "
            f"skipped: {skipped_tt:,} | locations: {created_loc:,}"
        ))

    # ── helpers ───────────────────────────────────────────────────────────────

    def _truncate_tables(self):
        p("\n[truncate] Truncating tables ...")
        p(f"  Location table : {_loc_table()}")
        p(f"  Timetable table: {_tt_table()}")
        try:
            with connection.cursor() as cur:
                cur.execute("SET FOREIGN_KEY_CHECKS=0")
                p("  SET FOREIGN_KEY_CHECKS=0 OK")
                cur.execute(f"TRUNCATE TABLE `{_loc_table()}`")
                p(f"  TRUNCATE `{_loc_table()}` OK")
                cur.execute(f"TRUNCATE TABLE `{_tt_table()}`")
                p(f"  TRUNCATE `{_tt_table()}` OK")
                cur.execute("SET FOREIGN_KEY_CHECKS=1")
                p("  SET FOREIGN_KEY_CHECKS=1 OK")
        except Exception as exc:
            p(f"  ERROR during truncate: {type(exc).__name__}: {exc}")
            traceback.print_exc()
            raise
        p("[truncate] Done.")

    def _flush_batch(
        self,
        records: List[dict],
        dry_run: bool,
        stop_cache: StopCache,
        do_update: bool,
    ) -> Tuple[int, int, int, int]:
        """
        Write one batch to the DB.
        Returns (created_tt, updated_tt, skipped_tt, created_loc).
        """
        uids = [r["CIF_train_uid"] for r in records]

        # Warm stop cache for any new TIPLOCs in this batch
        all_tiplocs = [
            str(raw_tip).strip().upper()
            for r in records
            for loc in r["schedule_locations"]
            for raw_tip in [loc.get("tiploc_code") or loc.get("tiploc")]
            if raw_tip
        ]
        p(f"  [flush] {len(records)} records  |  {len(all_tiplocs)} raw tiplocs")
        stop_cache.warm_batch(all_tiplocs)

        if dry_run:
            loc_count = sum(len(r["schedule_locations"]) for r in records)
            p(f"  [flush] DRY RUN — would insert {len(records)} timetables, {loc_count} locations")
            return len(records), 0, 0, loc_count

        # ── 1. Write timetable rows ───────────────────────────────────────────
        p(f"  [flush] Step 1: writing timetable rows (update={do_update})")
        if do_update:
            _with_retry(_upsert_timetable_rows, records)
        else:
            _with_retry(_insert_timetable_rows, records)

        # ── 2. Resolve PKs ────────────────────────────────────────────────────
        p(f"  [flush] Step 2: resolving PKs for {len(uids)} UIDs")
        uid_to_pk = _with_retry(_fetch_uid_to_pk, uids)

        # ── 3. Decide which rows need locations ───────────────────────────────
        p(f"  [flush] Step 3: deciding which rows need locations (update={do_update})")
        if do_update:
            _with_retry(_delete_locations_for, list(uid_to_pk.values()))
            uids_for_locations = set(uid_to_pk.keys())
            p(f"  [flush] --update mode: will write locations for all {len(uids_for_locations)} rows")
        else:
            already_have_locs = _with_retry(
                _fetch_pks_with_locations, list(uid_to_pk.values())
            )
            uids_for_locations = {
                uid for uid, pk in uid_to_pk.items()
                if pk not in already_have_locs
            }
            p(f"  [flush] insert-only mode: {len(uids_for_locations)} need locations, "
              f"{len(uid_to_pk) - len(uids_for_locations)} already have them")

        # ── 4. Build and insert ScheduleLocation rows ─────────────────────────
        p(f"  [flush] Step 4: building location rows for {len(uids_for_locations)} timetables")
        loc_rows: List[tuple] = []
        missing_pks = []
        for r in records:
            uid = r["CIF_train_uid"]
            if uid not in uids_for_locations:
                continue
            pk = uid_to_pk.get(uid)
            if pk is None:
                missing_pks.append(uid)
                continue
            built = _build_location_rows(r, pk, stop_cache)
            loc_rows.extend(built)

        if missing_pks:
            p(f"  [flush] WARNING: {len(missing_pks)} UIDs had no PK — locations skipped: "
              f"{missing_pks[:5]}{'…' if len(missing_pks) > 5 else ''}")

        p(f"  [flush] Built {len(loc_rows):,} location rows total")

        if loc_rows:
            _with_retry(_insert_location_rows, loc_rows)
        else:
            p(f"  [flush] No location rows to insert")

        # ── 5. Tally ──────────────────────────────────────────────────────────
        n_in_db   = len(uid_to_pk)
        n_new     = len(uids_for_locations)
        n_updated = n_in_db - n_new if not do_update else n_in_db
        n_skipped = len(records) - n_in_db

        p(f"  [flush] Tally: in_db={n_in_db}  new={n_new}  "
          f"updated={max(n_updated,0)}  skipped={max(n_skipped,0)}  locs={len(loc_rows)}")

        return n_new, max(n_updated, 0), max(n_skipped, 0), len(loc_rows)