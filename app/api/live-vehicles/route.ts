import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Redis } from "ioredis";
import { RateLimiterRedis } from "rate-limiter-flexible";

const redisClient = new Redis(process.env.REDIS_URL!, {
  enableAutoPipelining: true,
  maxRetriesPerRequest: 3,
});
redisClient.on("error", (err) => console.error("Redis Client Error", err));

const limiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "api_limit",
  points: 5,
  duration: 1,
});

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
});

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getDelayText(delay: number) {
  if (delay < 0) return `${Math.abs(delay)} mins early`;
  if (delay === 0) return "on time";
  return `${delay} mins late`;
}

function interpolateColour(c1: number[], c2: number[], t: number) {
  return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(",")})`;
}

function getTrainColour(delay: number, headcode?: string) {
  if (headcode === "N/A") return "#1e1e1f";
  if (delay <= -3) return "#3B82F6";
  if (delay <= 2) return "#22C55E";
  if (delay <= 9) return interpolateColour([245, 158, 11], [239, 68, 68], (delay - 3) / 6);
  if (delay <= 19) return interpolateColour([239, 68, 68], [236, 72, 153], (delay - 10) / 9);
  if (delay <= 59) return "#EC4899";
  return "#8B5CF6";
}

function getCacheKey(xmin: string, ymin: string, xmax: string, ymax: string) {
  const r = (val: string) => Math.round(parseFloat(val) * 200) / 200;
  return `cache:vehicles:${r(xmin)}:${r(ymin)}:${r(xmax)}:${r(ymax)}`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  try {
    await limiter.consume(ip);
  } catch {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const xmin = searchParams.get("xmin");
  const ymin = searchParams.get("ymin");
  const xmax = searchParams.get("xmax");
  const ymax = searchParams.get("ymax");

  if (!xmin || !ymin || !xmax || !ymax) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const cacheKey = getCacheKey(xmin, ymin, xmax, ymax);
  const cachedResponse = await redisClient.get(cacheKey);
  if (cachedResponse) return NextResponse.json(JSON.parse(cachedResponse));

  const showTrains = searchParams.get("showTrains") !== "false";
  const showBuses = searchParams.get("showBuses") !== "false";

  const latMin = parseFloat(ymin);
  const latMax = parseFloat(ymax);
  const lonMin = parseFloat(xmin);
  const lonMax = parseFloat(xmax);
  const bboxQuery = `xmin=${xmin}&ymin=${ymin}&xmax=${xmax}&ymax=${ymax}`;
  const today = new Date().toISOString().split("T")[0];

  try {
    // Fetch trains + buses in parallel
    const [trainRes, busRes] = await Promise.allSettled([
      showTrains
        ? fetch(`https://map-api.production.signalbox.io/api/locations?${bboxQuery}`)
        : Promise.resolve(null),
      showBuses
        ? fetch(`https://bustimes.org/vehicles.json?${bboxQuery}`)
        : Promise.resolve(null),
    ]);

    const allTrains: any[] =
      showTrains && trainRes.status === "fulfilled" && trainRes.value?.ok
        ? (await trainRes.value.json()).train_locations ?? []
        : [];

    const busData: any[] =
      showBuses && busRes.status === "fulfilled" && busRes.value?.ok
        ? await busRes.value.json()
        : [];

    const visibleTrains = allTrains.filter((t: any) => {
      const lat = t.location?.lat;
      const lon = t.location?.lon;
      if (lat == null || lon == null) return false;
      return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
    });

    const isSimpleMode = visibleTrains.length + busData.length > 1000;

    // Fetch Convex train details in parallel with nothing (it was serial before)
    // Use CHUNK_SIZE 200 to minimise round trips
    let trainDetails: Record<string, any> = {};
    if (!isSimpleMode && showTrains && visibleTrains.length > 0) {
      const rids = visibleTrains.map((t: any) => t.rid).filter(Boolean) as string[];
      const chunks = chunkArray(rids, 200);
      const results = await Promise.all(
        chunks.map((chunk) => convex.query(api.functions.trains.getDetailsForRids, { rids: chunk }))
      );
      for (const result of results) Object.assign(trainDetails, result);
    }

    const response = {
      trains: visibleTrains.map((t: any) => {
        const rotation =
          t.location && t.predicted_location
            ? calculateBearing(
                t.location.lat,
                t.location.lon,
                t.predicted_location.lat,
                t.predicted_location.lon
              )
            : 0;

        const details = trainDetails[t.rid] ?? {};
        const headcode = details.headcode ?? t.headcode ?? "N/A";

        let label1 = "Unknown Service";
        if (headcode && details.destination_name) label1 = `${headcode} to ${details.destination_name}`;
        else if (headcode) label1 = headcode;
        else if (details.destination_name) label1 = `Service to ${details.destination_name}`;

        return {
          id: t.rid,
          delay: t.delay,
          location: t.location,
          rotation,
          operator: isSimpleMode ? "" : (details.train_operator ?? "Loading..."),
          service: isSimpleMode ? (t.headcode ?? "Loading...") : headcode,
          destination: isSimpleMode ? "N/A" : (details.destination_name ?? "Loading..."),
          colour: getTrainColour(t.delay, isSimpleMode ? undefined : headcode),
          popup_data: {
            label1,
            link1: details.uid
              ? `https://www.realtimetrains.co.uk/service/gb-nr:${details.uid}/${today}/detailed`
              : "#",
            label2: getDelayText(t.delay),
            log_link: `/log?service_rid=${t.rid}`,
          },
        };
      }),

      buses: busData.map((b: any) => ({
        id: b.trip_id,
        location: {
          lat: b.coordinates?.[1] ?? 0,
          lon: b.coordinates?.[0] ?? 0,
        },
        rotation: b.heading ?? 0,
        service: b.service?.line_name ?? "N/A",
        destination: b.destination ?? "Unknown",
        colour: b.vehicle?.colour ?? "#3B82F6",
        liveryID: b.vehicle?.livery ?? 0,
        popup_data: {
          label1: `${b.service?.line_name ?? "Bus"} to ${b.destination ?? "Unknown"}`,
          link1: `https://bustimes.org/trips/${b.trip_id}`,
          label2: b.vehicle?.name ?? "Unknown Bus",
          link2: `https://bustimes.org${b.vehicle?.url ?? ""}`,
          log_link: `/log?service_id=${b.trip_id}&date=${b.date ?? ""}`,
        },
      })),
    };

    await redisClient.set(cacheKey, JSON.stringify(response), "EX", 30);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in live-vehicles API:", error);
    return NextResponse.json(
      { error: `Failed to fetch data: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}