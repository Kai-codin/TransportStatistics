// convex/functions/trips.ts
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";

export const fixTripLogsPaginated = mutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.cursor) {
      const allSeen = await ctx.db.query("seenUnits").collect();
      await Promise.all(allSeen.map((doc) => ctx.db.delete(doc._id)));
      console.log(`Wiped ${allSeen.length} seenUnits entries`);
    }

    // ⚠️ Can't sort by service_date via paginate, so fetch all and sort manually on first page only
    // Instead: collect ALL trips, sort by service_date asc, then paginate via slice
    const result = await ctx.db
      .query("tripLogs")
      .withIndex("by_service_date") // uses the composite index
      .order("asc") // this now orders by (user, service_date) asc
      .paginate({
        cursor: args.cursor ?? null,
        numItems: 750,
      });

    console.log(`Processing ${result.page.length} trips`);

    for (const trip of result.page) {
      const operator = trip.operator;
      const user = trip.user;
      const transportType = trip.transport_type;

      const rawUnits = (trip.units ?? []) as Array<{
        unit_number?: string;
        unit_reg?: string;
      }>;

      const normalizedUnits: Array<{ unit_number?: string; unit_reg?: string }> = [];
      for (const unit of rawUnits) {
        const reg = unit.unit_reg?.replace(/\s+/g, "").toUpperCase();
        if (unit.unit_number?.includes(" + ")) {
          for (const num of unit.unit_number.split(" + ").map(s => s.trim()).filter(Boolean)) {
            normalizedUnits.push({ unit_number: num, unit_reg: reg });
          }
        } else {
          normalizedUnits.push({ unit_number: unit.unit_number, unit_reg: reg });
        }
      }

      if (normalizedUnits.length === 0 && (trip.unit_number || trip.unit_reg)) {
        normalizedUnits.push({
          unit_number: trip.unit_number,
          unit_reg: trip.unit_reg?.replace(/\s+/g, "").toUpperCase(),
        });
      }

      const vehicleKeys: string[] = [];
      for (const unit of normalizedUnits) {
        let key: string | undefined;
        if (transportType === "Bus") {
          key = unit.unit_reg ?? unit.unit_number;
        } else {
          key = unit.unit_number ?? unit.unit_reg;
        }
        if (key) vehicleKeys.push(`${operator}_${key}`);
      }

      const uniqueKeys = [...new Set(vehicleKeys)];
      const firstUnits: string[] = [];

      for (const key of uniqueKeys) {
        const exists = await ctx.db
          .query("seenUnits")
          .withIndex("by_user_vehicle", (q) =>
            q.eq("user", user).eq("vehicle_key", key)
          )
          .first();

        if (!exists) {
          firstUnits.push(key);
          await ctx.db.insert("seenUnits", { user, vehicle_key: key });
        }
      }

      await ctx.db.patch(trip._id, {
        vehicle_keys: uniqueKeys,
        first_units: firstUnits,
        first_time: firstUnits.length > 0,
      });
    }

    return {
      continueCursor: result.continueCursor,
      done: result.isDone,
    };
  },
});

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

const tripLogUpdateArgs = {
  tripId: v.id("tripLogs"),
  ...tripLogArgs,
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

type TripUnitLike = {
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery?: string;
  livery_left?: string;
};

function getPrimaryUnit(raw: unknown): TripUnitLike | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const candidate = raw[0];
  if (!candidate || typeof candidate !== "object") return undefined;

  return candidate as TripUnitLike;
}

function getVehicleKey(unit?: TripUnitLike) {
  const unitNumber = unit?.unit_number;
  const unitReg = unit?.unit_reg?.replace(/\s+/g, "").toUpperCase();

  return unitNumber ?? unitReg ?? undefined;
}

function getVehicleKeyForTransport(unit?: TripUnitLike, transportType?: string) {
  const unitNumber = unit?.unit_number?.trim() || undefined;
  const unitReg = unit?.unit_reg?.replace(/\s+/g, "").toUpperCase();

  if (transportType === "Bus") {
    return unitReg ?? unitNumber;
  }

  return unitNumber ?? unitReg ?? undefined;
}

