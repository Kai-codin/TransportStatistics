import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { withApiKeyAuth } from "@/lib/api-key-auth";

// ─── Helper Functions ────────────────────────────────────────────────────────

async function fetchAllBustimesVehicles(url: string) {
  const allResults: any[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) break;
    const data: { results: any[]; next: string | null } = await res.json();
    allResults.push(...(data.results ?? []));
    nextUrl = data.next;
    console.log(`Fetched ${allResults.length} vehicles so far...`);
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
  a: { unit_number: string | null; ridden?: boolean },
  b: { unit_number: string | null; ridden?: boolean }
) {
  if (a.ridden !== b.ridden) return Number(b.ridden) - Number(a.ridden);
  
  // Handle nulls: push them to the bottom of their respective ridden group
  if (a.unit_number === null) return 1;
  if (b.unit_number === null) return -1;

  const aNum = parseInt(a.unit_number, 10);
  const bNum = parseInt(b.unit_number, 10);
  if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) return aNum - bNum;
  
  return String(a.unit_number).localeCompare(String(b.unit_number), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const operatorCode = searchParams.get("code"); // This is the slug from URL

  if (!operatorCode) {
    return NextResponse.json({ error: "Operator code is required" }, { status: 400 });
  }

  // 1. Get the merged operator document
  const operator = await fetchQuery(api.functions.completion.getOperatorByAnyCode, {
    code: operatorCode,
  });

  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  // 2. Extract expanded metadata from merged record
  const operatorId = operator._id;
  const operatorNames = operator.operator_names ?? [];

  // 3. Parallel Data Fetching
  const [rawBustimesVehicles, relevantTrips, unitGroups] = await Promise.all([
    fetchAllBustimesVehicles(
      `https://bustimes.org/api/vehicles/?operator=${encodeURIComponent(operatorCode)}`
    ),
    // Use the array of names so we catch trips logged under "XC" or "CrossCountry"
    fetchQuery(api.functions.vehicles.getUserTripsByOperators, {
      user: userId,
      operatorNames,
    }),
    fetchQuery(api.functions.vehicles.getOperatorUnits, { operatorId }),
  ]);

  const units = Array.isArray(unitGroups) ? unitGroups : [];
  const unitIds = units.map((unit) => unit._id);
  const unitDetails =
    unitIds.length > 0
      ? await fetchQuery(api.functions.trains.getUnitDetails, { unitIds })
      : { types: [], operators: [], liveries: [] };

  const typeMap = new Map(unitDetails.types.map((t: any) => [t._id, t]));
  const liveryMap = new Map(unitDetails.liveries.map((l: any) => [l._id, l]));

  // 4. Build Trip Indices
  const tripById = new Map<string, any>();
  const tripIdsByUnitNumber = new Map<string, Set<string>>();
  const tripIdsByReg = new Map<string, Set<string>>();
  const tripIdsByCombinedKey = new Map<string, Set<string>>();

  for (const trip of relevantTrips) {
    const tripId = String(trip._id);
    tripById.set(tripId, trip);
    const tripUnits = Array.isArray(trip.units) ? trip.units : [];
    
    for (const tripUnit of tripUnits) {
      // --- CHANGE START: Split units by "+" to handle "3086 + 3144" ---
      const rawNum = String(tripUnit.unit_number ?? "");
      const rawReg = String(tripUnit.unit_reg ?? "");

      // Split by '+' and trim whitespace to get individual unit numbers/regs
      const individualNums = rawNum.split('+').map(s => s.trim()).filter(Boolean);
      const individualRegs = rawReg.split('+').map(s => s.trim()).filter(Boolean);

      // Use the maximum length of the two arrays to ensure we process all parts
      const maxLength = Math.max(individualNums.length, individualRegs.length);

      for (let i = 0; i < maxLength; i++) {
        const num = normalizeKey(individualNums[i] || "");
        const reg = normalizeKey(individualRegs[i] || "");
        
        if (num) addTripIdToIndex(tripIdsByUnitNumber, num, tripId);
        if (reg) addTripIdToIndex(tripIdsByReg, reg, tripId);
        if (num || reg) {
          addTripIdToIndex(tripIdsByCombinedKey, buildVehicleKey(num, reg), tripId);
        }
      }
    }
  }

  function getMatchingTrips(unitNumber: string, reg: string) {
    const u = normalizeKey(unitNumber);
    const r = normalizeKey(reg);
    const ids = collectTripIds([
      u ? tripIdsByUnitNumber.get(u) : undefined,
      r ? tripIdsByReg.get(r) : undefined,
      u && r ? tripIdsByCombinedKey.get(buildVehicleKey(u, r)) : undefined,
    ]);
    return Array.from(ids).map((id) => tripById.get(id)).filter(Boolean);
  }

  function getPrevLiveryUnit(trips: any[], matchNumber: string, matchReg: string, currentName: string, currentCss: string) {
    const mN = matchNumber.toUpperCase();
    const mR = matchReg.toUpperCase();
    const trip = trips.find((t) => {
      const unit = (Array.isArray(t.units) ? t.units : []).find((u: any) => 
        String(u.unit_number ?? "").toUpperCase() === mN || String(u.unit_reg ?? "").toUpperCase() === mR
      );
      return unit && (unit.livery !== currentName || unit.livery_left !== currentCss);
    });
    return trip?.units?.find((u: any) => 
      String(u.unit_number ?? "").toUpperCase() === mN || String(u.unit_reg ?? "").toUpperCase() === mR
    ) ?? null;
  }

  // 5. Mapping
  const bustimesVehicles = rawBustimesVehicles.map((bv: any) => {
    const num = String(bv.fleet_code ?? bv.fleet_number ?? "");
    const reg = String(bv.reg ?? "");
    const trips = getMatchingTrips(num, reg);
    const currentName = bv.livery?.name || bv.branding || "Unknown";
    const currentCss = bv.livery?.left || "";
    const prevUnit = getPrevLiveryUnit(trips, num, reg, currentName, currentCss);

    return {
      "bt-id": bv.id,
      bustimes_id: bv.id,
      bustimes_slug: bv.slug,
      unit_number: num,
      reg: reg,
      previous_reg: bv.previous_reg || "",
      vehicle_type: bv.vehicle_type?.name || "Unknown",
      livery: {
        current_bustimes_livery: { name: currentName, css: currentCss },
        previous_bustimes_livery: prevUnit ? { name: prevUnit.livery || "Unknown", css: prevUnit.livery_left || "" } : null,
      },
      branding: bv.branding || "",
      withdrawn: bv.withdrawn ?? false,
      ridden: trips.length > 0,
      times_ridden: trips.length,
    };
  });

  const customVehicles = units.map((unit: any) => {
    const num = String(unit.unit_number ?? "");
    const reg = String(unit.unit_reg ?? "");
    const trips = getMatchingTrips(num, reg);
    const currentType = typeMap.get(unit.type_id);
    const currentLivery = liveryMap.get(unit.livery_id);
    const currentName = currentLivery?.livery_name || "Unknown";
    const currentCss = currentLivery?.css_class || "";
    const prevUnit = getPrevLiveryUnit(trips, num, reg, currentName, currentCss);

    return {
      "bt-id": unit._id,
      unit_number: num || reg,
      reg: reg || num,
      previous_reg: "",
      vehicle_type: currentType?.type_name || "Unknown",
      livery: {
        current_bustimes_livery: { name: currentName, css: currentCss },
        previous_bustimes_livery: prevUnit ? { name: prevUnit.livery || "Unknown", css: prevUnit.livery_left || "" } : null,
      },
      branding: currentName,
      withdrawn: false,
      ridden: trips.length > 0,
      times_ridden: trips.length,
    };
  });

  const tripVehicles = (() => {
    const vehiclesByKey = new Map<string, any>();
    for (const trip of relevantTrips) {
      const tripUnits = Array.isArray(trip.units) && trip.units.length > 0 ? trip.units : [];
      for (const unit of tripUnits) {
        const rawNum = String(unit.unit_number ?? "");
        const rawReg = String(unit.unit_reg ?? "");
        if (!rawNum && !rawReg) continue;

        // Split by '+' to handle multi-unit logs individually
        const nums = rawNum.split('+').map(s => s.trim()).filter(Boolean);
        const regs = rawReg.split('+').map(s => s.trim()).filter(Boolean);
        const maxLength = Math.max(nums.length, regs.length);

        for (let i = 0; i < maxLength; i++) {
          const num = nums[i] || "";
          const reg = regs[i] || "";
          const key = buildVehicleKey(num, reg);
          
          const existing = vehiclesByKey.get(key);
          const currentName = String(unit.livery ?? "Unknown");
          const currentCss = String(unit.livery_left ?? "");

          vehiclesByKey.set(key, {
            "bt-id": existing?.["bt-id"] ?? `trip-${key}`,
            unit_number: num,
            reg: reg,
            previous_reg: existing?.previous_reg ?? "",
            vehicle_type: String(unit.unit_type ?? existing?.vehicle_type ?? "Unknown"),
            branding: existing?.branding ?? currentName,
            withdrawn: existing?.withdrawn ?? false,
            ridden: true,
            times_ridden: (existing?.times_ridden ?? 0) + 1,
            livery: {
              current_bustimes_livery: { name: currentName, css: currentCss },
              previous_bustimes_livery: existing?.livery?.previous_bustimes_livery ?? null,
            },
          });
        }
      }
    }
    return Array.from(vehiclesByKey.values());
  })();

  // 6. Final Merge
  const rawMergePool = [...bustimesVehicles, ...customVehicles, ...tripVehicles];
  const byGroup = new Map<string, any[]>();

  for (const v of rawMergePool) {
    const u = normalizeKey(v.unit_number);
    const r = normalizeKey(v.reg);
    
    // Grouping key remains u || r to ensure metadata matches trip logs
    const groupKey = u || r; 
    if (!groupKey) continue;

    const group = byGroup.get(groupKey) ?? [];
    group.push(v);
    byGroup.set(groupKey, group);
  }

  const mergedVehicles = Array.from(byGroup.entries()).map(([key, variants]) => {
    // 1. Determine if active
    const isActuallyActive = variants.some(v => {
      const isBustimesOfficial = bustimesVehicles.some(bv => bv["bt-id"] === v["bt-id"] && !bv.withdrawn);
      const isCustomOfficial = units.some(u => u._id === v["bt-id"]);
      return isBustimesOfficial || isCustomOfficial;
    });

    // 2. Master metadata record
    const master = variants.find(v => v.bustimes_id && !v.withdrawn) || 
                   variants.find(v => v.bustimes_id) || 
                   variants[0];

    // 3. Aggregate stats
    const totalRidden = variants.some(v => v.ridden);
    const totalTimes = variants.reduce((acc, v) => acc + (v.times_ridden || 0), 0);

    // 4. Extract non-empty values from ANY variant in the group
    const fleetNumber = variants.find(v => normalizeKey(v.unit_number) !== "")?.unit_number;
    const registration = variants.find(v => normalizeKey(v.reg) !== "")?.reg;

    return {
      ...master,
      // Fallback to null if no non-empty value exists in the merge group
      unit_number: fleetNumber || null, 
      reg: registration || null,
      withdrawn: !isActuallyActive,
      ridden: totalRidden,
      times_ridden: totalTimes,
    };
  });

  mergedVehicles.sort(sortVehicles);
  return NextResponse.json(mergedVehicles);
});