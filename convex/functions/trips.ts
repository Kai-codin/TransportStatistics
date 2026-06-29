// convex/functions/trips.ts
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { ensureUserRecord } from "./users";
import { areFriends } from "./friends";
import { getAllUserTrips } from "./userTrips";

export const fixTripLogsPaginated = mutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // On the first page, wipe all seenUnits.
    // Use paginated deletes to avoid loading the entire table into memory.
    if (!args.cursor) {
      const allSeen = await ctx.db.query("seenUnits").collect();
      await Promise.all(allSeen.map((doc) => ctx.db.delete(doc._id)));
      console.log(`Wiped ${allSeen.length} seenUnits entries`);
    }

    const result = await ctx.db
      .query("tripLogs")
      .withIndex("by_user_date_departure")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: 250,
      });

    console.log(`Processing ${result.page.length} trips`);

    // --- Step 1: Derive all (user, vehicleKey) pairs needed for this page ---
    type TripMeta = {
      trip: Doc<"tripLogs">;
      uniqueKeys: string[];
    };

    const tripMetas: TripMeta[] = [];

    // Also collect every unique (user, vehicleKey) pair so we can batch-lookup
    // seenUnits in parallel rather than one-at-a-time inside a loop.
    const lookupPairs = new Map<string, { user: string; vehicle_key: string }>();

    for (const trip of result.page) {
      const { operator, transport_type: transportType } = trip;

      const rawUnits = (trip.units ?? []) as Array<{
        unit_number?: string;
        unit_reg?: string;
      }>;

      const normalizedUnits: Array<{ unit_number?: string; unit_reg?: string }> = [];

      for (const unit of rawUnits) {
        const reg = unit.unit_reg?.replace(/\s+/g, "").toUpperCase();
        if (unit.unit_number?.includes(" + ")) {
          for (const num of unit.unit_number.split(" + ").map((s) => s.trim()).filter(Boolean)) {
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
        const key =
          transportType === "Bus"
            ? (unit.unit_reg ?? unit.unit_number)
            : (unit.unit_number ?? unit.unit_reg);
        if (key) vehicleKeys.push(`${operator}_${key}`);
      }

      const uniqueKeys = [...new Set(vehicleKeys)];
      tripMetas.push({ trip, uniqueKeys });

      for (const key of uniqueKeys) {
        const lookupKey = `${trip.user}__${key}`;
        if (!lookupPairs.has(lookupKey)) {
          lookupPairs.set(lookupKey, { user: trip.user, vehicle_key: key });
        }
      }
    }

    // --- Step 2: Batch-lookup all seenUnits for this page in parallel ---
    const seenResults = await Promise.all(
      [...lookupPairs.values()].map(({ user, vehicle_key }) =>
        ctx.db
          .query("seenUnits")
          .withIndex("by_user_vehicle", (q) =>
            q.eq("user", user).eq("vehicle_key", vehicle_key)
          )
          .first()
          .then((doc) => ({ user, vehicle_key, exists: doc !== null }))
      )
    );

    // Build an in-memory set of already-seen keys: "user__vehicleKey"
    const alreadySeen = new Set<string>();
    for (const { user, vehicle_key, exists } of seenResults) {
      if (exists) alreadySeen.add(`${user}__${vehicle_key}`);
    }

    // --- Step 3: Compute patches and inserts, then execute in parallel ---
    const inserts: Array<{ user: string; vehicle_key: string }> = [];
    const patches: Array<{
      id: Id<"tripLogs">;
      vehicle_keys: string[];
      first_units: string[];
      first_time: boolean;
    }> = [];

    for (const { trip, uniqueKeys } of tripMetas) {
      const firstUnits: string[] = [];

      for (const key of uniqueKeys) {
        const lookupKey = `${trip.user}__${key}`;
        if (!alreadySeen.has(lookupKey)) {
          firstUnits.push(key);
          // Mark as seen in-memory so subsequent trips on this page that share
          // a vehicle key don't incorrectly treat it as a first encounter.
          alreadySeen.add(lookupKey);
          inserts.push({ user: trip.user, vehicle_key: key });
        }
      }

      patches.push({
        id: trip._id,
        vehicle_keys: uniqueKeys,
        first_units: firstUnits,
        first_time: firstUnits.length > 0,
      });
    }

    // Fire all inserts and patches in parallel
    await Promise.all([
      ...inserts.map(({ user, vehicle_key }) =>
        ctx.db.insert("seenUnits", { user, vehicle_key })
      ),
      ...patches.map(({ id, vehicle_keys, first_units, first_time }) =>
        ctx.db.patch(id, { vehicle_keys, first_units, first_time })
      ),
    ]);

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

function getTripsAllLimit() {
  const raw = process.env.TRIPS_ALL_LIMIT;
  if (!raw) return 2000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2000;
  return Math.floor(parsed);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const localeDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return date.getTime() - localeDate.getTime();
}

function getDateBounds(dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  if (!year || !month || !day) {
    return { start: 0, end: 0 };
  }

  const utcStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const utcEnd = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const startOffset = getTimeZoneOffsetMs(utcStart, timeZone);
  const endOffset = getTimeZoneOffsetMs(utcEnd, timeZone);

  return {
    start: utcStart.getTime() - startOffset,
    end: utcEnd.getTime() - endOffset,
  };
}

type TripUnitLike = {
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery?: string;
  livery_left?: string;
};

function toTripSummary(trip: Doc<"tripLogs">) {
  return {
    _id: trip._id,
    _creationTime: trip._creationTime,
    user: trip.user,
    on_trip_with: trip.on_trip_with,
    logged_at: trip.logged_at,
    service_number: trip.service_number,
    operator: trip.operator,
    operator_slug: trip.operator_slug,
    service_date: trip.service_date,
    transport_type: trip.transport_type,
    bustimes_service_id: trip.bustimes_service_id,
    bustimes_service_slug: trip.bustimes_service_slug,
    origin_name: trip.origin_name,
    origin_stop_code: trip.origin_stop_code,
    destination_name: trip.destination_name,
    destination_stop_code: trip.destination_stop_code,
    scheduled_departure: trip.scheduled_departure,
    actual_departure: trip.actual_departure,
    scheduled_arrival: trip.scheduled_arrival,
    actual_arrival: trip.actual_arrival,
    units: trip.units,
    unit_number: trip.unit_number,
    unit_reg: trip.unit_reg,
    unit_type: trip.unit_type,
    livery_name: trip.livery_name,
    livery_css: trip.livery_css,
    notes: trip.notes,
    first_time: trip.first_time,
    first_units: trip.first_units,
    vehicle_key: trip.vehicle_key,
    vehicle_keys: trip.vehicle_keys,
    distance_km: trip.distance_km,
    full_route: undefined,
    ridden_route: undefined,
    full_locations: undefined,
  };
}

async function getRouteDetails(ctx: QueryCtx, trip: Doc<"tripLogs">) {
  if (trip.full_route !== undefined || trip.ridden_route !== undefined || trip.full_locations !== undefined) {
    return {
      full_route: trip.full_route,
      ridden_route: trip.ridden_route,
      full_locations: trip.full_locations,
    };
  }

  const details = await ctx.db
    .query("tripRouteDetails")
    .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
    .first();

  return {
    full_route: details?.full_route ?? trip.full_route,
    ridden_route: details?.ridden_route ?? trip.ridden_route,
    full_locations: details?.full_locations ?? trip.full_locations,
  };
}

async function attachRouteDetails(ctx: QueryCtx, trip: Doc<"tripLogs">) {
  return {
    ...toTripSummary(trip),
    ...(await getRouteDetails(ctx, trip)),
  };
}

async function saveRouteDetails(
  ctx: MutationCtx,
  tripId: Id<"tripLogs">,
  user: string,
  routes: {
    full_route?: unknown;
    ridden_route?: unknown;
    full_locations?: unknown;
  },
) {
  const existing = await ctx.db
    .query("tripRouteDetails")
    .withIndex("by_tripId", (q) => q.eq("tripId", tripId))
    .first();

  const payload = {
    tripId,
    user,
    full_route: routes.full_route,
    ridden_route: routes.ridden_route,
    full_locations: routes.full_locations,
    updated_at: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return;
  }

  await ctx.db.insert("tripRouteDetails", payload);
}

function getPrimaryUnit(raw: unknown): TripUnitLike | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const candidate = raw[0];
  if (!candidate || typeof candidate !== "object") return undefined;

  return candidate as TripUnitLike;
}

function deriveVehicleKeys(
  units: Array<{ unit_number?: string; unit_reg?: string }>,
  transportType?: string,
  operator?: string,
): string[] {
  const normalizedUnits: Array<{ unit_number?: string; unit_reg?: string }> = [];
  for (const unit of units ?? []) {
    const reg = unit.unit_reg?.replace(/\s+/g, "").toUpperCase();
    if (unit.unit_number?.includes(" + ")) {
      for (const num of unit.unit_number.split(" + ").map((s) => s.trim()).filter(Boolean)) {
        normalizedUnits.push({ unit_number: num, unit_reg: reg });
      }
    } else {
      normalizedUnits.push({ unit_number: unit.unit_number, unit_reg: reg });
    }
  }

  const keys: string[] = [];
  for (const unit of normalizedUnits) {
    const key =
      transportType === "Bus"
        ? (unit.unit_reg ?? unit.unit_number)
        : (unit.unit_number ?? unit.unit_reg);
    if (key) keys.push(`${operator}_${key}`);
  }
  return [...new Set(keys)];
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

function haversineKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateDistanceKm(fullRoute: unknown, riddenRoute: unknown) {
  const route = riddenRoute as { geometry?: { coordinates?: unknown } } | null;
  const full = fullRoute as { coordinates?: unknown } | null;
  const coords = route?.geometry?.coordinates ?? full?.coordinates;
  if (!Array.isArray(coords)) return undefined;

  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const previous = coords[i - 1];
    const current = coords[i];
    if (
      Array.isArray(previous) &&
      Array.isArray(current) &&
      typeof previous[0] === "number" &&
      typeof previous[1] === "number" &&
      typeof current[0] === "number" &&
      typeof current[1] === "number"
    ) {
      total += haversineKm(previous as [number, number], current as [number, number]);
    }
  }

  return total;
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
    .take(2);

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

async function lookupOperatorBySlugOrName(
  ctx: QueryCtx,
  slug?: string,
  operatorName?: string
) {
  const normalizedSlug = slug?.trim().toLowerCase();
  const normalizedName = operatorName?.trim().toLowerCase();

  const [bySlug, byName, byDisplayName] = await Promise.all([
    normalizedSlug
      ? ctx.db
          .query("operators")
          .withIndex("by_operator_slugs", (q) =>
            q.eq("operator_slugs", normalizedSlug as never)
          )
          .first()
      : Promise.resolve(null),
    normalizedName
      ? ctx.db
          .query("operators")
          .withIndex("by_operator_names", (q) =>
            q.eq("operator_names", normalizedName as never)
          )
          .first()
      : Promise.resolve(null),
    operatorName
      ? ctx.db
          .query("operators")
          .withIndex("by_display_name", (q) =>
            q.eq("display_name", operatorName.trim())
          )
          .first()
      : Promise.resolve(null),
  ]);

  if (bySlug) return bySlug;
  if (byName) return byName;
  if (byDisplayName) return byDisplayName;

  if (!normalizedName && !normalizedSlug) return null;

  // Fallback: collect all and do case-insensitive match.
  // Operators table is small (<200 rows) so this is cheap.
  const operators = await ctx.db.query("operators").collect();

  return (
    operators.find((operator) => {
      const displayName = operator.display_name?.trim().toLowerCase();
      const names = (operator.operator_names ?? []).map((n: string) =>
        n.trim().toLowerCase()
      );
      const slugs = (operator.operator_slugs ?? []).map((s: string) =>
        s.trim().toLowerCase()
      );
      return (
        (normalizedName && (displayName === normalizedName || names.includes(normalizedName))) ||
        (normalizedSlug && slugs.includes(normalizedSlug))
      );
    }) ?? null
  );
}

async function lookupRailDetailsByTrip(ctx: QueryCtx, trip: Doc<"tripLogs">) {
  if (trip.transport_type !== "Rail") return null;

  const candidates = [trip.service_number, trip.bustimes_service_slug, trip.vehicle_key].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  if (candidates.length === 0) return null;

  // Issue all uid + rid lookups in parallel
  const results = await Promise.all(
    candidates.flatMap((candidate) => [
      ctx.db
        .query("trainDetails")
        .withIndex("by_uid", (q) => q.eq("uid", candidate))
        .first(),
      ctx.db
        .query("trainDetails")
        .withIndex("by_rid", (q) => q.eq("rid", candidate))
        .first(),
    ])
  );

  // Return the first non-null result, preserving the original uid-before-rid priority
  return results.find((r) => r !== null) ?? null;
}

export const getTripById = query({
  args: {
    tripId: v.id("tripLogs"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const trip = await ctx.db.get(args.tripId);

    if (!trip || trip.user !== args.userId) return null;

    return attachRouteDetails(ctx, trip);
  },
});

export const getTripByIdNoAuth = query({
  args: {
    tripId: v.id("tripLogs"),
  },
  handler: async (ctx, args) => {
    const trip = await ctx.db.get(args.tripId);
    if (!trip) return null;
    return attachRouteDetails(ctx, trip);
  },
});

export const getTripDetailsByIdNoAuth = query({
  args: {
    tripId: v.id("tripLogs"),
  },
  handler: async (ctx, args) => {
    const trip = await ctx.db.get(args.tripId);
    if (!trip) return null;

    const [originStop, destinationStop, operatorRecord, railDetails, routeDetails] =
      await Promise.all([
        lookupStopByCode(ctx, trip.origin_stop_code),
        lookupStopByCode(ctx, trip.destination_stop_code),
        lookupOperatorBySlugOrName(ctx, trip.operator_slug, trip.operator),
        lookupRailDetailsByTrip(ctx, trip),
        getRouteDetails(ctx, trip),
      ]);

    const units = normalizeTripUnits(trip.units);
    const fallbackUnits =
      units.length > 0
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
      trip: { ...toTripSummary(trip), ...routeDetails },
      originStop,
      destinationStop,
      operatorRecord,
      railDetails,
      units: fallbackUnits,
    };
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

    return attachRouteDetails(ctx, trip);
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

    // Run all independent lookups in parallel
    const [originStop, destinationStop, operatorRecord, railDetails, routeDetails] =
      await Promise.all([
        lookupStopByCode(ctx, trip.origin_stop_code),
        lookupStopByCode(ctx, trip.destination_stop_code),
        lookupOperatorBySlugOrName(ctx, trip.operator_slug, trip.operator),
        lookupRailDetailsByTrip(ctx, trip),
        getRouteDetails(ctx, trip),
      ]);

    const units = normalizeTripUnits(trip.units);
    const fallbackUnits =
      units.length > 0
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
      trip: { ...toTripSummary(trip), ...routeDetails },
      originStop,
      destinationStop,
      operatorRecord,
      railDetails,
      units: fallbackUnits,
    };
  },
});

export const getMyTripsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    includeRoutes: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { page: [], continueCursor: "", isDone: true };

    const result = await ctx.db
      .query("tripLogs")
      .withIndex("by_user_date_departure", (q) => q.eq("user", identity.subject))
      .order("desc")
      .paginate({
        cursor: args.paginationOpts.cursor ?? null,
        numItems: Math.max(args.paginationOpts.numItems, 20),
      });

    if (!args.includeRoutes) {
      return {
        ...result,
        page: result.page.map(toTripSummary),
      };
    }

    return {
      ...result,
      page: await Promise.all(result.page.map((trip) => attachRouteDetails(ctx, trip))),
    };
  },
});

