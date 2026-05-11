// app/api/vehicles/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";

async function fetchAllBustimesVehicles(url: string) {
  let allResults: any[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl);
    const data = await res.json();
    allResults = [...allResults, ...data.results];
    nextUrl = data.next;
  }
  return allResults;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const operatorCode = searchParams.get("code");

  if (!operatorCode) {
    return NextResponse.json({ error: "Operator code is required" }, { status: 400 });
  }

  const operator = await fetchQuery(api.functions.vehicles.getOperatorByCode, { code: operatorCode });
  if (!operator) return NextResponse.json({ error: "Operator not found" }, { status: 404 });

  const bustimesUrl = `https://bustimes.org/api/vehicles/?operator=${operatorCode}`;
  const rawBustimesVehicles = await fetchAllBustimesVehicles(bustimesUrl);

  const userTrips = await fetchQuery(api.functions.vehicles.getUserTripsByOperator, { 
    user: userId, 
    operatorName: operator.operator_name
  });

  // --- DEDUPLICATION LOGIC ---
  const vehicleMap = new Map<string, any>();

  for (const bv of rawBustimesVehicles) {
    // Create a unique key based on Reg and Fleet Code
    const key = `${bv.reg}-${bv.fleet_code}`.toUpperCase();
    
    if (!vehicleMap.has(key)) {
      vehicleMap.set(key, bv);
    } else {
      const existing = vehicleMap.get(key);
      
      // LOGIC: If the new one is NOT withdrawn, but the existing one is, 
      // replace it so the final state shows as active.
      if (!bv.withdrawn && existing.withdrawn) {
        vehicleMap.set(key, bv);
      }
      // Otherwise, keep the first one found (or the one already marked active)
    }
  }

  // Convert Map back to array and map to your final format
  const finalVehicles = Array.from(vehicleMap.values()).map((bv) => {
    // FIX: Look inside the 'units' array of each trip
    const vehicleTrips = userTrips.filter((trip) => {
      // If units array doesn't exist, fall back to top-level fields just in case
      const units = trip.units || [];
      
      return units.some((u: any) => {
        const uNum = (u.unit_number || "").toString().toUpperCase();
        const uReg = (u.unit_reg || "").toString().toUpperCase();
        const bvNum = (bv.fleet_code || "").toString().toUpperCase();
        const bvReg = (bv.reg || "").toString().toUpperCase();

        const matchBoth = uNum === bvNum && uReg === bvReg;
        const matchReg = uReg === bvReg && uReg !== "";
        const matchUnit = uNum === bvNum && uNum !== "";

        return matchBoth || matchReg || matchUnit;
      });
    });

    // Handle previous livery logic (looking into the specific unit match within the trip)
    const prevLiveryTrip = vehicleTrips.find((trip) => {
      const matchingUnit = trip.units?.find((u: any) => 
        u.unit_reg === bv.reg || u.unit_number === bv.fleet_code
      );
      
      if (!matchingUnit) return false;

      // Compare livery - check both name and CSS
      const currentBTName = bv.livery?.name || "Unknown";
      const currentBTCss = bv.livery?.left || "";
      
      return matchingUnit.livery !== currentBTName || matchingUnit.livery_left !== currentBTCss;
    });

    // Helper to get the previous livery details from the found trip
    const prevUnitData = prevLiveryTrip?.units?.find((u: any) => 
      u.unit_reg === bv.reg || u.unit_number === bv.fleet_code
    );

    return {
      bustimes_id: bv.id,
      bustimes_slug: bv.slug,
      unit_number: bv.fleet_code,
      reg: bv.reg,
      previous_reg: bv.previous_reg || "",
      vehicle_type: bv.vehicle_type?.name || "Unknown",
      livery: {
        current_bustimes_livery: {
          name: bv.livery?.name || bv.branding || "Unknown",
          css: bv.livery?.left || "",
        },
        previous_bustimes_livery: prevUnitData ? {
          name: prevUnitData.livery || "Unknown",
          css: prevUnitData.livery_left || ""
        } : null
      },
      branding: bv.branding || "",
      withdrawn: bv.withdrawn,
      ridden: vehicleTrips.length > 0,
      times_ridden: vehicleTrips.length
    };
  });

  finalVehicles.sort((a, b) => {
    // 1. Convert to numbers, handling potential strings/nulls
    // We use Number() on the string to ensure "81" < "40843"
    const aNum = parseInt(a.unit_number, 10);
    const bNum = parseInt(b.unit_number, 10);

    // 2. If both are valid numbers, sort them numerically
    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) {
        return aNum - bNum;
      }
    }

    // 3. Fallback: If one isn't a number (e.g. "BF67"), 
    // or numbers are equal, use natural alphanumeric sort
    return String(a.unit_number).localeCompare(String(b.unit_number), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return NextResponse.json(finalVehicles);
}