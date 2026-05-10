import { query } from "../_generated/server";
import { v } from "convex/values";

export const getInBBox = query({
  args: {
    minLat: v.number(),
    maxLat: v.number(),
    minLon: v.number(),
    maxLon: v.number(),
  },
  handler: async (ctx, args) => {
    // Note: No console.logs inside the chain!
    return await ctx.db
      .query("stops")
      // Bound both ends of the latitude range so Convex only scans the viewport slice.
      .withIndex("by_lat_lon", (q) =>
        q.gte("lat", args.minLat).lt("lat", args.maxLat)
      )
      .filter((q) =>
        q.and(
          q.gte(q.field("lon"), args.minLon),
          q.lte(q.field("lon"), args.maxLon),
          q.eq(q.field("active"), true)
        )
      )
      .take(500);
  },
});

export const getGroupByCode = query({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.query("stops").withIndex("by_crsCode", (q) =>
      q.eq("crsCode", args.code)
    ).first();
  }
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("stopTypes").collect();
  },
});