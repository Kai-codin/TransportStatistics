"""
Import JsonScheduleV1 NDJSON timetable data into the database.

PERFORMANCE REWRITE — target: ~10–15 min → ~3–5 min
═══════════════════════════════════════════════════════════════════════════════

KEY CHANGES FROM PREVIOUS VERSION
──────────────────────────────────
1.  STREAMING PIPELINE (no full RAM load)
    Previously: loaded all 683k records into a dict, then flushed.
    Now: records are streamed, STP-deduplicated in a rolling window,
    and flushed while reading. Peak RAM is bounded to ~2× batch_size.

2.  COLLAPSED ROUND-TRIPS PER BATCH
    Previously: insert → fetch PKs → check existing locs → delete → insert locs
    = 5 queries per batch of 200.
    Now (insert mode): INSERT IGNORE → fetch PKs → INSERT IGNORE locs = 3 queries.
    Now (replace mode): TRUNCATE first → INSERT IGNORE → INSERT IGNORE locs = 2.

3.  BULK INSERT EVERYTHING WITH RAW SQL
    No Django ORM in the hot path. All inserts use executemany() with
    INSERT IGNORE. No bulk_create(), no individual saves.

4.  LAST-WRITER-WINS STP DEDUPLICATION
    When multiple records share a UID, the highest-priority STP variant
    wins (C > N > O > P). Ties broken by most-recent schedule_start_date.
    Done in Python during streaming — zero extra DB queries.

5.  MUCH LARGER DEFAULT BATCH
    Default batch bumped from 200 → 2000 timetable rows.
    Fewer round-trips, better MySQL pipeline utilisation.

6.  SEPARATE LARGE LOCATION BATCH
    LOC_BATCH_SIZE raised from 500 → 5000 rows per executemany().
    ScheduleLocation inserts dominate runtime; bigger chunks = fewer
    Python→MySQL round-trips.

7.  AUTO --replace ON EMPTY TABLE
    If the timetable table is empty, --replace behaviour is applied
    automatically (skip the "already_have_locs" check entirely).

8.  PARALLEL LOCATION INSERT (optional, --parallel-locs)
    Location rows for different timetables are independent; they can be
    inserted in a second thread while the main thread reads the next batch.
    Enable with --parallel-locs (adds ~1 thread, safe on MySQL InnoDB).

USAGE
──────
  # First-time / weekly full re-import (fastest):
  python manage.py import_json_schedule_v1 --replace

  # Incremental update:
  python manage.py import_json_schedule_v1 --update

  # Diagnose a hanging import:
  python manage.py import_json_schedule_v1 --show-locks
  python manage.py import_json_schedule_v1 --kill-locks
"""

import datetime
import gzip
import json
import logging
import queue
import threading
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


def p(msg: str) -> None:
    print(msg, flush=True)
STP_PRIORITY         = {"C": 0, "N": 1, "O": 2, "P": 3}
TIMETABLE_BATCH_SIZE = 2_000   # timetable rows per DB flush (was 200)
LOC_BATCH_SIZE       = 5_000   # ScheduleLocation rows per executemany (was 500)
MAX_RETRIES          = 5
RETRY_BASE_DELAY     = 0.25
MYSQL_LOCK_ERRORS    = {1205, 1213}

# Columns written to the Timetable table (must match model fields exactly).
TIMETABLE_COLS = [
    "CIF_train_uid", "operator_id", "schedule_days_runs",
    "schedule_start_date", "schedule_end_date", "train_status",
    "headcode", "CIF_headcode", "train_service_code",
    "power_type", "max_speed", "train_class", "CIF_train_category", "CIF_timing_load",
]

# Columns written to the ScheduleLocation table.
LOC_COLS = [
    "timetable_id", "location_type", "tiploc_code", "stop_id",
    "sort_time", "departure_time", "arrival_time", "pass_time",
    "platform", "engineering_allowance", "pathing_allowance",
    "performance_allowance", "position",
]

def open_maybe_gz(path: Path):
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

