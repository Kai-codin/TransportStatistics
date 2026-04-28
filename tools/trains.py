#!/usr/bin/env python3
"""Scrape GBRAIL fleet-completion pages (MERGE MODE + REAL CSS)."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE_URL = "https://transittracker.net/Kai/fleet-completion/GBRAIL/{id}"


# -------------------------
# Helpers
# -------------------------

def collapse_ws(value: str) -> str:
    return " ".join(value.split())


def clean_type(text: str) -> str:
    # "Class 43 HST (0%)" → "Class 43 HST"
    return re.sub(r"\s*\(.*?\)", "", text).strip()


def extract_operator_name(soup: BeautifulSoup) -> str:
    heading = soup.select_one("div[data-flux-heading]")
    if not heading:
        return ""
    text = collapse_ws(heading.get_text(" ", strip=True))
    if " — " in text:
        return text.split(" — ", 1)[1].strip()
    return ""


def extract_livery_css(soup: BeautifulSoup) -> dict[str, str]:
    """Extract .livery-XXX background styles from <style> block"""
    css_map: dict[str, str] = {}

    styles = soup.find_all("style")
    pattern = re.compile(r"\.(livery-\d+)\s*\{[^}]*background:\s*([^;]+);", re.DOTALL)

    for style in styles:
        content = style.string or ""
        for match in pattern.finditer(content):
            cls = match.group(1).strip()
            bg = collapse_ws(match.group(2))
            css_map[cls] = bg

    return css_map


# -------------------------
# Parser
# -------------------------

def parse_page(html: str) -> tuple[str, list[dict[str, Any]]]:
    soup = BeautifulSoup(html, "html.parser")

    operator_name = extract_operator_name(soup)
    css_map = extract_livery_css(soup)

    results: list[dict[str, Any]] = []

    sections = soup.select("span.whitespace-nowrap")

    for section in sections:
        raw_type = collapse_ws(section.get_text(strip=True))
        if not raw_type:
            continue

        vehicle_type = clean_type(raw_type)

        parent = section.find_parent("div")
        if not parent:
            continue

        grid = parent.find_next_sibling("div")
        if not grid:
            continue

        cards = grid.select("div[data-flux-card]:has(div.livery)")

        for card in cards:
            headings = card.select("div[data-flux-heading]")
            if not headings:
                continue

            fleet_number = collapse_ws(headings[0].get_text(strip=True))
            if not fleet_number:
                continue

            livery_div = card.select_one("div.livery")
            livery_class = ""

            if livery_div:
                for cls in livery_div.get("class", []):
                    if cls.startswith("livery-"):
                        livery_class = cls
                        break

            css_value = css_map.get(livery_class, "")

            results.append(
                {
                    "operator": operator_name,
                    "fleetnumber": fleet_number,
                    "type": vehicle_type,
                    "livery": {
                        "name": "",  # unchanged (no source for name yet)
                        "css": css_value,
                    },
                }
            )

    return operator_name, results


# -------------------------
# Merge JSON
# -------------------------

def merge_rows(existing: list[dict], new: list[dict]) -> list[dict]:
    """Merge without duplicates, update CSS if changed"""

    index = {
        (r["operator"], r["fleetnumber"], r["type"]): r
        for r in existing
    }

    for row in new:
        key = (row["operator"], row["fleetnumber"], row["type"])

        if key in index:
            # update CSS if new one exists
            if row["livery"]["css"]:
                index[key]["livery"]["css"] = row["livery"]["css"]
        else:
            index[key] = row

    return list(index.values())


# -------------------------
# Scraper
# -------------------------

def scrape_ids(
    start_id: int,
    end_id: int,
    profile_dir: Path,
    delay_seconds: float,
    timeout_seconds: float,
    headed: bool,
    login_first: bool,
) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    timeout_ms = int(timeout_seconds * 1000)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=not headed,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )

        page = context.new_page()

        page.set_extra_http_headers({
            "Accept-Language": "en-GB,en;q=0.9",
        })

        page.set_default_navigation_timeout(timeout_ms)

        print("[info] Opening main site...")
        page.goto("https://transittracker.net", wait_until="domcontentloaded")

        if headed or login_first:
            print("[info] Log in then press ENTER...")
            input()

        time.sleep(2)

        for page_id in range(start_id, end_id + 1):
            url = BASE_URL.format(id=page_id)

            time.sleep(max(0.5, delay_seconds))

            try:
                response = page.goto(
                    url,
                    wait_until="domcontentloaded",
                    referer="https://transittracker.net/",
                )
            except PlaywrightTimeoutError:
                print(f"[warn] ID {page_id}: timeout", file=sys.stderr)
                continue

            status = response.status if response else None
            if status == 403:
                print(f"[warn] ID {page_id}: 403", file=sys.stderr)
                continue

            try:
                page.wait_for_selector("div.livery", timeout=10000)
            except:
                print(f"[warn] ID {page_id}: no data", file=sys.stderr)
                continue

            html = page.content()
            operator_name, rows = parse_page(html)

            print(f"ID {page_id}: {len(rows)} rows ({operator_name or 'unknown'})")
            all_rows.extend(rows)

        context.close()

    return all_rows


# -------------------------
# CLI
# -------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-id", type=int, default=1)
    parser.add_argument("--end-id", type=int, default=50)
    parser.add_argument("--output", default="gbrail_fleet.json")
    parser.add_argument("--profile-dir", default="tools/.playwright-profile")
    parser.add_argument("--login-first", action="store_true")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=30.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    profile_dir = Path(args.profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)

    new_rows = scrape_ids(
        start_id=args.start_id,
        end_id=args.end_id,
        profile_dir=profile_dir,
        delay_seconds=args.delay,
        timeout_seconds=args.timeout,
        headed=args.headed,
        login_first=args.login_first,
    )

    output_path = Path(args.output)

    if output_path.exists():
        with open(output_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
    else:
        existing = []

    merged = merge_rows(existing, new_rows)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"Updated {len(merged)} records → {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())