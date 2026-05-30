import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { withApiKeyAuth } from "@/lib/api-key-auth";
import { buildBustimesUrl, getBustimesBaseUrl } from "@/lib/bustimes-source";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

interface SearchResult {
  id: string;
  source: "train" | "bus";
  unit_number: string;
  unit_reg: string;
  withdrawn?: boolean; // Optional, since trains don't have it
  type: {
    type_id: string;
    type_name: string;
  };
  operator: {
    operator_id: string | number;
    operator_name: string;
    operator_slug: string;
    operator_code: string | number;
  };
  livery: {
    livery_id: string;
    livery_name: string;
    livery_css: string;
  };
}

// --- Train search ---
async function searchTrains(q: string): Promise<SearchResult[]> {
  const units = await convex.query(api.functions.trains.searchForUnits, {
    search: q,
  });

  if (units.length === 0) return [];

  const unitIds = units.map((u) => u._id);
  const { types, operators, liveries } = await convex.query(
    api.functions.trains.getUnitDetails,
    { unitIds }
  );

  const typesMap = Object.fromEntries(types.map((t) => [t._id, t]));
  const operatorsMap = Object.fromEntries(operators.map((o) => [o._id, o]));
  const liveriesMap = Object.fromEntries(liveries.map((l) => [l._id, l]));

  return units.map((unit) => ({
    id: unit._id,
    source: "train",
    unit_number: unit.unit_number ?? "",
    unit_reg: unit.unit_reg,
    type: {
      type_id: unit.type_id,
      type_name: typesMap[unit.type_id]?.type_name ?? "",
    },
    operator: {
      operator_id: unit.operator_id,
      operator_name: operatorsMap[unit.operator_id]?.display_name ?? "",
      // Grab the first element of the array, or fall back to an empty string
      operator_slug: operatorsMap[unit.operator_id]?.operator_slugs?.[0] ?? "", 
      operator_code: operatorsMap[unit.operator_id]?.operator_codes?.[0] ?? "",
    },
    livery: {
      livery_id: unit.livery_id,
      livery_name: liveriesMap[unit.livery_id]?.livery_name ?? "",
      livery_css: liveriesMap[unit.livery_id]?.css_class ?? "",
    },
  }));
}

// --- Bus search ---
async function searchBuses(q: string, bustimesBaseUrl: string): Promise<SearchResult[]> {
  const stripped = q.replace(/\s+/g, "");
  const res = await fetch(
    buildBustimesUrl(bustimesBaseUrl, `/api/vehicles/?search=${encodeURIComponent(stripped)}`)
  );

  if (!res.ok) return [];

  const data = await res.json();

  return (data.results ?? []).map((v: any) => ({
    id: String(v.id),
    source: "bus",
    unit_number: v.fleet_code ?? "",
    unit_reg: v.reg ?? "",
    withdrawn: v.withdrawn ?? false,
    type: {
      type_id: String(v.vehicle_type?.id ?? ""),
      type_name: v.vehicle_type?.name ?? "",
      //style: v.vehicle_type?.style ?? "",
      //fuel: v.vehicle_type?.fuel ?? "",
      //double_decker: v.vehicle_type?.double_decker ?? false,
      //electric: v.vehicle_type?.electric ?? false,
    },
    operator: {
      operator_id: v.operator?.id ?? "",
      operator_name: v.operator?.name ?? "",
      operator_slug: v.operator?.slug ?? "",
      operator_code: v.operator?.id ?? "",
    },
    livery: {
      livery_id: String(v.livery?.id ?? ""),
      livery_name: v.livery?.name ?? "",
      livery_css: v.livery?.left ?? "",
    },
  }));
}

// --- Route handler ---
export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const type = searchParams.get("type"); // "train" | "bus" | null
  const bustimesBaseUrl = await getBustimesBaseUrl("vehicleSearch", _auth?.userId);

  if (!q) {
    return NextResponse.json({ error: "Missing search query" }, { status: 400 });
  }

  let results;

  if (type === "train") {
    results = await searchTrains(q);
  } else if (type === "bus") {
    results = await searchBuses(q, bustimesBaseUrl);
  } else {
    // Search both in parallel
    const [trains, buses] = await Promise.all([
      searchTrains(q),
      searchBuses(q, bustimesBaseUrl),
    ]);
    results = [...trains, ...buses];
  }

  const sortedResults = results.sort((a, b) => {
    const aVal = a.withdrawn ? 1 : 0;
    const bVal = b.withdrawn ? 1 : 0;
    return aVal - bVal;
  });

  return NextResponse.json(sortedResults);
});
