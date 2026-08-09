import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAllUserTrips } from "./userTrips";

type VehicleSummary = {
  unit_number: string;
  unit_type: string;
  livery: string;
  livery_left: string;
};

function toTripMatchSummary(trip: Doc<"tripLogs">) {
  return {
    _id: trip._id,
    service_number: trip.service_number,
    operator: trip.operator,
    operator_slug: trip.operator_slug,
    bustimes_service_id: trip.bustimes_service_id,
    bustimes_service_slug: trip.bustimes_service_slug,
    units: trip.units,
    unit_number: trip.unit_number,
    unit_reg: trip.unit_reg,
    vehicle_key: trip.vehicle_key,
    vehicle_keys: trip.vehicle_keys,
  };
}

export const getOperatorByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("operators")
      .withIndex("by_operator_codes", (q) => q.eq("operator_codes", [args.code]))
      .first(); 
  },
});

export const getOperatorsByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("operators")
      .withIndex("by_operator_codes", (q) => q.eq("operator_codes", [args.code]))
      .collect();
  },
});

export const getOperatorUnits = query({
  args: { operatorId: v.id("operators") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("units")
      .withIndex("by_operator_id", (q) => q.eq("operator_id", args.operatorId))
      .collect();
  },
});

export const getHistoricalRoutesByOperatorIds = query({
  args: { operatorIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<Doc<"historicalRoutes">[]> => {
    const uniqueOperatorIds = [...new Set(args.operatorIds)];
    const routes: Doc<"historicalRoutes">[] = [];

    for (const operatorId of uniqueOperatorIds) {
      const operatorRoutes = await ctx.db
        .query("historicalRoutes")
        .withIndex("by_operator_id", (q) => q.eq("operator_id", operatorId))
        .collect();

      routes.push(...operatorRoutes);
    }

    return routes;
  },
});

export const getUserTripsByUser = query({
  args: { user: v.string() },
  handler: async (ctx, args) => {
    const trips = await getAllUserTrips(ctx, args.user);
    return trips.map(toTripMatchSummary);
  },
});

export const getUserTripsByOperator = query({
  args: { user: v.string(), operatorName: v.string() },
  handler: async (ctx, args) => {
    const trips = (await getAllUserTrips(ctx, args.user))
      .filter((trip) => trip.operator === args.operatorName);
    return trips.map(toTripMatchSummary);
  },
});

export const getUserTripsByOperators = query({
  args: { user: v.string(), operatorNames: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniqueNames = [...new Set(args.operatorNames)];
    const allTrips = await getAllUserTrips(ctx, args.user);
    const tripGroups = uniqueNames.map((operatorName) =>
      allTrips.filter((trip) => trip.operator === operatorName)
    );
    return tripGroups.flat().map(toTripMatchSummary);
  },
});

export const checkVehicleRidden = query({
  args: {
    user: v.string(),
    vehicleIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.vehicleIdentifier) return { ridden: false, count: 0, trips: [] };

    const trips = await getAllUserTrips(ctx, args.user);

    // Build exact-match keys from the identifier. Format varies per source,
    // e.g. "63176 - SN64 CGU" (fleet + reg) or just "SN64 CGU" / "63176".
    const cleanToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const identifierKeys = new Set<string>();
    for (const part of args.vehicleIdentifier.trim().split(/\s+/)) {
      const clean = cleanToken(part);
      if (clean) identifierKeys.add(clean);
    }
    const identifierCompact = cleanToken(args.vehicleIdentifier);
    if (identifierCompact) identifierKeys.add(identifierCompact);

    const matchingTrips = trips.filter((trip) => {
      const matches = (value: unknown) => {
        const clean = cleanToken(String(value ?? ""));
        return !!clean && (identifierKeys.has(clean) || clean === identifierCompact);
      };
      if (matches(trip.unit_number) || matches(trip.unit_reg)) return true;
      const units = trip.units;
      if (Array.isArray(units)) {
        return units.some((u: any) =>
          matches(u?.unit_number ?? u?.number ?? "") || matches(u?.unit_reg ?? "")
        );
      }
      return false;
    });

    return {
      ridden: matchingTrips.length > 0,
      count: matchingTrips.length,
      trips: matchingTrips.slice(0, 5).map((t) => ({
        _id: t._id,
        service_number: t.service_number,
        operator: t.operator,
        logged_at: t.logged_at,
        service_date: t.service_date,
        origin_name: t.origin_name,
        destination_name: t.destination_name,
      })),
    };
  },
});

export const getDetailsByUnits = query({
  args: { 
    unitNumbers: v.array(v.string()) 
  },
  handler: async (ctx, args) => {
    const vehicles: Record<string, VehicleSummary> = {};

    // Batch-fetch all units in parallel
    const unitResults = await Promise.all(
      args.unitNumbers.map((unitNumber) =>
        unitNumber === "unknown"
          ? Promise.resolve(null)
          : ctx.db
              .query("units")
              .withIndex("unit_number", (q) => q.eq("unit_number", unitNumber))
              .first()
      )
    );

    // Collect unique type/livery IDs for batch resolution
    const typeIds = new Set<string>();
    const liveryIds = new Set<string>();
    const validUnits = unitResults.filter((u): u is NonNullable<typeof u> => u !== null);
    for (const unit of validUnits) {
      const typeId = ctx.db.normalizeId("types", unit.type_id);
      if (typeId) typeIds.add(typeId);
      const liveryId = ctx.db.normalizeId("liveries", unit.livery_id);
      if (liveryId) liveryIds.add(liveryId);
    }

    // Batch-resolve all types and liveries in parallel
    const [types, liveries] = await Promise.all([
      Promise.all([...typeIds].map((id) => ctx.db.get(id as Id<"types">))),
      Promise.all([...liveryIds].map((id) => ctx.db.get(id as Id<"liveries">))),
    ]);

    const typeMap = new Map(
      types.filter((t): t is NonNullable<typeof t> => t !== null).map((t) => [t._id, t])
    );
    const liveryMap = new Map(
      liveries.filter((l): l is NonNullable<typeof l> => l !== null).map((l) => [l._id, l])
    );

    for (let i = 0; i < args.unitNumbers.length; i++) {
      const unitNumber = args.unitNumbers[i];

      if (unitNumber === "unknown") {
        vehicles[i.toString()] = {
          unit_number: "unknown",
          unit_type: "Unknown",
          livery: "Unknown",
          livery_left: "",
        };
        continue;
      }

      const unit = unitResults[i];
      if (unit) {
        const typeId = ctx.db.normalizeId("types", unit.type_id);
        const type = typeId ? typeMap.get(typeId) : null;
        const liveryId = ctx.db.normalizeId("liveries", unit.livery_id);
        const livery = liveryId ? liveryMap.get(liveryId) : null;

        vehicles[i.toString()] = {
          unit_number: unit.unit_number || unitNumber,
          unit_type: type ? type.type_name : "Unknown",
          livery: livery ? livery.livery_name : "Unknown",
          livery_left: livery ? livery.css_class : "",
        };
      } else {
        vehicles[i.toString()] = {
          unit_number: unitNumber,
          unit_type: "Unknown",
          livery: "Unknown",
          livery_left: "",
        };
      }
    }

    return vehicles;
  },
});