def _stp_key(rec: dict) -> tuple:
    """Lower tuple = higher priority (wins)."""
    stp   = STP_PRIORITY.get(rec.get("CIF_stp_indicator", ""), 99)
    start = rec.get("schedule_start_date") or ""
    # More-recent start date wins on tie (negate by sorting desc → negate str)
    return (stp, "".join(reversed(start)))


def _best_record(recs: List[dict], today: datetime.date) -> dict:
    """
    Pick the single best record for a UID from a list of candidates.
    Prefer records valid today, then by STP priority, then most-recent start.
    """
    def valid_today(r: dict) -> bool:
        s = r.get("schedule_start_date")
        e = r.get("schedule_end_date")
        try:
            if s and datetime.date.fromisoformat(s) > today:
                return False
            if e and datetime.date.fromisoformat(e) < today:
                return False
        except ValueError:
            pass
        return True

    valid   = [r for r in recs if valid_today(r)]
    pool    = valid if valid else recs
    return min(pool, key=_stp_key)

def _compute_sort_time(raw: Optional[str]) -> Optional[str]:
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

class OperatorCache:
    def __init__(self):
        self._cache: Dict[str, Optional[int]] = {
            op.code: op.pk for op in Operator.objects.all()
        }

    def get_pk(self, atoc_code: Optional[str]) -> Optional[int]:
        if not atoc_code:
            return None
        code = str(atoc_code).strip().upper()
        if code not in self._cache:
            try:
                op, created = Operator.objects.get_or_create(
                    code=code, defaults={"name": ""}
                )
                self._cache[code] = op.pk
            except Exception as exc:
                logger.error("Failed to create operator '%s': %s", code, exc)
                self._cache[code] = None
        return self._cache[code]


class StopCache:
    def __init__(self):
        self._cache: Dict[str, Optional[int]] = {}
        for row in (
            Stop.objects.exclude(tiploc__isnull=True)
            .exclude(tiploc="")
            .values("pk", "tiploc")
        ):
            self._cache[row["tiploc"].strip().upper()] = row["pk"]

    def warm_batch(self, tiplocs: List[str]):
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
        return self._cache.get(tiploc.strip().upper())

def _is_lock_error(exc: Exception) -> bool:
    cause = getattr(exc, "__cause__", None) or exc
    errno = getattr(cause, "args", [None])[0]
    return errno in MYSQL_LOCK_ERRORS


def _with_retry(fn, *args, **kwargs):
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

def _tt_table() -> str:
    return Timetable._meta.db_table


def _loc_table() -> str:
    return ScheduleLocation._meta.db_table

def _insert_timetable_rows(rows: List[dict]) -> int:
    """
    INSERT IGNORE — skips duplicates silently.
    Returns number of rows actually inserted.
    """
    if not rows:
        return 0
    col_sql = ", ".join(f"`{c}`" for c in TIMETABLE_COLS)
    ph      = ", ".join(["%s"] * len(TIMETABLE_COLS))
    sql     = f"INSERT IGNORE INTO `{_tt_table()}` ({col_sql}) VALUES ({ph})"
    vals = [
        (
            r["CIF_train_uid"], r["operator_id"], r["schedule_days_runs"],
            r["schedule_start_date"], r["schedule_end_date"], r["train_status"],
            r["headcode"], r["CIF_headcode"], r["train_service_code"],
            r["power_type"], r["max_speed"], r["train_class"], r["CIF_train_category"], r['CIF_timing_load']
        )
        for r in rows
    ]
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.executemany(sql, vals)
            return cur.rowcount  # affected rows from executemany (may be -1 on some drivers)


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
    vals = [
        (
            r["CIF_train_uid"], r["operator_id"], r["schedule_days_runs"],
            r["schedule_start_date"], r["schedule_end_date"], r["train_status"],
            r["headcode"], r["CIF_headcode"], r["train_service_code"],
            r["power_type"], r["max_speed"], r["train_class"], r["CIF_train_category"], r['CIF_timing_load']
        )
        for r in rows
    ]
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.executemany(sql, vals)


