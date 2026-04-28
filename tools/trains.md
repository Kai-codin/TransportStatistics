# GBRAIL Fleet Scraper Guide (Playwright)

This scraper uses Playwright with a persistent browser profile so rotating cookies are handled automatically.
It also follows pagination and scrapes all pages for each ID.

## Output format
Each record in the output JSON looks like this:

```json
{
  "operator": "Avanti West Coast",
  "fleetnumber": "97304",
  "type": "Class 97 (ex Cl. 37)",
  "livery": {
    "name": "Network Rail Yellow",
    "css": "#d7a301"
  }
}
```

## 1. Install dependencies
Install Playwright Python package (if not already installed):

```bash
./venv/bin/pip install playwright
```

Install Chromium for Playwright:

```bash
./venv/bin/playwright install chromium
```

## 2. First run: log in once
Run in headed mode and open login first:

```bash
./venv/bin/python tools/trains.py \
  --start-id 1 \
  --end-id 50 \
  --output gbrail_fleet.json \
  --headed \
  --login-first
```

What to do:
- A browser window opens.
- Log into transittracker manually.
- Wait for the script to continue scraping.

The session is saved in `tools/.playwright-transittracker-profile`.

## 3. Later runs
You can usually run without re-login as long as the saved session is still valid:

```bash
./venv/bin/python tools/scrape_gbrail_fleet.py --start-id 1 --end-id 50 --output gbrail_fleet.json
```

If auth expires, run again with `--headed --login-first`.

## Optional flags
- `--start-id`: First ID to scrape (default `1`)
- `--end-id`: Last ID to scrape (default `50`)
- `--output`: Output JSON path (default `gbrail_fleet.json`)
- `--profile-dir`: Persistent browser profile directory
- `--headed`: Show browser window
- `--login-first`: Open transittracker home first for manual login
- `--pause-after-login`: Seconds to wait after opening login page (default `20`)
- `--delay`: Delay between page requests in seconds (default `0.2`)
- `--timeout`: Page timeout in seconds (default `30`)

## Troubleshooting
- `403 Forbidden`: login/session expired. Re-run with `--headed --login-first`.
- `0 rows`: that ID may be empty, or page format changed.