function normalizeReg(value?: string) {
  return value?.replace(/\s+/g, "").toUpperCase();
}

async function hasExistingTripWithVehicle(
  ctx: QueryCtx,
  userId: string,
  operator: string,
  vehicleKey: string | undefined,
  excludeTripId?: Id<"tripLogs">,
) {
  if (!vehicleKey) return false;

  const trips = await ctx.db
    .query("tripLogs")
    .withIndex("by_user_operator_vehicle", (q) =>
      q.eq("user", userId).eq("operator", operator).eq("vehicle_key", vehicleKey)
    )
    .collect();

  return trips.some((trip) => trip._id !== excludeTripId);
}

function normalizeTripUnits(raw: unknown): TripUnitLike[] {
  if (!Array.isArray(raw)) return [];

  const units: TripUnitLike[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;

    const unit = entry as TripUnitLike;
    const unitNumbers = typeof unit.unit_number === "string" && unit.unit_number.includes(" + ")
      ? unit.unit_number.split(" + ").map((value) => value.trim()).filter(Boolean)
      : [unit.unit_number].filter((value): value is string => Boolean(value && value.trim()));

    if (unitNumbers.length === 0) {
      units.push({
        unit_reg: unit.unit_reg,
        unit_type: unit.unit_type,
        livery: unit.livery,
        livery_left: unit.livery_left,
      });
      continue;
    }

    for (const unitNumber of unitNumbers) {
      units.push({
        unit_number: unitNumber,
        unit_reg: unit.unit_reg,
        unit_type: unit.unit_type,
        livery: unit.livery,
        livery_left: unit.livery_left,
      });
    }
  }

  return units;
}

async function lookupStopByCode(ctx: QueryCtx, code?: string) {
  if (!code) return null;

  const trimmed = code.trim();
  if (!trimmed) return null;

  const byCrs = await ctx.db
    .query("stops")
    .withIndex("by_crsCode", (q) => q.eq("crsCode", trimmed))
    .first();

  if (byCrs) return byCrs;

  return await ctx.db
    .query("stops")
    .withIndex("by_atcoCode", (q) => q.eq("atcoCode", trimmed))
    .first();
}

async function lookupOperatorBySlugOrName(ctx: QueryCtx, slug?: string, operatorName?: string) {
  const normalizedSlug = slug?.trim().toLowerCase();
  const normalizedName = operatorName?.trim().toLowerCase();

  if (normalizedSlug) {
    const bySlug = await ctx.db
      .query("operators")
      .withIndex("by_operator_slugs", (q) => q.eq("operator_slugs", normalizedSlug as never))
      .unique();

    if (bySlug) return bySlug;
  }

  if (!normalizedName) return null;

  const operators = await ctx.db.query("operators").collect();

  return operators.find((operator) => {
    const displayName = operator.display_name?.trim().toLowerCase();
    const names = (operator.operator_names ?? []).map((name: string) => name.trim().toLowerCase());
    const slugs = (operator.operator_slugs ?? []).map((value: string) => value.trim().toLowerCase());

    return displayName === normalizedName || names.includes(normalizedName) || slugs.includes(normalizedSlug ?? "");
  }) ?? null;
}

async function lookupRailDetailsByTrip(ctx: QueryCtx, trip: Doc<"tripLogs">) {
  if (trip.transport_type !== "Rail") return null;

  const candidates = [trip.service_number, trip.bustimes_service_slug, trip.vehicle_key]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    const byUid = await ctx.db
      .query("trainDetails")
      .withIndex("by_uid", (q) => q.eq("uid", candidate))
      .first();

    if (byUid) return byUid;

    const byRid = await ctx.db
      .query("trainDetails")
      .withIndex("by_rid", (q) => q.eq("rid", candidate))
      .first();

    if (byRid) return byRid;
  }

  return null;
}

