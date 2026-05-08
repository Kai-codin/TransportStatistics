import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const deleteStopsByType = mutation({
  args: {
    stopTypeId: v.id("stopTypes"),
  },
  handler: async (ctx, args) => {
    const stops = await ctx.db
      .query("stops")
      .withIndex("by_stopType", (q) => q.eq("stopTypeId", args.stopTypeId))
      .collect();

    await Promise.all(stops.map((stop) => ctx.db.delete(stop._id)));

    return { deleted: stops.length };
  },
});