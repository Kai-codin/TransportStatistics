import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from main.models import Trains, Operator


class Command(BaseCommand):
    help = "Import trains from a JSON file"

    def add_arguments(self, parser):
        parser.add_argument(
            "file",
            type=str,
            help="Path to the JSON file"
        )

    def handle(self, *args, **options):
        file_path = options["file"]

        self.stdout.write(self.style.NOTICE(f"📂 Loading file: {file_path}"))

        try:
            with open(file_path, "r") as f:
                data = json.load(f)
        except Exception as e:
            raise CommandError(f"Failed to read file: {e}")

        fleet_data = data.get("fleet", [])
        if not fleet_data:
            raise CommandError("No 'fleet' data found in JSON")

        self.stdout.write(self.style.NOTICE(f"📊 Found {len(fleet_data)} fleet entries"))

        created = 0
        updated = 0
        processed = 0

        with transaction.atomic():
            for i, entry in enumerate(fleet_data, start=1):
                self.stdout.write(self.style.NOTICE(f"\n🚆 Processing fleet entry {i}"))

                operator_id = entry.get("operator_id")
                operator = None

                if operator_id:
                    try:
                        operator = Operator.objects.get(id=operator_id)
                        self.stdout.write(
                            self.style.SUCCESS(f"✔ Operator found: ID {operator_id}")
                        )
                    except Operator.DoesNotExist:
                        self.stdout.write(
                            self.style.WARNING(f"⚠ Operator {operator_id} not found, skipping operator assignment")
                        )
                else:
                    self.stdout.write(self.style.WARNING("⚠ No operator_id provided"))

                fleet_numbers = entry.get("fleet_numbers", [])
                self.stdout.write(
                    self.style.NOTICE(f"🔢 {len(fleet_numbers)} fleet numbers to process")
                )

                for fleet_number in fleet_numbers:
                    obj, was_created = Trains.objects.update_or_create(
                        fleetnumber=str(fleet_number),
                        defaults={
                            "operator": operator,
                            "type": entry.get("type", ""),
                            "livery_name": entry.get("livery_name", ""),
                            "livery_css": entry.get("livery_css", ""),
                        },
                    )

                    processed += 1

                    if was_created:
                        created += 1
                        self.stdout.write(f"  ➕ Created: {fleet_number}")
                    else:
                        updated += 1
                        self.stdout.write(f"  🔄 Updated: {fleet_number}")

                    # Optional: reduce spam for huge imports
                    if processed % 50 == 0:
                        self.stdout.write(
                            self.style.NOTICE(
                                f"📈 Progress: {processed} processed ({created} created, {updated} updated)"
                            )
                        )

        self.stdout.write(self.style.SUCCESS(
            f"\n✅ Import complete: {created} created, {updated} updated, {processed} total"
        ))