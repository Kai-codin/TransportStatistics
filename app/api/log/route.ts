/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { withApiKeyAuth } from '@/lib/api-key-auth';

const consoleDebug = false;

const REDIS_DISABLED =
  process.env.DISABLE_REDIS === 'true' || process.env.REDIS_DISABLED === 'true';

let redisClient: Redis | any;
let limiter: any;

if (!REDIS_DISABLED) {
  redisClient = new Redis(process.env.REDIS_URL!, { 
    lazyConnect: true,
    maxRetriesPerRequest: 3 
  });

  limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'detail_limit',
    points: 5, 
    duration: 1,
  });
} else {
  redisClient = { get: async () => null, set: async () => null, on: () => null } as unknown as Redis;
  limiter = new RateLimiterMemory({ points: 5, duration: 1 });
}

function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function log(message: string) {
  if (consoleDebug) console.log(`[Detail API] ${message}`);
}

function isPassingPoint(loc: any): boolean {
  const hasScheduled = Boolean(
    loc.temporalData?.arrival?.scheduleAdvertised ||
    loc.temporalData?.departure?.scheduleAdvertised
  );
  const isPass = loc.displayAs === 'PASS';
  return isPass || !hasScheduled;
}

function toLineStringGeometry(routeData: any) {
  if (!routeData) return null;
  if (routeData.type === "LineString" && Array.isArray(routeData.coordinates)) {
    return routeData;
  }
  if (routeData.geometry?.type === "LineString" && Array.isArray(routeData.geometry.coordinates)) {
    return routeData.geometry;
  }
  if (Array.isArray(routeData.coordinates)) {
    return { type: "LineString", coordinates: routeData.coordinates };
  }
  if (Array.isArray(routeData)) {
    return { type: "LineString", coordinates: routeData };
  }
  return null;
}

function dateToTimestamp(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
}

// --- Auth Cache for RTT ---
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getRTTToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  log('Refreshing RTT access token...');
  const response = await fetch('https://data.rtt.io/api/get_access_token', {
    headers: { 'Authorization': `Bearer ${process.env.RTT_REFRESH_TOKEN}` },
  });

  if (!response.ok) {
    throw new Error(`AUTH_FAILURE: Failed to refresh RTT token (${response.status})`);
  }

  const data = await response.json();
  cachedToken = data.token;
  tokenExpiry = new Date(data.validUntil).getTime();
  return cachedToken!;
}

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  
  try { 
    await limiter.consume(ip); 
  } catch {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const serviceRid = searchParams.get('service_rid');
  const serviceId = searchParams.get('service_id');
  const serviceUid = searchParams.get('service_uid');
  const tripId = searchParams.get('trip_id');
  const uid = searchParams.get('uid') ?? serviceUid ?? serviceId ?? tripId;
  const date = searchParams.get('date') ?? searchParams.get('service_date'); 
  const type = searchParams.get('type') || (serviceRid ? 'train' : (serviceId || tripId ? 'bus' : 'train'));
  const debug = searchParams.get('debug') === 'true';
  const showPass = searchParams.get('show_pass') === 'true';

  if (serviceRid) {
    try {
      return await handleServiceRidRequest(serviceRid, debug, showPass);
    } catch (err: any) {
      log(`RID resolution error: ${err.message}`);
      return NextResponse.json({
        error: 'Failed to resolve service RID.',
        message: err.message,
      }, { status: 500 });
    }
  }

  if (!uid || !date) {
    return NextResponse.json({ 
      error: 'Missing required parameters.', 
      details: 'Both "uid" and "date" (YYYY-MM-DD) are required.' 
    }, { status: 400 });
  }

  try {
    switch (type) {
      case 'train':
        return await handleTrainRequest(uid, date, debug, showPass);
      case 'bus':
        return await handleBusRequest(uid, date, debug);
      default:
        return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
    }
  } catch (err: any) {
    log(`Critical Error: ${err.message}`);
    return NextResponse.json({ 
      error: 'An internal error occurred.', 
      message: err.message 
    }, { status: 500 });
  }
});

