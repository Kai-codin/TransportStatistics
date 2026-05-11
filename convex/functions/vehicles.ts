// convex/vehicles.ts
import { v } from "convex/values";
import { query } from "../_generated/server";

export const getOperatorByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("operators")
      .withIndex("by_operator_code", (q) => q.eq("operator_code", args.code))
      .first(); // Returns the first match instead of crashing if there are multiple
  },
});

export const getOperatorUnits = query({
  args: { operatorId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("units")
      .withIndex("by_operator_id", (q) => q.eq("operator_id", args.operatorId))
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