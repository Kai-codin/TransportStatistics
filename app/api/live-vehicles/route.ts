// app/api/live-vehicles/route.ts
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(request: Request) {
  // 1. Extract and Validate BBox parameters
  const { searchParams } = new URL(request.url);
  const xmin = searchParams.get("xmin");
  const ymin = searchParams.get("ymin");
  const xmax = searchParams.get("xmax");
  const ymax = searchParams.get("ymax");

  // Guard Clause: Ensure BBox is provided
  if (!xmin || !ymin || !xmax || !ymax) {
    return NextResponse.json(
      { error: "Missing bounding box parameters (xmin, ymin, xmax, ymax)" },
      { status: 400 }
    );
  }

  // Construct query string
  const bboxQuery = `xmin=${xmin}&ymin=${ymin}&xmax=${xmax}&ymax=${ymax}`;

  try {
    // 2. Fetch live data with bbox applied to both APIs
    const [trainsRes, busesRes] = await Promise.allSettled([
      fetch(`https://map-api.production.signalbox.io/api/locations?${bboxQuery}`),
      fetch(`https://bustimes.org/vehicles.json?${bboxQuery}`),
    ]);

    // Handle train data
    const trainData = trainsRes.status === "fulfilled" && trainsRes.value.ok 
      ? await trainsRes.value.json() 
      : { train_locations: [] };

    // Handle bus data
    const busData = busesRes.status === "fulfilled" && busesRes.value.ok 
      ? await busesRes.value.json() 
      : [];

    // 3. CHECK: Too many buses?
    if (busData.length > 1000) {
      return NextResponse.json(
        { 
          error: "Too many vehicles", 
          message: `The selected area contains ${busData.length} buses. Please zoom in to see data.` 
        }, 
        { status: 429 } 
      );
    }

    // 4. Get RIDs from live trains
    const rids = trainData.train_locations.map((t: any) => t.rid);

    // 5. Query Convex for cached details
    const cachedDetails = await convex.query(api.functions.trains.getDetailsForRids, { rids });

    // 6. Trigger BATCH sync for missing RIDs
    const missingRids = rids.filter((rid: string) => !cachedDetails[rid]);
    if (missingRids.length > 0) {
      // You only call this action if you actually have missing data
      convex.action(api.functions.trains.syncBatch, { rids: missingRids });
    }

    // 7. Build and return response
    const response = {
      trains: trainData.train_locations.map((t: any) => {
        const details = cachedDetails[t.rid];
        return {
          id: t.rid,
          delay: t.delay,
          location: t.location,
          rotation: 0, 
          operator_code: t.toc_code,
          operator: details?.train_operator ?? "Loading...",
          service: details?.headcode ?? "N/A",
          destination: details?.destination_name ?? "Loading...",
          colour: getTrainColour(t.delay),
        };
      }),
      buses: busData.map((b: any) => ({
        id: b.trip_id,
        location: { 
            lat: b.coordinates?.[1] ?? 0, 
            lon: b.coordinates?.[0] ?? 0 
        },
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