export const getMyTripCount = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { trips: 0, days: 0 };

    const trips = await getAllUserTrips(ctx, identity.subject);

    const days = new Set(
      trips.map((t) => {
        const ts = t.service_date > 1_000_000_000_000 ? t.service_date : t.service_date * 1000;
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })
    ).size;

    return { trips: trips.length, days };
  },
});

export const getUserTripsPaginated = query({
  args: {
    userId: v.string(),
    paginationOpts: paginationOptsValidator,
    includeRoutes: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { page: [], continueCursor: "", isDone: true };
    const me = identity.subject;

    const query = ctx.db
      .query("tripLogs")
      .withIndex("by_user_date_departure", (q) => q.eq("user", args.userId))
      .order("desc");

    if (me === args.userId) {
      const result = await query.paginate({
        cursor: args.paginationOpts.cursor ?? null,
        numItems: Math.max(args.paginationOpts.numItems, 20),
      });
      return {
        ...result,
        page: args.includeRoutes
          ? await Promise.all(result.page.map((trip) => attachRouteDetails(ctx, trip)))
          : result.page.map(toTripSummary),
      };
    }

    const isFriend = await areFriends(ctx, me, args.userId);
    if (!isFriend) return { page: [], continueCursor: "", isDone: true };

    const result = await query.paginate({
      cursor: args.paginationOpts.cursor ?? null,
      numItems: Math.max(args.paginationOpts.numItems, 20),
    });

    return {
      ...result,
      page: args.includeRoutes
        ? await Promise.all(result.page.map((trip) => attachRouteDetails(ctx, trip)))
        : result.page.map(toTripSummary),
    };
  },
});

