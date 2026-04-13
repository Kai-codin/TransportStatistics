import osmium
import json
import os
import shutil
import requests
from tqdm import tqdm
import pandas as pd
from rapidfuzz import process
from scipy.spatial import cKDTree

# -------------------------
# CONFIG
# -------------------------

OSM_URL = "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf"
OSM_FILE = "great-britain-latest.osm.pbf"

INPUT_JSON = "input.json"
OUTPUT_JSON = "output.json"

BACKUP_ENABLED = True

FUZZY_SCORE_CUTOFF = 80


# -------------------------
# Download OSM
# -------------------------

def download_osm():
    if os.path.exists(OSM_FILE):
        print("✔ OSM already exists")
        return

    print("⬇ Downloading OSM...")
    r = requests.get(OSM_URL, stream=True)
    total = int(r.headers.get("content-length", 0))

    with open(OSM_FILE, "wb") as f, tqdm(total=total, unit="B", unit_scale=True) as bar:
        for chunk in r.iter_content(8192):
            f.write(chunk)
            bar.update(len(chunk))


# -------------------------
# Backup
# -------------------------

def backup():
    if not BACKUP_ENABLED:
        return

    shutil.copy(INPUT_JSON, INPUT_JSON + ".backup")
    print("✔ Backup created")


# -------------------------
# OSM Handler
# -------------------------

class RailHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.stations = []
        self.rail_nodes = set()
        self.edges = []

    def node(self, n):
        if not n.location.valid():
            return

        tags = n.tags

        if "railway" in tags:
            if tags["railway"] in ["station", "halt", "stop"]:
                self.stations.append({
                    "name": tags.get("name"),
                    "ref": tags.get("ref"),
                    "lat": n.location.lat,
                    "lon": n.location.lon
                })

            if tags["railway"] == "rail":
                self.rail_nodes.add(n.id)

    def way(self, w):
        if w.tags.get("railway") == "rail":
            nodes = [n.ref for n in w.nodes]
            for i in range(len(nodes) - 1):
                self.edges.append((nodes[i], nodes[i+1]))


# -------------------------
# Clean name
# -------------------------

def clean(name):
    if not name:
        return ""
    return name.lower().replace(" station", "").replace(" railway", "").strip()


# -------------------------
# Build junctions
# -------------------------

def build_junctions(edges):
    from collections import Counter

    count = Counter()

    for u, v in edges:
        count[u] += 1
        count[v] += 1

    return {node for node, deg in count.items() if deg >= 3}


# -------------------------
# Main
# -------------------------

def main():
    download_osm()
    backup()

    print("📦 Parsing OSM (this takes a few mins)...")

    handler = RailHandler()
    handler.apply_file(OSM_FILE, locations=True)

    stations = pd.DataFrame(handler.stations).dropna(subset=["lat", "lon"])
    stations["clean"] = stations["name"].apply(clean)

    print(f"✔ Stations: {len(stations)}")

    print("🔗 Building junctions...")
    junction_ids = build_junctions(handler.edges)

    # Map node id → coords
    node_coords = {}

    class NodeCollector(osmium.SimpleHandler):
        def node(self, n):
            if n.id in junction_ids and n.location.valid():
                node_coords[n.id] = (n.location.lat, n.location.lon)

    NodeCollector().apply_file(OSM_FILE, locations=True)

    junctions = pd.DataFrame([
        {"lat": lat, "lon": lon}
        for lat, lon in node_coords.values()
    ])

    print(f"✔ Junctions: {len(junctions)}")

    # Build KD trees
    station_tree = cKDTree(stations[["lat", "lon"]].values)
    junction_tree = cKDTree(junctions[["lat", "lon"]].values)

    station_names = stations["clean"].tolist()

    with open(INPUT_JSON) as f:
        data = json.load(f)

    updated = 0

    for entry in tqdm(data):

        name = entry.get("stationName", "")
        crs = entry.get("crsCode", "")
        cname = clean(name)

        match = None

        # CRS match
        if crs:
            res = stations[stations["ref"] == crs]
            if not res.empty:
                match = res.iloc[0]

        # Fuzzy match
        if match is None:
            result = process.extractOne(cname, station_names)
            if result and result[1] >= FUZZY_SCORE_CUTOFF:
                match = stations.iloc[result[2]]

        # Apply station coords
        if match is not None:
            entry["lat"] = float(match["lat"])
            entry["long"] = float(match["lon"])
            updated += 1
            continue

        # Junction fallback
        if cname:
            result = process.extractOne(cname, station_names)
            if result:
                base = stations.iloc[result[2]]

                dist, idx = junction_tree.query([base["lat"], base["lon"]])
                j = junctions.iloc[idx]

                entry["lat"] = float(j["lat"])
                entry["long"] = float(j["lon"])
                updated += 1

    with open(OUTPUT_JSON, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\n✔ Done. Updated {updated} entries")


if __name__ == "__main__":
    main()