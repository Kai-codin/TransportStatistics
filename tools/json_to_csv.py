#!/usr/bin/env python3
"""Simple JSON -> CSV converter.

Usage:
  python tools/json_to_csv.py input.json output.csv
  cat input.json | python tools/json_to_csv.py - output.csv
  python tools/json_to_csv.py input.json -  # write to stdout

The script expects the JSON to be either an array of objects or a single object
containing an array as the top-level value. Nested objects are flattened using
dot-separated keys. Lists are written as JSON strings in the CSV cell.
"""
import argparse
import csv
import json
import sys
from typing import Any, Dict


def flatten(obj: Any, prefix: str = "") -> Dict[str, Any]:
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            out.update(flatten(v, key))
    elif isinstance(obj, list):
        # turn lists into JSON strings
        out[prefix] = json.dumps(obj, ensure_ascii=False)
    else:
        out[prefix] = obj
    return out


def load_json(path: str):
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try NDJSON (one JSON object per line)
        lines = [ln for ln in text.splitlines() if ln.strip()]
        items = []
        failed = False
        for ln in lines:
            try:
                items.append(json.loads(ln))
            except json.JSONDecodeError:
                failed = True
                break
        if not failed and items:
            return items

        # As a last resort, try iteratively decoding multiple concatenated JSON objects
        decoder = json.JSONDecoder()
        idx = 0
        n = len(text)
        objs = []
        while idx < n:
            try:
                obj, offset = decoder.raw_decode(text, idx)
                objs.append(obj)
                idx += offset
                # skip whitespace between objects
                while idx < n and text[idx].isspace():
                    idx += 1
            except json.JSONDecodeError:
                # give up and re-raise original error
                raise
        return objs


def main():
    p = argparse.ArgumentParser(description="Convert JSON array of objects to CSV")
    p.add_argument("input", help="Input JSON file path or - for stdin")
    p.add_argument("output", help="Output CSV file path or - for stdout")
    args = p.parse_args()

    data = load_json(args.input)

    # normalize to list of objects
    if isinstance(data, dict):
        # find first list value if top-level dict
        lists = [v for v in data.values() if isinstance(v, list)]
        if len(lists) == 1:
            items = lists[0]
        else:
            # maybe the dict itself is the single object we want
            items = [data]
    elif isinstance(data, list):
        items = data
    else:
        raise SystemExit("Unsupported JSON structure: expected array or object")

    flattened = [flatten(item) for item in items if isinstance(item, dict)]

    # collect fieldnames in deterministic order
    fieldnames = []
    seen = set()
    for item in flattened:
        for k in item.keys():
            if k not in seen:
                seen.add(k)
                fieldnames.append(k)

    out_fh = sys.stdout if args.output == "-" else open(args.output, "w", encoding="utf-8", newline="")
    writer = csv.DictWriter(out_fh, fieldnames=fieldnames)
    writer.writeheader()
    for item in flattened:
        # ensure all keys exist
        row = {k: item.get(k, "") for k in fieldnames}
        writer.writerow(row)

    if out_fh is not sys.stdout:
        out_fh.close()


if __name__ == "__main__":
    main()
