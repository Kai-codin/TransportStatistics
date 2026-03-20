import json
import gzip
import logging
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from django.core.management.base import BaseCommand
from django.db import transaction

from Depatures.models import ScheduleLocation, Timetable
from main.models import Operator
from Stops.models import Stop

logger = logging.getLogger(__name__)

# Fields compared when --update is used to decide whether a Timetable row
# is actually stale and needs saving.
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
# Helpers
# ---------------------------------------------------------------------------

def open_maybe_gz(path: Path):
    """Return a text-mode file handle, transparently handling gzip."""
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
    Lines up to and including `resume_from` are skipped cheaply (no JSON
    parse) so resuming a large file is nearly instant.
    """
    for lineno, raw in enumerate(fh, 1):
        if lineno <= resume_from:
            continue          # fast-forward - no JSON parse needed
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            logger.warning("Bad JSON on line %d - skipped", lineno)
            continue
        rec = obj.get("JsonScheduleV1", obj) if isinstance(obj, dict) else obj
        yield lineno, rec


def _int_or_none(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Operator cache  (avoids per-row get_or_create round-trips)
# ---------------------------------------------------------------------------

class OperatorCache:
    def __init__(self):
        # Warm from DB once; lazily insert unknowns.
        self._cache: Dict[str, Operator] = {
            op.code: op for op in Operator.objects.all()
        }

    def get(self, atoc_code: Optional[str]) -> Optional[Operator]:
        if not atoc_code:
            return None
        code = str(atoc_code).strip().upper()
        if code not in self._cache:
            op, created = Operator.objects.get_or_create(
                code=code, defaults={"name": ""}
            )
            if created:
                logger.info("Created Operator %s (id=%s)", code, op.pk)
            self._cache[code] = op
        return self._cache[code]


# ---------------------------------------------------------------------------
# Stop / TIPLOC cache  (replaces per-location DB hit)
# ---------------------------------------------------------------------------

class StopCache:
    """
    Loads *all* stops with a tiploc into memory once, then resolves lookups
    from that dict.  For very large Stop tables you could instead pre-warm
    only the tiplocs seen in the current batch - see `warm_batch` below.
    """

    def __init__(self):
        self._cache: Dict[str, Optional[Stop]] = {}
        self._loaded_all = False

    def _load_all(self):
        if not self._loaded_all:
            # only fetch the columns we actually need
            for stop in Stop.objects.exclude(tiploc__isnull=True).exclude(tiploc="").only("pk", "tiploc"):
                key = stop.tiploc.strip().upper()
                self._cache[key] = stop
            self._loaded_all = True

    def warm_batch(self, tiplocs: List[str]):
        """
        Alternative to loading everything: fetch only tiplocs we haven't
        seen yet.  Call this once per batch before building ScheduleLocations.
        """
        missing = [t for t in tiplocs if t.upper() not in self._cache]
        if missing:
            for stop in Stop.objects.filter(tiploc__in=missing).only("pk", "tiploc"):
                self._cache[stop.tiploc.strip().upper()] = stop
            # Record negative results so we don't query again
            for t in missing:
                self._cache.setdefault(t.upper(), None)

    def get(self, tiploc: Optional[str]) -> Optional[Stop]:
        if not tiploc:
            return None
        key = str(tiploc).strip().upper()
        if key not in self._cache:
            # fallback: single lookup + cache result
            stop = Stop.objects.filter(tiploc__iexact=key).first()
            self._cache[key] = stop
        return self._cache[key]


# ---------------------------------------------------------------------------
# Main command
# ---------------------------------------------------------------------------

class Command(BaseCommand):
    help = "Import JsonScheduleV1 NDJSON into Timetable and ScheduleLocation models."

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default="data/JsonScheduleV1.ndjson",
            help="Path to JsonScheduleV1 ndjson(.gz) file",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=500,
            help="Timetable rows per DB transaction",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse only - nothing written to DB",
        )
        parser.add_argument(
            "--resume-from",
            type=int,
            default=0,
            metavar="LINE",
            help=(
                "Skip the first N lines and start processing from line N+1. "
                "Useful for resuming an interrupted import. Skipped lines are "
                "read but not JSON-parsed, so fast-forwarding is near-instant."
            ),
        )
        parser.add_argument(
            "--update",
            action="store_true",
            help=(
                "When a Timetable already exists, compare its fields against "
                "the incoming data and update + replace its ScheduleLocations "
                "only if something changed. Without this flag existing rows are "
                "left untouched (insert-only)."
            ),
        )

    # ------------------------------------------------------------------

    def handle(self, *args, **options):
        file_path = Path(options["file"])
        batch_size: int = options["batch_size"] or 500
        dry_run: bool = options["dry_run"]
        resume_from: int = options["resume_from"] or 0
        do_update: bool = options["update"]

        if not file_path.exists():
            self.stderr.write(f"File not found: {file_path}")
            return

        if resume_from:
            self.stdout.write(f"Resuming: skipping first {resume_from} lines.")

        op_cache = OperatorCache()
        stop_cache = StopCache()

        buf: List[dict] = []
        total = created_tt = updated_tt = created_loc = 0

        logger.info("Opening %s (resume_from=%d, update=%s)", file_path, resume_from, do_update)
        fh = open_maybe_gz(file_path)
        try:
            for lineno, rec in iter_records(fh, resume_from=resume_from):
                total += 1

                uid = rec.get("CIF_train_uid")
                if not uid:
                    logger.warning("No CIF_train_uid on line %d - skipped", lineno)
                    continue

                seg = rec.get("schedule_segment") or {}
                max_speed = _int_or_none(seg.get("CIF_speed"))

                buf.append(
                    {
                        "CIF_train_uid": uid,
                        "operator": op_cache.get(rec.get("atoc_code") or rec.get("TOC")),
                        "schedule_days_runs": rec.get("schedule_days_runs"),
                        "schedule_start_date": rec.get("schedule_start_date") or None,
                        "schedule_end_date": rec.get("schedule_end_date") or None,
                        "train_status": rec.get("train_status") or rec.get("CIF_train_status"),
                        "headcode": seg.get("signalling_id") or seg.get("CIF_headcode") or rec.get("headcode"),
                        "CIF_headcode": seg.get("CIF_headcode"),
                        "train_service_code": seg.get("CIF_train_service_code"),
                        "power_type": seg.get("CIF_power_type"),
                        "max_speed": max_speed,
                        "train_class": seg.get("CIF_train_class"),
                        "schedule_locations": seg.get("schedule_location") or [],
                        # store the current line number so callers can report it
                        "_lineno": lineno,
                    }
                )

                if len(buf) >= batch_size:
                    c_tt, u_tt, c_loc = self._flush_batch(buf, dry_run, stop_cache, do_update)
                    created_tt += c_tt
                    updated_tt += u_tt
                    created_loc += c_loc
                    # Print progress with the last-processed line so the user
                    # knows exactly which --resume-from value to use next time.
                    self.stdout.write(
                        f"  … processed up to line {lineno} "
                        f"(+{c_tt} created, +{u_tt} updated, +{c_loc} locations)"
                    )
                    buf.clear()

            # Final partial batch
            if buf:
                c_tt, u_tt, c_loc = self._flush_batch(buf, dry_run, stop_cache, do_update)
                created_tt += c_tt
                updated_tt += u_tt
                created_loc += c_loc

        finally:
            fh.close()

        self.stdout.write(
            f"Done. Lines read: {total} | "
            f"Timetables created: {created_tt} | "
            f"Timetables updated: {updated_tt} | "
            f"Locations created: {created_loc}"
        )

    # ------------------------------------------------------------------

    def _flush_batch(
        self,
        buf: List[dict],
        dry_run: bool,
        stop_cache: StopCache,
        do_update: bool = False,
    ) -> Tuple[int, int, int]:
        """
        Returns (created_tt, updated_tt, created_loc).

        --update behaviour
        ------------------
        For each existing Timetable we compare every field in
        TIMETABLE_UPDATE_FIELDS.  If anything differs we queue it for
        bulk_update and delete+replace its ScheduleLocations.  Unchanged
        rows are skipped entirely - no unnecessary writes.
        """

        uids = [b["CIF_train_uid"] for b in buf]

        # Pre-warm stop cache with every tiploc in this batch (one query).
        batch_tiplocs = [
            str(loc.get("tiploc_code") or loc.get("tiploc")).strip().upper()
            for b in buf
            for loc in b["schedule_locations"]
            if loc.get("tiploc_code") or loc.get("tiploc")
        ]
        stop_cache.warm_batch(batch_tiplocs)

        if dry_run:
            loc_count = sum(len(b["schedule_locations"]) for b in buf)
            logger.info(
                "Dry-run: would process %d records (%d locations) update=%s",
                len(buf), loc_count, do_update,
            )
            return len(buf), 0, loc_count

        with transaction.atomic():
            # ----------------------------------------------------------------
            # 1. Fetch all existing Timetables for this batch's UIDs.
            #    We need the full objects (not just PKs) when do_update=True
            #    so we can diff fields; values_list is enough otherwise.
            # ----------------------------------------------------------------
            if do_update:
                existing: Dict[str, Timetable] = {
                    t.CIF_train_uid: t
                    for t in Timetable.objects.filter(CIF_train_uid__in=uids)
                }
                existing_uids = set(existing.keys())
            else:
                existing_uids = set(
                    Timetable.objects.filter(CIF_train_uid__in=uids)
                    .values_list("CIF_train_uid", flat=True)
                )
                existing = {}

            # ----------------------------------------------------------------
            # 2. Split buf into: new inserts / updates / unchanged
            # ----------------------------------------------------------------
            to_insert: List[Timetable] = []
            to_update: List[Timetable] = []       # only populated with --update
            uids_needing_loc_refresh: set = set() # UIDs whose locations must be replaced

            for b in buf:
                uid = b["CIF_train_uid"]
                op_id = b["operator"].pk if b["operator"] else None

                if uid not in existing_uids:
                    # Brand-new record
                    to_insert.append(
                        Timetable(
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
                        )
                    )

                elif do_update:
                    existing_tt = existing[uid]
                    # Build a dict of what the incoming data says
                    incoming = {
                        "operator_id": op_id,
                        "schedule_days_runs": b["schedule_days_runs"],
                        "schedule_start_date": b["schedule_start_date"],
                        "schedule_end_date": b["schedule_end_date"],
                        "train_status": b["train_status"],
                        "headcode": b["headcode"],
                        "CIF_headcode": b["CIF_headcode"],
                        "train_service_code": b["train_service_code"],
                        "power_type": b["power_type"],
                        "max_speed": b["max_speed"],
                        "train_class": b["train_class"],
                    }
                    # Only update if at least one field differs
                    changed_fields = [
                        f for f in TIMETABLE_UPDATE_FIELDS
                        if getattr(existing_tt, f) != incoming[f]
                    ]
                    if changed_fields:
                        for f in TIMETABLE_UPDATE_FIELDS:
                            setattr(existing_tt, f, incoming[f])
                        to_update.append(existing_tt)
                        uids_needing_loc_refresh.add(uid)
                        logger.debug(
                            "Timetable %s changed fields: %s", uid, changed_fields
                        )
                # else: existing + no --update → skip entirely

            # ----------------------------------------------------------------
            # 3. Persist inserts / updates
            # ----------------------------------------------------------------
            if to_insert:
                Timetable.objects.bulk_create(to_insert, ignore_conflicts=True)
                logger.info("Inserted %d new Timetable rows", len(to_insert))

            if to_update:
                Timetable.objects.bulk_update(to_update, TIMETABLE_UPDATE_FIELDS)
                logger.info("Updated %d existing Timetable rows", len(to_update))

            # ----------------------------------------------------------------
            # 4. Fetch PKs for every UID we need to attach locations to.
            #    New inserts always need locations; updated UIDs need a refresh.
            # ----------------------------------------------------------------
            new_uids = {t.CIF_train_uid for t in to_insert}
            uids_for_locations = new_uids | uids_needing_loc_refresh

            if not uids_for_locations:
                return len(to_insert), len(to_update), 0

            uid_to_pk: Dict[str, int] = dict(
                Timetable.objects.filter(CIF_train_uid__in=uids_for_locations)
                .values_list("CIF_train_uid", "pk")
            )

            # ----------------------------------------------------------------
            # 5. For updated timetables, delete their old ScheduleLocations
            #    before we bulk-create the fresh ones.
            # ----------------------------------------------------------------
            if uids_needing_loc_refresh:
                pks_to_clear = [
                    uid_to_pk[u] for u in uids_needing_loc_refresh if u in uid_to_pk
                ]
                if pks_to_clear:
                    deleted, _ = ScheduleLocation.objects.filter(
                        timetable_id__in=pks_to_clear
                    ).delete()
                    logger.debug(
                        "Deleted %d stale ScheduleLocation rows for %d timetables",
                        deleted, len(pks_to_clear),
                    )

            # ----------------------------------------------------------------
            # 6. Build and insert ScheduleLocation rows
            # ----------------------------------------------------------------
            sl_objs: List[ScheduleLocation] = []
            for b in buf:
                uid = b["CIF_train_uid"]
                if uid not in uids_for_locations:
                    continue
                pk = uid_to_pk.get(uid)
                if pk is None:
                    logger.warning("No PK found for uid %s", uid)
                    continue

                for pos, loc in enumerate(b["schedule_locations"]):
                    raw_tip = loc.get("tiploc_code") or loc.get("tiploc")
                    tiploc = str(raw_tip).strip() if raw_tip else None

                    sl_objs.append(
                        ScheduleLocation(
                            timetable_id=pk,
                            location_type=loc.get("location_type"),
                            tiploc_code=tiploc,
                            stop=stop_cache.get(tiploc),
                            departure_time=loc.get("departure") or loc.get("public_departure"),
                            arrival_time=loc.get("arrival") or loc.get("public_arrival"),
                            pass_time=loc.get("pass"),
                            platform=loc.get("platform"),
                            engineering_allowance=loc.get("engineering_allowance"),
                            pathing_allowance=loc.get("pathing_allowance"),
                            performance_allowance=loc.get("performance_allowance"),
                            position=pos,
                        )
                    )

            if sl_objs:
                ScheduleLocation.objects.bulk_create(sl_objs)
                logger.info("Bulk-created %d ScheduleLocation rows", len(sl_objs))

        return len(to_insert), len(to_update), len(sl_objs)