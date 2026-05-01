import { query } from "../_generated/server";
import { v } from "convex/values";

// convex/functions/stops.ts
export const getInBBox = query({
  args: {
    minLat: v.number(),
    maxLat: v.number(),
    minLon: v.number(),
    maxLon: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. Narrow the search space using the index
    const stops = await ctx.db
      .query("stops")
      .withIndex("by_lat", (q) => 
        q.gte("lat", args.minLat).lte("lat", args.maxLat)
      )
      // 2. Perform the longitudinal filter on the reduced set
      .filter((q) =>
        q.and(
          q.gte(q.field("lon"), args.minLon),
          q.lte(q.field("lon"), args.maxLon)
        )
      )
      .take(501);

    if (stops.length > 500) return [];
    
    return stops;
  },
});