export const getUserTripCount = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = identity.subject;

    if (me !== args.userId) {
      const isFriend = await areFriends(ctx, me, args.userId);
      if (!isFriend) return null;
    }

    const trips = await getAllUserTrips(ctx, args.userId);

    const days = new Set(
      trips.map((t) => {
        const ts = t.service_date > 1_000_000_000_000 ? t.service_date : t.service_date * 1000;
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })
    ).size;

    return { trips: trips.length, days };
  },
});

export const getMyTripsByDate = query({
  args: {
    user: v.string(),
    date: v.string(),
    timeZone: v.optional(v.string()),
    includeRoutes: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tz = args.timeZone ?? "Europe/London";

    if (args.date === "all") {
      const limit = getTripsAllLimit();
      const trips = (await getAllUserTrips(ctx, args.user)).slice(0, limit);

      if (args.includeRoutes) {
        return await Promise.all(trips.map((trip) => attachRouteDetails(ctx, trip)));
      }

      return trips.map(toTripSummary);
    }

    const { start, end } = getDateBounds(args.date, tz);
    if (!start || !end) return [];

    // Execute query using our dedicated two-field index
    const trips = (await getAllUserTrips(ctx, args.user)).filter((trip) =>
      normalizeServiceDate(trip.service_date) >= start &&
      normalizeServiceDate(trip.service_date) < end
    );

    if (args.includeRoutes) {
      return await Promise.all(trips.map((trip) => attachRouteDetails(ctx, trip)));
    }

    return trips.map(toTripSummary);
  },
});

