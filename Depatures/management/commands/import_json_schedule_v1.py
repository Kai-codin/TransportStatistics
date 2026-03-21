"""
Import JsonScheduleV1 NDJSON timetable data into the database.

Handles the CIF STP overlay system — when the same CIF_train_uid appears
multiple times (permanent, overlay, new, cancellation), the record that is
valid for today and has the highest STP priority is kept.

STP priority (lowest value wins):
  C = Cancellation  (overrides everything)
  N = New
  O = Overlay
  P = Permanent     (lowest priority)

Performance notes:
  - Pass 1 stores only the raw JSON fields needed for STP selection; expensive
    work (operator lookup, location parsing) is deferred to Pass 2 so it only
    runs on the winning record per UID.
  - StopCache pre-warms with all known TIPLOCs at startup (one query) so
    per-batch warm-ups only need to handle genuinely unseen TIPLOCs.
  - ScheduleLocation rows are inserted in bounded sub-batches to avoid
    building single INSERT statements with tens of thousands of rows.
"""

import datetime
import gzip
import json
import logging
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from django.core.management.base import BaseCommand
from django.db import transaction

from Depatures.models import ScheduleLocation, Timetable
from main.models import Operator
from Stops.models import Stop

logger = logging.getLogger(__name__)

STP_PRIORITY   = {"C": 0, "N": 1, "O": 2, "P": 3}
LOC_BATCH_SIZE = 5_000   # max rows per ScheduleLocation bulk_create call

TIMETABLE_UPDATE_FIELDS = [
    "operator_id",
    "schedule_days_runs",
    "schedule_start_date",
    "schedule_end_date",
    "train_status",
    "headcode",
    "CIF_headcode",
    "train_service_code",
    "power_type",
    "max_speed",
    "train_class",
]


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def open_maybe_gz(path: Path):
    """Open a plain or gzip-compressed text file transparently."""
    try:
        fh = gzip.open(path, "rt", encoding="utf-8", errors="replace")
        fh.read(1)
        fh.seek(0)
        return fh
    except Exception:
        return open(path, "r", encoding="utf-8", errors="replace")


def iter_records(fh, resume_from: int = 0) -> Iterator[Tuple[int, dict]]:
    """
    Yield (line_number, record_dict) for every valid NDJSON line.
    Lines up to resume_from are skipped without JSON parsing for fast resumption.
    """
    for lineno, raw in enumerate(fh, 1):
        if lineno <= resume_from:
            continue
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            logger.warning("Bad JSON on line %d — skipped", lineno)
            continue
        rec = obj.get("JsonScheduleV1", obj) if isinstance(obj, dict) else obj
        yield lineno, rec


