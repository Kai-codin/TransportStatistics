// convex/migrations/replaceRailStationStopType.ts

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const BATCH_SIZE = 500; // Safe batch size for Convex's operation limits
const OLD_STOP_TYPE_ID = "rail_station_id"; // the type to filter out
const NEW_STOP_TYPE_ID = "j57526944rm9x6tb7k750mfaz586705n" as any; // replacement ID

export const replaceRailStationStopTypeBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    totalUpdated: v.optional(v.number()),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    totalUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    const totalUpdated = args.totalUpdated ?? 0;

    // Paginate through stops that match the old stopTypeId
    const result = await ctx.db
      .query("stops")
      .withIndex("by_stopType", (q) =>
        q.eq("stopTypeId", OLD_STOP_TYPE_ID as any)
      )
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    // Update each stop in this batch
    const updates = result.page.map((stop) =>
      ctx.db.patch(stop._id, { stopTypeId: NEW_STOP_TYPE_ID })
    );
    await Promise.all(updates);

    const newTotal = totalUpdated + result.page.length;

    console.log(
      `Batch done: updated ${result.page.length} stops | Total so far: ${newTotal} | Done: ${result.isDone}`
    );

    return {
      cursor: result.continueCursor,
      isDone: result.isDone,
      totalUpdated: newTotal,
    };
  },
});