// convex/migrations/runReplaceRailStationType.ts

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const runReplaceRailStationType = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let totalUpdated = 0;

    while (!isDone) {
      const result: { cursor: string | null; isDone: boolean; totalUpdated: number } = await ctx.runMutation(
        internal.migrations.replaceRailStationStopType.replaceRailStationStopTypeBatch,
        { cursor: cursor ?? undefined, totalUpdated }
      );

      cursor = result.cursor;
      isDone = result.isDone;
      totalUpdated = result.totalUpdated;
    }

    console.log(
      `Migration complete. Total stops updated: ${totalUpdated}`
    );
  },
});