export const logTrip = mutation({
  args: tripLogArgs,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("You must be signed in to log a trip.");

    const primaryUnit = getPrimaryUnit(args.units);
    const unit_number = primaryUnit?.unit_number;
    const unit_reg = normalizeReg(primaryUnit?.unit_reg);
    const vehicle_key = getVehicleKeyForTransport(
      { ...primaryUnit, unit_reg },
      args.transport_type
    );

    const { full_route, ridden_route, ...tripFields } = args;
    const distance_km = calculateDistanceKm(full_route, ridden_route);

    // ensureUserRecord and hasExistingTripWithVehicle are independent — run in parallel
    const [, existingTripExists] = await Promise.all([
      ensureUserRecord(ctx, identity),
      hasExistingTripWithVehicle(ctx, identity.subject, args.operator, vehicle_key),
    ]);

    const first_time = !existingTripExists;
    const vehicle_keys = deriveVehicleKeys(args.units, args.transport_type, args.operator);
    const first_units = first_time ? vehicle_keys : [];

    const tripId = await ctx.db.insert("tripLogs", {
      user: identity.subject,
      on_trip_with: [],
      logged_at: Date.now(),
      ...tripFields,
      unit_number,
      unit_reg,
      unit_type: primaryUnit?.unit_type,
      livery_name: primaryUnit?.livery,
      livery_css: primaryUnit?.livery_left,
      distance_km,
      vehicle_key,
      vehicle_keys,
      first_time,
      first_units,
    });

    await saveRouteDetails(ctx, tripId, identity.subject, { full_route, ridden_route });

    return tripId;
  },
});