const resolveServiceRidPayload = (payload: any) => {
  const uid =
    payload?.uid ??
    payload?.service?.uid ??
    payload?.train?.uid ??
    payload?.data?.uid ??
    null;

  const destinationArrival =
    payload?.destination_arrival ??
    payload?.service?.destination_arrival ??
    payload?.train?.destination_arrival ??
    payload?.data?.destination_arrival ??
    null;

  const date =
    typeof destinationArrival === "string" && destinationArrival.includes("T")
      ? destinationArrival.split("T")[0]
      : null;

  return { uid, date };
};

async function handleServiceRidRequest(serviceRid: string, debug: boolean, showPass: boolean) {
  const response = await fetch(`https://map-api.production.signalbox.io/api/train-information/${serviceRid}`);

  if (!response.ok) {
    return NextResponse.json(
      { error: "Signalbox train lookup failed." },
      { status: 500 },
    );
  }

  const payload = await response.json();
  const { uid, date } = resolveServiceRidPayload(payload);

  if (!uid || !date) {
    return NextResponse.json(
      {
        error: "Signalbox lookup did not return a usable UID and date.",
        debug: debug ? payload : undefined,
      },
      { status: 500 },
    );
  }

  return handleTrainRequest(uid, date, debug, showPass);
}

function mergeTrainStopAndTrack(locations: any[], routeData: any, uid: string, date: string) {
  const geometry = toLineStringGeometry(routeData);
  const fullCoords = geometry?.coordinates || [];

  // Helper to generate our unique number ID
  const generateId = (loc: any, i: number) => {
    const formatted = formatStop(loc);
    const stopCode = formatted.stop_code ?? i.toString();
    return hashStringToNumber(`${uid}-${date}-${stopCode}`);
  };

  // IF NO GEOMETRY: Just return stops with unique IDs
  if (fullCoords.length === 0) {
    return locations.map((loc, i) => ({
      id: generateId(loc, i), // FIX: Use unique ID here too
      stop: formatStop(loc),
      scheduled_arrival: loc.temporalData?.arrival?.scheduleAdvertised || null,
      scheduled_departure: loc.temporalData?.departure?.scheduleAdvertised || null,
      actual_arrival: loc.temporalData?.arrival?.realtimeActual || loc.temporalData?.arrival?.realtimeForecast || null,
      actual_departure: loc.temporalData?.departure?.realtimeActual || loc.temporalData?.departure?.realtimeForecast || null,
      track: null,
    }));
  }

  // Pass 1: find the closest geometry index for each stop
  const closestIndices: number[] = [];
  let searchFrom = 0;

  for (const loc of locations) {
    const stopCoords = formatStop(loc).location as [number, number] | null;

    if (!stopCoords) {
      closestIndices.push(searchFrom);
      continue;
    }

    let closestIdx = searchFrom;
    let minDistance = Infinity;

    for (let j = searchFrom; j < fullCoords.length; j++) {
      const dist = Math.sqrt(
        Math.pow(fullCoords[j][0] - stopCoords[0], 2) +
        Math.pow(fullCoords[j][1] - stopCoords[1], 2)
      );
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = j;
      }
    }

    closestIndices.push(closestIdx);
    searchFrom = closestIdx;
  }

  // Pass 2: assign each stop the track segment from itself to the *next* stop
  return locations.map((loc, i) => {
    const formattedStop = formatStop(loc);
    const isLast = i === locations.length - 1;

    const stopCode = formattedStop.stop_code ?? i.toString();
    const uniqueString = `${uid}-${date}-${stopCode}`;
    const uniqueId = hashStringToNumber(uniqueString);

    let trackSegment: any[] = [];
    if (!isLast) {
      const fromIdx = closestIndices[i];
      const toIdx = closestIndices[i + 1];
      trackSegment = fullCoords.slice(fromIdx, toIdx + 1);
    }

    return {
      id: uniqueId, // Now a unique string instead of just 'i'
      stop: formattedStop,
      scheduled_arrival: loc.temporalData?.arrival?.scheduleAdvertised || null,
      scheduled_departure: loc.temporalData?.departure?.scheduleAdvertised || null,
      actual_arrival: loc.temporalData?.arrival?.realtimeActual || loc.temporalData?.arrival?.realtimeForecast || null,
      actual_departure: loc.temporalData?.departure?.realtimeActual || loc.temporalData?.departure?.realtimeForecast || null,
      track: trackSegment.length > 0 ? trackSegment : null,
      timing_status: loc.displayAs,
      pick_up: loc.scheduledCallType?.includes("PICK_UP"),
      set_down: loc.scheduledCallType?.includes("SET_DOWN"),
    };
  });
}