def _int_or_none(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# STP record selection
# ---------------------------------------------------------------------------

def _pick_best_record(existing: dict, candidate: dict, today: datetime.date) -> dict:
    """
    Choose which of two records for the same CIF_train_uid to keep.

    Priority:
      1. Valid for today beats not valid today
      2. Lower STP value wins (C beats N beats O beats P)
      3. More recent start date wins (more specific schedule)
    """
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


# ---------------------------------------------------------------------------
# Sort-time helpers
# ---------------------------------------------------------------------------

def _compute_sort_time(raw: Optional[str]) -> Optional[str]:
    """
    Normalise a raw CIF time string to HH:MM:SS.
    "0744" -> "07:44:00",  "0740H" -> "07:40:30",  "07:44" -> "07:44:00"
    """
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None

    seconds = "30" if s.endswith("H") else "00"
    if s.endswith("H"):
        s = s[:-1]

    if ":" in s:
        parts = s.split(":")
        if len(parts) == 2:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{seconds}"
        if len(parts) >= 3:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"

    s = s.zfill(4)
    return f"{s[:2]}:{s[2:4]}:{seconds}"


def _pick_sort_time(dep: Optional[str], arr: Optional[str], pas: Optional[str]) -> Optional[str]:
    """Departure preferred over arrival over pass — matches departure board logic."""
    return _compute_sort_time(dep or arr or pas)


# ---------------------------------------------------------------------------
# DB caches
# ---------------------------------------------------------------------------

class OperatorCache:
    """Warm from DB once; lazily insert unknown operators."""

    def __init__(self):
        self._cache: Dict[str, Operator] = {op.code: op for op in Operator.objects.all()}

    def get(self, atoc_code: Optional[str]) -> Optional[Operator]:
        if not atoc_code:
            return None
        code = str(atoc_code).strip().upper()
        if code not in self._cache:
            op, created = Operator.objects.get_or_create(code=code, defaults={"name": ""})
            if created:
                logger.info("Created Operator %s", code)
            self._cache[code] = op
        return self._cache[code]


class StopCache:
    """
    Resolve TIPLOC -> Stop.

    Pre-warmed with all known TIPLOCs at startup so that per-batch warm_batch
    calls only need to hit the DB for genuinely unseen TIPLOCs (junctions,
    sidings, etc. not in the Stops table).
    """

    def __init__(self):
        self._cache: Dict[str, Optional[Stop]] = {}
        for stop in Stop.objects.exclude(tiploc__isnull=True).exclude(tiploc="").only("pk", "tiploc"):
            self._cache[stop.tiploc.strip().upper()] = stop

    def warm_batch(self, tiplocs: List[str]):
        """Fetch any TIPLOCs not yet in the cache (usually very few after __init__)."""
        missing = [t for t in tiplocs if t not in self._cache]
        if not missing:
            return
        for stop in Stop.objects.filter(tiploc__in=missing).only("pk", "tiploc"):
            self._cache[stop.tiploc.strip().upper()] = stop
        for t in missing:
            self._cache.setdefault(t, None)

    def get(self, tiploc: Optional[str]) -> Optional[Stop]:
        if not tiploc:
            return None
        return self._cache.get(tiploc.strip().upper())


# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------

class Command(BaseCommand):
    help = "Import JsonScheduleV1 NDJSON into Timetable and ScheduleLocation models."

    def add_arguments(self, parser):
        parser.add_argument("--file", default="data/JsonScheduleV1.ndjson",
                            help="Path to JsonScheduleV1 ndjson(.gz) file")
        parser.add_argument("--batch-size", type=int, default=500,
                            help="Timetable rows per DB transaction (default: 500)")
        parser.add_argument("--dry-run", action="store_true",
                            help="Parse only - nothing written to DB")
        parser.add_argument("--resume-from", type=int, default=0, metavar="LINE",
                            help="Skip the first N lines (for resuming interrupted imports)")
        parser.add_argument("--update", action="store_true",
                            help="Update existing timetables if data has changed")

    def handle(self, *args, **options):
        file_path   = Path(options["file"])
        batch_size  = options["batch_size"] or 500
        dry_run     = options["dry_run"]
        resume_from = options["resume_from"] or 0
        do_update   = options["update"]

        if not file_path.exists():
            self.stderr.write(f"File not found: {file_path}")
            return

        if resume_from:
            self.stdout.write(f"Resuming from line {resume_from + 1}")

        today = datetime.date.today()

        self.stdout.write("Pre-warming caches ...")
        stop_cache = StopCache()
        op_cache   = OperatorCache()
        self.stdout.write(f"  {len(stop_cache._cache):,} stops loaded.")

        # ── Pass 1: select the best record per UID ─────────────────────────
        #
        # Store only the minimal fields needed for STP comparison plus the raw
        # rec dict. Operator resolution and location parsing are deferred to
        # Pass 2 so we skip that work entirely for discarded duplicates.

        raw_records: Dict[str, dict] = {}
        total_lines = 0

        self.stdout.write(f"Reading {file_path} ...")
        fh = open_maybe_gz(file_path)
        try:
            for lineno, rec in iter_records(fh, resume_from=resume_from):
                total_lines += 1

                uid = rec.get("CIF_train_uid")
                if not uid:
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
                    raw_records[uid] = _pick_best_record(raw_records[uid], candidate, today)
                else:
                    raw_records[uid] = candidate

                if total_lines % 10_000 == 0:
                    self.stdout.write(
                        f"  ... {total_lines:,} lines read, {len(raw_records):,} unique UIDs"
                    )
        finally:
            fh.close()

        self.stdout.write(
            f"Read complete - {total_lines:,} lines, {len(raw_records):,} unique UIDs. Flushing ..."
        )

        # ── Pass 2: expand winning records and flush to DB ─────────────────
        #
        # Now that we know the winner per UID, do the expensive work:
        # operator lookup, location parsing, sort_time computation.

        records: List[dict] = []
        for uid, best in raw_records.items():
            rec = best["_rec"]
            seg = rec.get("schedule_segment") or {}
            records.append({
                "CIF_train_uid":       uid,
                "operator":            op_cache.get(rec.get("atoc_code") or rec.get("TOC")),
                "schedule_days_runs":  rec.get("schedule_days_runs"),
                "schedule_start_date": rec.get("schedule_start_date") or None,
                "schedule_end_date":   rec.get("schedule_end_date")   or None,
                "train_status":        rec.get("train_status") or rec.get("CIF_train_status"),
                "headcode":            seg.get("signalling_id") or seg.get("CIF_headcode") or rec.get("headcode"),
                "CIF_headcode":        seg.get("CIF_headcode"),
                "train_service_code":  seg.get("CIF_train_service_code"),
                "power_type":          seg.get("CIF_power_type"),
                "max_speed":           _int_or_none(seg.get("CIF_speed")),
                "train_class":         seg.get("CIF_train_class"),
                "schedule_locations":  seg.get("schedule_location") or [],
            })

        created_tt = updated_tt = created_loc = 0

        for i in range(0, len(records), batch_size):
            buf = records[i : i + batch_size]
            c_tt, u_tt, c_loc = self._flush_batch(buf, dry_run, stop_cache, do_update)
            created_tt  += c_tt
            updated_tt  += u_tt
            created_loc += c_loc
            self.stdout.write(f"  ... {min(i + batch_size, len(records)):,}/{len(records):,} flushed")

        self.stdout.write(self.style.SUCCESS(
            f"Done - lines: {total_lines:,} | UIDs: {len(raw_records):,} | "
            f"created: {created_tt:,} | updated: {updated_tt:,} | locations: {created_loc:,}"
        ))

    def _flush_batch(
        self,
        buf: List[dict],
        dry_run: bool,
        stop_cache: StopCache,
        do_update: bool,
    ) -> Tuple[int, int, int]:
        """Persist one batch of records. Returns (created_tt, updated_tt, created_loc)."""

        uids = [b["CIF_train_uid"] for b in buf]

        # Warm stop cache for any TIPLOCs not seen at startup
        stop_cache.warm_batch([
            tiploc.strip().upper()
            for b in buf
            for loc in b["schedule_locations"]
            for tiploc in [loc.get("tiploc_code") or loc.get("tiploc")]
            if tiploc
        ])

        if dry_run:
            loc_count = sum(len(b["schedule_locations"]) for b in buf)
            logger.info("Dry-run: %d records, %d locations", len(buf), loc_count)
            return len(buf), 0, loc_count

        with transaction.atomic():
            # ── 1. Fetch existing timetables for this batch ────────────────
            if do_update:
                existing_map: Dict[str, Timetable] = {
                    t.CIF_train_uid: t
                    for t in Timetable.objects.filter(CIF_train_uid__in=uids)
                }
                existing_uids = set(existing_map.keys())
            else:
                existing_uids = set(
                    Timetable.objects.filter(CIF_train_uid__in=uids)
                    .values_list("CIF_train_uid", flat=True)
                )
                existing_map = {}

            # ── 2. Classify each record as insert / update / skip ──────────
            to_insert:               List[Timetable] = []
            to_update:               List[Timetable] = []
            uids_needing_loc_refresh: set            = set()

            for b in buf:
                uid   = b["CIF_train_uid"]
                op_id = b["operator"].pk if b["operator"] else None

                if uid not in existing_uids:
                    to_insert.append(Timetable(
                        CIF_train_uid=uid,
                        operator_id=op_id,
                        schedule_days_runs=b["schedule_days_runs"],
                        schedule_start_date=b["schedule_start_date"],
                        schedule_end_date=b["schedule_end_date"],
                        train_status=b["train_status"],
                        headcode=b["headcode"],
                        CIF_headcode=b["CIF_headcode"],
                        train_service_code=b["train_service_code"],
                        power_type=b["power_type"],
                        max_speed=b["max_speed"],
                        train_class=b["train_class"],
                    ))

                elif do_update:
                    existing_tt = existing_map[uid]
                    incoming = {
                        "operator_id":         op_id,
                        "schedule_days_runs":  b["schedule_days_runs"],
                        "schedule_start_date": b["schedule_start_date"],
                        "schedule_end_date":   b["schedule_end_date"],
                        "train_status":        b["train_status"],
                        "headcode":            b["headcode"],
                        "CIF_headcode":        b["CIF_headcode"],
                        "train_service_code":  b["train_service_code"],
                        "power_type":          b["power_type"],
                        "max_speed":           b["max_speed"],
                        "train_class":         b["train_class"],
                    }
                    changed = [f for f in TIMETABLE_UPDATE_FIELDS if getattr(existing_tt, f) != incoming[f]]
                    if changed:
                        for f in TIMETABLE_UPDATE_FIELDS:
                            setattr(existing_tt, f, incoming[f])
                        to_update.append(existing_tt)
                        uids_needing_loc_refresh.add(uid)
                        logger.debug("Timetable %s changed: %s", uid, changed)

            # ── 3. Write timetable rows ────────────────────────────────────
            if to_insert:
                Timetable.objects.bulk_create(to_insert, ignore_conflicts=True)
            if to_update:
                Timetable.objects.bulk_update(to_update, TIMETABLE_UPDATE_FIELDS)

            # ── 4. Resolve PKs for rows that need locations ────────────────
            uids_for_locations = {t.CIF_train_uid for t in to_insert} | uids_needing_loc_refresh
            if not uids_for_locations:
                return len(to_insert), len(to_update), 0

            uid_to_pk: Dict[str, int] = dict(
                Timetable.objects.filter(CIF_train_uid__in=uids_for_locations)
                .values_list("CIF_train_uid", "pk")
            )

            # ── 5. Delete stale locations for updated timetables ──────────
            if uids_needing_loc_refresh:
                pks_to_clear = [uid_to_pk[u] for u in uids_needing_loc_refresh if u in uid_to_pk]
                if pks_to_clear:
                    ScheduleLocation.objects.filter(timetable_id__in=pks_to_clear).delete()

            # ── 6. Build and insert ScheduleLocation rows ─────────────────
            sl_objs: List[ScheduleLocation] = []
            for b in buf:
                uid = b["CIF_train_uid"]
                if uid not in uids_for_locations:
                    continue
                pk = uid_to_pk.get(uid)
                if pk is None:
                    logger.warning("No PK found for uid %s - locations skipped", uid)
                    continue

                for pos, loc in enumerate(b["schedule_locations"]):
                    raw_tip   = loc.get("tiploc_code") or loc.get("tiploc")
                    tiploc    = str(raw_tip).strip() if raw_tip else None
                    departure = loc.get("departure")  or loc.get("public_departure")
                    arrival   = loc.get("arrival")    or loc.get("public_arrival")
                    pass_time = loc.get("pass")

                    sl_objs.append(ScheduleLocation(
                        timetable_id=pk,
                        location_type=loc.get("location_type"),
                        tiploc_code=tiploc,
                        stop=stop_cache.get(tiploc),
                        departure_time=departure,
                        arrival_time=arrival,
                        pass_time=pass_time,
                        platform=loc.get("platform"),
                        engineering_allowance=loc.get("engineering_allowance"),
                        pathing_allowance=loc.get("pathing_allowance"),
                        performance_allowance=loc.get("performance_allowance"),
                        position=pos,
                        sort_time=_pick_sort_time(departure, arrival, pass_time),
                    ))

            # Insert in bounded sub-batches to avoid huge single INSERT statements
            total_loc = 0
            for j in range(0, len(sl_objs), LOC_BATCH_SIZE):
                ScheduleLocation.objects.bulk_create(sl_objs[j : j + LOC_BATCH_SIZE])
                total_loc += len(sl_objs[j : j + LOC_BATCH_SIZE])

        return len(to_insert), len(to_update), total_loc