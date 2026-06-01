/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { withApiKeyAuth } from '@/lib/api-key-auth';
import { buildBustimesUrl, getBustimesBaseUrl } from '@/lib/bustimes-source';
import { getTrainAllocation } from "@/lib/realtime-trains";

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
  const bustimesBaseUrl = await getBustimesBaseUrl("tripLookup", _auth?.userId);
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
  const debug = searchParams.get('debug') === 'false';
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
        return await handleBusRequest(uid, date, debug, bustimesBaseUrl);
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

const resolveServiceRidPayload = (payload: any, serviceRid?: string) => {
  // 1. Resolve UID
  const uid =
    payload?.uid ??
    payload?.service?.uid ??
    payload?.train?.uid ??
    payload?.data?.uid ??
    null;

  // 2. Target origin_departure FIRST (The definitive schedule operational date)
  const originDeparture = 
    payload?.origin_departure ?? 
    payload?.service?.origin_departure ??
    payload?.train?.origin_departure ??
    null;

  let date = typeof originDeparture === "string" && originDeparture.includes("T")
    ? originDeparture.split("T")[0]
    : null;

  // 3. Fallback to destination_arrival ONLY if origin_departure is entirely absent
  if (!date) {
    const destinationArrival =
      payload?.destination_arrival ??
      payload?.service?.destination_arrival ??
      payload?.train?.destination_arrival ??
      payload?.data?.destination_arrival ??
      null;

    date = typeof destinationArrival === "string" && destinationArrival.includes("T")
        ? destinationArrival.split("T")[0]
        : null;
  }

  // 4. Absolute Fallback: Extract the date directly from the Service RID string digits
  if (!date && serviceRid && serviceRid.length >= 8) {
    const year = serviceRid.substring(0, 4);
    const month = serviceRid.substring(4, 6);
    const day = serviceRid.substring(6, 8);
    
    if (!isNaN(Number(year)) && !isNaN(Number(month)) && !isNaN(Number(day))) {
      date = `${year}-${month}-${day}`;
    }
  }

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

  return handleTrainRequest(uid, date, debug, showPass, serviceRid);
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

  // Pass 2: assign each stop the track segment from the PREVIOUS stop to itself
  return locations.map((loc, i) => {
    const formattedStop = formatStop(loc);
    const isFirst = i === 0;

    const stopCode = formattedStop.stop_code ?? i.toString();
    const uniqueString = `${uid}-${date}-${stopCode}`;
    const uniqueId = hashStringToNumber(uniqueString);

    let trackSegment: any[] = [];
    if (!isFirst) {
      const fromIdx = closestIndices[i - 1];
      const toIdx = closestIndices[i];
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

async function handleTrainRequest(
  uid: string,
  date: string,
  debug: boolean,
  showPass: boolean,
  serviceRid?: string,
) {
  log(`Processing train: ${uid} for ${date}`);

  let rid: string | null = serviceRid ?? null;
  if (!rid) {
    try {
      const trainRecord = await fetchQuery(api.functions.trains.getRidWithUID, { uid });
      if (trainRecord) rid = trainRecord.rid;
    } catch (e: any) {
      log(`Convex Lookup Error: ${e.message}`);
    }
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
    const allocationData = await getTrainAllocation(uid, date);

    console.log(`Train ${uid} on ${date} has ${full_route.length} stops after merging.`);
    console.log(`Allocation data: ${JSON.stringify(allocationData)}`);

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
      unit: allocationData,
    };

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleBusRequest(uid: string, date: string, debug: boolean, bustimesBaseUrl: string) {
  log(`Processing bus trip: ${uid} for ${date}`);

  try {
    // Always fetch the trip directly — this is the source of truth for stops + track
    const tripGeomRes = await fetch(buildBustimesUrl(bustimesBaseUrl, `/api/trips/${uid}/`));
    if (!tripGeomRes.ok) {
      return NextResponse.json({ error: 'Bus trip not found on bustimes.org' }, { status: 404 });
    }
    const geomData = await tripGeomRes.json();
    const geomTimes: any[] = geomData?.times ?? [];

    // Journey lookup is best-effort — only needed for realtime + vehicle data
    let journeyLookupData: any = null;
    let tripData: any = null;
    let vehicleDetails: any = null;

    const journeyLookupRes = await fetch(
      buildBustimesUrl(bustimesBaseUrl, `/api/vehiclejourneys/?vehicle=&service=&trip=${uid}&source=&datetime=&date=${date}`)
    );

    if (journeyLookupRes.ok) {
      journeyLookupData = await journeyLookupRes.json();
      const journeyId = journeyLookupData?.results?.[0]?.id;

      if (journeyId) {
        const journeyDetailsRes = await fetch(buildBustimesUrl(bustimesBaseUrl, `/api/vehiclejourneys/${journeyId}/details/`));
        if (journeyDetailsRes.ok) {
          tripData = await journeyDetailsRes.json();

          const vehicleStub = tripData?.vehicle ?? tripData?.trip?.vehicle ?? null;
          if (vehicleStub?.id) {
            const vDetailsRes = await fetch(buildBustimesUrl(bustimesBaseUrl, `/api/vehicles/${vehicleStub.id}/`));
            if (vDetailsRes.ok) vehicleDetails = await vDetailsRes.json();
          }
        }
      }
    }

    // Use realtime times if available, otherwise fall back to geom times
    const trip = tripData?.trip ?? tripData ?? geomData;
    const realtimeTimes: any[] = trip?.times ?? [];
    const stops = realtimeTimes.length > 0 ? realtimeTimes : geomTimes;

    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    const getAimedArrival = (time: any) => time?.aimed_arrival_time ?? null;
    const getAimedDeparture = (time: any) => time?.aimed_departure_time ?? null;
    const getActualArrival = (time: any) =>
      time?.actual_arrival_time ??
      time?.expected_arrival_time ??
      time?.aimed_arrival_time ??
      null;
    const getActualDeparture = (time: any) =>
      time?.actual_departure_time ??
      time?.expected_departure_time ??
      time?.aimed_departure_time ??
      null;

    const full_route = stops.map((time: any, index: number) => {
      const isFirst = index === 0;
      const track = !isFirst && geomTimes[index]?.track?.length > 0
        ? geomTimes[index].track
        : null;

      const uniqueId = `bus-${uid}-${date}-${time.stop.atco_code ?? index}`;

      return {
        id: hashStringToNumber(uniqueId),
        stop: {
          stop_code: time.stop.atco_code,
          name: time.stop.name,
          location: time.stop.location,
          bearing: null,
          icon: null,
        },
        scheduled_arrival: getAimedArrival(time),
        scheduled_departure: getAimedDeparture(time),
        actual_arrival: getActualArrival(time),
        actual_departure: getActualDeparture(time),
        track,
        timing_status: time.timing_status || time.status || "scheduled",
        pick_up: time.pick_up ?? true,
        set_down: time.set_down ?? true,
      };
    });

    const stitchedGeometry = {
      type: "LineString",
      coordinates: geomTimes
        .filter((t: any) => t.track && Array.isArray(t.track))
        .flatMap((t: any) => t.track)
    };

    const responsePayload = {
      service_number: geomData?.service?.line_name ?? trip?.service?.line_name ?? "Unknown",
      operator: geomData?.operator?.name ?? trip?.operator?.name ?? "Unknown Operator",
      operator_slug: geomData?.operator?.slug ?? geomData?.operator?.noc?.toLowerCase?.() ?? "unknown",
      service_date: dateToTimestamp(date),
      bustimes_service_id: typeof geomData?.service?.id === "number" ? geomData.service.id : undefined,
      bustimes_service_slug: geomData?.service?.slug ?? undefined,
      origin_name: firstStop?.stop?.name ?? "Unknown Origin",
      origin_stop_code: firstStop?.stop?.atco_code ?? null,
      destination_name: geomData?.headsign ?? lastStop?.stop?.name ?? "Unknown",
      destination_stop_code: lastStop?.stop?.atco_code ?? null,
      scheduled_departure: getAimedDeparture(firstStop),
      actual_departure: getActualDeparture(firstStop),
      scheduled_arrival: getAimedArrival(lastStop),
      actual_arrival: getActualArrival(lastStop),
      full_route_geometry: stitchedGeometry.coordinates.length > 0 ? stitchedGeometry : null,
      full_locations: full_route,
      full_route: full_route,
      unit: vehicleDetails ? {
        "0": {
          unit_number: vehicleDetails.fleet_code || vehicleDetails.fleet_number || null,
          unit_reg: vehicleDetails.reg || null,
          unit_type: vehicleDetails.vehicle_type?.name || "Bus",
          livery: vehicleDetails.livery?.name || null,
          livery_left: vehicleDetails.livery?.left || null,
        }
      } : null,
      debug: debug ? {
        journey_lookup_raw: journeyLookupData,
        trip_raw: tripData,
        geom_raw: geomData,
        vehicle_raw: vehicleDetails,
      } : undefined,
    };

    return NextResponse.json(responsePayload);

  } catch (error: any) {
    log(`Bus Handler Error: ${error.message}`);
    return NextResponse.json({ error: 'Internal Bus API Error', details: error.message }, { status: 500 });
  }
}