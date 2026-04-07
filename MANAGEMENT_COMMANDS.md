# Command Reference

This file documents all project-specific commands in this repository.

## How To Run
- Django management commands: `python manage.py <command> [options]`
- Utility scripts: `python <script.py> [args]`

## Django Built-In Commands
Django also provides built-in commands (`runserver`, `migrate`, `makemigrations`, `createsuperuser`, etc.).

Use:
```bash
python manage.py help
python manage.py help <command>
```

## Project Management Commands

### `import_json_schedule_v1`
File: `Depatures/management/commands/import_json_schedule_v1.py`

Purpose: high-performance importer for `JsonScheduleV1` NDJSON into `Timetable` and `ScheduleLocation`.

Options:
- `--file` (default: `data/JsonScheduleV1.ndjson`)
- `--batch-size` (default: `2000`)
- `--dry-run`
- `--resume-from LINE` (default: `0`)
- `--update`
- `--replace`
- `--parallel-locs`
- `--show-locks`
- `--kill-locks`

Examples:
```bash
python manage.py import_json_schedule_v1 --replace
python manage.py import_json_schedule_v1 --update --batch-size 1000
python manage.py import_json_schedule_v1 --resume-from 250000 --update
python manage.py import_json_schedule_v1 --show-locks
```

### `correct_stop`
File: `Depatures/management/commands/correct_stop.py`

Purpose: replace one `Stop` FK with another on `ScheduleLocation` rows.

Arguments:
- positional `from_id`
- positional `to_id`

Options:
- `--batch-size` (default: `1000`)
- `--dry-run`

Example:
```bash
python manage.py correct_stop 123 456 --dry-run
```

### `fix_timetables`
File: `Depatures/management/commands/fix_timetables.py`

Purpose: backfill missing `ScheduleLocation.stop` from TIPLOC codes.

Options:
- `--batch-size` (default: `1000`)
- `--dry-run`

Example:
```bash
python manage.py fix_timetables --batch-size 2000
```

### `populate_sort_times`
File: `Depatures/management/commands/populate_sort_times.py`

Purpose: populate/recompute `sort_time` for `ScheduleLocation` rows.

Options:
- `--batch-size` (default: `2000`)
- `--only-null`

Example:
```bash
python manage.py populate_sort_times --only-null
```

### `dedupe_timetables`
File: `Depatures/management/commands/dedupe_timetables.py`

Purpose: remove duplicate `Timetable` rows while handling child FK rows first.

Options: none (chunk size is internal: `500`).

Example:
```bash
python manage.py dedupe_timetables
```

### `mysql_diagnostics`
File: `Depatures/management/commands/mysql_diagnostics.py`

Purpose: print MySQL memory variables, buffer status, and processlist.

Options: none.

Example:
```bash
python manage.py mysql_diagnostics
```

### `split_nr_json`
File: `Stops/management/commands/split_nr_json.py`

Purpose: download (or read local) Network Rail CIF file and split into NDJSON by record type.

Options:
- `--url` (default: official CIF feed URL)
- `--file` (local file instead of download)
- `--out-dir` (default: `data`)
- `--username`
- `--password`

Examples:
```bash
python manage.py split_nr_json --file /path/to/CIF.gz --out-dir data
python manage.py split_nr_json --out-dir data --username "$NR_USERNAME" --password "$NR_PASSWORD"
```

### `import_tiploc_from_tiplocv1`
File: `Stops/management/commands/import_tiploc_from_tiplocv1.py`

Purpose: import TIPLOC mappings into `Stop` records from `TiplocV1` NDJSON.

Options:
- `--file` (default: `data/TiplocV1.ndjson`)
- `--batch-size` (default: `500`)
- `--dry-run`
- `--update` (overwrite existing tiploc values)

Examples:
```bash
python manage.py import_tiploc_from_tiplocv1 --dry-run
python manage.py import_tiploc_from_tiplocv1 --file data/TiplocV1.ndjson --batch-size 1000 --update
```

