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
    const stops = await ctx.db
      .query("stops")
      .withIndex("by_lat_lon", (q) =>
        q
          .gte("lat", args.minLat)
          .lte("lat", args.maxLat)
      )
      // lon is now the second field in the index — Convex can
      // use it for filtering without a full collection scan
      .filter((q) =>
        q.and(
          q.gte(q.field("lon"), args.minLon),
          q.lte(q.field("lon"), args.maxLon),
          q.eq(q.field("active"), true)
        )
      )
      .take(500);

    return stops;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("stopTypes").collect();
  },
});