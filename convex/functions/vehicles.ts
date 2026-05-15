import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

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
    return await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .collect();
  },
});

export const getUserTripsByOperator = query({
  args: { user: v.string(), operatorName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .filter((q) => q.eq(q.field("operator"), args.operatorName))
      .collect();
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
    return tripGroups.flat();
  },
});