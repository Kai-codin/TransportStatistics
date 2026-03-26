from django.core.management.base import BaseCommand
from Depatures.models import ScheduleLocation
from Stops.models import Stop


def _build_tiploc_map() -> dict[str, Stop]:
    """
    Load all stops into a tiploc → Stop dict in a single query pass.
    Covers both primary `tiploc` and comma-separated `other_tiplocs`.
    """
    tiploc_map: dict[str, Stop] = {}

    for stop in Stop.objects.only("id", "tiploc", "other_tiplocs").iterator(chunk_size=2000):
        if stop.tiploc:
            tiploc_map.setdefault(stop.tiploc.strip(), stop)

        if stop.other_tiplocs:
            for part in stop.other_tiplocs.split(","):
                part = part.strip()
                if part:
                    tiploc_map.setdefault(part, stop)

    return tiploc_map


class Command(BaseCommand):
    help = "Assign Stop foreign keys on ScheduleLocation rows using their Tiploc codes"

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=1000,
            help="Rows per bulk_update batch (default: 1000)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Don't save changes; just report what would be updated",
        )

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        dry_run = options["dry_run"]

        self.stdout.write("Building tiploc lookup map from all stops...")
        tiploc_map = _build_tiploc_map()
        self.stdout.write(f"  Loaded {len(tiploc_map)} tiploc entries.\n")

        qs = (
            ScheduleLocation.objects
            .only("id", "tiploc_code", "stop")
            .filter(tiploc_code__isnull=False, stop__isnull=True)
            .exclude(tiploc_code__exact="")
        )

        total = qs.count()
        updated = 0
        not_found = 0
        processed = 0
        batch: list[ScheduleLocation] = []

        self.stdout.write(f"Processing {total} ScheduleLocation rows with tiploc but no stop...\n")

        def flush_batch():
            nonlocal updated, batch
            if batch and not dry_run:
                ScheduleLocation.objects.bulk_update(batch, ["stop"])
            updated += len(batch)
            batch = []

        try:
            for loc in qs.iterator(chunk_size=batch_size):
                processed += 1
                code = (loc.tiploc_code or "").strip()
                if not code:
                    continue

                stop = tiploc_map.get(code)
                if stop:
                    loc.stop = stop
                    batch.append(loc)
                else:
                    not_found += 1

                if processed % 100 == 0:
                    self.stdout.write(
                        f"  {processed}/{total} processed | "
                        f"{updated + len(batch)} assigned | "
                        f"{not_found} unmatched"
                    )

                if len(batch) >= batch_size:
                    flush_batch()
                    self.stdout.write(f"  → {updated} rows committed so far...")

        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nInterrupted — flushing pending batch..."))
            flush_batch()

        finally:
            flush_batch()

        label = "[DRY RUN] Would have updated" if dry_run else "Updated"
        self.stdout.write(self.style.SUCCESS(
            f"\nDone. {label} {updated} rows. "
            f"{not_found} unmatched (of {total} total)."
        ))