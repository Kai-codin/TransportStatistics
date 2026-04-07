import os
import json
import gzip
import requests
from dotenv import load_dotenv
import time
# Config

load_dotenv()

NR_USERNAME = os.getenv("NR_USERNAME")
NR_PASSWORD = os.getenv("NR_PASSWORD")

CORPUS_URL = "https://publicdatafeeds.networkrail.co.uk/ntrod/SupportingFileAuthenticate?type=CORPUS"

CORPUS_FILE = "CORPUSExtract.json.gz"
CORPUS_JSON = "CORPUSExtract.json"

OUTPUT_FILE = "stations.json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

DELAY = 1.0
# 1. Download CORPUS

def download_corpus():
    print("Downloading CORPUS...")

    r = requests.get(CORPUS_URL, auth=(NR_USERNAME, NR_PASSWORD), stream=True)
    r.raise_for_status()

    with open(CORPUS_FILE, "wb") as f:
        for chunk in r.iter_content(8192):
            f.write(chunk)

    print("Downloaded CORPUS.")


def extract_corpus():
    print("Extracting CORPUS...")

    with gzip.open(CORPUS_FILE, "rt", encoding="utf-8") as f:
        raw = json.load(f)

    # Handle wrapper formats
    if isinstance(raw, dict):
        if "TIPLOCDATA" in raw:
            data = raw["TIPLOCDATA"]
        elif "CORPUSExtract" in raw:
            data = raw["CORPUSExtract"]
        else:
            raise Exception(f"Unknown CORPUS format keys: {list(raw.keys())}")
    else:
        data = raw

    print(f"Loaded {len(data)} CORPUS records")
    return data
# 2. Filter stations

def build_station_base(corpus):
    stations = []

    for entry in corpus:
        crs = entry.get("3ALPHA", "").strip()
        tiploc = entry.get("TIPLOC", "").strip()
        name = entry.get("NLCDESC", "").strip()

        if not crs:
            continue  # skip non-stations

        stations.append({
            "stationName": name.title(),
            "crsCode": crs,
            "tiplocCode": tiploc,
            "lat": 0.0,
            "long": 0.0
        })

    print(f"Filtered to {len(stations)} CRS stations")
    return stations
# 3. Fetch OSM data

def fetch_osm_stations():
    print("Fetching OSM stations...")

    query = """
    [out:json][timeout:25];
    (
      node["railway"="station"](49,-8,61,2);
      way["railway"="station"](49,-8,61,2);
    );
    out center;
    """

    r = requests.post(OVERPASS_URL, data=query)
    r.raise_for_status()

    data = r.json()
    print(f"Got {len(data['elements'])} OSM elements")

    return data["elements"]


def build_osm_index(elements):
    index_by_crs = {}
    index_by_name = {}

    for el in elements:
        tags = el.get("tags", {})

        name = tags.get("name")
        crs = tags.get("ref")

        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")

        if not lat or not lon:
            continue

        if crs:
            index_by_crs[crs.upper()] = (lat, lon)

        if name:
            index_by_name[name.lower()] = (lat, lon)

    return index_by_crs, index_by_name
# 4. Merge CORPUS + OSM

def merge_data(stations, osm_crs, osm_name):
    matched = 0

    for s in stations:
        crs = s["crsCode"]
        name = s["stationName"]

        # Try CRS match first
        if crs in osm_crs:
            s["lat"], s["long"] = osm_crs[crs]
            matched += 1
            continue

        # Fallback: name match
        key = name.lower()
        if key in osm_name:
            s["lat"], s["long"] = osm_name[key]
            matched += 1

    print(f"Matched {matched}/{len(stations)} with OSM")
    return stations
# MAIN

def main():
    download_corpus()
    corpus = extract_corpus()

    stations = build_station_base(corpus)

    osm_elements = fetch_osm_stations()
    osm_crs, osm_name = build_osm_index(osm_elements)

    stations = merge_data(stations, osm_crs, osm_name)

    print("Writing output...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(stations, f, indent=2)

    print("Done ✅")


if __name__ == "__main__":
    main()