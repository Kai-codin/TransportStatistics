from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Sequence


def _run(cmd: Sequence[str], cwd: Path) -> int:
    print(f"\n$ {shlex.join(cmd)}", flush=True)
    proc = subprocess.run(cmd, cwd=str(cwd))
    return int(proc.returncode)


def _manage_cmd(python_bin: str, manage_py: Path, parts: list[str]) -> list[str]:
    return [python_bin, str(manage_py), *parts]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ts-schedule-updater",
        description="Run TransportStatistics train schedule update pipeline on a target server.",
    )

    p.add_argument("--project-dir", required=True, help="Path to Django project root containing manage.py")
    p.add_argument("--python", default=sys.executable, help="Python executable to run manage.py")

    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--update", action="store_true", help="Incremental schedule import")
    mode.add_argument("--replace", action="store_true", help="Full replace import")

    p.add_argument("--batch-size", type=int, default=None, help="Timetable import batch size")
    p.add_argument("--resume-from", type=int, default=None, help="Resume import from line number")
    p.add_argument("--parallel-locs", action="store_true", help="Enable parallel location inserts")
    p.add_argument("--dry-run", action="store_true", help="Parse-only mode for import")

    p.add_argument("--download-cif", action="store_true", help="Run split_nr_json before schedule import")
    p.add_argument("--cif-file", default=None, help="Local CIF file path for split_nr_json")
    p.add_argument("--out-dir", default="data", help="Output dir for split files (default: data)")
    p.add_argument("--nr-username", default=None, help="Network Rail username (optional)")
    p.add_argument("--nr-password", default=None, help="Network Rail password (optional)")

    p.add_argument("--run-fix-timetables", action="store_true", help="Run fix_timetables after import")
    p.add_argument("--run-sort-times", action="store_true", help="Run populate_sort_times after import")

    return p


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    project_dir = Path(args.project_dir).expanduser().resolve()
    manage_py = project_dir / "manage.py"

    if not project_dir.exists():
        parser.error(f"project directory not found: {project_dir}")
    if not manage_py.exists():
        parser.error(f"manage.py not found in project directory: {project_dir}")

    print("TransportStatistics schedule updater")
    print(f"project_dir={project_dir}")
    print(f"python={args.python}")

    schedule_file = project_dir / args.out_dir / "JsonScheduleV1.ndjson"
    should_run_split = args.download_cif or bool(args.cif_file) or not schedule_file.exists()

    if not schedule_file.exists() and not (args.download_cif or args.cif_file):
        print(
            "\nJsonScheduleV1.ndjson not found; running split_nr_json automatically "
            "to download/split fresh CIF data."
        )

    # 1) Optional split/download step
    if should_run_split:
        split_parts = ["split_nr_json", "--out-dir", args.out_dir]
        if args.cif_file:
            split_parts.extend(["--file", args.cif_file])
        if args.nr_username:
            split_parts.extend(["--username", args.nr_username])
        if args.nr_password:
            split_parts.extend(["--password", args.nr_password])

        rc = _run(_manage_cmd(args.python, manage_py, split_parts), cwd=project_dir)
        if rc != 0:
            return rc

    # 2) Main import step
    import_parts = ["import_json_schedule_v1"]
    import_parts.append("--replace" if args.replace else "--update")

    if args.batch_size is not None:
        import_parts.extend(["--batch-size", str(args.batch_size)])
    if args.resume_from is not None:
        import_parts.extend(["--resume-from", str(args.resume_from)])
    if args.parallel_locs:
        import_parts.append("--parallel-locs")
    if args.dry_run:
        import_parts.append("--dry-run")

    rc = _run(_manage_cmd(args.python, manage_py, import_parts), cwd=project_dir)
    if rc != 0:
        return rc

    # 3) Optional post-processing
    if args.run_fix_timetables:
        rc = _run(_manage_cmd(args.python, manage_py, ["fix_timetables"]), cwd=project_dir)
        if rc != 0:
            return rc

    if args.run_sort_times:
        rc = _run(_manage_cmd(args.python, manage_py, ["populate_sort_times"]), cwd=project_dir)
        if rc != 0:
            return rc

    print("\nSchedule update pipeline completed successfully.")
    return 0
