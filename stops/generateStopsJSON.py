import os
import json
import requests
import pandas as pd
import osmium
import time
from tqdm import tqdm
from pyproj import Transformer # <--- Add this import

# -----------------------------
# CONFIG
# -----------------------------
OSM_URL = "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf"
OSM_FILE = "great-britain-latest.osm.pbf"

NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"

OUTPUT_FILE = "stops.json"

LOG_EVERY = 50000  # <-- adjust for spam vs visibility

STOP_TYPES = {
    "rail": "j57526944rm9x6tb7k750mfaz586705n",
    "tram": "tram_stop_id",
    "bus": "bus_stop_id"
}

# -----------------------------
# -----------------------------
# STOP TYPE → CONVEX ID MAPPING (accepts direct Convex paste or convex_ids.json)
# -----------------------------
# You can either:
#  - Paste your Convex objects export into `CONVEX_PASTE` below (JS/JSON-like), OR
#  - Place a JSON file named `convex_ids.json` next to this script containing
#    either a list of objects with `code` and `_id` fields or a mapping {"CODE": "_id"}.

CONVEX_PASTE = '[{ _creationTime: 1778146398336.3525, _id: "j5769apg39ghr2be0xd7evndz1868tky", code: "FLX", name: "Bus Coach on street Bay", subOf: "j577yw1veaqnb1866ywajqnkjs869za5" }, { _creationTime: 1778146398336.3523, _id: "j57dsmpfb7s4h54vpd1crcfbv586922e", code: "HAR", name: "Bus Coach on street Bay", subOf: "j577yw1veaqnb1866ywajqnkjs869za5" }, { _creationTime: 1778146398336.352, _id: "j570ngv581athkg6174z1fpkrx869w3b", code: "CUS", name: "Bus Coach on street Bay", subOf: "j577yw1veaqnb1866ywajqnkjs869za5" }, { _creationTime: 1778146398336.3518, _id: "j576q65ws7q09vae1mb4sx4zdd869d8r", code: "MKD", name: "Bus Coach on street Bay", subOf: "j577yw1veaqnb1866ywajqnkjs869za5" }, { _creationTime: 1778146398336.3516, _id: "j576q404nzaghzx94rk0yd3qjh868r0a", code: "TXR", name: "Taxi Rank Bay" }, { _creationTime: 1778146398336.3513, _id: "j5763y07z7zazah8xnq7gcwky1869x6h", code: "STR", name: "Shared Taxi Rank" }, { _creationTime: 1778146398336.351, _id: "j571jaygf4wgh564f2h4ekq069868yh2", code: "RLS", name: "Rail Stations" }, { _creationTime: 1778146398336.3508, _id: "j573mvevnmyrjsq8ey3va1bmah868nms", code: "RPL", name: "Rail Station Platform" }, { _creationTime: 1778146398336.3506, _id: "j5755adndmycwxkvqyq8b42n4d8699er", code: "RSE", name: "Rail Station Entrance" }, { _creationTime: 1778146398336.3503, _id: "j57dr897vp32da16qtg1j81pnx8692n9", code: "RLY", name: "Rail Station Access Area" }, { _creationTime: 1778146398336.35, _id: "j57386cetwss9j0t940zr60jc5869fty", code: "PLT", name: "Metro Station Platform" }, { _creationTime: 1778146398336.3499, _id: "j57b66zrps61kdsbjcsekb36kd869cbm", code: "TMU", name: "Metro Station Entrance" }, { _creationTime: 1778146398336.3496, _id: "j571ck3nrwcbwf4h744a9dg9wd868px7", code: "MET", name: "Metro Station Access Area" }, { _creationTime: 1778146398336.3494, _id: "j574eaqj2q5c6k287y7jdsqv4s8689wh", code: "FTD", name: "Ferry Port Entrance" }, { _creationTime: 1778146398336.349, _id: "j5741vesayvey83g1yrd3ekv1s869y3k", code: "FBT", name: "Ferry Port Bay" }, { _creationTime: 1778146398336.3489, _id: "j57c1a1k5219h86bt5cv52pw8x868s1b", code: "FER", name: "Ferry Port Access Area" }, { _creationTime: 1778146398336.3486, _id: "j57bmqt6r9zvnfrew5h00y4gb9868qw5", code: "BCE", name: "Bus or Coach Station Entrance" }, { _creationTime: 1778146398336.3484, _id: "j579sf5g0y6ked4vn072w7rksx8686n1", code: "BCS", name: "Bus or Coach Station Bay" }, { _creationTime: 1778146398336.3481, _id: "j57cd623q6q2n2phn5fgta8tk98684n0", code: "BCQ", name: "Bus or Coach Station Bay" }, { _creationTime: 1778146398336.348, _id: "j57da22xmncbqtbrnpz0b5sgzx868746", code: "BST", name: "Bus or Coach Station Access Area" }, { _creationTime: 1778146398336.3477, _id: "j577yw1veaqnb1866ywajqnkjs869za5", code: "BCT", name: "Bus Coach on street" }, { _creationTime: 1778146398336.3474, _id: "j572gtxbb0zf7pxy7fk4f6vjyd868pr4", code: "AIR", name: "Airport Entrance" }, { _creationTime: 1778146398336.3472, _id: "j5791c4rq89ab3yq670jghdkyn868jad", code: "GAT", name: "Airport Access Area" }]'
import re