function formatStop(loc: any) {
  const hasCoords = typeof loc.stopData?.lon === "number" && typeof loc.stopData?.lat === "number";
  const location = hasCoords
    ? [loc.stopData.lon, loc.stopData.lat]
    : (loc.stopData?.location || null);

  return {
    stop_code: loc.location.shortCodes?.[0] || null,
    name: loc.location.description,
    location: location,
    bearing: null,
    icon: null
  };
}

async function handleTrainRequest(uid: string, date: string, debug: boolean, showPass: boolean) {
  log(`Processing train: ${uid} for ${date}`);

  let rid: string | null = null;
  try {
    const trainRecord = await fetchQuery(api.functions.trains.getRidWithUID, { uid });
    if (trainRecord) rid = trainRecord.rid;
  } catch (e: any) {
    log(`Convex Lookup Error: ${e.message}`);
  }

  try {
    const token = await getRTTToken();
    const rttUrl = `https://data.rtt.io/gb-nr/service?uniqueIdentity=${uid}:${date}&detailed=true`;
    
    const rttPromise = fetch(rttUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    const routePromise = rid 
      ? fetch(`https://map-api.production.signalbox.io/api/route/${rid}`).catch(() => null)
      : Promise.resolve(null);

    const [rttRes, routeRes] = await Promise.all([rttPromise, routePromise]);
    const rttData = await rttRes.json();
    const routeData = routeRes?.ok ? await routeRes.json() : null;
    const fullRouteGeometry = toLineStringGeometry(routeData);

    const service = rttData.service;
    if (!service) return NextResponse.json({ error: 'Missing service object' }, { status: 500 });

    // --- FIX: Define the missing variables ---
    const meta = service.scheduleMetadata;
    const locations = service.locations || [];
    const filteredLocations = showPass ? locations : locations.filter((loc: any) => !isPassingPoint(loc));
    const origin = filteredLocations[0];
    const destination = filteredLocations[filteredLocations.length - 1];
    // -----------------------------------------

    // 1. Resolve stop locations from Convex using crsCodes
    const locationsWithCoords = await Promise.all(
      filteredLocations.map(async (loc: any) => {
        const crs = loc.location.shortCodes?.[0];
        let stopData = null;
        if (crs) {
          stopData = await fetchQuery(api.functions.stops.getGroupByCode, { code: crs });
        }
        return { ...loc, stopData };
      })
    );

    // 2. Merge Stop and Track
    const full_route = mergeTrainStopAndTrack(locationsWithCoords, routeData, uid, date);

    const responsePayload = {
      service_number: meta?.trainReportingIdentity ?? "Unknown",
      operator: meta?.operator?.name ?? "Unknown",
      operator_slug: meta?.operator?.code?.toLowerCase() ?? "unknown",
      service_date: meta?.departureDate ? new Date(meta.departureDate).getTime() : Date.now(),
      origin_name: origin?.location?.description ?? "Unknown Origin",
      origin_stop_code: origin?.location?.shortCodes?.[0] ?? null,
      destination_name: destination?.location?.description ?? "Unknown Destination",
      destination_stop_code: destination?.location?.shortCodes?.[0] ?? null,
      scheduled_departure: origin?.temporalData?.departure?.scheduleInternal,
      actual_departure: origin?.temporalData?.departure?.realtimeActual || origin?.temporalData?.departure?.realtimeForecast,
      scheduled_arrival: destination?.temporalData?.arrival?.scheduleInternal,
      actual_arrival: destination?.temporalData?.arrival?.realtimeActual || destination?.temporalData?.arrival?.realtimeForecast,
      full_route_geometry: fullRouteGeometry,
      full_locations: full_route,
      full_route: full_route, 
      unit: service.allocationData?.[0] ? {
          unit_number: service.allocationData[0].allocationItems?.[0]?.identity || null,
          unit_type: service.allocationData[0].leadingClass || null,
          unit_reg: null,
          livery: null,
          livery_left: null,
      } : null,
      debug: debug ? {
        rid,
        route_found: Boolean(fullRouteGeometry),
      } : undefined,
    };

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleBusRequest(uid: string, date: string, debug: boolean) {
  log(`Processing bus trip: ${uid} for ${date}`);

  try {
    const tripRes = await fetch(`https://bustimes.org/api/trips/${uid}/`);
    if (!tripRes.ok) {
      return NextResponse.json({ error: 'Bus trip not found on bustimes.org' }, { status: 404 });
    }
    const tripData = await tripRes.json();

    const assignmentRes = await fetch(`https://bustimes.org/api/vehiclejourneys/?trip=${uid}`);
    const assignmentData = assignmentRes.ok ? await assignmentRes.json() : null;
    const vehicleStub = assignmentData?.results?.[0]?.vehicle;

    let vehicleDetails = null;
    if (vehicleStub?.id) {
      const vDetailsRes = await fetch(`https://bustimes.org/api/vehicles/${vehicleStub.id}/`);
      if (vDetailsRes.ok) {
        vehicleDetails = await vDetailsRes.json();
      }
    }

    const stops = tripData.times || [];
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    // 1. Generate the unified full_route (Matches train format)
    const full_route = stops.map((time: any, index: number) => {
      const isLast = index === stops.length - 1;
      // bustimes track leads TO this stop, so we want the next stop's track
      const nextTrack = !isLast && stops[index + 1]?.track?.length > 0
        ? stops[index + 1].track
        : null;

      const uniqueId = `bus-${uid}-${date}-${time.stop.atco_code ?? index}`;
    
      return {
        id:  hashStringToNumber(uniqueId),
        stop: {
          stop_code: time.stop.atco_code,
          name: time.stop.name,
          location: time.stop.location,
          bearing: null,
          icon: null
        },
        scheduled_arrival: time.aimed_arrival_time || null,
        scheduled_departure: time.aimed_departure_time || null,
        actual_arrival: time.expected_arrival_time || time.aimed_arrival_time || null,
        actual_departure: time.expected_departure_time || time.aimed_departure_time || null,
        track: nextTrack,
        timing_status: time.status || "scheduled",
        pick_up: true,
        set_down: true
      };
    });

    // 2. Stitch geometry for the full_route_geometry field
    const stitchedGeometry = {
      type: "LineString",
      coordinates: stops
        .filter((t: any) => t.track && Array.isArray(t.track))
        .flatMap((t: any) => t.track)
    };

    const responsePayload = {
      service_number: tripData.service?.line_name ?? "Unknown",
      operator: tripData.operator?.name ?? "Unknown Operator",
      operator_slug: tripData.operator?.slug ?? "unknown",
      service_date: dateToTimestamp(date),
      bustimes_service_id: typeof tripData.service?.id === "number" ? tripData.service.id : undefined,
      bustimes_service_slug: tripData.service?.slug ?? undefined,
      origin_name: firstStop?.stop?.name ?? "Unknown Origin",
      origin_stop_code: firstStop?.stop?.atco_code ?? null,
      destination_name: tripData.headsign ?? lastStop?.stop?.name ?? "Unknown",
      destination_stop_code: lastStop?.stop?.atco_code ?? null,
      scheduled_departure: firstStop?.aimed_departure_time,
      actual_departure: firstStop?.expected_departure_time || firstStop?.aimed_departure_time,
      scheduled_arrival: lastStop?.aimed_arrival_time,
      actual_arrival: lastStop?.expected_arrival_time || lastStop?.aimed_arrival_time,
      full_route_geometry: stitchedGeometry.coordinates.length > 0 ? stitchedGeometry : null,
      full_locations: full_route,
      full_route: full_route,
      unit: vehicleDetails ? {
        unit_number: vehicleDetails.fleet_code || vehicleDetails.fleet_number || null,
        unit_reg: vehicleDetails.reg || null,
        unit_type: vehicleDetails.vehicle_type?.name || "Bus",
        livery: vehicleDetails.livery?.name || null,
        livery_left: vehicleDetails.livery?.left || null,
      } : null,
      debug: debug ? {
        trip_raw: tripData,
        assignment_raw: assignmentData,
        vehicle_raw: vehicleDetails,
      } : undefined,
    };

    return NextResponse.json(responsePayload);

  } catch (error: any) {
    log(`Bus Handler Error: ${error.message}`);
    return NextResponse.json({ error: 'Internal Bus API Error', details: error.message }, { status: 500 });
  }
}