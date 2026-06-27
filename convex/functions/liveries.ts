import { query } from "../_generated/server";
import { v } from "convex/values";
import { getAllUserTrips } from "./userTrips";

export const getLiveryGrid = query({
  args: { user: v.string() },
  handler: async (ctx, args) => {
    const trips = await getAllUserTrips(ctx, args.user);

    const liveryMap: Record<string, { name: string; css: string; count: number }> = {};

    for (const trip of trips) {
      const units = Array.isArray(trip.units) ? trip.units : [];
      if (units.length > 0) {
        for (const unit of units) {
          const name = unit.livery ?? trip.livery_name;
          const css = unit.livery_left ?? trip.livery_css;
          if (name) {
            const entry = liveryMap[name];
            if (entry) {
              entry.count++;
            } else {
              liveryMap[name] = { name, css: css ?? "", count: 1 };
            }
          }
        }
      } else if (trip.livery_name) {
        const entry = liveryMap[trip.livery_name];
        if (entry) {
          entry.count++;
        } else {
          liveryMap[trip.livery_name] = {
            name: trip.livery_name,
            css: trip.livery_css ?? "",
            count: 1,
          };
        }
      }
    }

    return Object.values(liveryMap).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  },
});
