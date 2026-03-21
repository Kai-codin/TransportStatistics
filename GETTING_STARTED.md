**Getting Started**
- **Repo:** Clone or open the repository at the project root.

**Prerequisites**
- **Python:** 3.10+ recommended. Create and activate a virtualenv.
- **Dependencies:** Install with `pip install -r requirements.txt`.
- **Optional system libs:** `pyproj` is used for Easting/Northing → lat/lon conversions (used by bus stops import).
- **Environment:** Create a `.env` (at project root) containing any secrets. If you plan to download Network Rail CIF data set `NR_USERNAME` and `NR_PASSWORD`.

**Initial setup**
- **Migrate DB:** Run `python manage.py migrate` to create database tables.
- **Create superuser:** `python manage.py createsuperuser` (optional for admin access).

**Data files (example location)**
- The repository expects NDJSON/CSV files in the `data/` folder by default:
  - `data/JsonScheduleV1.ndjson` — Network Rail schedule records
  - `data/JsonTimetableV1.ndjson` — timetable excerpts
  - `data/JsonAssociationV1.ndjson` — associations
  - `data/TiplocV1.ndjson` — TIPLOC mappings
  - `data/JsonAssociationV1.ndjson` and `data/JsonTimetableV1.ndjson` may also be produced by the split utility
  - For bus stops you can provide a NaPTAN CSV file (or use the default download URL)

** Helpful utilities**
- Split a Network Rail CIF download into per-record NDJSON files (requires NR credentials or a local file):

```bash
python manage.py split_nr_json --file path/to/CIF.gz --out-dir data
# or to download directly (requires NR_USERNAME/NR_PASSWORD in .env):
python manage.py split_nr_json --out-dir data --username $NR_USERNAME --password $NR_PASSWORD
```

This will create: `data/TiplocV1.ndjson`, `data/JsonScheduleV1.ndjson`, `data/JsonTimetableV1.ndjson`, and `data/JsonAssociationV1.ndjson`.

**Import order & commands**
Recommended sequence and example commands (defaults assume files in `data/`):

1. TIPLOCs → match/assign TIPLOC codes to existing stops
- Purpose: assign TIPLOC codes to `Stops` rows (matches by CRS or name); supports `--dry-run` and `--update`.
- Command example:

```bash
python manage.py import_tiploc_from_tiplocv1 --file data/TiplocV1.ndjson --batch-size 500
# Dry-run to preview changes:
python manage.py import_tiploc_from_tiplocv1 --file data/TiplocV1.ndjson --dry-run
# Overwrite existing tiploc values:
python manage.py import_tiploc_from_tiplocv1 --file data/TiplocV1.ndjson --update
```

2. Schedules → import JsonScheduleV1 into Timetable + ScheduleLocation
- Purpose: parse `JsonScheduleV1.ndjson`, pick best STP record per CIF UID, and create/update `Timetable` and `ScheduleLocation` rows.
- Key flags: `--file`, `--batch-size`, `--resume-from`, `--dry-run`, `--update`.
- Command example:

```bash
# Import with updates enabled, smaller batch for testing
python manage.py import_json_schedule_v1 --file data/JsonScheduleV1.ndjson --batch-size 100 --update
# Resume at a specific line if an import was interrupted
python manage.py import_json_schedule_v1 --file data/JsonScheduleV1.ndjson --resume-from 100000 --update
# Parse only, no DB writes
python manage.py import_json_schedule_v1 --file data/JsonScheduleV1.ndjson --dry-run
```

Notes: the schedule importer pre-warms TIPLOC -> Stop mappings and defers expensive work to a second pass; use `--update` to refresh existing timetables when the data changes.

3. Train stations → import station list as `Stops` rows
- Purpose: create or update rail station `Stop` records (StopType `RLS`).
- Command example:

```bash
python manage.py import_train_stations --file path/to/stations.json
# Default downloads a curated stations.json from a public repo if --file is omitted
```

4. Bus stops → import NaPTAN CSV into `Stops`
- Purpose: download or read a local NaPTAN CSV and create/update bus stop `Stop` records.
- Flags: `--url` (download), `--file` (local CSV to import), `--batch-size`.
- Command example:

```bash
# Download latest NaPTAN and import
python manage.py import_bus_stops --url "https://beta-naptan.dft.gov.uk/Download/National/csv"
# Use a local file
python manage.py import_bus_stops --file data/naptan.csv --batch-size 2000
```

Important: `import_bus_stops` will try to convert Easting/Northing to lat/lon with `pyproj`; install `pyproj` if you want that conversion.

**Other utilities**
- `populate_sort_times` (Depatures management command): recompute/refresh sort times for schedule locations (useful after imports). See its help for usage.

**Tips & troubleshooting**
- Use `--dry-run` where available to preview changes without writing to the DB.
- For large NDJSON files, pick a smaller `--batch-size` for testing then scale up for production.
- If an import fails mid-run, use `--resume-from LINE` where supported (line numbers are 1-based) to skip already-processed input.
- Ensure `.env` credentials (e.g., `NR_USERNAME`, `NR_PASSWORD`) are set when using remote downloads.
- Check logs/output for warnings about missing tiplocs or skipped rows; those generally indicate data mismatches.

**Example full workflow**

```bash
# 1. Set up environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# add NR_USERNAME/NR_PASSWORD to .env if you will download CIF files

# 2. Apply migrations
python manage.py migrate

# 3. Split a downloaded CIF full file (or use local file)
python manage.py split_nr_json --file /path/to/cif.gz --out-dir data

# 4. Assign TIPLOC values
python manage.py import_tiploc_from_tiplocv1 --file data/TiplocV1.ndjson --batch-size 500

# 5. Import schedules
python manage.py import_json_schedule_v1 --file data/JsonScheduleV1.ndjson --batch-size 500 --update

# 6. Import stations and bus stops (optional)
python manage.py import_train_stations --file data/stations.json
python manage.py import_bus_stops --file data/naptan.csv
```

**Where to look for issues**
- Django `stderr` / command output shows parsing errors and skipped rows.
- Log messages: some commands log at `INFO`/`WARNING` levels; check the console output when running commands.
- Use the Django admin UI to inspect `Stops`, `Timetable`, and `ScheduleLocation` after imports.

If you'd like, I can:
- add this file to the repo now (saved as `GETTING_STARTED.md`),
- add example `.env` template, or
- run a dry-run import for a small sample file and report results.
