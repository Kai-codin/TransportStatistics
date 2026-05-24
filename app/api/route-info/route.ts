import { NextResponse } from "next/server";
import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { withApiKeyAuth } from "@/lib/api-key-auth";
import { getTrainAllocation } from "@/lib/realtime-trains";

const REDIS_DISABLED =
  process.env.DISABLE_REDIS === 'true' || process.env.REDIS_DISABLED === 'true';

let redisClient: Redis | any;
let limiter: any;

if (!REDIS_DISABLED) {
  // 1. Initialize Redis with better error handling
  redisClient = new Redis(process.env.REDIS_URL!, {
    enableAutoPipelining: true,
    maxRetriesPerRequest: 3,
    // Add a generic error handler so it doesn't crash the server
    lazyConnect: true,
  });

  redisClient.on('error', (err: unknown) => console.error('Redis Client Error', err));

  // 2. Setup the rate limiter
  limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'api_limit',
    points: 5, // 5 requests
    duration: 1, // per 1 second
  });
} else {
  redisClient = { get: async (_: string) => null, set: async (_: string, __: string) => null, on: () => null } as unknown as Redis;
  limiter = new RateLimiterMemory({ points: 5, duration: 1 });
}

function normalizeAllocationUnits(allocationData: any): string[] {
  if (!allocationData) return [];
  if (Array.isArray(allocationData)) {
    return allocationData.map((item) => String(item)).filter(Boolean);
  }
  if (typeof allocationData === 'object') {
    return Object.values(allocationData)
      .map((item: any) => item?.unit_number || item?.unit_reg)
      .filter(Boolean)
      .map((item) => String(item));
  }
  return [String(allocationData)];
}

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  // Identify user by IP
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  try {
    // 3. Consume points. This will throw an error if rate limited
    await limiter.consume(ip);
  } catch (rejRes: any) {
    // This runs if the user is rate limited
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }
  
  const { searchParams } = new URL(request.url);
  const rid = searchParams.get("rid");
  const trip_id = searchParams.get("trip_id");

  try {
    if (rid) {
      // --- TRAIN DATA FETCH ---
      const [routeRes, infoRes] = await Promise.all([
        fetch(`https://map-api.production.signalbox.io/api/route/${rid}`),
        fetch(`https://map-api.production.signalbox.io/api/train-information/${rid}`)
      ]);

      if (!routeRes.ok || !infoRes.ok) throw new Error("Train data not found");
      const routeData = await routeRes.json();
      const infoData = await infoRes.json();

      const date = infoData.origin_departure.split('T')[0];

      const allocationData = await getTrainAllocation(infoData.uid, date);
      const vehicles = normalizeAllocationUnits(allocationData);

      return NextResponse.json({
        type: "train",
        id: rid,
        service: infoData.headcode,
        operator: infoData.train_operator,
        destination: infoData.destination_name,
        path: routeData.coordinates || [],
        vehicles,
        snapped: true 
      });

    } else if (trip_id) {
      // --- BUS DATA FETCH ---
      const res = await fetch(`https://bustimes.org/api/trips/${trip_id}/`);
      if (!res.ok) throw new Error("Bus data not found");
      const data = await res.json();

      // 1. Flatten the fragmented tracks from the times array
      let fullPath: any[] = [];
      if (Array.isArray(data.times)) {
        data.times.forEach((t: any) => {
          if (Array.isArray(t.track)) {
            fullPath.push(...t.track);
          }
        });
      }

      // 2. Determine snapped status: if we collected any points from tracks, it's snapped
      const isSnapped = fullPath.length > 0;

      // 3. Fallback: If no tracks were found, use stop locations
      if (!isSnapped && Array.isArray(data.times)) {
        fullPath = data.times.map((t: any) => t.stop.location);
      }
      
      return NextResponse.json({
        type: "bus",
        id: trip_id,
        path: fullPath,
        snapped: isSnapped
      });
    }

    return NextResponse.json({ error: "Missing rid or trip_id" }, { status: 400 });
  } catch (error) {
    console.error("Proxy Error:", error);
    return NextResponse.json({ error: "Failed to fetch route info" }, { status: 500 });
  }
});