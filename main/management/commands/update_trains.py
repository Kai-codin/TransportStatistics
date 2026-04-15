import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from main.models import Operator, Trains


class Command(BaseCommand):
    help = "Update existing Trains from GB Rail fleet JSON (no creates)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default="gbrail_fleet.json",
            help="Path to gbrail fleet JSON file",
        )
        parser.add_argument(
            "--import-missing",
            action="store_true",
            help="Create trains that do not already exist",
        )
        parser.add_argument(
            "--map-file",
            default="map.json",
            help="Operator mapping file path",
        )

    def _load_map(self, map_path: Path) -> dict[str, str]:
        if not map_path.exists():
            return {}
        try:
            raw = json.loads(map_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return {str(k): str(v) for k, v in raw.items()}
        except Exception:
            pass
        return {}

    def _resolve_operator(
        self,
        name: str,
        operator_by_name,
        operator_by_id,
        op_map,
    ):
        key = name.strip()
        if not key:
            return None

        if key.lower() in operator_by_name:
            return operator_by_name[key.lower()]

        mapped = op_map.get(key)
        if mapped and mapped.isdigit():
            return operator_by_id.get(int(mapped))

        return None  # no prompt in update mode

    def handle(self, *args, **options):
        file_path = Path(options["file"]).resolve()
        map_path = Path(options["map_file"]).resolve()

        if not file_path.exists():
            raise CommandError(f"File not found: {file_path}")

        payload = json.loads(file_path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise CommandError("Expected JSON array")

        op_map = self._load_map(map_path)

        operators = list(Operator.objects.all())
        operator_by_id = {op.id: op for op in operators}
        operator_by_name = {op.name.lower(): op for op in operators}

        existing = Trains.objects.in_bulk(field_name="fleetnumber")

        updated = 0
        skipped = 0
        unchanged = 0
        created = 0

        to_create = []
        to_update = []

        for idx, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                skipped += 1
                continue

            fleetnumber = str(item.get("fleetnumber", "")).strip()
            train_type = str(item.get("type", "")).strip()
            operator_name = str(item.get("operator", "")).strip()

            livery = item.get("livery") or {}
            livery_name = str(livery.get("name", "")).strip()
            livery_css = str(livery.get("css", "")).strip()

            if not fleetnumber or not train_type:
                skipped += 1
                continue

            obj = existing.get(fleetnumber)
            if not obj:
                if options["import_missing"]:
                    operator_obj = self._resolve_operator(
                        operator_name,
                        operator_by_name,
                        operator_by_id,
                        op_map,
                    )

                    to_create.append(
                        Trains(
                            operator=operator_obj,
                            fleetnumber=fleetnumber,
                            type=train_type,
                            livery_name=livery_name,
                            livery_css=livery_css,
                        )
                    )

                    created += 1
                    self.stdout.write(f"[{idx}] created (missing): {fleetnumber}")
                else:
                    skipped += 1
                    self.stdout.write(f"[{idx}] skipped (not in DB): {fleetnumber}")
                continue

            operator_obj = self._resolve_operator(
                operator_name,
                operator_by_name,
                operator_by_id,
                op_map,
            )

            changed = False

            if obj.operator_id != (operator_obj.id if operator_obj else None):
                obj.operator = operator_obj
                changed = True

            if obj.type != train_type:
                obj.type = train_type
                changed = True

            if obj.livery_name != livery_name:
                obj.livery_name = livery_name
                changed = True

            if obj.livery_css != livery_css:
                obj.livery_css = livery_css
                changed = True

            if changed:
                to_update.append(obj)
                updated += 1
                status = "updated"
            else:
                unchanged += 1
                status = "unchanged"

            self.stdout.write(f"[{idx}] {status}: {fleetnumber}")

        if to_update:
            Trains.objects.bulk_update(
                to_update,
                ["operator", "type", "livery_name", "livery_css"],
                batch_size=1000,
            )

        if to_create:
            Trains.objects.bulk_create(to_create, batch_size=1000)

        self.stdout.write(
            self.style.SUCCESS(
                f"Update complete: created={created}, updated={updated}, unchanged={unchanged}, skipped={skipped}"
            )
        )