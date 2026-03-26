from django.core.management.base import BaseCommand

from Depatures.models import ScheduleLocation
from Stops.models import Stop


class Command(BaseCommand):
    help = "Replace ScheduleLocation.stop from one Stop to another (by ID)"

    def add_arguments(self, parser):
        parser.add_argument("from_id", type=int, help="ID of the Stop to replace (source)")
        parser.add_argument("to_id", type=int, help="ID of the Stop to assign (destination)")
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
        from_id = options["from_id"]
        to_id = options["to_id"]
        batch_size = options["batch_size"]
        dry_run = options["dry_run"]

        from_stop = Stop.objects.filter(pk=from_id).first()
        if not from_stop:
            self.stderr.write(self.style.ERROR(f"Source Stop id={from_id} not found."))
            return

        to_stop = Stop.objects.filter(pk=to_id).first()
        if not to_stop:
            self.stderr.write(self.style.ERROR(f"Destination Stop id={to_id} not found."))
            return

        qs = ScheduleLocation.objects.filter(stop=from_stop).only("id", "stop")
        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.WARNING(f"No ScheduleLocation rows reference Stop id={from_id}."))
            return

        self.stdout.write(f"Found {total} ScheduleLocation rows to update: replacing stop {from_id} -> {to_id}")

        processed = 0
        updated = 0
        batch = []

        try:
            for loc in qs.iterator(chunk_size=batch_size):
                processed += 1
                loc.stop = to_stop
                batch.append(loc)

                if processed % 100 == 0:
                    self.stdout.write(f"Processed {processed}/{total}; prepared {len(batch)} pending updates...")

                if len(batch) >= batch_size:
                    if not dry_run:
                        ScheduleLocation.objects.bulk_update(batch, ["stop"])
                    updated += len(batch)
                    self.stdout.write(f"  {updated}/{total} updated so far...")
                    batch = []

        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Interrupted by user — flushing pending updates..."))
            if batch and not dry_run:
                ScheduleLocation.objects.bulk_update(batch, ["stop"])
                updated += len(batch)

        if batch:
            if not dry_run:
                ScheduleLocation.objects.bulk_update(batch, ["stop"])
            updated += len(batch)

        if dry_run:
            self.stdout.write(self.style.SUCCESS(f"Dry-run: would update {total} rows. (no changes saved)"))
        else:
            self.stdout.write(self.style.SUCCESS(f"Done. {updated} rows updated (out of {total})."))
