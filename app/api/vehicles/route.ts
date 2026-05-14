import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";

async function fetchAllBustimesVehicles(url: string) {
  const allResults: any[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) break;
    const data: { results: any[]; next: string | null } = await res.json();
    allResults.push(...(data.results ?? []));
    nextUrl = data.next;
  }

  return allResults;
}

function buildVehicleKey(unitNumber: string, reg: string) {
  return `${unitNumber}|${reg}`.toUpperCase();
}

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function addTripIdToIndex(index: Map<string, Set<string>>, key: string, tripId: string) {
  if (!key) return;
  const bucket = index.get(key) ?? new Set<string>();
  bucket.add(tripId);
  index.set(key, bucket);
}

function collectTripIds(indices: Array<Set<string> | undefined>) {
  const matchingTripIds = new Set<string>();
  for (const index of indices) {
    if (!index) continue;
    for (const tripId of index) matchingTripIds.add(tripId);
  }
  return matchingTripIds;
}

function sortVehicles(
  a: { unit_number: string; ridden?: boolean },
  b: { unit_number: string; ridden?: boolean }
) {
  if (a.ridden !== b.ridden) return Number(b.ridden) - Number(a.ridden);
  const aNum = parseInt(a.unit_number, 10);
  const bNum = parseInt(b.unit_number, 10);
  if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) return aNum - bNum;
  return String(a.unit_number).localeCompare(String(b.unit_number), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const operatorCode = searchParams.get("code");
  const withdrawnParam =
    searchParams.get("withdrawn") === "1" || searchParams.get("withdrawn") === "true"
      ? "true"
      : "false";

  if (!operatorCode) {
    return NextResponse.json({ error: "Operator code is required" }, { status: 400 });
  }

  const operators = await fetchQuery(api.functions.vehicles.getOperatorsByCode, {
    code: operatorCode,
  });

  const operatorIds = [...new Set(operators.map((o) => o._id))];
  const operatorNames = [...new Set(operators.map((o) => o.operator_name))];

  const [rawBustimesVehicles, relevantTrips, unitGroups] = await Promise.all([
    fetchAllBustimesVehicles(
      `https://bustimes.org/api/vehicles/?operator=${encodeURIComponent(operatorCode)}&withdrawn=${withdrawnParam}`
    ),
    fetchQuery(api.functions.vehicles.getUserTripsByOperators, {
      user: userId,
      operatorNames,
    }),
    operatorIds.length > 0
      ? Promise.all(
          operatorIds.map((operatorId) =>
            fetchQuery(api.functions.vehicles.getOperatorUnits, { operatorId })
          )
        )
      : Promise.resolve([]),
  ]);

  const units = unitGroups
    .flat()
    .filter((unit, i, arr) => arr.findIndex((u) => u._id === unit._id) === i);

  const unitIds = units.map((unit) => unit._id);
  const unitDetails =
    unitIds.length > 0
      ? await fetchQuery(api.functions.trains.getUnitDetails, { unitIds })
      : { types: [], operators: [], liveries: [] };

  const typeMap = new Map(unitDetails.types.map((t: any) => [t._id, t]));
  const liveryMap = new Map(unitDetails.liveries.map((l: any) => [l._id, l]));

  // Build trip indices for fast vehicle matching
  const tripById = new Map<string, any>();
  const tripIdsByUnitNumber = new Map<string, Set<string>>();
  const tripIdsByReg = new Map<string, Set<string>>();
  const tripIdsByCombinedKey = new Map<string, Set<string>>();

  for (const trip of relevantTrips) {
    const tripId = String(trip._id);
    tripById.set(tripId, trip);

    for (const tripUnit of Array.isArray(trip.units) ? trip.units : []) {
      const num = normalizeKey(tripUnit.unit_number);
      const reg = normalizeKey(tripUnit.unit_reg);
      addTripIdToIndex(tripIdsByUnitNumber, num, tripId);
      addTripIdToIndex(tripIdsByReg, reg, tripId);
      addTripIdToIndex(tripIdsByCombinedKey, buildVehicleKey(num, reg), tripId);
    }
  }

  function getMatchingTrips(unitNumber: string, reg: string) {
    const ids = collectTripIds([
      unitNumber ? tripIdsByUnitNumber.get(unitNumber) : undefined,
      reg ? tripIdsByReg.get(reg) : undefined,
      unitNumber && reg ? tripIdsByCombinedKey.get(buildVehicleKey(unitNumber, reg)) : undefined,
    ]);
    return Array.from(ids)
      .map((id) => tripById.get(id))
      .filter(Boolean);
  }

  function getPrevLiveryUnit(
    trips: any[],
    matchNumber: string,
    matchReg: string,
    currentName: string,
    currentCss: string
  ) {
    const trip = trips.find((t) => {
      const unit = (Array.isArray(t.units) ? t.units : []).find((u: any) => {
        const n = String(u.unit_number ?? "").toUpperCase();
        const r = String(u.unit_reg ?? "").toUpperCase();
        return n === matchNumber || r === matchReg;
      });
      return unit && (unit.livery !== currentName || unit.livery_left !== currentCss);
    });

    return trip?.units?.find((u: any) => {
      const n = String(u.unit_number ?? "").toUpperCase();
      const r = String(u.unit_reg ?? "").toUpperCase();
      return n === matchNumber || r === matchReg;
    }) ?? null;
  }

  const bustimesVehicles = rawBustimesVehicles.map((bv: any) => {
    const num = String(bv.fleet_code ?? bv.fleet_number ?? "").toUpperCase();
    const reg = String(bv.reg ?? "").toUpperCase();
    const trips = getMatchingTrips(num, reg);
    const currentName = bv.livery?.name || bv.branding || "Unknown";
    const currentCss = bv.livery?.left || "";
    const prevUnit = getPrevLiveryUnit(trips, num, reg, currentName, currentCss);

    return {
      "bt-id": bv.id,
      bustimes_id: bv.id,
      bustimes_slug: bv.slug,
      unit_number: bv.fleet_code || bv.fleet_number || "",
      reg: bv.reg || "",
      previous_reg: bv.previous_reg || "",
      vehicle_type: bv.vehicle_type?.name || "Unknown",
      livery: {
        current_bustimes_livery: { name: currentName, css: currentCss },
        previous_bustimes_livery: prevUnit
          ? { name: prevUnit.livery || "Unknown", css: prevUnit.livery_left || "" }
          : null,
      },
      branding: bv.branding || "",
      withdrawn: bv.withdrawn ?? false,
      ridden: trips.length > 0,
      times_ridden: trips.length,
    };
  });

  const customVehicles = units.map((unit: any) => {
    const num = String(unit.unit_number ?? "").toUpperCase();
    const reg = String(unit.unit_reg ?? "").toUpperCase();
    const trips = getMatchingTrips(num, reg);
    const currentType = typeMap.get(unit.type_id);
    const currentLivery = liveryMap.get(unit.livery_id);
    const currentName = currentLivery?.livery_name || "Unknown";
    const currentCss = currentLivery?.css_class || "";
    const prevUnit = getPrevLiveryUnit(trips, num, reg, currentName, currentCss);

    return {
      "bt-id": unit._id,
      unit_number: unit.unit_number || unit.unit_reg || "",
      reg: unit.unit_reg || unit.unit_number || "",
      previous_reg: "",
      vehicle_type: currentType?.type_name || "Unknown",
      livery: {
        current_bustimes_livery: { name: currentName, css: currentCss },
        previous_bustimes_livery: prevUnit
          ? { name: prevUnit.livery || "Unknown", css: prevUnit.livery_left || "" }
          : null,
      },
      branding: currentName,
      withdrawn: false,
      ridden: trips.length > 0,
      times_ridden: trips.length,
    };
  });

  // Merge bustimes + custom vehicles by key, preferring non-withdrawn
  const groupedVehicles = new Map<string, any[]>();
  for (const vehicle of [...bustimesVehicles, ...customVehicles]) {
    const key = buildVehicleKey(String(vehicle.unit_number ?? ""), String(vehicle.reg ?? ""));
    const group = groupedVehicles.get(key) ?? [];
    group.push(vehicle);
    groupedVehicles.set(key, group);
  }

  const mergedVehicles = Array.from(groupedVehicles.values()).map((group) => ({
    ...(group.find((v) => !v.withdrawn) ?? group[0]),
    withdrawn: group.every((v) => v.withdrawn),
  }));

  mergedVehicles.sort(sortVehicles);

  return NextResponse.json(mergedVehicles);
}