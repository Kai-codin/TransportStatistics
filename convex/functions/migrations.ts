import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { deriveVehicleKeysForParticipation } from "./friends";

export const migrateAndCleanup = mutation({
  handler: async (ctx) => {
    const all = await ctx.db.query("operators").collect();
    for (const op of all) {
      const oldOp = op as any;
      
      const update: any = {};
      if (oldOp.operator_name && !op.display_name) {
        update.display_name = oldOp.operator_name;
        update.operator_names = [oldOp.operator_name];
        update.operator_slugs = [oldOp.operator_slug];
        update.operator_codes = [oldOp.operator_code];
      }

      update.operator_name = undefined;
      update.operator_slug = undefined;
      update.operator_code = undefined;

      await ctx.db.patch(op._id, update);
    }
  },
});

export const getTripsWithOnTripWith = query({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("tripLogs").paginate({
      cursor: args.cursor ?? null,
      numItems: 50,
    });

    const trips: Array<{
      _id: unknown;
      user: string;
      username: string;
      service_number: string;
      service_date: number;
      on_trip_with: string[];
      origin_name: string;
      destination_name: string;
    }> = [];

    for (const t of page.page) {
      if (t.on_trip_with.length === 0) continue;
      const owner = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", t.user))
        .first();
      trips.push({
        _id: t._id,
        user: t.user,
        username: owner?.username ?? "Unknown",
        service_number: t.service_number,
        service_date: t.service_date,
        on_trip_with: t.on_trip_with,
        origin_name: t.origin_name,
        destination_name: t.destination_name,
      });
    }

    return {
      trips,
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const getUserOwnedTrips = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.clerkId))
      .collect();
  },
});

export const getUserParticipatedTrips = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const participations = await ctx.db
      .query("tripParticipants")
      .withIndex("by_user", (q) => q.eq("user", args.clerkId))
      .collect();

    return (await Promise.all(
      participations.map((p) => ctx.db.get(p.tripId))
    )).filter((t): t is NonNullable<typeof t> => t !== null);
  },
});

export const migrateOnTripWith = mutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("tripLogs").paginate({
      cursor: args.cursor ?? null,
      numItems: 50,
    });

    const result = {
      tripsProcessed: 0,
      participantsCreated: 0,
      participantsSkipped: 0,
      participantsUpdated: 0,
      usernamesNotFound: 0,
      tripsSkippedOwner: 0,
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };

    for (const trip of page.page) {
      if (trip.on_trip_with.length === 0) continue;
      result.tripsProcessed++;

      for (const rawUsername of trip.on_trip_with) {
        const trimmed = rawUsername.trim();
        if (!trimmed) continue;

        const user = await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.eq("username", trimmed))
          .first();

        if (!user) {
          result.usernamesNotFound++;
          continue;
        }

        if (user.clerkId === trip.user) {
          result.tripsSkippedOwner++;
          continue;
        }

        const existing = await ctx.db
          .query("tripParticipants")
          .withIndex("by_tripId_user", (q) =>
            q.eq("tripId", trip._id).eq("user", user.clerkId)
          )
          .first();

        const [ownedTrips, participationTrips] = await Promise.all([
          ctx.db.query("tripLogs").withIndex("by_user", (q) => q.eq("user", user.clerkId)).collect(),
          ctx.db
            .query("tripParticipants")
            .withIndex("by_user", (q) => q.eq("user", user.clerkId))
            .collect()
            .then((participations) =>
              Promise.all(participations.map((p) => ctx.db.get(p.tripId)))
            )
            .then((trips) => trips.filter((t): t is NonNullable<typeof t> => t !== null)),
        ]);

        const seenVehicleKeys = new Set<string>();
        const historyTrips = [...ownedTrips, ...participationTrips].filter(
          (historyTrip) => String(historyTrip._id) !== String(trip._id)
        );

        for (const previousTrip of historyTrips) {
          for (const key of deriveVehicleKeysForParticipation(previousTrip)) {
            if (key.trim()) seenVehicleKeys.add(key);
          }
        }

        const currentVehicleKeys = deriveVehicleKeysForParticipation(trip);
        const firstUnits = currentVehicleKeys.filter((key) => !seenVehicleKeys.has(key));

        const firstTimeInfo = {
          first_time: firstUnits.length > 0,
          first_units: firstUnits,
          vehicle_key: currentVehicleKeys[0],
          vehicle_keys: currentVehicleKeys,
        };

        if (existing) {
          if (!existing.first_time) {
            await ctx.db.patch(existing._id, firstTimeInfo);
            result.participantsUpdated++;
          } else {
            result.participantsSkipped++;
          }
          continue;
        }

        await ctx.db.insert("tripParticipants", {
          tripId: trip._id,
          user: user.clerkId,
          addedAt: Date.now(),
          ...firstTimeInfo,
        });

        result.participantsCreated++;
      }
    }

    return result;
  },
});
