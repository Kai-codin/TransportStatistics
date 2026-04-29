import json
from collections import defaultdict

from django.core.management.base import BaseCommand
from main.models import Trains


class Command(BaseCommand):
    help = "Export trains to a JSON file"

    def add_arguments(self, parser):
        parser.add_argument(
            "file",
            type=str,
            help="Output JSON file path"
        )
        parser.add_argument(
            "--operator",
            type=int,
            help="Filter by operator ID"
        )

    def handle(self, *args, **options):
        file_path = options["file"]
        operator_filter = options.get("operator")

        self.stdout.write(self.style.NOTICE(f"📤 Exporting to: {file_path}"))

        # Query trains
        qs = Trains.objects.all().order_by("fleetnumber")

        if operator_filter:
            qs = qs.filter(operator_id=operator_filter)
            self.stdout.write(f"🔍 Filtering by operator {operator_filter}")

        total = qs.count()
        self.stdout.write(f"🚆 Found {total} trains")

        if total == 0:
            self.stdout.write(self.style.WARNING("⚠ No trains found to export"))

        # Grouping
        grouped = defaultdict(list)

        for train in qs:
            key = (
                train.operator_id,
                train.type,
                train.livery_name,
                train.livery_css,
            )
            grouped[key].append(int(train.fleetnumber))

        self.stdout.write(f"🧩 Grouped into {len(grouped)} entries")

        # Build JSON
        fleet = []

        for i, ((operator_id, type_, livery_name, livery_css), fleet_numbers) in enumerate(grouped.items(), start=1):
            fleet_numbers_sorted = sorted(fleet_numbers)

            self.stdout.write(
                f"📦 Entry {i}: {len(fleet_numbers_sorted)} vehicles"
            )

            fleet.append({
                "operator_id": operator_id,
                "type": type_,
                "livery_name": livery_name,
                "livery_css": livery_css,
                "fleet_numbers": fleet_numbers_sorted,
            })

        output = {"fleet": fleet}

        # WRITE FILE (no reading!)
        try:
            with open(file_path, "w") as f:
                json.dump(output, f, indent=2)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"❌ Failed to write file: {e}"))
            return

        self.stdout.write(self.style.SUCCESS(
            f"\n✅ Export complete: {total} trains written"
        ))