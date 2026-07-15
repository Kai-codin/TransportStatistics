import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

const TFL_API_BASE = "https://api.tfl.gov.uk";

function simplifyStationName(name: string): string {
  return name.replace(" Underground Station", "");
}

export const bulkUpsertTflStops = mutation({
  args: {
    stops: v.array(
      v.object({
        actoCode: v.string(),
        name: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;

    for (const stop of args.stops) {
      const existing = await ctx.db
        .query("tflStops")
        .withIndex("by_actoCode", (q) => q.eq("actoCode", stop.actoCode))
        .unique();

      if (existing) {
        if (existing.name !== stop.name) {
          await ctx.db.patch(existing._id, { name: stop.name });
          updated++;
        }
      } else {
        await ctx.db.insert("tflStops", stop);
        inserted++;
      }
    }

    return { inserted, updated };
  },
});

export const syncTflStops = action({
  args: {},
  handler: async (ctx) => {
    const linesResponse = await fetch(`${TFL_API_BASE}/line/mode/tube`);
    if (!linesResponse.ok) {
      throw new Error(`Failed to fetch tube lines: ${linesResponse.status}`);
    }
    const linesData = (await linesResponse.json()) as Array<{
      id: string;
      name: string;
    }>;

    const stationsMap = new Map<string, string>();

    for (const line of linesData) {
      const stopsResponse = await fetch(
        `${TFL_API_BASE}/line/${line.id}/stoppoints`
      );
      if (!stopsResponse.ok) continue;
      const stopsData = (await stopsResponse.json()) as Array<{
        id: string;
        commonName: string;
      }>;
      for (const stop of stopsData) {
        stationsMap.set(stop.id, simplifyStationName(stop.commonName));
      }
    }

    const stops = Array.from(stationsMap.entries()).map(
      ([actoCode, name]) => ({ actoCode, name })
    );

    await ctx.runMutation(api.functions.tflStops.bulkUpsertTflStops, {
      stops,
    });
  },
});

export const getStopByActoCode = query({
  args: { actoCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tflStops")
      .withIndex("by_actoCode", (q) => q.eq("actoCode", args.actoCode))
      .unique();
  },
});

export const searchStopsByName = query({
  args: { name: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const maxResults = Math.min(args.limit ?? 10, 50);
    const stops = await ctx.db.query("tflStops").collect();
    const lower = args.name.toLowerCase();
    return stops
      .filter((s) => s.name.toLowerCase().includes(lower))
      .slice(0, maxResults);
  },
});
