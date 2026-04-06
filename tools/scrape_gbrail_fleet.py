#!/usr/bin/env python3
"""Scrape GBRAIL fleet-completion pages using Playwright persistent context.

Expected output shape per record:
{
  "fleetnumber": "97304",
  "type": "Class 97 (ex Cl. 37)",
  "livery": {
    "name": "Network Rail Yellow",
    "css": "#d7a301"
  }
}
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE_URL = "https://transittracker.net/Kai/fleet-completion/GBRAIL/{id}"


def collapse_ws(value: str) -> str:
    return " ".join(value.split())


def extract_background(style: str) -> str:
    if not style:
        return ""

    # Parse inline style declarations safely, preserving complex gradient values.
    for declaration in style.split(";"):
        if ":" not in declaration:
            continue
        prop, value = declaration.split(":", 1)
        if prop.strip().lower() == "background":
            return collapse_ws(value.strip())
    return ""


def parse_page(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select("tbody[data-flux-rows] tr[data-flux-row]")
    results: list[dict[str, Any]] = []

    for row in rows:
        cells = row.select("td[data-flux-cell]")
        if len(cells) < 4:
            continue

        livery_cell = cells[0]
        swatch = livery_cell.select_one("div.w-12.h-8.rounded.border.flex-shrink-0.overflow-hidden")
        if swatch is None:
            swatch = livery_cell.select_one("div[style]")

        livery_css = extract_background(swatch.get("style", "") if swatch else "")

        name_el = livery_cell.select_one("div.text-sm.font-medium.truncate")
        livery_name = collapse_ws(name_el.get_text(strip=True)) if name_el else ""

        fleet_number = collapse_ws(cells[1].get_text(" ", strip=True))
        vehicle_type = collapse_ws(cells[3].get_text(" ", strip=True))

        if not fleet_number or not vehicle_type:
            continue

        results.append(
            {
                "fleetnumber": fleet_number,
                "type": vehicle_type,
                "livery": {
                    "name": livery_name,
                    "css": livery_css,
                },
            }
        )

    return results


def collect_rows_from_paginated_view(page, timeout_seconds: float) -> list[dict[str, Any]]:
    """Collect all rows from current page, following pagination next buttons when present."""
    all_rows: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str, str, str]] = set()
    timeout_ms = int(timeout_seconds * 1000)

    while True:
        html = page.content()
        rows = parse_page(html)
        for row in rows:
            key = (
                row["fleetnumber"],
                row["type"],
                row["livery"]["name"],
                row["livery"]["css"],
            )
            if key in seen_keys:
                continue
            seen_keys.add(key)
            all_rows.append(row)

        next_button = page.locator(
            "div[data-flux-pagination] button[wire\\:click*=\"nextPage\"]:visible"
        ).first

        if next_button.count() == 0:
            break

        first_fleet_locator = page.locator(
            "tbody[data-flux-rows] tr[data-flux-row] td[data-flux-cell]:nth-child(2)"
        ).first
        first_key_before = first_fleet_locator.inner_text().strip() if first_fleet_locator.count() else ""
        next_button.click()

        try:
            page.wait_for_function(
                """
                (previousFleet) => {
                    const firstFleetCell = document.querySelector(
                        "tbody[data-flux-rows] tr[data-flux-row] td[data-flux-cell]:nth-child(2)"
                    );
                    if (!firstFleetCell) return true;
                    return firstFleetCell.textContent.trim() !== previousFleet;
                }
                """,
                arg=first_key_before,
                timeout=timeout_ms,
            )
        except PlaywrightTimeoutError:
            # If DOM didn't visibly change but click succeeded, avoid infinite loops.
            break

    return all_rows


def scrape_ids(
    start_id: int,
    end_id: int,
    profile_dir: Path,
    delay_seconds: float,
    timeout_seconds: float,
    headed: bool,
    login_first: bool,
    pause_after_login: float,
    user_agent: str,
) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    timeout_ms = int(timeout_seconds * 1000)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=not headed,
            user_agent=user_agent,
            args=["--disable-blink-features=AutomationControlled"],
        )

        page = context.new_page()
        page.set_extra_http_headers(
            {
                "Accept-Language": "en-GB,en;q=0.9",
                "Pragma": "no-cache",
                "Cache-Control": "no-cache",
            }
        )
        page.set_default_navigation_timeout(timeout_ms)

        if login_first:
            print("[info] Opening site for manual login. Complete login in the browser window.")
            page.goto("https://transittracker.net", wait_until="domcontentloaded")
            if headed:
                input("[info] After you finish login in the browser, press Enter to continue scraping...")
            elif pause_after_login > 0:
                print(f"[info] Waiting {pause_after_login}s for login/cookie settlement...")
                time.sleep(pause_after_login)

        saw_403 = False
        for page_id in range(start_id, end_id + 1):
            url = BASE_URL.format(id=page_id)
            try:
                response = page.goto(url, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                print(f"[warn] ID {page_id}: navigation timeout", file=sys.stderr)
                continue

            status = response.status if response else None
            if status == 403:
                saw_403 = True
                print(
                    f"[warn] ID {page_id}: 403 Forbidden (session not authenticated/expired)",
                    file=sys.stderr,
                )
                continue

            rows = collect_rows_from_paginated_view(page, timeout_seconds=timeout_seconds)
            print(f"ID {page_id}: {len(rows)} rows (all pagination pages)")
            all_rows.extend(rows)

            if delay_seconds > 0:
                time.sleep(delay_seconds)

        context.close()

    if saw_403:
        print(
            "[info] One or more 403 responses detected. Run again with --headed --login-first and complete login first.",
            file=sys.stderr,
        )

    return all_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape transittracker GBRAIL fleet completion pages into JSON using Playwright."
    )
    parser.add_argument("--start-id", type=int, default=1, help="First ID (default: 1)")
    parser.add_argument("--end-id", type=int, default=50, help="Last ID (default: 50)")
    parser.add_argument(
        "--output",
        default="gbrail_fleet.json",
        help="Output JSON file path (default: gbrail_fleet.json)",
    )
    parser.add_argument(
        "--profile-dir",
        default="tools/.playwright-transittracker-profile",
        help="Persistent browser profile directory (default: tools/.playwright-transittracker-profile)",
    )
    parser.add_argument(
        "--login-first",
        action="store_true",
        help="Open transittracker root first so you can manually log in before scraping.",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run with visible browser window (recommended for login/auth).",
    )
    parser.add_argument(
        "--user-agent",
        default="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0",
        help="Browser User-Agent string.",
    )
    parser.add_argument(
        "--pause-after-login",
        type=float,
        default=20.0,
        help="Seconds to wait after opening login page when --login-first is used (default: 20).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.2,
        help="Delay in seconds between requests (default: 0.2)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Per-page timeout in seconds (default: 30)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.start_id > args.end_id:
        print("--start-id must be <= --end-id", file=sys.stderr)
        return 2

    profile_dir = Path(args.profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)

    rows = scrape_ids(
        start_id=args.start_id,
        end_id=args.end_id,
        profile_dir=profile_dir,
        delay_seconds=args.delay,
        timeout_seconds=args.timeout,
        headed=args.headed,
        login_first=args.login_first,
        pause_after_login=args.pause_after_login,
        user_agent=args.user_agent,
    )

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(rows)} records to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