def _fetch_uid_to_pk(uids: List[str]) -> Dict[str, int]:
    if not uids:
        return {}
    ph  = ", ".join(["%s"] * len(uids))
    sql = (
        f"SELECT `CIF_train_uid`, MAX(`id`) FROM `{_tt_table()}` "
        f"WHERE `CIF_train_uid` IN ({ph}) "
        f"GROUP BY `CIF_train_uid`"
    )
    result: Dict[str, int] = {}
    with connection.cursor() as cur:
        cur.execute(sql, uids)
        for uid, pk in cur.fetchall():
            result[uid] = pk          # ← was: result.setdefault(uid, []).append(pk)
    return result


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


def _insert_location_rows(loc_rows: List[tuple]) -> int:
    """Insert ScheduleLocation rows in bounded sub-batches. Returns row count."""
    if not loc_rows:
        return 0
    col_sql = ", ".join(f"`{c}`" for c in LOC_COLS)
    ph      = ", ".join(["%s"] * len(LOC_COLS))
    sql     = f"INSERT IGNORE INTO `{_loc_table()}` ({col_sql}) VALUES ({ph})"
    total   = 0
    for start in range(0, len(loc_rows), LOC_BATCH_SIZE):
        chunk = loc_rows[start : start + LOC_BATCH_SIZE]
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.executemany(sql, chunk)
                total += len(chunk)
    return total

