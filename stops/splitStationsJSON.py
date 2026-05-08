import json

# Replace this with the actual rail stop type ID
RAIL_STOP_TYPE_ID = "rail_station_id"

INPUT_FILE = "stops.json"
OUTPUT_FILE = "rail_stations.json"


def extract_rail_stops(input_file: str, output_file: str, stop_type_id: str) -> None:
    with open(input_file, "r", encoding="utf-8") as f:
        stops = json.load(f)

    rail_stops = [stop for stop in stops if stop.get("stopTypeId") == stop_type_id]

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(rail_stops, f, indent=2)

    print(f"Found {len(rail_stops)} rail stop(s). Saved to '{output_file}'.")


if __name__ == "__main__":
    extract_rail_stops(INPUT_FILE, OUTPUT_FILE, RAIL_STOP_TYPE_ID)