export const updateTrip = mutation({
  args: tripLogUpdateArgs,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("You must be signed in to edit a trip.");

    const existingTrip = await ctx.db.get(args.tripId);
    if (!existingTrip || existingTrip.user !== identity.subject) {
      throw new Error("Trip not found.");
    }

    const primaryUnit = getPrimaryUnit(args.units);
    const unit_number = primaryUnit?.unit_number;
    const unit_reg = normalizeReg(primaryUnit?.unit_reg);
    const vehicle_key = getVehicleKeyForTransport(
      { ...primaryUnit, unit_reg },
      args.transport_type
    );

    const { full_route, ridden_route } = args;
    const distance_km = calculateDistanceKm(full_route, ridden_route);

    // Vehicle check and route detail lookup are independent — run in parallel
    const [existingTripExists] = await Promise.all([
      hasExistingTripWithVehicle(
        ctx,
        identity.subject,
        args.operator,
        vehicle_key,
        args.tripId
      ),
      saveRouteDetails(ctx, args.tripId, identity.subject, { full_route, ridden_route }),
    ]);

    const first_time = !existingTripExists;
    const vehicle_keys = deriveVehicleKeys(args.units, args.transport_type, args.operator);
    const first_units = first_time ? vehicle_keys : [];

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
      units: args.units,
      notes: args.notes,
      distance_km,
      unit_number,
      unit_reg,
      unit_type: primaryUnit?.unit_type,
      livery_name: primaryUnit?.livery,
      livery_css: primaryUnit?.livery_left,
      vehicle_key,
      vehicle_keys,
      first_time,
      first_units,
    });

    return args.tripId;
  },
});

export const deleteTrip = mutation({
  args: {
    tripId: v.id("tripLogs"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("You must be signed in to delete a trip.");
    }

    const existingTrip = await ctx.db.get(args.tripId);

    if (!existingTrip || existingTrip.user !== identity.subject) {
      throw new Error("Trip not found.");
    }

    const routeDetails = await ctx.db
      .query("tripRouteDetails")
      .withIndex("by_tripId", (q) => q.eq("tripId", args.tripId))
      .first();

    if (routeDetails) {
      await ctx.db.delete(routeDetails._id);
    }

    await ctx.db.delete(args.tripId);

    return args.tripId;
  },
});
