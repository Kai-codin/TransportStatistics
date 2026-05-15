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

function normalizeServiceDate(value: number) {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function formatDateKey(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}

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

export const getMyTripsByDate = query({
  args: {
    user: v.string(),
    date: v.string(),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timeZone = args.timeZone ?? "UTC";
    const allTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .collect();

    if (args.date === 'all') {
      return [...allTrips].sort((a, b) => normalizeServiceDate(b.service_date) - normalizeServiceDate(a.service_date));
    }

    return allTrips
      .filter((trip) => {
        const timestamp = normalizeServiceDate(trip.service_date);
        return formatDateKey(timestamp, timeZone) === args.date;
      })
      .sort((a, b) => normalizeServiceDate(b.service_date) - normalizeServiceDate(a.service_date));
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
