import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";

async function fetchAllBustimesVehicles(url: string) {
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

function buildVehicleKey(unitNumber: string, reg: string) {
  return `${unitNumber}|${reg}`.toUpperCase();
}

function sortVehicles(a: { unit_number: string }, b: { unit_number: string }) {
  const aNum = parseInt(a.unit_number, 10);
  const bNum = parseInt(b.unit_number, 10);

  if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) {
    return aNum - bNum;
  }

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

  if (!operatorCode) {
    return NextResponse.json({ error: "Operator code is required" }, { status: 400 });
  }

  const operators = await fetchQuery(api.functions.vehicles.getOperatorsByCode, { code: operatorCode });
  const operatorIds = [...new Set(operators.map((operator) => operator._id))];
  const operatorNames = new Set(operators.map((operator) => operator.operator_name));
  const operatorSlugs = new Set(operators.map((operator) => operator.operator_slug));

  const [rawBustimesVehicles, allUserTrips, unitGroups] = await Promise.all([
    fetchAllBustimesVehicles(`https://bustimes.org/api/vehicles/?operator=${encodeURIComponent(operatorCode)}`),
    fetchQuery(api.functions.vehicles.getUserTripsByUser, { user: userId }),
    operatorIds.length > 0
      ? Promise.all(operatorIds.map((operatorId) => fetchQuery(api.functions.vehicles.getOperatorUnits, { operatorId })))
      : Promise.resolve([]),
  ]);

  const units = unitGroups.flat().filter((unit, index, array) =>
    array.findIndex((candidate) => candidate._id === unit._id) === index
  );

  const unitIds = units.map((unit) => unit._id);
  const unitDetails = unitIds.length > 0
    ? await fetchQuery(api.functions.trains.getUnitDetails, { unitIds })
    : { types: [], operators: [], liveries: [] };

  const typeMap = new Map(unitDetails.types.map((type: any) => [type._id, type]));
  const liveryMap = new Map(unitDetails.liveries.map((livery: any) => [livery._id, livery]));

  const relevantTrips = allUserTrips.filter((trip: any) =>
    operatorNames.has(trip.operator) || operatorSlugs.has(trip.operator_slug)
  );

  const bustimesVehicles = rawBustimesVehicles.map((bv: any) => {
    const bvNumber = String(bv.fleet_code ?? bv.fleet_number ?? "").toUpperCase();
    const bvReg = String(bv.reg ?? "").toUpperCase();

    const vehicleTrips = relevantTrips.filter((trip: any) => {
      const tripUnits = Array.isArray(trip.units) ? trip.units : [];

      return tripUnits.some((tripUnit: any) => {
        const tripUnitNumber = String(tripUnit.unit_number ?? "").toUpperCase();
        const tripUnitReg = String(tripUnit.unit_reg ?? "").toUpperCase();

        return (
          (bvNumber && tripUnitNumber === bvNumber && bvReg && tripUnitReg === bvReg) ||
          (bvReg && tripUnitReg === bvReg) ||
          (bvNumber && tripUnitNumber === bvNumber)
        );
      });
    });

    const prevLiveryTrip = vehicleTrips.find((trip: any) => {
      const matchingUnit = (Array.isArray(trip.units) ? trip.units : []).find((tripUnit: any) => {
        const tripUnitNumber = String(tripUnit.unit_number ?? "").toUpperCase();
        const tripUnitReg = String(tripUnit.unit_reg ?? "").toUpperCase();
        return tripUnitNumber === bvNumber || tripUnitReg === bvReg;
      });

      if (!matchingUnit) return false;

      const currentBTName = bv.livery?.name || "Unknown";
      const currentBTCss = bv.livery?.left || "";
      return matchingUnit.livery !== currentBTName || matchingUnit.livery_left !== currentBTCss;
    });

    const prevUnitData = prevLiveryTrip?.units?.find((tripUnit: any) => {
      const tripUnitNumber = String(tripUnit.unit_number ?? "").toUpperCase();
      const tripUnitReg = String(tripUnit.unit_reg ?? "").toUpperCase();
      return tripUnitNumber === bvNumber || tripUnitReg === bvReg;
    });

    return {
      "bt-id": bv.id,
      bustimes_id: bv.id,
      bustimes_slug: bv.slug,
      unit_number: bv.fleet_code || bv.fleet_number || "",
      reg: bv.reg || "",
      previous_reg: bv.previous_reg || "",
      vehicle_type: bv.vehicle_type?.name || "Unknown",
      livery: {
        current_bustimes_livery: {
          name: bv.livery?.name || bv.branding || "Unknown",
          css: bv.livery?.left || "",
        },
        previous_bustimes_livery: prevUnitData ? {
          name: prevUnitData.livery || "Unknown",
          css: prevUnitData.livery_left || "",
        } : null,
      },
      branding: bv.branding || "",
      withdrawn: bv.withdrawn ?? false,
      ridden: vehicleTrips.length > 0,
      times_ridden: vehicleTrips.length,
    };
  });

  const customVehicles = units.map((unit: any) => {
    const unitNumber = String(unit.unit_number ?? "").toUpperCase();
    const unitReg = String(unit.unit_reg ?? "").toUpperCase();

    const matchingTrips = relevantTrips.filter((trip: any) => {
      const tripUnits = Array.isArray(trip.units) ? trip.units : [];
      return tripUnits.some((tripUnit: any) => {
        const tripUnitNumber = String(tripUnit.unit_number ?? "").toUpperCase();
        const tripUnitReg = String(tripUnit.unit_reg ?? "").toUpperCase();
        return (
          (unitNumber && tripUnitNumber === unitNumber && unitReg && tripUnitReg === unitReg) ||
          (unitReg && tripUnitReg === unitReg) ||
          (unitNumber && tripUnitNumber === unitNumber)
        );
      });
    });

    const currentType = typeMap.get(unit.type_id);
    const currentLivery = liveryMap.get(unit.livery_id);

    const prevLiveryTrip = matchingTrips.find((trip: any) => {
      const matchingUnit = (Array.isArray(trip.units) ? trip.units : []).find((tripUnit: any) => {
        const tripUnitNumber = String(tripUnit.unit_number ?? "").toUpperCase();
        const tripUnitReg = String(tripUnit.unit_reg ?? "").toUpperCase();
        return tripUnitNumber === unitNumber || tripUnitReg === unitReg;
      });

      if (!matchingUnit) return false;

      const currentName = currentLivery?.livery_name || "Unknown";
      const currentCss = currentLivery?.css_class || "";
      return matchingUnit.livery !== currentName || matchingUnit.livery_left !== currentCss;
    });

    const prevUnitData = prevLiveryTrip?.units?.find((tripUnit: any) => {
      const tripUnitNumber = String(tripUnit.unit_number ?? "").toUpperCase();
      const tripUnitReg = String(tripUnit.unit_reg ?? "").toUpperCase();
      return tripUnitNumber === unitNumber || tripUnitReg === unitReg;
    });

    return {
      "bt-id": unit._id,
      unit_number: unit.unit_number || unit.unit_reg || "",
      reg: unit.unit_reg || unit.unit_number || "",
      previous_reg: "",
      vehicle_type: currentType?.type_name || "Unknown",
      livery: {
        current_bustimes_livery: {
          name: currentLivery?.livery_name || "Unknown",
          css: currentLivery?.css_class || "",
        },
        previous_bustimes_livery: prevUnitData ? {
          name: prevUnitData.livery || "Unknown",
          css: prevUnitData.livery_left || "",
        } : null,
      },
      branding: currentLivery?.livery_name || "",
      withdrawn: false,
      ridden: matchingTrips.length > 0,
      times_ridden: matchingTrips.length,
    };
  });

  const mergedVehicles = [...bustimesVehicles, ...customVehicles].filter((vehicle, index, array) => {
    const vehicleKey = buildVehicleKey(String(vehicle.unit_number ?? ""), String(vehicle.reg ?? ""));
    return array.findIndex((candidate) =>
      buildVehicleKey(String(candidate.unit_number ?? ""), String(candidate.reg ?? "")) === vehicleKey
    ) === index;
  });

  mergedVehicles.sort(sortVehicles);

  return NextResponse.json(mergedVehicles);
}
