"""
Management command: prefill_rids

Fetches the current live train locations from Signalbox, then calls the
train-information API for every RID that isn't already fresh in the DB.

Usage:
    python manage.py prefill_rids
    python manage.py prefill_rids --force          # re-fetch all RIDs, even cached ones
    python manage.py prefill_rids --max-age 12     # treat entries older than 12 h as stale
"""

import time
import logging
from datetime import timedelta

import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

# Adjust this import to match your app name
from main.models import TrainRID  # ← update app name

logger = logging.getLogger(__name__)

_SB_LOCATIONS_URL = "https://map-api.production.signalbox.io/api/locations"
_SB_TRAIN_INFO_URL = "https://map-api.production.signalbox.io/api/train-information/{rid}"
_RATE_LIMIT_DELAY = 0.25  # 4 req/s


def _parse_rid_payload(data: dict) -> dict:
    return dict(
        headcode=data.get("headcode") or "",
        uid=data.get("uid") or "",
        toc_code=data.get("toc_code") or "",
        train_operator=data.get("train_operator") or "",
        origin_crs=data.get("origin_crs") or "",
        origin_name=data.get("origin_name") or "",
        origin_departure=data.get("origin_departure") or None,
        destination_crs=data.get("destination_crs") or "",
        destination_name=data.get("destination_name") or "",
        destination_arrival=data.get("destination_arrival") or None,
    )


class Command(BaseCommand):
    help = "Pre-fills the TrainRID cache from the current Signalbox live locations feed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-fetch all RIDs even if they are already cached.",
        )
        parser.add_argument(
            "--max-age",
            type=int,
            default=6,
            metavar="HOURS",
            help="Consider DB entries older than this many hours stale (default: 6).",
        )

    def handle(self, *args, **options):
        force: bool = options["force"]
        max_age_hours: int = options["max_age"]

        # ── 1. fetch live locations ────────────────────────────────────────────
        self.stdout.write("Fetching live train locations from Signalbox…")
        try:
            resp = requests.get(_SB_LOCATIONS_URL, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"Failed to fetch locations: {exc}"))
            return

        # Locations may be a bare list or wrapped in {"train_locations": [...]}
        if isinstance(data, dict):
            locations = data.get("train_locations", [])
        else:
            locations = data

        rids = [t["rid"] for t in locations if t.get("rid")]
        if not rids:
            self.stdout.write(self.style.WARNING("No RIDs found in locations response."))
            return

        self.stdout.write(f"Found {len(rids)} RID(s) in the live feed.")

        # ── 2. determine which RIDs need fetching ─────────────────────────────
        if force:
            missing = rids
            self.stdout.write("--force set: re-fetching all RIDs.")
        else:
            stale_cutoff = timezone.now() - timedelta(hours=max_age_hours)
            fresh_rids = set(
                TrainRID.objects.filter(
                    rid__in=rids,
                    fetched_at__gte=stale_cutoff,
                ).values_list("rid", flat=True)
            )
            missing = [r for r in rids if r not in fresh_rids]
            self.stdout.write(
                f"{len(fresh_rids)} already fresh in DB, "
                f"{len(missing)} to fetch."
            )

        if not missing:
            self.stdout.write(self.style.SUCCESS("Nothing to do – all RIDs are up to date."))
            return

        # ── 3. fetch each missing RID at ≤ 2 req/s ────────────────────────────
        ok = 0
        failed = 0

        for i, rid in enumerate(missing):
            if i > 0:
                time.sleep(_RATE_LIMIT_DELAY)

            url = _SB_TRAIN_INFO_URL.format(rid=rid)
            try:
                r = requests.get(url, timeout=5)
                r.raise_for_status()
                payload = r.json()
            except Exception as exc:
                self.stderr.write(self.style.WARNING(f"  ✗ {rid}: {exc}"))
                failed += 1
                continue

            defaults = _parse_rid_payload(payload)
            TrainRID.objects.update_or_create(rid=rid, defaults=defaults)

            headcode = defaults.get("headcode") or rid
            dest = defaults.get("destination_name") or "?"
            self.stdout.write(f"  ✓ [{i+1}/{len(missing)}] {headcode} → {dest}")
            ok += 1

        # ── 4. summary ────────────────────────────────────────────────────────
        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(f"Done. {ok} saved, {failed} failed.")
        )