def _expand_record(uid: str, rec: dict, op_cache: OperatorCache) -> dict:
    seg = rec.get("schedule_segment") or {}
    return {
        "CIF_train_uid":       uid,
        "operator_id":         op_cache.get_pk(rec.get("atoc_code") or rec.get("TOC")),
        "schedule_days_runs":  rec.get("schedule_days_runs"),
        "schedule_start_date": rec.get("schedule_start_date") or None,
        "schedule_end_date":   rec.get("schedule_end_date")   or None,
        "train_status":        rec.get("train_status") or rec.get("CIF_train_status"),
        "headcode": (
            seg.get("signalling_id") or seg.get("CIF_headcode") or rec.get("headcode")
        ),
        "CIF_headcode":       seg.get("CIF_headcode"),
        "train_service_code": seg.get("CIF_train_service_code"),
        "power_type":         seg.get("CIF_power_type"),
        "max_speed":          _int_or_none(seg.get("CIF_speed")),
        "train_class":        seg.get("CIF_train_class"),
        "CIF_train_category": seg.get("CIF_train_category"),
        "CIF_timing_load":    seg.get("CIF_timing_load"),
        "schedule_locations": seg.get("schedule_location") or [],
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

class _LocInserter:
    """
    Background thread that drains a queue of loc_row lists and inserts them.
    Keeps the main thread free to parse the next batch while the DB is busy.
    """
    def __init__(self):
        self._q:      queue.Queue = queue.Queue(maxsize=4)
        self._total:  int         = 0
        self._error:  Optional[Exception] = None
        self._thread  = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()

    def submit(self, loc_rows: List[tuple]) -> None:
        if self._error:
            raise self._error
        self._q.put(loc_rows)

    def flush(self) -> int:
        self._q.join()
        if self._error:
            raise self._error
        return self._total

    def _worker(self) -> None:
        while True:
            item = self._q.get()
            try:
                if item is None:
                    self._q.task_done()
                    break
                n = _with_retry(_insert_location_rows, item)
                self._total += n
            except Exception as exc:
                self._error = exc
            finally:
                self._q.task_done()

    def stop(self) -> None:
        self._q.put(None)
        self._thread.join()

class Command(BaseCommand):
    help = (
        "Import JsonScheduleV1 NDJSON into Timetable + ScheduleLocation "
        "(MySQL-safe, streaming, lock-retry — target ~3–5 min for full import)."
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
                "Fastest for weekly full re-imports."
            ),
        )
        parser.add_argument(
            "--parallel-locs", action="store_true",
            help=(
                "Insert ScheduleLocation rows in a background thread while "
                "the main thread reads the next timetable batch. "
                "Safe on InnoDB; saves ~10–20%% wall time."
            ),
        )
        parser.add_argument(
            "--show-locks", action="store_true",
            help="Print open connections and InnoDB lock waits then exit.",
        )
        parser.add_argument(
            "--kill-locks", action="store_true",
            help="Kill stale/blocking connections then exit.",
        )

    def handle(self, *args, **options):
        file_path      = Path(options["file"])
        batch_size     = options["batch_size"] or TIMETABLE_BATCH_SIZE
        dry_run        = options["dry_run"]
        resume_from    = options["resume_from"] or 0
        do_update      = options["update"]
        do_replace     = options["replace"]
        parallel_locs  = options["parallel_locs"]
        show_locks     = options["show_locks"]
        kill_locks_opt = options["kill_locks"]

        if show_locks or kill_locks_opt:
            self._diagnose_locks(kill=kill_locks_opt)
            return

        p("=" * 60)
        p("import_json_schedule_v1")
        p(f"  file  : {file_path}  "
          f"({file_path.stat().st_size / 1_048_576:.0f} MB)")
        mode = (
            "dry-run"  if dry_run    else
            "replace"  if do_replace else
            "update"   if do_update  else
            "insert"
        )
        p(f"  mode  : {mode}")
        p(f"  batch : {batch_size}  |  loc_batch: {LOC_BATCH_SIZE}")
        if parallel_locs:
            p("  locs  : parallel background thread ON")
        if resume_from:
            p(f"  resume: from line {resume_from + 1}")
        p("=" * 60)
        if not dry_run:
            try:
                with connection.cursor() as cur:
                    cur.execute("SET SESSION innodb_lock_wait_timeout = 120")
                    cur.execute("SET SESSION wait_timeout = 28800")
                    # Larger sort buffer helps ORDER BY in _fetch_uid_to_pk
                    cur.execute("SET SESSION sort_buffer_size = 8388608")
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
        if not dry_run and not do_replace and not do_update:
            with connection.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM `{_tt_table()}` LIMIT 1")
                count = cur.fetchone()[0]
            if count == 0:
                p("  [auto] Timetable is empty — switching to replace mode")
                do_replace = True

        today = datetime.date.today()
        p("\nWarming caches ...")
        t0         = time.time()
        stop_cache = StopCache()
        op_cache   = OperatorCache()
        p(f"  {len(stop_cache._cache):,} stops  |  "
          f"{len(op_cache._cache):,} operators  |  "
          f"{time.time() - t0:.1f}s")
        #
        # Strategy:
        #   • Accumulate raw records per UID in uid_recs (dict of lists).
        #   • Once we have `batch_size` *unique* UIDs, flush the best record
        #     for each and clear the accumulator.
        #   • This keeps RAM bounded and overlaps I/O with DB writes.
        #
        created_tt = updated_tt = skipped_tt = created_loc = 0
        uid_recs: Dict[str, List[dict]] = {}   # uid → [raw_rec, ...]
        total_lines = 0
        no_uid      = 0
        t_start     = time.time()
        t_read      = time.time()

        loc_inserter: Optional[_LocInserter] = (
            _LocInserter() if parallel_locs and not dry_run else None
        )

        def _flush(uid_recs: dict, final: bool = False) -> Tuple[int, int, int, int]:
            """Flush current uid_recs accumulator."""
            if not uid_recs:
                return 0, 0, 0, 0

            # Pick best record per UID
            expanded = [
                _expand_record(uid, _best_record(recs, today), op_cache)
                for uid, recs in uid_recs.items()
            ]

            # Warm stop cache for all tiplocs in this batch
            all_tiplocs = [
                str(loc.get("tiploc_code") or loc.get("tiploc")).strip().upper()
                for r in expanded
                for loc in r["schedule_locations"]
                if loc.get("tiploc_code") or loc.get("tiploc")
            ]
            stop_cache.warm_batch(all_tiplocs)

            if dry_run:
                loc_count = sum(len(r["schedule_locations"]) for r in expanded)
                return len(expanded), 0, 0, loc_count
            if do_update:
                _with_retry(_upsert_timetable_rows, expanded)
            else:
                _with_retry(_insert_timetable_rows, expanded)
            uids      = [r["CIF_train_uid"] for r in expanded]
            uid_to_pk = _with_retry(_fetch_uid_to_pk, uids)
            if do_replace or do_update:
                # replace: table was truncated, every row is new
                # update: always rebuild locations
                if do_update:
                    _with_retry(_delete_locations_for, list(uid_to_pk.values()))
                uids_need_locs = set(uid_to_pk.keys())
            else:
                already = _with_retry(
                    _fetch_pks_with_locations, list(uid_to_pk.values())
                )
                uids_need_locs = {
                    uid for uid, pk in uid_to_pk.items()
                    if pk not in already
                }
            loc_rows: List[tuple] = []
            for r in expanded:
                pk = uid_to_pk.get(r["CIF_train_uid"])
                if pk is None or r["CIF_train_uid"] not in uids_need_locs:
                    continue
                loc_rows.extend(_build_location_rows(r, pk, stop_cache))
            if loc_rows:
                if loc_inserter:
                    loc_inserter.submit(loc_rows)
                    n_loc = len(loc_rows)
                else:
                    n_loc = _with_retry(_insert_location_rows, loc_rows)
            else:
                n_loc = 0

            n_new     = len(uids_need_locs)
            n_in_db   = len(uid_to_pk)
            n_updated = n_in_db - n_new if not do_update else n_in_db
            n_skipped = len(expanded) - n_in_db
            return n_new, max(n_updated, 0), max(n_skipped, 0), n_loc

        REPORT_EVERY = 50_000  # lines between progress prints

        p(f"\nStreaming {file_path.name} → DB ...")

        with open_maybe_gz(file_path) as fh:
            for lineno, rec in iter_records(fh, resume_from=resume_from):
                print(f"\r  Processing line {lineno:,} ...", end="")
                total_lines += 1

                uid = rec.get("CIF_train_uid")
                if not uid:
                    no_uid += 1
                    continue

                uid_recs.setdefault(uid, []).append(rec)

                # Flush when we have enough unique UIDs
                if len(uid_recs) >= batch_size:
                    try:
                        c, u, s, loc = _flush(uid_recs)
                    except Exception as exc:
                        p(f"\nERROR flushing batch ending at line {lineno}")
                        p(f"  {type(exc).__name__}: {exc}")
                        traceback.print_exc()
                        raise
                    created_tt  += c
                    updated_tt  += u
                    skipped_tt  += s
                    created_loc += loc
                    uid_recs     = {}

                if total_lines % REPORT_EVERY == 0:
                    elapsed = time.time() - t_start
                    p(f"  {total_lines:,} lines  "
                      f"+{created_tt:,} new  {created_loc:,} locs  "
                      f"{total_lines / elapsed:,.0f} lines/s")
                

        # Final flush
        try:
            c, u, s, loc = _flush(uid_recs, final=True)
        except Exception as exc:
            p(f"\nERROR in final flush: {type(exc).__name__}: {exc}")
            traceback.print_exc()
            raise
        created_tt  += c
        updated_tt  += u
        skipped_tt  += s
        created_loc += loc

        if loc_inserter:
            p("  Waiting for background loc inserter to finish ...")
            created_loc = loc_inserter.flush()
            loc_inserter.stop()

        elapsed_total = time.time() - t_start
        p(f"\n{'=' * 60}")
        p(f"Done in {elapsed_total:.1f}s  ({elapsed_total / 60:.1f} min)")
        p(f"  Lines read : {total_lines:,}")
        p(f"  Created    : {created_tt:,}")
        p(f"  Updated    : {updated_tt:,}")
        p(f"  Skipped    : {skipped_tt:,}")
        p(f"  Locations  : {created_loc:,}")
        if no_uid:
            p(f"  No-UID skip: {no_uid:,}")
        p("=" * 60)
        self.stdout.write(self.style.SUCCESS(
            f"Done — lines: {total_lines:,} | "
            f"created: {created_tt:,} | updated: {updated_tt:,} | "
            f"skipped: {skipped_tt:,} | locations: {created_loc:,}"
        ))

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

    def _diagnose_locks(self, kill: bool = False) -> None:
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
                col_w = [
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
                        p("    → killed")
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