import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// --- Helper Functions ---

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getDelayText(delay: number) {
  if (delay < 0) return `${Math.abs(delay)} mins early`;
  if (delay === 0) return "on time";
  return `${delay} mins late`;
}

function getTrainColour(delay: number) {
  if (delay <= -5) return "blue";
  if (delay <= 0) return "green";
  if (delay <= 9) return "orange";
  if (delay <= 19) return "red";
  return "pink";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const xmin = searchParams.get("xmin");
  const ymin = searchParams.get("ymin");
  const xmax = searchParams.get("xmax");
  const ymax = searchParams.get("ymax");
  
  // Parse boolean filters (default to true if not provided)
  const showTrains = searchParams.get("showTrains") !== "false";
  const showBuses = searchParams.get("showBuses") !== "false";

  if (!xmin || !ymin || !xmax || !ymax) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const latMin = parseFloat(ymin);
  const latMax = parseFloat(ymax);
  const lonMin = parseFloat(xmin);
  const lonMax = parseFloat(xmax);
  const bboxQuery = `xmin=${xmin}&ymin=${ymin}&xmax=${xmax}&ymax=${ymax}`;

  try {
    // Perform only the fetches requested
    const results = await Promise.allSettled([
      showTrains ? fetch(`https://map-api.production.signalbox.io/api/locations?${bboxQuery}`) : Promise.resolve(null),
      showBuses ? fetch(`https://bustimes.org/vehicles.json?${bboxQuery}`) : Promise.resolve(null),
    ]);

    // Parse Train Data
    let trainList: any[] = [];
    if (showTrains && results[0].status === "fulfilled" && results[0].value?.ok) {
      const data = await results[0].value.json();
      trainList = (data.train_locations || []).filter((t: any) => {
        const lat = t.location.lat;
        const lon = t.location.lon;
        return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
      });
    }

    // Parse Bus Data
    let busData: any[] = [];
    if (showBuses && results[1].status === "fulfilled" && results[1].value?.ok) {
      busData = await results[1].value.json();
    }

    const isSimpleMode = (trainList.length + busData.length) > 1000;
    const cachedDetails: Record<string, any> = {};

    if (!isSimpleMode && showTrains) {
      const rids = trainList.map((t: any) => t.rid);
      const CHUNK_SIZE = 100;
      
      for (let i = 0; i < rids.length; i += CHUNK_SIZE) {
        const chunk = rids.slice(i, i + CHUNK_SIZE);
        
        // 1. Get existing data
        const data = await convex.query(api.functions.trains.getDetailsForRids, { rids: chunk });
        Object.assign(cachedDetails, data);

        // 2. Identify missing RIDs (not in database)
        const missingRids = chunk.filter((rid: string) => !data[rid]);

        // 3. Trigger background sync for missing RIDs
        if (missingRids.length > 0) {
          // We fire this and do NOT await it, so the map API response stays fast.
          convex.action(api.functions.trains.syncBatch, { rids: missingRids })
            .catch((err) => console.error("Failed to sync new RIDs:", err));
        }
      }
    }

    const today = new Date().toISOString().split('T')[0];

    const response = {
      trains: trainList
        .filter((t: any) => {
          const details = cachedDetails[t.rid];
          return details?.headcode || t.headcode; // only include if headcode exists
        })
        .map((t: any) => {
        const rotation = (t.location && t.predicted_location) 
            ? calculateBearing(t.location.lat, t.location.lon, t.predicted_location.lat, t.predicted_location.lon) 
            : 0;
        const details = cachedDetails[t.rid] || {};

        return {
          id: t.rid,
          delay: t.delay,
          location: t.location,
          rotation,
          operator: isSimpleMode ? "N/A" : (details.train_operator ?? "Loading..."),
          service: isSimpleMode ? (t.headcode ?? t.rid) : (details.headcode ?? "N/A"),
          destination: isSimpleMode ? "N/A" : (details.destination_name ?? "Loading..."),
          colour: getTrainColour(t.delay),
          popup_data: {
            label1: `${details.headcode ?? t.rid} to ${details.destination_name ?? "Unknown"}`,
            link1: details.uid ? `https://www.realtimetrains.co.uk/service/gb-nr:${details.uid}/${today}/detailed` : "#",
            label2: getDelayText(t.delay),
            log_link: `/log?service_id=${t.rid}`
          }
        };
      }),
      buses: busData.map((b: any) => {
        const vehicleName = b.vehicle?.name || " - ";
        const [fleet_number, reg] = vehicleName.split(" - ");
        const vehicleSlug = b.vehicle?.url?.replace("/vehicles/", "") ?? "";

        return {
          id: b.trip_id,
          location: { lat: b.coordinates?.[1] ?? 0, lon: b.coordinates?.[0] ?? 0 },
          rotation: b.heading ?? 0,
          service: b.service?.line_name ?? "N/A",
          destination: b.destination ?? "Unknown",
          colour: b.vehicle?.colour ?? "#ff0000",
          liveryID: b.vehicle?.livery ?? 0,
          popup_data: {
            label1: `${b.service?.line_name ?? "Bus"} to ${b.destination ?? "Unknown"}`,
            link1: `https://bustimes.org${b.service?.url ?? ""}`,
            label2: b.vehicle?.name ?? "Unknown Bus",
            link2: `https://bustimes.org${b.vehicle?.url ?? ""}`,
            log_link: `/log?reg=${reg ?? ""}&unit=${fleet_number ?? ""}&service_id=${b.trip_id}&vehicle_slug=${vehicleSlug}`
          }
        };
      }),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in live-vehicles API:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}