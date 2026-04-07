# TS Schedule Updater

Small standalone package to run the train schedule update pipeline on another server.

## What it does
- Runs Django management commands in sequence against your project:
1. Optional: `split_nr_json` (download/split CIF feed)
2. `import_json_schedule_v1` (update or replace timetable)
3. Optional: `fix_timetables`
4. Optional: `populate_sort_times`

## Install
From this repository root:

```bash
pip install ./tools/schedule_updater
```

## Basic usage

```bash
ts-schedule-updater --project-dir /srv/TransportStatistics --update
```

## Replace mode (full refresh)

```bash
ts-schedule-updater --project-dir /srv/TransportStatistics --replace --parallel-locs
```

## Download latest CIF first

```bash
ts-schedule-updater \
  --project-dir /srv/TransportStatistics \
  --download-cif \
  --out-dir data \
  --update
```

## Common options
- `--project-dir`: path containing `manage.py` (required)
- `--python`: python executable to run manage.py (default: current python)
- `--update` or `--replace` (exactly one required)
- `--batch-size N`
- `--resume-from LINE`
- `--parallel-locs`
- `--dry-run`
- `--run-fix-timetables`
- `--run-sort-times`

### CIF download/split options
- `--download-cif`
- `--cif-file /path/to/local/cif.gz`
- `--out-dir data`
- `--nr-username USER`
- `--nr-password PASS`

## Cron example

```bash
0 3 * * * /usr/bin/ts-schedule-updater --project-dir /srv/TransportStatistics --update --parallel-locs >> /var/log/ts-schedule-updater.log 2>&1
```
