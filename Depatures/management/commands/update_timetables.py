import datetime
from pathlib import Path
from typing import List

from django.core.management import call_command
from django.core.management.base import BaseCommand


def _normalize_days(arg: str) -> List[str]:
    """Accept comma-separated days or single day; return list of 3-letter lowercase codes."""
    if not arg:
        return []
    parts = [p.strip() for p in arg.split(",") if p.strip()]
    out = []
    for p in parts:
        try:
            # allow numeric day like 0=Mon..6=Sun
            if p.isdigit():
                d = datetime.date.today() + datetime.timedelta(days=0)
                weekday = int(p) % 7
                # build a date with desired weekday by shifting from today
                today_wd = d.weekday()
                delta = (weekday - today_wd) % 7
                chosen = d + datetime.timedelta(days=delta)
                out.append(chosen.strftime('%a').lower())
            else:
                # take first three letters and lowercase
                out.append(p[:3].lower())
        except Exception:
            out.append(p[:3].lower())
    return out


class Command(BaseCommand):
    help = (
        "Download Network Rail TOC update CIF and import as incremental timetable updates."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            help=(
                "Comma-separated list of 3-letter day codes to download (e.g. mon,tue). "
                "Defaults to today's weekday."
            ),
        )
        parser.add_argument("--username", help="Network Rail username (optional)")
        parser.add_argument("--password", help="Network Rail password (optional)")
        parser.add_argument("--out-dir", default="data", help="Output dir for split files")
        parser.add_argument("--batch-size", type=int, default=None, help="Batch size for importer")
        parser.add_argument("--parallel-locs", action="store_true", help="Enable parallel loc inserts")
        parser.add_argument("--dry-run", action="store_true", help="Parse-only mode (no DB writes)")
        parser.add_argument("--resume-from", type=int, default=None, help="Resume import from line")
        parser.add_argument("--run-fix-timetables", action="store_true", help="Run fix_timetables after import")
        parser.add_argument("--run-sort-times", action="store_true", help="Run populate_sort_times after import")

    def handle(self, *args, **options):
        out_dir = Path(options.get("out_dir") or "data")
        out_dir.mkdir(parents=True, exist_ok=True)

        days_opt = options.get("days")
        if days_opt:
            days = _normalize_days(days_opt)
        else:
            days = [datetime.date.today().strftime("%a").lower()]

        username = options.get("username")
        password = options.get("password")

        for day in days:
            url = (
                "https://publicdatafeeds.networkrail.co.uk/ntrod/"
                f"CifFileAuthenticate?type=CIF_ALL_UPDATE_DAILY&day=toc-update-{day}"
            )
            self.stdout.write(f"\n=== Processing update for day: {day} ===")
            self.stdout.write(f"Download URL: {url}")

            # 1) split / download
            split_kwargs = {"url": url, "out_dir": str(out_dir)}
                username = options.get("username")
                password = options.get("password")

                results = []

                for day in days:
                    url = (
                        "https://publicdatafeeds.networkrail.co.uk/ntrod/"
                        f"CifFileAuthenticate?type=CIF_ALL_UPDATE_DAILY&day=toc-update-{day}"
                    )
                    self.stdout.write(f"\n=== Processing update for day: {day} ===")
                    self.stdout.write(f"Download URL: {url}")

                    # 1) split / download
                    split_kwargs = {"url": url, "out_dir": str(out_dir)}
                    if username:
                        split_kwargs["username"] = username
                    if password:
                        split_kwargs["password"] = password

                    self.stdout.write("Starting download+split ...")
                    split_buf = io.StringIO()
                    day_result = {"day": day, "split_ok": False, "import_ok": False, "stats": None, "errors": []}
                    try:
                        call_command("split_nr_json", stdout=split_buf, stderr=split_buf, **split_kwargs)
                        split_out = split_buf.getvalue()
                        self.stdout.write("Split complete")
                        day_result["split_ok"] = True
                    except SystemExit:
                        raise
                    except Exception as exc:
                        err = f"split_nr_json failed for {day}: {exc}"
                        self.stderr.write(self.style.ERROR(err))
                        day_result["errors"].append(err)
                        results.append(day_result)
                        continue

                    # 2) import incremental update (only update what's needed)
                    import_kwargs = {"file": str(out_dir / "JsonScheduleV1.ndjson"), "update": True}
                    if options.get("batch_size") is not None:
                        import_kwargs["batch_size"] = options.get("batch_size")
                    if options.get("parallel_locs"):
                        import_kwargs["parallel_locs"] = True
                    if options.get("dry_run"):
                        import_kwargs["dry_run"] = True
                    if options.get("resume_from") is not None:
                        import_kwargs["resume_from"] = options.get("resume_from")

                    self.stdout.write("Starting import_json_schedule_v1 (update mode) ...")
                    import_buf = io.StringIO()
                    try:
                        call_command("import_json_schedule_v1", stdout=import_buf, stderr=import_buf, **import_kwargs)
                        import_out = import_buf.getvalue()
                        # try to extract final stats line
                        m = re.search(r"Done.*lines:\s*([\d,]+)\s*\|\s*created:\s*([\d,]+)\s*\|\s*updated:\s*([\d,]+)\s*\|\s*skipped:\s*([\d,]+)\s*\|\s*locations:\s*([\d,]+)", import_out)
                        if m:
                            stats = {
                                "lines": int(m.group(1).replace(",", "")),
                                "created": int(m.group(2).replace(",", "")),
                                "updated": int(m.group(3).replace(",", "")),
                                "skipped": int(m.group(4).replace(",", "")),
                                "locations": int(m.group(5).replace(",", "")),
                            }
                            day_result["stats"] = stats
                        else:
                            day_result["stats"] = {"raw_output_tail": import_out.splitlines()[-10:]}
                        day_result["import_ok"] = True
                        self.stdout.write("Import finished")
                    except Exception as exc:
                        err = f"import_json_schedule_v1 failed for {day}: {exc}"
                        self.stderr.write(self.style.ERROR(err))
                        day_result["errors"].append(err)
                    finally:
                        results.append(day_result)

                    # 3) optional post-processing
                    if options.get("run_fix_timetables") and day_result["import_ok"]:
                        try:
                            self.stdout.write("Running fix_timetables ...")
                            call_command("fix_timetables")
                        except Exception as exc:
                            self.stderr.write(self.style.ERROR(f"fix_timetables failed: {exc}"))
                    if options.get("run_sort_times") and day_result["import_ok"]:
                        try:
                            self.stdout.write("Running populate_sort_times ...")
                            call_command("populate_sort_times")
                        except Exception as exc:
                            self.stderr.write(self.style.ERROR(f"populate_sort_times failed: {exc}"))

                    if day_result["import_ok"]:
                        self.stdout.write(self.style.SUCCESS(f"Completed update for {day}"))
                    else:
                        self.stderr.write(self.style.ERROR(f"Update for {day} completed with errors"))

                # Final summary
                self.stdout.write("\n=== Update Summary ===")
                total_days = len(results)
                succeeded = sum(1 for r in results if r.get("import_ok"))
                failed = total_days - succeeded
                self.stdout.write(f"Processed {total_days} day(s): {succeeded} succeeded, {failed} failed")
                for r in results:
                    day = r.get("day")
                    status = "OK" if r.get("import_ok") else "FAILED"
                    self.stdout.write(f"- {day}: {status}")
                    if r.get("stats") and isinstance(r["stats"], dict):
                        s = r["stats"]
                        if "created" in s:
                            self.stdout.write(
                                f"    lines={s['lines']:,} created={s['created']:,} updated={s['updated']:,} skipped={s['skipped']:,} locs={s['locations']:,}"
                            )
                        else:
                            tail = s.get("raw_output_tail") or []
                            for line in tail:
                                self.stdout.write(f"    {line}")
                    if r.get("errors"):
                        for e in r.get("errors"):
                            self.stderr.write(f"    ERROR: {e}")
