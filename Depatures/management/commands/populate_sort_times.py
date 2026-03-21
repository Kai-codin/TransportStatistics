from django.core.management.base import BaseCommand
from Depatures.models import ScheduleLocation


def _raw_to_sort_time(raw: str | None) -> str | None:
    """
    Convert a raw CIF time string to HH:MM:SS.
    
    Formats handled:
      "0744"   → "07:44:00"
      "0740H"  → "07:40:30"  (H = half minute)
      "07:44"  → "07:44:00"
      "07:44:30" → "07:44:30"
      None / "" → None
    """
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None

    seconds = "00"
    if s.endswith("H"):
        s = s[:-1]
        seconds = "30"

    # Already has colons
    if ":" in s:
        parts = s.split(":")
        if len(parts) == 2:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{seconds}"
        if len(parts) >= 3:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"

    # Plain HHMM
    s = s.zfill(4)
    return f"{s[:2]}:{s[2:4]}:{seconds}"


def _pick_sort_time(loc) -> str | None:
    """
    Pick the best time to sort by: departure > arrival > pass.
    This matches real departure board logic.
    """
    raw = loc.departure_time or loc.arrival_time or loc.pass_time
    return _raw_to_sort_time(raw)


class Command(BaseCommand):
    help = "Populate sort_time on all ScheduleLocation rows"

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=2000,
            help="Rows per bulk_update batch (default: 2000)",
        )
        parser.add_argument(
            "--only-null",
            action="store_true",
            help="Only update rows where sort_time is currently NULL",
        )

    def handle(self, *args, **options):
        batch_size  = options["batch_size"]
        only_null   = options["only_null"]

        qs = ScheduleLocation.objects.only(
            "id", "departure_time", "arrival_time", "pass_time", "sort_time"
        )
        if only_null:
            qs = qs.filter(sort_time__isnull=True)

        total   = qs.count()
        updated = 0
        batch   = []

        self.stdout.write(f"Processing {total} rows...")

        for loc in qs.iterator(chunk_size=batch_size):
            new_sort_time = _pick_sort_time(loc)
            if loc.sort_time != new_sort_time:
                loc.sort_time = new_sort_time
                batch.append(loc)

            if len(batch) >= batch_size:
                ScheduleLocation.objects.bulk_update(batch, ["sort_time"])
                updated += len(batch)
                self.stdout.write(f"  {updated}/{total} updated...")
                batch = []

        if batch:
            ScheduleLocation.objects.bulk_update(batch, ["sort_time"])
            updated += len(batch)

        self.stdout.write(self.style.SUCCESS(
            f"Done. {updated} rows updated out of {total} total."
        ))