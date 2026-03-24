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

  LOCK DIAGNOSIS
  ──────────────
  • --show-locks  prints open connections and InnoDB lock waits then exits.
  • --kill-locks  kills stale/blocking connections then exits.
    If the import hangs on the very first INSERT, run --kill-locks then
    --replace.
"""

import datetime
import gzip
import json
import logging
import os
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


# Redis cache client (optional)
REDIS_URL = os.getenv("REDIS_URL", "")
_redis_client = None
_redis_usable = False
if REDIS_URL:
    try:
        import redis as _redis_mod

        _redis_client = _redis_mod.from_url(REDIS_URL, decode_responses=True)
        # quick smoke test
        _redis_client.ping()
        _redis_usable = True
        logger.info("Using Redis cache at %s", REDIS_URL)
    except Exception as exc:
        logger.warning("Redis not available for import caches: %s", exc)
        _redis_client = None
        _redis_usable = False


def p(msg: str) -> None:
    """Flush-safe print — output appears immediately even over SSH/pipe."""
    print(msg, flush=True)


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
    "created_at", "modified_at", 
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
        return fh
    except Exception:
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
            if bad_json <= 5:
                logger.warning("Bad JSON on line %d (%s) — skipped", lineno, exc)
            elif bad_json == 6:
                logger.warning("Further bad-JSON warnings suppressed")
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
        # If Redis is usable, use it as the backing store to avoid DB RAM caching.
        self._use_redis = _redis_usable and _redis_client is not None
        self._prefix = "import:operator:"
        if not self._use_redis:
            self._cache: Dict[str, Optional[int]] = {
                op.code: op.pk for op in Operator.objects.all()
            }

    
    def size(self) -> int:
        if self._use_redis:
            try:
                return len(_redis_client.keys(f"{self._prefix}*"))
            except Exception:
                return -1
        return len(self._cache)

    def get_pk(self, atoc_code: Optional[str]) -> Optional[int]:
        if not atoc_code:
            return None
        code = str(atoc_code).strip().upper()
        if self._use_redis:
            key = f"{self._prefix}{code}"
            try:
                val = _redis_client.get(key)
            except Exception:
                val = None
            if val is not None:
                return int(val) if val != "" else None
            # cache miss — create or fetch from DB and store in Redis
            try:
                op, created = Operator.objects.get_or_create(
                    code=code, defaults={"name": ""}
                )
                if created:
                    p(f"  [operator] Created new operator: {code}")
                try:
                    _redis_client.set(key, str(op.pk) if op.pk is not None else "")
                except Exception:
                    pass
                return op.pk
            except Exception as exc:
                logger.error("Failed to create operator '%s': %s", code, exc)
                try:
                    _redis_client.set(key, "")
                except Exception:
                    pass
                return None

        # Fallback to in-memory dict
        if code not in self._cache:
            try:
                op, created = Operator.objects.get_or_create(
                    code=code, defaults={"name": ""}
                )
                if created:
                    p(f"  [operator] Created new operator: {code}")
                self._cache[code] = op.pk
            except Exception as exc:
                logger.error("Failed to create operator '%s': %s", code, exc)
                self._cache[code] = None
        return self._cache[code]


class StopCache:
    def size(self) -> int:
        if self._use_redis:
            try:
                return len(_redis_client.keys(f"{self._prefix}*"))
            except Exception:
                return -1
        return len(self._cache)

    def __init__(self):
        # If Redis is available, use it to avoid holding all stop PKs in RAM.
        self._use_redis = _redis_usable and _redis_client is not None
        self._prefix = "import:stop:"
        if self._use_redis:
            # Preload stops into Redis keys. Use a pipeline for efficiency.
            try:
                pipe = _redis_client.pipeline()
                for row in (
                    Stop.objects.exclude(tiploc__isnull=True)
                    .exclude(tiploc="")
                    .values("pk", "tiploc")
                ):
                    key = f"{self._prefix}{row['tiploc'].strip().upper()}"
                    pipe.set(key, str(row["pk"]))
                pipe.execute()
            except Exception:
                # If Redis fails during preload, fall back to local dict
                self._use_redis = False
                self._cache: Dict[str, Optional[int]] = {}
                for row in (
                    Stop.objects.exclude(tiploc__isnull=True)
                    .exclude(tiploc="")
                    .values("pk", "tiploc")
                ):
                    self._cache[row["tiploc"].strip().upper()] = row["pk"]
        else:
            self._cache: Dict[str, Optional[int]] = {}
            for row in (
                Stop.objects.exclude(tiploc__isnull=True)
                .exclude(tiploc="")
                .values("pk", "tiploc")
            ):
                self._cache[row["tiploc"].strip().upper()] = row["pk"]

    def warm_batch(self, tiplocs: List[str]):
        if self._use_redis:
            keys = [f"{self._prefix}{t}" for t in tiplocs]
            try:
                vals = _redis_client.mget(keys)
            except Exception:
                vals = [None] * len(keys)
            missing = []
            for t, v in zip(tiplocs, vals):
                if v is None:
                    missing.append(t)
            if not missing:
                return
            # Fetch missing from DB and populate Redis
            rows = Stop.objects.filter(tiploc__in=missing).values("pk", "tiploc")
            try:
                pipe = _redis_client.pipeline()
                found = set()
                for row in rows:
                    key = f"{self._prefix}{row['tiploc'].strip().upper()}"
                    pipe.set(key, str(row["pk"]))
                    found.add(row["tiploc"].strip().upper())
                # mark not-found tiplocs with empty value to avoid repeated DB hits
                for t in missing:
                    if t.strip().upper() not in found:
                        pipe.set(f"{self._prefix}{t}", "")
                pipe.execute()
            except Exception:
                # On failure, fallback to DB-only fills (no Redis writes)
                for row in rows:
                    key = row["tiploc"].strip().upper()
                    try:
                        _redis_client.set(f"{self._prefix}{key}", str(row["pk"]))
                    except Exception:
                        pass
        else:
            missing = [t for t in tiplocs if t not in self._cache]
            if not missing:
                return
            for row in Stop.objects.filter(tiploc__in=missing).values("pk", "tiploc"):
                self._cache[row["tiploc"].strip().upper()] = row["pk"]
            for t in missing:
                self._cache.setdefault(t, None)

    def get_pk(self, tiploc: Optional[str]) -> Optional[int]:
        if not tiploc:
            return None
        key = tiploc.strip().upper()
        if self._use_redis:
            try:
                v = _redis_client.get(f"{self._prefix}{key}")
            except Exception:
                v = None
            if v is None:
                return None
            return int(v) if v != "" else None
        return self._cache.get(key)


# ── Retry helper ──────────────────────────────────────────────────────────────

def _is_lock_error(exc: Exception) -> bool:
    cause = getattr(exc, "__cause__", None) or exc
    errno = getattr(cause, "args", [None])[0]
    return errno in MYSQL_LOCK_ERRORS


def _with_retry(fn, *args, **kwargs):
    """Retry fn on MySQL lock errors with exponential back-off."""
    delay = RETRY_BASE_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if attempt == MAX_RETRIES or not _is_lock_error(exc):
                raise
            p(f"  [retry] Lock error (attempt {attempt}/{MAX_RETRIES}) "
              f"— retrying in {delay:.1f}s")
            time.sleep(delay)
            delay = min(delay * 2, 30)


# ── Raw-SQL writers ───────────────────────────────────────────────────────────

def _tt_table() -> str:
    return Timetable._meta.db_table


def _loc_table() -> str:
    return ScheduleLocation._meta.db_table


def _row_values(r: dict) -> tuple:
    now = datetime.datetime.now()
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
        now,   # created_at
        now,   # modified_at
    )


def _insert_timetable_rows(rows: List[dict]) -> None:
    """INSERT IGNORE — skip conflicts without gap locks."""
    if not rows:
        return
    col_sql = ", ".join(f"`{c}`" for c in TIMETABLE_COLS)
    ph      = ", ".join(["%s"] * len(TIMETABLE_COLS))
    sql     = f"INSERT IGNORE INTO `{_tt_table()}` ({col_sql}) VALUES ({ph})"
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.executemany(sql, [_row_values(r) for r in rows])


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
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.executemany(sql, [_row_values(r) for r in rows])


def _fetch_uid_to_pk(uids: List[str]) -> Dict[str, int]:
    if not uids:
        return {}
    ph  = ", ".join(["%s"] * len(uids))
    sql = (
        f"SELECT `CIF_train_uid`, `id` FROM `{_tt_table()}` "
        f"WHERE `CIF_train_uid` IN ({ph})"
    )
    with connection.cursor() as cur:
        cur.execute(sql, uids)
        return {row[0]: row[1] for row in cur.fetchall()}


def _fetch_pks_with_locations(pks: List[int]) -> set:
    if not pks:
        return set()
    ph  = ", ".join(["%s"] * len(pks))
    sql = (
        f"SELECT DISTINCT `timetable_id` FROM `{_loc_table()}` "
        f"WHERE `timetable_id` IN ({ph})"
    )
    with connection.cursor() as cur:
        cur.execute(sql, pks)
        return {row[0] for row in cur.fetchall()}


def _delete_locations_for(pks: List[int]) -> None:
    if not pks:
        return
    ph  = ", ".join(["%s"] * len(pks))
    sql = f"DELETE FROM `{_loc_table()}` WHERE `timetable_id` IN ({ph})"
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute(sql, pks)


def _insert_location_rows(loc_rows: List[tuple]) -> None:
    """Insert ScheduleLocation rows in bounded sub-batches."""
    if not loc_rows:
        return
    col_sql = ", ".join(f"`{c}`" for c in LOC_COLS)
    ph      = ", ".join(["%s"] * len(LOC_COLS))
    sql     = f"INSERT IGNORE INTO `{_loc_table()}` ({col_sql}) VALUES ({ph})"
    for start in range(0, len(loc_rows), LOC_BATCH_SIZE):
        chunk = loc_rows[start : start + LOC_BATCH_SIZE]
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.executemany(sql, chunk)


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
        parser.add_argument(
            "--show-locks", action="store_true",
            help="Print all open connections and InnoDB lock waits then exit.",
        )
        parser.add_argument(
            "--kill-locks", action="store_true",
            help=(
                "Kill any connection blocking the timetable or location tables, "
                "then exit. Run this before --replace if the import hangs."
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
        show_locks  = options["show_locks"]
        kill_locks  = options["kill_locks"]

        # ── Lock diagnosis / kill (runs before anything else, then exits) ─────
        if show_locks or kill_locks:
            self._diagnose_locks(kill=kill_locks)
            return

        p("=" * 60)
        p("import_json_schedule_v1")
        p(f"  file  : {file_path}  "
          f"({file_path.stat().st_size / 1_048_576:.0f} MB)")
        p(f"  mode  : {'dry-run' if dry_run else 'replace' if do_replace else 'update' if do_update else 'insert'}")
        p(f"  batch : {batch_size}")
        if resume_from:
            p(f"  resume: from line {resume_from + 1}")
        p("=" * 60)

        # ── Session setup ─────────────────────────────────────────────────────
        if not dry_run:
            try:
                with connection.cursor() as cur:
                    cur.execute("SET SESSION innodb_lock_wait_timeout = 120")
                    cur.execute("SET SESSION wait_timeout = 28800")
                    cur.execute(
                        "SELECT VERSION(), DATABASE(), "
                        "@@SESSION.innodb_lock_wait_timeout"
                    )
                    row = cur.fetchone()
                p(f"  DB: MySQL {row[0]}  db={row[1]}  "
                  f"lock_wait_timeout={row[2]}s")
            except Exception as exc:
                p(f"  WARNING: session setup failed: {exc}")

        if do_replace and not dry_run:
            self._truncate_tables()

        today = datetime.date.today()

        # ── Cache warm-up ─────────────────────────────────────────────────────
        p("\nWarming caches ...")
        t0         = time.time()
        stop_cache = StopCache()
        op_cache   = OperatorCache()
        p(f"  {stop_cache.size():,} stops  |  "
            f"{op_cache.size():,} operators  |  "
            f"{time.time() - t0:.1f}s")

        # ── Pass 1: STP selection ─────────────────────────────────────────────
        raw_records: Dict[str, dict] = {}
        total_lines = 0
        no_uid      = 0

        p(f"\nReading {file_path.name} ...")
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
                except ValueError:
                    start = end = None

                candidate = {"_stp": stp, "_start": start, "_end": end, "_rec": rec}
                if uid in raw_records:
                    raw_records[uid] = _pick_best_record(
                        raw_records[uid], candidate, today
                    )
                else:
                    raw_records[uid] = candidate

                if total_lines % 50_000 == 0:
                    elapsed = time.time() - t_read
                    p(f"  {total_lines:,} lines  {len(raw_records):,} UIDs  "
                      f"{total_lines / elapsed:,.0f} lines/s")

        elapsed_read = time.time() - t_read
        stp_counts: Dict[str, int] = {}
        for best in raw_records.values():
            stp_counts[best["_stp"]] = stp_counts.get(best["_stp"], 0) + 1

        p(f"\nRead complete: {total_lines:,} lines in {elapsed_read:.1f}s  "
          f"({total_lines / elapsed_read:,.0f} lines/s)")
        p(f"  {len(raw_records):,} unique UIDs  "
          f"|  STP winners: {dict(sorted(stp_counts.items()))}")
        if no_uid:
            p(f"  WARNING: {no_uid:,} records had no CIF_train_uid and were skipped")

        # ── Pass 2: flush ─────────────────────────────────────────────────────
        p(f"\nFlushing to DB ...")
        created_tt = updated_tt = created_loc = skipped_tt = 0
        uid_list      = list(raw_records.keys())
        total_batches = (len(uid_list) + batch_size - 1) // batch_size
        t_flush       = time.time()
        REPORT_EVERY  = max(1, total_batches // 20)  # ~20 progress lines total

        for batch_num, batch_start in enumerate(range(0, len(uid_list), batch_size), 1):
            print(f"\nBatch {batch_num}/{total_batches} ...", flush=True)
            batch_uids = uid_list[batch_start : batch_start + batch_size]
            records    = [
                _expand_record(uid, raw_records[uid], op_cache)
                for uid in batch_uids
            ]

            try:
                c, u, s, loc = self._flush_batch(
                    records, dry_run, stop_cache, do_update
                )
            except Exception as exc:
                done = batch_start + len(batch_uids)
                p(f"\nERROR at batch {batch_num}/{total_batches} "
                  f"(records {batch_start + 1}–{done}, "
                  f"first UID={batch_uids[0]!r})")
                p(f"  {type(exc).__name__}: {exc}")
                traceback.print_exc()
                raise

            created_tt  += c
            updated_tt  += u
            skipped_tt  += s
            created_loc += loc

            if batch_num % REPORT_EVERY == 0 or batch_num == total_batches:
                done    = min(batch_start + batch_size, len(uid_list))
                elapsed = time.time() - t_flush
                rate    = done / elapsed if elapsed else 0
                eta_min = (len(uid_list) - done) / rate / 60 if rate else 0
                p(f"  {done:,}/{len(uid_list):,} ({100 * done / len(uid_list):.0f}%)  "
                  f"+{created_tt:,} new  {created_loc:,} locs  "
                  f"ETA {eta_min:.0f} min")

        elapsed_total = time.time() - t_flush
        p(f"\n{'=' * 60}")
        p(f"Done in {elapsed_total:.1f}s  "
          f"({len(uid_list) / elapsed_total:,.0f} UIDs/s)")
        p(f"  Created   : {created_tt:,}")
        p(f"  Updated   : {updated_tt:,}")
        p(f"  Skipped   : {skipped_tt:,}")
        p(f"  Locations : {created_loc:,}")
        p("=" * 60)
        self.stdout.write(self.style.SUCCESS(
            f"Done — lines: {total_lines:,} | UIDs: {len(raw_records):,} | "
            f"created: {created_tt:,} | updated: {updated_tt:,} | "
            f"skipped: {skipped_tt:,} | locations: {created_loc:,}"
        ))

    # ── helpers ───────────────────────────────────────────────────────────────

    def _truncate_tables(self):
        p("\nTruncating tables ...")
        try:
            with connection.cursor() as cur:
                cur.execute("SET FOREIGN_KEY_CHECKS=0")
                cur.execute(f"TRUNCATE TABLE `{_loc_table()}`")
                cur.execute(f"TRUNCATE TABLE `{_tt_table()}`")
                cur.execute("SET FOREIGN_KEY_CHECKS=1")
            p("  Truncated OK")
        except Exception as exc:
            p(f"  ERROR during truncate: {exc}")
            traceback.print_exc()
            raise

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

        stop_cache.warm_batch([
            str(raw_tip).strip().upper()
            for r in records
            for loc in r["schedule_locations"]
            for raw_tip in [loc.get("tiploc_code") or loc.get("tiploc")]
            if raw_tip
        ])

        if dry_run:
            loc_count = sum(len(r["schedule_locations"]) for r in records)
            return len(records), 0, 0, loc_count

        # ── 1. Write timetable rows ───────────────────────────────────────────
        if do_update:
            _with_retry(_upsert_timetable_rows, records)
        else:
            _with_retry(_insert_timetable_rows, records)

        # ── 2. Resolve PKs ────────────────────────────────────────────────────
        uid_to_pk = _with_retry(_fetch_uid_to_pk, uids)

        # ── 3. Decide which rows need locations ───────────────────────────────
        if do_update:
            _with_retry(_delete_locations_for, list(uid_to_pk.values()))
            uids_for_locations = set(uid_to_pk.keys())
        else:
            already_have_locs = _with_retry(
                _fetch_pks_with_locations, list(uid_to_pk.values())
            )
            uids_for_locations = {
                uid for uid, pk in uid_to_pk.items()
                if pk not in already_have_locs
            }

        # ── 4. Build and insert ScheduleLocation rows ─────────────────────────
        loc_rows: List[tuple] = []
        for r in records:
            uid = r["CIF_train_uid"]
            if uid not in uids_for_locations:
                continue
            pk = uid_to_pk.get(uid)
            if pk is None:
                logger.warning("No PK for uid %s — locations skipped", uid)
                continue
            loc_rows.extend(_build_location_rows(r, pk, stop_cache))

        if loc_rows:
            _with_retry(_insert_location_rows, loc_rows)

        # ── 5. Tally ──────────────────────────────────────────────────────────
        n_in_db   = len(uid_to_pk)
        n_new     = len(uids_for_locations)
        n_updated = n_in_db - n_new if not do_update else n_in_db
        n_skipped = len(records) - n_in_db

        return n_new, max(n_updated, 0), max(n_skipped, 0), len(loc_rows)

    def _diagnose_locks(self, kill: bool = False) -> None:
        """
        Print everything MySQL knows about open connections and lock waits.
        If kill=True, also KILL any connection blocking our tables.
        """
        our_tables = {_tt_table().lower(), _loc_table().lower()}

        p("\n── PROCESS LIST ─────────────────────────────────────────────")
        try:
            with connection.cursor() as cur:
                cur.execute("SHOW FULL PROCESSLIST")
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
            if not rows:
                p("  (no processes)")
            else:
                col_w  = [
                    max(len(str(c)), max(len(str(r[i])) for r in rows))
                    for i, c in enumerate(cols)
                ]
                header = "  " + "  ".join(
                    str(c).ljust(col_w[i]) for i, c in enumerate(cols)
                )
                p(header)
                p("  " + "-" * (len(header) - 2))
                for row in rows:
                    p("  " + "  ".join(
                        str(v).ljust(col_w[i]) for i, v in enumerate(row)
                    ))
        except Exception as exc:
            p(f"  ERROR reading PROCESSLIST: {exc}")

        p("\n── INNODB LOCK WAITS ────────────────────────────────────────")
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT
                        r.trx_mysql_thread_id AS waiting_thread,
                        LEFT(r.trx_query, 80) AS waiting_query,
                        b.trx_mysql_thread_id AS blocking_thread,
                        LEFT(b.trx_query, 80) AS blocking_query,
                        b.trx_started         AS blocking_since
                    FROM information_schema.innodb_lock_waits w
                    JOIN information_schema.innodb_trx r
                      ON r.trx_id = w.requesting_trx_id
                    JOIN information_schema.innodb_trx b
                      ON b.trx_id = w.blocking_trx_id
                """)
                waits = cur.fetchall()
            if not waits:
                p("  No InnoDB lock waits.")
            else:
                for row in waits:
                    p(f"  Thread {row[0]} waiting   — {row[1]}")
                    p(f"  Blocked by thread {row[2]} (since {row[4]}) — {row[3]}")
                    p("")
        except Exception as exc:
            p(f"  information_schema query failed: {exc}")

        p("\n── OPEN TRANSACTIONS ────────────────────────────────────────")
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT trx_mysql_thread_id, trx_started, trx_state,
                           trx_tables_locked, trx_rows_locked,
                           LEFT(trx_query, 100) AS query
                    FROM information_schema.innodb_trx
                    ORDER BY trx_started
                """)
                trxs = cur.fetchall()
            if not trxs:
                p("  No open InnoDB transactions.")
            else:
                p(f"  {len(trxs)} open transaction(s):")
                for t in trxs:
                    p(f"  thread={t[0]}  started={t[1]}  state={t[2]}")
                    p(f"    tables_locked={t[3]}  rows_locked={t[4]}  query={t[5]}")
        except Exception as exc:
            p(f"  ERROR reading innodb_trx: {exc}")

        p("\n── TABLES IN USE ────────────────────────────────────────────")
        try:
            with connection.cursor() as cur:
                cur.execute("SHOW OPEN TABLES WHERE In_use > 0")
                rows = cur.fetchall()
            if not rows:
                p("  No tables currently in use.")
            else:
                for db, tbl, in_use, name_locked in rows:
                    p(f"  {db}.{tbl}  In_use={in_use}  Name_locked={name_locked}")
        except Exception as exc:
            p(f"  ERROR: {exc}")

        if not kill:
            p("\nRe-run with --kill-locks to kill blocking connections.")
            return

        p("\n── KILLING BLOCKING CONNECTIONS ─────────────────────────────")
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT CONNECTION_ID()")
                my_id = cur.fetchone()[0]
                cur.execute("SHOW FULL PROCESSLIST")
                procs = cur.fetchall()

            killed = []
            for proc in procs:
                pid, user, host, db, cmd, secs, state, info = proc[:8]
                if pid == my_id:
                    continue
                info_lower = (info or "").lower()
                is_blocker = any(t in info_lower for t in our_tables)
                is_stale   = cmd == "Sleep" and (secs or 0) > 30

                if is_blocker or is_stale:
                    reason = ("touches timetable table" if is_blocker
                              else f"idle Sleep for {secs}s")
                    p(f"  KILL {pid}  ({cmd}, {secs}s)  reason: {reason}")
                    try:
                        with connection.cursor() as cur:
                            cur.execute(f"KILL {pid}")
                        killed.append(pid)
                        p(f"    → killed")
                    except Exception as exc:
                        p(f"    → KILL failed: {exc}")

            if killed:
                p(f"\nKilled {len(killed)} connection(s): {killed}")
                p("Now re-run the import with --replace")
            else:
                p("Nothing to kill.")
                p("The table may be locked by Railway internals — "
                  "try restarting the DB from the Railway dashboard.")
        except Exception as exc:
            p(f"  ERROR during kill: {exc}")
            traceback.print_exc()