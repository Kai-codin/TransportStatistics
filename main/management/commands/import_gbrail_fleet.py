import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError

from main.models import Operator, Trains


class Command(BaseCommand):
    help = "Import GB Rail fleet JSON into main.Trains"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default="gbrail_fleet.json",
            help="Path to gbrail fleet JSON file (default: gbrail_fleet.json)",
        )
        parser.add_argument(
            "--map-file",
            default="map.json",
            help="Operator mapping file path (default: map.json)",
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

    def _save_map(self, map_path: Path, mapping: dict[str, str]) -> None:
        map_path.write_text(json.dumps(mapping, indent=2, ensure_ascii=False), encoding="utf-8")

    def _resolve_operator_for_name(
        self,
        operator_name: str,
        operator_by_name: dict[str, Operator],
        operator_by_id: dict[int, Operator],
        op_map: dict[str, str],
        map_path: Path,
        unresolved_cache: dict[str, Operator | None],
    ) -> Operator | None:
        key = operator_name.strip()
        if not key:
            return None

        lowered = key.lower()
        if lowered in operator_by_name:
            return operator_by_name[lowered]

        if key in unresolved_cache:
            return unresolved_cache[key]

        mapped_id = op_map.get(key)
        if mapped_id:
            try:
                mapped_operator = operator_by_id.get(int(mapped_id))
                if mapped_operator:
                    unresolved_cache[key] = mapped_operator
                    return mapped_operator
            except ValueError:
                pass

        self.stdout.write("")
        self.stdout.write(self.style.WARNING(f"Unknown operator in JSON: {key!r}"))
        self.stdout.write("Known operators:")
        for op in sorted(operator_by_id.values(), key=lambda o: o.id):
            self.stdout.write(f"  {op.id}: {op.name}")

        while True:
            raw = input(f"Enter Operator ID for {key!r} (blank = skip this operator): ").strip()
            if raw == "":
                unresolved_cache[key] = None
                return None
            if not raw.isdigit():
                self.stdout.write("Invalid ID. Enter a numeric Operator ID.")
                continue

            selected = operator_by_id.get(int(raw))
            if not selected:
                self.stdout.write(f"Operator ID {raw} not found. Try again.")
                continue

            op_map[key] = str(selected.id)
            self._save_map(map_path, op_map)
            self.stdout.write(self.style.SUCCESS(f"Saved map: {key!r} -> {selected.id}"))
            unresolved_cache[key] = selected
            return selected

    def handle(self, *args, **options):
        file_path = Path(options["file"]).expanduser().resolve()
        map_path = Path(options["map_file"]).expanduser().resolve()
        if not file_path.exists():
            raise CommandError(f"File not found: {file_path}")

        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CommandError(f"Invalid JSON in {file_path}: {exc}") from exc

        if not isinstance(payload, list):
            raise CommandError("Expected top-level JSON array")

        op_map = self._load_map(map_path)

        operators = list(Operator.objects.all())
        operator_by_id = {op.id: op for op in operators}
        operator_by_name = {op.name.lower(): op for op in operators}

        created = 0
        updated = 0
        skipped = 0
        unchanged = 0

        self.stdout.write(f"Starting import from: {file_path}")
        self.stdout.write(f"Using map file: {map_path}")
        self.stdout.write(f"Total input records: {len(payload)}")

        normalized: list[dict] = []
        unresolved_cache: dict[str, Operator | None] = {}

        # Normalize + operator resolution once, then do bulk DB operations.
        for idx, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                skipped += 1
                self.stdout.write(f"[{idx}] skipped: item is not an object")
                continue

            operator_name = str(item.get("operator", "")).strip()
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

            operator_obj = self._resolve_operator_for_name(
                operator_name=operator_name,
                operator_by_name=operator_by_name,
                operator_by_id=operator_by_id,
                op_map=op_map,
                map_path=map_path,
                unresolved_cache=unresolved_cache,
            )

            normalized.append(
                {
                    "idx": idx,
                    "operator_name": operator_name,
                    "operator_obj": operator_obj,
                    "fleetnumber": fleetnumber,
                    "type": train_type,
                    "livery_name": livery_name,
                    "livery_css": livery_css,
                }
            )

        if not normalized:
            self.stdout.write(self.style.WARNING("No valid rows to import."))
            return

        fleetnumbers = [row["fleetnumber"] for row in normalized]
        existing_by_fleet = Trains.objects.in_bulk(fleetnumbers, field_name="fleetnumber")

        to_create: list[Trains] = []
        to_update: list[Trains] = []

        for row in normalized:
            idx = row["idx"]
            fleetnumber = row["fleetnumber"]
            train_type = row["type"]
            operator_obj = row["operator_obj"]
            livery_name = row["livery_name"]
            livery_css = row["livery_css"]

            existing = existing_by_fleet.get(fleetnumber)
            if existing is None:
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
                self.stdout.write(
                    f"[{idx}] created: operator={row['operator_name']!r} fleet={fleetnumber} "
                    f"type={train_type} livery_name={livery_name!r} livery_css_len={len(livery_css)}"
                )
                continue

            changed = False
            if existing.operator_id != (operator_obj.id if operator_obj else None):
                existing.operator = operator_obj
                changed = True
            if existing.type != train_type:
                existing.type = train_type
                changed = True
            if existing.livery_name != livery_name:
                existing.livery_name = livery_name
                changed = True
            if existing.livery_css != livery_css:
                existing.livery_css = livery_css
                changed = True

            if changed:
                to_update.append(existing)
                updated += 1
                action = "updated"
            else:
                unchanged += 1
                action = "unchanged"

            self.stdout.write(
                f"[{idx}] {action}: operator={row['operator_name']!r} fleet={fleetnumber} "
                f"type={train_type} livery_name={livery_name!r} livery_css_len={len(livery_css)}"
            )

        if to_create:
            # Deduplicate by fleetnumber in case input JSON contains duplicates
            unique_map: dict[str, Trains] = {}
            for obj in to_create:
                if obj.fleetnumber in unique_map:
                    # skip duplicate fleetnumber (keep first occurrence)
                    continue
                unique_map[obj.fleetnumber] = obj

            uniques = list(unique_map.values())
            try:
                Trains.objects.bulk_create(uniques, batch_size=1000)
            except IntegrityError:
                # Fallback: create individually and ignore rows that violate uniqueness
                for obj in uniques:
                    try:
                        obj.save()
                    except IntegrityError:
                        # another record with same fleetnumber exists; skip
                        continue
        if to_update:
            Trains.objects.bulk_update(
                to_update,
                fields=["operator", "type", "livery_name", "livery_css"],
                batch_size=1000,
            )

        self.stdout.write(
            self.style.SUCCESS(
                "Import complete: "
                f"created={created}, updated={updated}, unchanged={unchanged}, skipped={skipped}, total={len(payload)}"
            )
        )