export const getTripById = query({
  args: {
    tripId: v.id("tripLogs"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const trip = await ctx.db.get(args.tripId);

    if (!trip || trip.user !== args.userId) return null;

    return trip;
  },
});

export const getMyTripById = query({
  args: {
    tripId: v.id("tripLogs"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) return null;

    const trip = await ctx.db.get(args.tripId);

    if (!trip || trip.user !== identity.subject) return null;

    return trip;
  },
});

export const getTripDetailsById = query({
  args: {
    tripId: v.id("tripLogs"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const trip = await ctx.db.get(args.tripId);

    if (!trip || trip.user !== args.userId) return null;

    const originStop = await lookupStopByCode(ctx, trip.origin_stop_code);
    const destinationStop = await lookupStopByCode(ctx, trip.destination_stop_code);
    const operatorRecord = await lookupOperatorBySlugOrName(ctx, trip.operator_slug, trip.operator);
    const railDetails = await lookupRailDetailsByTrip(ctx, trip);

    const units = normalizeTripUnits(trip.units);
    const fallbackUnits = units.length > 0
      ? units
      : normalizeTripUnits([
          {
            unit_number: trip.unit_number,
            unit_reg: trip.unit_reg,
            unit_type: trip.unit_type,
            livery: trip.livery_name,
            livery_left: trip.livery_css,
          },
        ]);

    return {
      trip,
      originStop,
      destinationStop,
      operatorRecord,
      railDetails,
      units: fallbackUnits,
    };
  },
});

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

    const primaryUnit = getPrimaryUnit(args.units);
    const unit_number = primaryUnit?.unit_number;
    const unit_reg = normalizeReg(primaryUnit?.unit_reg);
    const vehicle_key = getVehicleKeyForTransport({ ...primaryUnit, unit_reg }, args.transport_type);
    const first_time = !(await hasExistingTripWithVehicle(ctx, identity.subject, args.operator, vehicle_key));

    return await ctx.db.insert("tripLogs", {
      user: identity.subject,
      on_trip_with: [],
      logged_at: Date.now(),

      ...args,

      unit_number,
      unit_reg,
      unit_type: primaryUnit?.unit_type,
      livery_name: primaryUnit?.livery,
      livery_css: primaryUnit?.livery_left,

      vehicle_key,
      first_time,
    });
  },
});

export const updateTrip = mutation({
  args: tripLogUpdateArgs,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("You must be signed in to edit a trip.");
    }

    const existingTrip = await ctx.db.get(args.tripId);

    if (!existingTrip || existingTrip.user !== identity.subject) {
      throw new Error("Trip not found.");
    }

    const primaryUnit = getPrimaryUnit(args.units);
    const unit_number = primaryUnit?.unit_number;
    const unit_reg = normalizeReg(primaryUnit?.unit_reg);
    const vehicle_key = getVehicleKeyForTransport({ ...primaryUnit, unit_reg }, args.transport_type);
    const first_time = !(await hasExistingTripWithVehicle(ctx, identity.subject, args.operator, vehicle_key, args.tripId));

    await ctx.db.patch(args.tripId, {
      service_number: args.service_number,
      operator: args.operator,
      operator_slug: args.operator_slug,
      service_date: args.service_date,
      transport_type: args.transport_type,
      bustimes_service_id: args.bustimes_service_id,
      bustimes_service_slug: args.bustimes_service_slug,
      origin_name: args.origin_name,
      origin_stop_code: args.origin_stop_code,
      destination_name: args.destination_name,
      destination_stop_code: args.destination_stop_code,
      scheduled_departure: args.scheduled_departure,
      actual_departure: args.actual_departure,
      scheduled_arrival: args.scheduled_arrival,
      actual_arrival: args.actual_arrival,
      full_route: args.full_route,
      ridden_route: args.ridden_route,
      units: args.units,
      notes: args.notes,
      unit_number,
      unit_reg,
      unit_type: primaryUnit?.unit_type,
      livery_name: primaryUnit?.livery,
      livery_css: primaryUnit?.livery_left,
      vehicle_key,
      first_time,
    });

    return args.tripId;
  },
});