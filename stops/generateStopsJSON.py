import os
import json
import requests
import pandas as pd
import osmium
import time
from tqdm import tqdm

# -----------------------------
# CONFIG
# -----------------------------
OSM_URL = "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf"
OSM_FILE = "great-britain-latest.osm.pbf"

NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"

OUTPUT_FILE = "stops.json"

LOG_EVERY = 50000  # <-- adjust for spam vs visibility

STOP_TYPES = {
    "rail": "rail_station_id",
    "tram": "tram_stop_id",
    "bus": "bus_stop_id"
}

def log(msg):
    """tqdm-safe logging"""
    tqdm.write(f"[{time.strftime('%H:%M:%S')}] {msg}")

# -----------------------------
# DOWNLOAD FILE WITH PROGRESS
# -----------------------------
def download_file(url, filename):
    if os.path.exists(filename):
        log(f"{filename} already exists, skipping download.")
        return

    log(f"Downloading {filename}...")
    r = requests.get(url, stream=True)
    total = int(r.headers.get('content-length', 0))

    with open(filename, "wb") as f, tqdm(
        desc=filename,
        total=total,
        unit='iB',
        unit_scale=True,
        unit_divisor=1024,
        mininterval=1,  # force refresh at least every second
    ) as bar:
        for chunk in r.iter_content(chunk_size=1024):
            if chunk:
                size = f.write(chunk)
                bar.update(size)

    log("Download complete.")

# -----------------------------
# PARSE NAPTAN
# -----------------------------
def parse_naptan():
    log("Downloading + parsing NaPTAN CSV...")

    df = pd.read_csv(NAPTAN_URL, dtype=str, low_memory=False)

    stops = {}

    skipped = 0
    errors = 0

    start = time.time()

    for i, (_, row) in enumerate(tqdm(df.iterrows(), total=len(df), desc="NaPTAN", mininterval=1)):
        lat = row.get("Latitude")
        lon = row.get("Longitude")

        if not lat or not lon:
            skipped += 1
            continue

        atco = row.get("ATCOCode")
        if not atco:
            skipped += 1
            continue

        stop_type = row.get("StopType", "")

        # Skip rail
        if stop_type.startswith(("RLY", "RSE", "RPL")):
            skipped += 1
            continue

        if stop_type.startswith(("MET", "PLT")):
            stop_type_id = STOP_TYPES["tram"]
        else:
            stop_type_id = STOP_TYPES["bus"]

        try:
            stops[atco] = {
                "name": row.get("CommonName") or "Unknown",
                "commonName": row.get("CommonName") or "Unknown",
                "atcoCode": atco,
                "naptanCode": row.get("NaptanCode"),
                "stopTypeId": stop_type_id,
                "active": True,
                "hidden": False,
                "lat": float(lat),
                "lon": float(lon),
                "indicator": row.get("Indicator"),
            }
        except Exception:
            errors += 1
            continue

        # 🔥 heartbeat logging
        if i % LOG_EVERY == 0 and i > 0:
            elapsed = time.time() - start
            rate = i / elapsed if elapsed > 0 else 0
            log(f"NaPTAN progress: {i:,} rows | {rate:,.0f} rows/sec | kept={len(stops):,} skipped={skipped:,} errors={errors:,}")

    log(f"NaPTAN DONE: {len(stops)} stops (skipped={skipped}, errors={errors})")
    return stops

# -----------------------------
# OSM HANDLER
# -----------------------------
class StationHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.stations = []
        self.count = 0
        self.start = time.time()

    def node(self, n):
        self.count += 1

        # Heartbeat every N nodes
        if self.count % LOG_EVERY == 0:
            elapsed = time.time() - self.start
            rate = self.count / elapsed if elapsed > 0 else 0
            log(f"OSM nodes processed: {self.count:,} | {rate:,.0f} nodes/sec | stations={len(self.stations):,}")

        # Ensure it is a railway station
        if n.tags.get("railway") == "station":
            tags = n.tags
            
            # Using .get() allows us to set defaults if tags are missing
            self.stations.append({
                "name": tags.get("name", "Unknown"),
                "commonName": tags.get("name", "Unknown"),
                "atcoCode": tags.get("naptan:AtcoCode", None), 
                "crsCode": tags.get("ref:crs", None),
                "tipLocCode": tags.get("ref:tiploc", None),
                "stopTypeId": STOP_TYPES["rail"],
                "active": True,
                "hidden": False,
                "lat": n.location.lat,
                "lon": n.location.lon,
            })

# -----------------------------
# PARSE OSM
# -----------------------------
def parse_osm():
    log("Parsing OSM (this WILL take time, like 5–20 mins)...")

    handler = StationHandler()
    handler.apply_file(OSM_FILE, locations=True)

    log(f"OSM DONE: {len(handler.stations)} stations")
    return handler.stations

# -----------------------------
# MAIN
# -----------------------------
def main():
    start = time.time()

    download_file(OSM_URL, OSM_FILE)

    naptan_stops = parse_naptan()
    osm_stations = parse_osm()

    log("Merging datasets...")
    all_stops = list(naptan_stops.values()) + osm_stations

    log(f"Total stops: {len(all_stops):,}")

    log("Saving JSON...")
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_stops, f)

    elapsed = time.time() - start
    log(f"DONE in {elapsed/60:.1f} minutes → {OUTPUT_FILE}")

# -----------------------------
if __name__ == "__main__":
    main()