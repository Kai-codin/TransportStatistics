// convex/functions/trips.ts
import { query } from "../_generated/server";

export const getMyTrips = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) return [];

    return await ctx.db
      .query("tripLogs")
      .withIndex("by_service_date", (q) => q.eq("user", identity.subject))
      .order("desc")
      .collect();
  },
});