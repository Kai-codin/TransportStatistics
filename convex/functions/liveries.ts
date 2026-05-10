import { query } from "../_generated/server";
import { v } from "convex/values";

export const getLiveryGrid = query({
  args: { user: v.string() },
  handler: async (ctx, args) => {
    const trips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .collect();

    const liveryMap: Record<string, { name: string; css: string; count: number }> = {};

    for (const trip of trips) {
      const units = Array.isArray(trip.units) ? trip.units : [];
      
      if (units.length > 0) {
        for (const unit of units) {
          const name = unit.livery ?? trip.livery_name;
          const css = unit.livery_left ?? trip.livery_css; 
          if (name) updateMap(liveryMap, name, css);
        }
      } else if (trip.livery_name) {
        updateMap(liveryMap, trip.livery_name, trip.livery_css ?? "");
      }
    }

    return Object.values(liveryMap).sort((a, b) => {
      // 1. Primary Sort: Trip Count (Descending)
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      // 2. Secondary Sort: Alphabetical Name (Ascending)
      return a.name.localeCompare(b.name);
    });
  },
});

function updateMap(map: any, name: string, css: string) {
  if (!map[name]) {
    map[name] = { name, css, count: 0 };
  }
  map[name].count++;
}