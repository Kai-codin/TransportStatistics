# Management commands

This document lists the project's Django management commands, their purpose, arguments, and usage examples.

Commands found in the repository:

- `Stops/management/commands/import_tiploc_from_tiplocv1.py`
  - Help: Read TiplocV1 NDJSON and assign tiploc to Stop records matching CRS codes when tiploc is empty.
  - Purpose: Parse a Network Rail TiplocV1 NDJSON (or wrapped JSON) and assign TIPLOC codes to existing `Stop` records, or create new `Stop` entries when no CRS/name match exists.
  - Arguments:
    - `--file` (str) Path to TiplocV1.ndjson (default: `data/TiplocV1.ndjson`)
    - `--batch-size` (int) Number of updates to bulk commit at once (default: 500)
    - `--dry-run` (flag) Don't write changes, just report actions
    - `--update` (flag) Also update tiploc on stops that already have one (overwrite existing values)
  - Notes: The command prints progress, supports dry-run and batching, and will create `Stop` records for entries with no CRS when no name match exists.
  - Example:
    ```bash
    python manage.py import_tiploc_from_tiplocv1 --file data/TiplocV1.ndjson --batch-size 1000
    ```

- `Stops/management/commands/split_nr_json.py`
  - Help: Download and split Network Rail CIF JSON file into separate NDJSON files by record type.
  - Purpose: Download (or use a local file) the Network Rail CIF feed and split it into multiple NDJSON files such as `TiplocV1.ndjson`, `JsonScheduleV1.ndjson`, `JsonTimetableV1.ndjson`, and `JsonAssociationV1.ndjson`.
  - Arguments:
    - `--url` (str) Network Rail download URL (defaults to the configured feed URL)
    - `--file` (str) Local file path (gzipped or plain text) to split instead of downloading
    - `--out-dir` (str) Output directory for split files (default: `data`)
    - `--username` / `--password` (str) Network Rail credentials (override .env or environment vars)
  - Notes: The command attempts to load credentials from a `.env` file or environment variables (`NR_USERNAME`/`NR_PASSWORD`) if not supplied. It prefers `requests` for downloading but falls back to `urllib` when `requests` is not available. Output files are created under the specified output directory.
  - Example (local file):
    ```bash
    python manage.py split_nr_json --file /path/to/nr_feed.gz --out-dir data
    ```

- `Stops/management/commands/import_train_stations.py`
  - Help: Download rail stations JSON and import as Stops with StopType RLS
  - Purpose: Import a JSON list of UK rail stations (from a URL or local file) into the `Stop` model, marking them with the `RLS` `StopType`.
  - Arguments:
    - `--url` (str) Stations JSON URL (default points to a GitHub raw stations.json)
    - `--file` (str) Local JSON file path to import (overrides `--url`)
  - Notes: The command will create the `RLS` StopType if it does not exist and uses `update_or_create` when CRS is provided.
  - Example:
    ```bash
    python manage.py import_train_stations --file data/stations.json
    ```

- `Stops/management/commands/import_bus_stops.py`
  - Help: Download NaPTAN CSV and import bus stops into the Stops app
  - Purpose: Download or read a local NaPTAN CSV and create/update `Stop` rows for bus stops. Supports coordinate conversion from Easting/Northing via `pyproj` if installed.
  - Arguments:
    - `--url` (str) CSV URL (default: NaPTAN download URL)
    - `--file` (str) Local CSV file path to import (overrides `--url`)
    - `--batch-size` (int) Number of rows to process per DB batch (default: 2000)
  - Notes: The command batches inserts/updates, creates missing `StopType` entries as needed, and attempts to convert grid references when `pyproj` is available.
  - Example:
    ```bash
    python manage.py import_bus_stops --file data/Naptan.csv --batch-size 3000
    ```

- `Depatures/management/commands/import_json_schedule_v1.py`
  - Help: Import JsonScheduleV1 NDJSON into Timetable and ScheduleLocation models.
  - Purpose: Parse Network Rail JsonScheduleV1 NDJSON (optionally gzipped) and populate `Timetable` and `ScheduleLocation` models. The importer is streaming, batched, and supports resuming and optional updates.
  - Arguments:
    - `--file` (str) Path to JsonScheduleV1 ndjson(.gz) file (default: `data/JsonScheduleV1.ndjson`)
    - `--batch-size` (int) Timetable rows per DB transaction (default: 500)
    - `--dry-run` (flag) Parse only - nothing written to DB
    - `--resume-from` (int) Skip the first N lines and start processing from line N+1; useful for resuming interrupted imports
    - `--update` (flag) When a Timetable already exists, compare fields and update + replace ScheduleLocations only if something changed
  - Notes: The command uses internal caches (`OperatorCache`, `StopCache`) for performance, pre-warms tiploc lookups per batch, and supports insert-only (default) or update mode with field-diffing.
  - Example (resume):
    ```bash
    python manage.py import_json_schedule_v1 --file data/JsonScheduleV1.ndjson.gz --resume-from 25000
    ```


## How this file was generated

I scanned the project's `management/commands` directories and extracted the command `help` strings, arguments from `add_arguments`, and inline notes. If you want richer documentation (e.g., full option lists with default values, or generated `--help` output), I can run each command's `--help` and include the results (requires running Django manage.py in your environment).

Would you like me to also add these command summaries to the main README or auto-generate `--help` output for each command and include it here?
