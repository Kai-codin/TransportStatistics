// convex/functions/trips.ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const unitArgs = v.object({
  unit_number: v.optional(v.string()),
  unit_reg: v.optional(v.string()),
  unit_type: v.optional(v.string()),
  livery: v.optional(v.string()),
  livery_left: v.optional(v.string()),
});

const tripLogArgs = {
  service_number: v.string(),
  operator: v.string(),
  operator_slug: v.string(),
  service_date: v.number(),
  transport_type: v.union(
    v.literal("Rail"),
    v.literal("Bus"),
    v.literal("Tram"),
    v.literal("Ferry"),
    v.literal("Taxi"),
    v.literal("Other")
  ),
  bustimes_service_id: v.optional(v.number()),
  bustimes_service_slug: v.optional(v.string()),
  origin_name: v.string(),
  origin_stop_code: v.string(),
  destination_name: v.string(),
  destination_stop_code: v.string(),
  scheduled_departure: v.string(),
  actual_departure: v.optional(v.string()),
  scheduled_arrival: v.string(),
  actual_arrival: v.optional(v.string()),
  full_route: v.any(),
  ridden_route: v.any(),
  units: v.array(unitArgs),
  notes: v.optional(v.string()),
};

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

function getDateBounds(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

export const getMyTripsByDate = query({
  args: {
    user: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.date === 'all') {
      return await ctx.db
        .query("tripLogs")
        .withIndex("by_service_date", (q) => q.eq("user", args.user))
        .order("desc")
        .collect();
    }

    const { start, end } = getDateBounds(args.date);

    return await ctx.db
      .query("tripLogs")
      .withIndex("by_service_date", (q) =>
        q.eq("user", args.user).gte("service_date", start).lt("service_date", end)
      )
      .order("desc")
      .collect();
  },
});

export const logTrip = mutation({
  args: tripLogArgs,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("You must be signed in to log a trip.");
    }

    return await ctx.db.insert("tripLogs", {
      user: identity.subject,
      on_trip_with: [],
      logged_at: Date.now(),
      ...args,
    });
  },
});
