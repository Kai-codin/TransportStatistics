import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

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
      .withIndex("by_operator_codes", (q) => q.eq("operator_codes", args.code as any))
      .first(); 
  },
});

export const getOperatorsByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("operators")
      .withIndex("by_operator_codes", (q) => q.eq("operator_codes", args.code as any))
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
        .withIndex("by_operator_id", (q) => q.eq("operator_id", operatorId as any))
        .collect();

      routes.push(...operatorRoutes);
    }

    return routes;
  },
});

export const getUserTripsByUser = query({
  args: { user: v.string() },
  handler: async (ctx, args) => {
    const trips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .collect();
    return trips.map(toTripMatchSummary);
  },
});

export const getUserTripsByOperator = query({
  args: { user: v.string(), operatorName: v.string() },
  handler: async (ctx, args) => {
    const trips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .filter((q) => q.eq(q.field("operator"), args.operatorName))
      .collect();
    return trips.map(toTripMatchSummary);
  },
});

export const getUserTripsByOperators = query({
  args: { user: v.string(), operatorNames: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniqueNames = [...new Set(args.operatorNames)];
    const tripGroups = await Promise.all(
      uniqueNames.map((operatorName) =>
        ctx.db
          .query("tripLogs")
          .withIndex("by_user_and_operator", (q) =>
            q.eq("user", args.user).eq("operator", operatorName)
          )
          .collect()
      )
    );
    return tripGroups.flat().map(toTripMatchSummary);
  },
});

export const getDetailsByUnits = query({
  args: { 
    unitNumbers: v.array(v.string()) 
  },
  handler: async (ctx, args) => {
    const vehicles: Record<string, any> = {};

    for (let i = 0; i < args.unitNumbers.length; i++) {
      const unitNumber = args.unitNumbers[i];

      // 1. Skip if it's the "unknown" fallback from your scraper
      if (unitNumber === "unknown") {
        vehicles[i.toString()] = {
          unit_number: "unknown",
          unit_type: "Unknown",
          livery: "Unknown",
          livery_left: ""
        };
        continue;
      }

      // 2. Find the unit in the database
      const unit = await ctx.db
        .query("units")
        .withIndex("unit_number", (q) => q.eq("unit_number", unitNumber))
        .first();

      if (unit) {
        // 3. Resolve the Type and Livery using the IDs
        const typeId = ctx.db.normalizeId("types", unit.type_id);
        const type = typeId ? await ctx.db.get(typeId) : null;
        
        const liveryId = ctx.db.normalizeId("liveries", unit.livery_id);
        const livery = liveryId ? await ctx.db.get(liveryId) : null;

        // 4. Build the output object
        vehicles[i.toString()] = {
          unit_number: unit.unit_number || unitNumber,
          unit_type: type ? type.type_name : "Unknown",
          livery: livery ? livery.livery_name : "Unknown",
          livery_left: livery ? livery.css_class : ""
        };
      } else {
        // Fallback if the unit exists in RTT but isn't saved in your DB yet
        vehicles[i.toString()] = {
          unit_number: unitNumber,
          unit_type: "Unknown",
          livery: "Unknown",
          livery_left: ""
        };
      }
    }

    return vehicles;
  },
});
