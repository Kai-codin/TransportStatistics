import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from main.models import Trains


class Command(BaseCommand):
    help = "Import GB Rail fleet JSON into main.Trains"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default="gbrail_fleet.json",
            help="Path to gbrail fleet JSON file (default: gbrail_fleet.json)",
        )

    def handle(self, *args, **options):
        file_path = Path(options["file"]).expanduser().resolve()
        if not file_path.exists():
            raise CommandError(f"File not found: {file_path}")

        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CommandError(f"Invalid JSON in {file_path}: {exc}") from exc

        if not isinstance(payload, list):
            raise CommandError("Expected top-level JSON array")

        created = 0
        updated = 0
        skipped = 0
        self.stdout.write(f"Starting import from: {file_path}")
        self.stdout.write(f"Total input records: {len(payload)}")

        for idx, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                skipped += 1
                self.stdout.write(f"[{idx}] skipped: item is not an object")
                continue

            fleetnumber = str(item.get("fleetnumber", "")).strip()
            train_type = str(item.get("type", "")).strip()
            livery = item.get("livery") or {}

            livery_name = ""
            livery_css = ""
            if isinstance(livery, dict):
                livery_name = str(livery.get("name", "")).strip()
                livery_css = str(livery.get("css", "")).strip()

            if not fleetnumber or not train_type:
                skipped += 1
                self.stdout.write(
                    f"[{idx}] skipped: missing fleetnumber/type (fleetnumber={fleetnumber!r}, type={train_type!r})"
                )
                continue

            _, was_created = Trains.objects.update_or_create(
                fleetnumber=fleetnumber,
                defaults={
                    "type": train_type,
                    "livery_name": livery_name,
                    "livery_css": livery_css,
                },
            )
            if was_created:
                created += 1
                action = "created"
            else:
                updated += 1
                action = "updated"

            self.stdout.write(
                f"[{idx}] {action}: fleet={fleetnumber} type={train_type} "
                f"livery_name={livery_name!r} livery_css_len={len(livery_css)}"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Import complete: created={created}, updated={updated}, skipped={skipped}, total={len(payload)}"
            )
        )