### `import_train_stations`
File: `Stops/management/commands/import_train_stations.py`

Purpose: import rail stations JSON into `Stops` with `StopType=RLS`.

Options:
- `--url` (remote JSON source)
- `--file` (default: `stations.json`)
- `--cache-ttl` (default: `86400`)

Examples:
```bash
python manage.py import_train_stations --file stations.json
python manage.py import_train_stations --url https://example.com/stations.json
```

### `import_bus_stops`
File: `Stops/management/commands/import_bus_stops.py`

Purpose: import NaPTAN CSV bus stops into `Stops`.

Options:
- `--url` (default: NaPTAN CSV URL)
- `--file` (local CSV; overrides `--url`)
- `--batch-size` (default: `2000`)

Examples:
```bash
python manage.py import_bus_stops --url https://beta-naptan.dft.gov.uk/Download/National/csv
python manage.py import_bus_stops --file data/naptan.csv --batch-size 3000
```

### `update_bus_stops`
File: `Stops/management/commands/update_bus_stops.py`

Purpose: append indicator to bus stop names where missing.

Options:
- `--dry-run`
- `--limit`, `-n` (default: `0` = unlimited)
- `--atco`, `-a`

Examples:
```bash
python manage.py update_bus_stops --dry-run
python manage.py update_bus_stops --atco 1800SB12345 --limit 10
```

### `enrich_stops`
File: `Stops/management/commands/enrich_stops.py`

Purpose: enrich stops via bustimes API and/or indicator name updates.

Options:
- `--commit`
- `--atco`, `-a`
- `--limit`, `-n` (default: `0`)
- `--sleep` (default: `0.01`)
- `--indicators`
- `--bustimes`

Examples:
```bash
python manage.py enrich_stops --limit 100
python manage.py enrich_stops --atco 1800SB12345 --sleep 0.1 --commit
```

### `enrich_stops_bustimes`
File: `Stops/management/commands/enrich_stops_bustimes.py`

Purpose: enrich stop data from bustimes.org using `atco_code`.

Options:
- `--commit`
- `--atco`, `-a`
- `--limit`, `-n` (default: `0`)
- `--sleep` (default: `0.05`)

Examples:
```bash
python manage.py enrich_stops_bustimes --limit 100
python manage.py enrich_stops_bustimes --atco 1800SB12345 --commit
```

### `import_gbrail_fleet`
File: `main/management/commands/import_gbrail_fleet.py`

Purpose: import GB rail fleet data into `main.Trains` and resolve operators.

Options:
- `--file` (default: `gbrail_fleet.json`)
- `--map-file` (default: `map.json`)

Example:
```bash
python manage.py import_gbrail_fleet --file gbrail_fleet.json --map-file map.json
```

## Utility Script Commands

### `tools/json_to_csv.py`
Purpose: flatten JSON and convert to CSV.

Arguments:
- positional `input` (`-` for stdin)
- positional `output` (`-` for stdout)

Examples:
```bash
python tools/json_to_csv.py input.json output.csv
cat input.json | python tools/json_to_csv.py - output.csv
python tools/json_to_csv.py input.json -
```

### `stations.py`
Purpose: fetch Network Rail CORPUS and OSM station data, then write merged `stations.json`.

Environment:
- `NR_USERNAME`
- `NR_PASSWORD`

Run:
```bash
python stations.py
```

### `tools/schedule_updater` package
Purpose: installable mini package for running train schedule update pipeline on another server.

Install:
```bash
pip install ./tools/schedule_updater
```

Run:
```bash
ts-schedule-updater --project-dir /srv/TransportStatistics --update
```

Docs:
- `tools/schedule_updater/README.md`

## Discover Commands Quickly

List project management commands:
```bash
find . -type f -path '*/management/commands/*.py' ! -name '__init__.py' | sort
```

List script-style command files:
```bash
ls tools
```
