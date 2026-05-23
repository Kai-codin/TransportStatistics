import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { withApiKeyAuth } from "@/lib/api-key-auth";

// ─── Helper Functions ────────────────────────────────────────────────────────

async function fetchAllBustimesServices(url: string) {
  const allResults: any[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl);
    if (!res.ok) break;
    const data: { results: any[]; next: string | null } = await res.json();
    allResults.push(...(data.results ?? []));
    nextUrl = data.next;
  }

  return allResults;
}

function normalizeServiceNumber(serviceNumber: string) {
  return String(serviceNumber ?? "").trim().toUpperCase();
}

function addTripIdToIndex(index: Map<string, Set<string>>, key: string, tripId: string) {
  if (!key) return;
  const bucket = index.get(key) ?? new Set<string>();
  bucket.add(tripId);
  index.set(key, bucket);
}

function countMatchingTrips(indices: Array<Set<string> | undefined>) {
  const matchingTripIds = new Set<string>();
  for (const index of indices) {
    if (!index) continue;
    for (const tripId of index) matchingTripIds.add(tripId);
  }
  return matchingTripIds.size;
}

function sortRoutes(
  a: { service_number: string; ridden?: boolean },
  b: { service_number: string; ridden?: boolean }
) {
  if (a.ridden !== b.ridden) return Number(b.ridden) - Number(a.ridden);
  return String(a.service_number).localeCompare(String(b.service_number), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function formatHistoricalRouteName(route: {
  inbound_destination: string;
  outbound_destination: string;
}) {
  return (
    [route.inbound_destination, route.outbound_destination].filter(Boolean).join(" - ") ||
    "Unknown route"
  );
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const operatorCode = searchParams.get("code") ?? searchParams.get("operator");

  if (!operatorCode) {
    return NextResponse.json({ error: "Operator code is required" }, { status: 400 });
  }

  // 1. Resolve the merged operator record
  const operator = await fetchQuery(api.functions.completion.getOperatorByAnyCode, {
    code: operatorCode,
  });

  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  // 2. Extract metadata for queries
  const operatorId = operator._id;
  const operatorNames = operator.operator_names ?? [];

  // 3. Parallel Data Fetching
  const [rawBustimesRoutes, relevantTrips, historicalRouteGroups] = await Promise.all([
    fetchAllBustimesServices(
      `https://bustimes.org/api/services/?operator=${encodeURIComponent(operatorCode)}`
    ),
    // Query trips using the array of names to handle merged aliases
    fetchQuery(api.functions.vehicles.getUserTripsByOperators, {
      user: userId,
      operatorNames,
    }),
    // Fetch historical routes using the master operator ID
    fetchQuery((api as any).functions.vehicles.getHistoricalRoutesByOperatorIds, {
      operatorIds: [operatorId],
    }),
  ]);

  // 4. Index Trip Data for fast matching
  const tripIdsByServiceId = new Map<string, Set<string>>();
  const tripIdsByServiceSlug = new Map<string, Set<string>>();
  const tripIdsByServiceNumber = new Map<string, Set<string>>();

  for (const trip of relevantTrips) {
    const tripId = String(trip._id);
    if (trip.bustimes_service_id) {
      addTripIdToIndex(tripIdsByServiceId, String(trip.bustimes_service_id), tripId);
    }
    if (trip.bustimes_service_slug) {
      addTripIdToIndex(
        tripIdsByServiceSlug,
        normalizeServiceNumber(trip.bustimes_service_slug),
        tripId
      );
    }
    if (trip.service_number) {
      addTripIdToIndex(
        tripIdsByServiceNumber,
        normalizeServiceNumber(trip.service_number),
        tripId
      );
    }
  }

  const routeMap = new Map<string, any>();

  // 5. Process Active Routes (from BusTimes)
  for (const service of rawBustimesRoutes) {
    const serviceNumber = normalizeServiceNumber(service.line_name ?? "");
    const routeKey = serviceNumber || (service.id ? `bt-${service.id}` : "");

    const matchingTripCount = countMatchingTrips([
      service.id ? tripIdsByServiceId.get(String(service.id)) : undefined,
      service.slug ? tripIdsByServiceSlug.get(normalizeServiceNumber(service.slug)) : undefined,
      serviceNumber ? tripIdsByServiceNumber.get(serviceNumber) : undefined,
    ]);

    routeMap.set(routeKey, {
      "bt-id": service.id,
      bustimes_id: service.id,
      bustimes_slug: service.slug,
      service_number: service.line_name || "",
      route_name: service.description || service.line_name || "Unknown route",
      inbound_destination: service.description || "",
      outbound_destination: "",
      withdrawn: false,
      ridden: matchingTripCount > 0,
      times_ridden: matchingTripCount,
    });
  }

  // 6. Process Historical and "Trip-Only" Routes (The "Ghost" Services)
  for (const trip of relevantTrips) {
    const tripServiceNumber = normalizeServiceNumber(trip.service_number ?? "");
    
    // We only care if this specific service number isn't in our map yet
    if (!tripServiceNumber || routeMap.has(tripServiceNumber)) continue;

    // A. Check if this trip belongs to a BusTimes service we already have under a different name
    // (e.g., trip is '402' but routeMap has '401' for ID 41224)
    const activeServiceMatch = Array.from(routeMap.values()).find(
      (r) => r.bustimes_id && String(r.bustimes_id) === String(trip.bustimes_service_id)
    );

    // B. Try to find metadata in the historical groups
    const historicalMatch = (historicalRouteGroups as any[]).find(h => 
      (h.bustimes_service_id && String(h.bustimes_service_id) === String(trip.bustimes_service_id)) ||
      (h.bustimes_service_slug && normalizeServiceNumber(h.bustimes_service_slug ?? '') === normalizeServiceNumber(trip.bustimes_service_slug ?? '')) ||
      (normalizeServiceNumber(h.service_number ?? '') === tripServiceNumber)
    );

    // C. Calculate trip count for this SPECIFIC number
    const matchingTripCount = countMatchingTrips([
      tripIdsByServiceNumber.get(tripServiceNumber),
    ]);

    // D. Add to map as a separate withdrawn entry
    routeMap.set(tripServiceNumber, {
      "bt-id": historicalMatch?._id ?? `trip-${tripServiceNumber}`,
      bustimes_id: trip.bustimes_service_id,
      bustimes_slug: trip.bustimes_service_slug,
      service_number: trip.service_number || tripServiceNumber,
      // If we have an active match for the ID, borrow its description but keep the '402' number
      route_name: historicalMatch 
        ? formatHistoricalRouteName(historicalMatch) 
        : (activeServiceMatch?.route_name || "Unknown route"),
      inbound_destination: historicalMatch?.inbound_destination ?? (activeServiceMatch?.inbound_destination || "Unknown"),
      outbound_destination: historicalMatch?.outbound_destination ?? "",
      withdrawn: true, // It's a "ghost" of a merged or old service
      ridden: true,
      times_ridden: matchingTripCount,
    });
  }

  // 7. Final Pass: Historical Routes that haven't been ridden
  for (const historicalRoute of historicalRouteGroups as any[]) {
    const serviceNumber = normalizeServiceNumber(historicalRoute.service_number ?? "");
    if (!serviceNumber || routeMap.has(serviceNumber)) continue;

    routeMap.set(serviceNumber, {
      "bt-id": historicalRoute._id,
      bustimes_id: historicalRoute.bustimes_service_id,
      bustimes_slug: historicalRoute.bustimes_service_slug,
      service_number: historicalRoute.service_number,
      route_name: formatHistoricalRouteName(historicalRoute),
      inbound_destination: historicalRoute.inbound_destination,
      outbound_destination: historicalRoute.outbound_destination,
      withdrawn: true,
      ridden: false,
      times_ridden: 0,
    });
  }

  return NextResponse.json(Array.from(routeMap.values()).sort(sortRoutes));
});