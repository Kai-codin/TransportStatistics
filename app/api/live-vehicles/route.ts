import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const xmin = searchParams.get("xmin");
  const ymin = searchParams.get("ymin");
  const xmax = searchParams.get("xmax");
  const ymax = searchParams.get("ymax");

  if (!xmin || !ymin || !xmax || !ymax) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const latMin = parseFloat(ymin);
  const latMax = parseFloat(ymax);
  const lonMin = parseFloat(xmin);
  const lonMax = parseFloat(xmax);

  const bboxQuery = `xmin=${xmin}&ymin=${ymin}&xmax=${xmax}&ymax=${ymax}`;

  try {
    const [trainsRes, busesRes] = await Promise.allSettled([
      fetch(`https://map-api.production.signalbox.io/api/locations?${bboxQuery}`),
      fetch(`https://bustimes.org/vehicles.json?${bboxQuery}`),
    ]);

    const trainData = trainsRes.status === "fulfilled" && trainsRes.value.ok 
      ? await trainsRes.value.json() 
      : { train_locations: [] };

    const busData = busesRes.status === "fulfilled" && busesRes.value.ok 
      ? await busesRes.value.json() 
      : [];

    const trainList = (trainData.train_locations || []).filter((t: any) => {
      const lat = t.location.lat;
      const lon = t.location.lon;
      return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
    });

    const busList = Array.isArray(busData) ? busData : [];
    const totalVehicles = trainList.length + busList.length;

    // Determine Mode
    const isSimpleMode = totalVehicles > 1000;
    const cachedDetails: Record<string, any> = {};

    // Only perform Convex logic if NOT in simple mode
    if (!isSimpleMode) {
      const rids = trainList.map((t: any) => t.rid);
      const CHUNK_SIZE = 100;
      const chunks = [];
      for (let i = 0; i < rids.length; i += CHUNK_SIZE) {
        chunks.push(rids.slice(i, i + CHUNK_SIZE));
      }

      await Promise.all(chunks.map(async (chunk) => {
        const data = await convex.query(api.functions.trains.getDetailsForRids, { rids: chunk });
        Object.assign(cachedDetails, data);
      }));

      // Trigger sync for missing data
      const missingRids = rids.filter((rid: string) => !cachedDetails[rid]);
      if (missingRids.length > 0) {
        convex.action(api.functions.trains.syncBatch, { rids: missingRids });
      }
    }

    const response = {
      trains: trainList.map((t: any) => ({
        id: t.rid,
        delay: t.delay,
        location: t.location,
        rotation: 0, 
        operator_code: t.toc_code,
        // If simple mode, show basic info, otherwise show rich data
        operator: isSimpleMode ? "N/A" : (cachedDetails[t.rid]?.train_operator ?? "Loading..."),
        service: isSimpleMode ? (t.headcode ?? t.rid) : (cachedDetails[t.rid]?.headcode ?? "N/A"),
        destination: isSimpleMode ? "N/A" : (cachedDetails[t.rid]?.destination_name ?? "Loading..."),
        colour: getTrainColour(t.delay),
      })),
      buses: busList.map((b: any) => ({
        id: b.trip_id,
        location: { lat: b.coordinates?.[1] ?? 0, lon: b.coordinates?.[0] ?? 0 },
        rotation: b.heading ?? 0,
        service: b.service?.line_name ?? "N/A",
        destination: b.destination ?? "Unknown",
        name: b.vehicle?.name ?? "Unknown Bus",
        colour: b.vehicle?.colour ?? "#ff0000",
        liveryID: b.vehicle?.livery ?? 0,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in live-vehicles API:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

function getTrainColour(delay: number) {
  if (delay <= -5) return "blue";
  if (delay <= 0) return "green";
  if (delay <= 9) return "orange";
  if (delay <= 19) return "red";
  return "pink";
}