def parse_convex_paste(text):
    """Extract a mapping of code -> _id from a pasted Convex export.
    Handles JS-style objects (unquoted keys) and JSON lists.
    """
    mapping = {}
    if not text or text.strip().startswith("[PASTE"):
        return mapping

    # Try JSON first
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            for item in parsed:
                code = item.get("code") or item.get('Code')
                _id = item.get("_id") or item.get("id")
                if code and _id:
                    mapping[code] = _id
            return mapping
        if isinstance(parsed, dict):
            # If it's already a mapping code->id
            if all(isinstance(v, str) for v in parsed.values()):
                return parsed
    except Exception:
        pass

    # Fallback: regex-scan JS/JS-like objects to pull out pairs within each {...}
    objects = re.findall(r'\{([^}]+)\}', text, re.S)
    for obj in objects:
        code_m = re.search(r'code\s*[:]\s*["\']?([A-Z0-9]+)["\']?', obj) or re.search(r'\"code\"\s*:\s*\"([^\"]+)\"', obj)
        id_m = re.search(r'_id\s*[:]\s*["\']?([a-z0-9]+)["\']?', obj) or re.search(r'\"_id\"\s*:\s*\"([^\"]+)\"', obj)
        if code_m and id_m:
            code = code_m.group(1)
            _id = id_m.group(1)
            mapping[code] = _id

    # Also try to catch simple "code: \"X\", _id: \"Y\"" patterns across the whole text
    pairs = re.findall(r'code\s*[:]\s*["\']?([A-Z0-9]+)["\']?[,\s\n]+[^}]*?_id\s*[:]\s*["\']?([a-z0-9]+)["\']?', text, re.I)
    for code, _id in pairs:
        mapping[code] = _id

    return mapping

def load_convex_mapping():
    # 1) convex_ids.json file next to script
    try:
        if os.path.exists("convex_ids.json"):
            with open("convex_ids.json") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {item.get("code"): item.get("_id") for item in data if item.get("code") and item.get("_id")}
                if isinstance(data, dict):
                    return data
    except Exception:
        pass

    # 2) parse pasted export
    return parse_convex_paste(CONVEX_PASTE)

# Convex ID for the OSM rail station type (fallback)
RAIL_CONVEX_ID = "j57526944rm9x6tb7k750mfaz586705n"  # RLS - Rail Stations

# Build mapping once
STOP_TYPE_CONVEX_MAP = load_convex_mapping()

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
transformer = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)

def parse_naptan():
    log("Downloading + parsing NaPTAN CSV...")
    df = pd.read_csv(NAPTAN_URL, dtype=str, low_memory=False)
    
    stops = {}
    skipped = 0
    errors = 0
    start = time.time()

    for i, (_, row) in enumerate(tqdm(df.iterrows(), total=len(df), desc="NaPTAN", mininterval=1)):
        # Try getting existing lat/lon
        lat = row.get("Latitude")
        lon = row.get("Longitude")
        
        # Check if we need to fall back to Easting/Northing
        if (not lat or not lon or pd.isna(lat) or pd.isna(lon)):
            easting = row.get("Easting")
            northing = row.get("Northing")
            
            if easting and northing and not pd.isna(easting) and not pd.isna(northing):
                # Perform the conversion
                # Note: Transformer returns (lon, lat)
                lon, lat = transformer.transform(float(easting), float(northing))
            else:
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

        convex_id = STOP_TYPE_CONVEX_MAP.get(stop_type)
        if not convex_id:
            convex_id = STOP_TYPE_CONVEX_MAP.get("BCT") or RAIL_CONVEX_ID

        try:
            stops[atco] = {
                "name": row.get("CommonName") or "Unknown",
                "commonName": row.get("CommonName") or "Unknown",
                "atcoCode": atco,
                "naptanCode": row.get("NaptanCode"),
                "stopTypeId": convex_id, 
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