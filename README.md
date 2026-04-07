# TransportStatistics

TransportStatistics is a Django project for logging journeys and serving rail/bus stop and departure data through HTML pages and REST endpoints.

## Features
- Trip logging with social/privacy controls.
- Stops API with text, type, active-state, and bounding-box filters.
- Train and bus departure APIs.
- Bulk import commands for timetable and stop datasets.

## Tech Stack
- Python 3.10+
- Django 5.x
- Django REST Framework
- MySQL/PostgreSQL/SQLite (via `DATABASE_URL`)

## Quick Start
1. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Copy environment template and adjust values:
   ```bash
   cp .env.example .env
   ```
3. Run migrations and start development server:
   ```bash
   python manage.py migrate
   python manage.py runserver
   ```

See [GETTING_STARTED.md](GETTING_STARTED.md) for import workflows and dataset setup.
Full command reference: [MANAGEMENT_COMMANDS.md](MANAGEMENT_COMMANDS.md).
Standalone schedule updater package: [`tools/schedule_updater`](tools/schedule_updater).

## Logging (toggleable)
Logging is controlled through environment variables:
- `LOGGING_ENABLED=True|False` (default `True`)
- `LOG_LEVEL=DEBUG|INFO|WARNING|ERROR|CRITICAL` (default `INFO`)

Example:
```bash
LOGGING_ENABLED=True LOG_LEVEL=DEBUG python manage.py runserver
```

## Open Source Metadata
- License: [LICENSE](LICENSE)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security policy: [SECURITY.md](SECURITY.md)
