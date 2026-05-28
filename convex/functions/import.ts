import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

export const importBatch = mutation({
  args: { features: v.array(v.any()) },
  handler: async (ctx, args) => {
    const validFeatures = args.features.filter(
      (f) =>
        f?.atcoCode &&
        f.lat != null &&
        f.lon != null &&
        !isNaN(Number(f.lat)) &&
        !isNaN(Number(f.lon)) &&
        f.stopTypeId
    );
    if (validFeatures.length === 0) {
      return { inserted: 0, updated: 0, skipped: args.features.length };
    }

    const atcoCodes = validFeatures.map((f) => String(f.atcoCode));
    const existingStops = await Promise.all(
      atcoCodes.map((code) =>
        ctx.db
          .query("stops")
          .withIndex("by_atcoCode", (q) => q.eq("atcoCode", code))
          .unique()
      )
    );
    const stopMap = new Map(
      existingStops
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => [s.atcoCode, s])
    );

    let inserted = 0;
    let updated = 0;
    let skipped = args.features.length - validFeatures.length;

    for (const feature of validFeatures) {
      const stopData = {
        name: feature.name ?? "Unknown",
        commonName: feature.commonName ?? feature.name ?? "Unknown",
        atcoCode: String(feature.atcoCode),
        crsCode: feature.crsCode ?? undefined,
        tiplocCode: feature.tiplocCode ?? undefined,
        naptanCode: feature.naptanCode ?? undefined,
        indicator: feature.indicator ?? undefined,
        stopTypeId: feature.stopTypeId as Id<"stopTypes">,
        active: feature.active ?? true,
        hidden: feature.hidden ?? false,
        lat: Number(feature.lat),
        lon: Number(feature.lon),
      };

      const existing = stopMap.get(stopData.atcoCode);
      if (existing) {
        const isDifferent =
          existing.name !== stopData.name ||
          existing.lat !== stopData.lat ||
          existing.lon !== stopData.lon ||
          existing.stopTypeId !== stopData.stopTypeId;
        if (isDifferent) {
          await ctx.db.patch(existing._id, stopData);
          updated++;
        }
      } else {
        await ctx.db.insert("stops", stopData);
        inserted++;
      }
    }

    return { inserted, updated, skipped };
  },
});

export const importTrips = mutation({
  args: {
    trips: v.array(v.any()),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    for (const trip of args.trips) {
      const timestamp = typeof trip.service_date === 'string'
        ? new Date(trip.service_date).getTime()
        : trip.service_date;

      const cleanString = (val: unknown) => {
        if (typeof val !== 'string') return undefined;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      const normaliseReg = (val?: string) =>
        val?.replace(/\s+/g, "").toUpperCase();

      const mappedTransportType = (() => {
        const value = String(trip.transport_type || 'Other').toLowerCase();
        if (value === 'rail' || value === 'train') return 'Rail';
        if (value === 'bus') return 'Bus';
        if (value === 'tram') return 'Tram';
        if (value === 'ferry') return 'Ferry';
        if (value === 'taxi') return 'Taxi';
        return 'Other';
      })();

      const units = (() => {
        if (Array.isArray(trip.units) && trip.units.length > 0) {
          return trip.units
            .map((u: any) => ({
              unit_number: cleanString(u.unit_number),
              unit_reg: cleanString(u.unit_reg),
              unit_type: cleanString(u.unit_type),
              livery: cleanString(u.livery),
              livery_left: cleanString(u.livery_left),
            }))
            .filter((u: any) =>
              Boolean(u.unit_number || u.unit_reg || u.unit_type || u.livery || u.livery_left)
            );
        }

        const unit = {
          unit_number: cleanString(trip.train_fleet_number || trip.bus_fleet_number),
          unit_reg: cleanString(trip.bus_registration),
          unit_type: cleanString(trip.train_type || trip.bus_type),
          livery: cleanString(trip.bus_livery_name || trip.livery_name),
          livery_left: cleanString(trip.bus_livery || trip.livery_css),
        };

        return unit.unit_number || unit.unit_reg || unit.unit_type || unit.livery || unit.livery_left
          ? [unit]
          : [];
      })();

      // 👉 pick a primary unit for first_time logic
      const primaryUnit = units[0];

      const unit_number = primaryUnit?.unit_number;
      const unit_reg = normaliseReg(primaryUnit?.unit_reg);

      const vehicle_key =
        unit_number ??
        unit_reg ??
        undefined;

      const operator = trip.operator ?? 'Unknown';

      // 👉 check if seen before
      let first_time = false;

      if (vehicle_key) {
        const existing = await ctx.db
          .query("tripLogs")
          .withIndex("by_user_operator_vehicle", (q) =>
            q.eq("user", args.userId)
             .eq("operator", operator)
             .eq("vehicle_key", vehicle_key)
          )
          .first();

        first_time = !existing;
      }

      await ctx.db.insert('tripLogs', {
        user: args.userId,
        on_trip_with: Array.isArray(trip.on_trip_with)
          ? trip.on_trip_with
          : Array.isArray(trip.on_trip_usernames)
          ? trip.on_trip_usernames
          : [],
        logged_at: Date.now(),
        service_number: cleanString(trip.service_number) || cleanString(trip.headcode) || 'N/A',
        operator,
        operator_slug: operator.toLowerCase().replace(/\s+/g, '-'),
        service_date: timestamp,
        transport_type: mappedTransportType as 'Rail' | 'Bus' | 'Tram' | 'Ferry' | 'Taxi' | 'Other',
        bustimes_service_id: trip.bustimes_service_id != null && trip.bustimes_service_id !== ''
          ? Number(trip.bustimes_service_id)
          : undefined,
        bustimes_service_slug: cleanString(trip.bustimes_service_slug),
        origin_name: trip.origin_name ?? 'Unknown',
        origin_stop_code: cleanString(trip.origin_crs) || cleanString(trip.origin_stop_code) || 'N/A',
        destination_name: trip.destination_name ?? 'Unknown',
        destination_stop_code: cleanString(trip.destination_crs) || cleanString(trip.destination_stop_code) || 'N/A',
        scheduled_departure: cleanString(trip.scheduled_departure) || '00:00',
        actual_departure: cleanString(trip.actual_departure),
        scheduled_arrival: cleanString(trip.scheduled_arrival) || '00:00',
        actual_arrival: cleanString(trip.actual_arrival),
        full_route: trip.full_route ?? (trip.full_route_geometry || trip.full_locations
          ? { geometry: trip.full_route_geometry, stops: trip.full_locations }
          : undefined),
        ridden_route: trip.ridden_route ?? (trip.route_geometry
          ? { geometry: { type: 'LineString', coordinates: trip.route_geometry } }
          : undefined),
        units,

        // 👉 new fields
        unit_number,
        unit_reg,
        vehicle_key,
        first_time,

        notes: cleanString(trip.notes),
      });
    }
  },
});

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function toCode(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export const importTrains = mutation({
  args: {
    trains: v.array(
      v.object({
        operator: v.string(),
        fleetnumber: v.string(),
        type: v.string(),
        livery: v.object({
          name: v.string(),
          css: v.string(),
        }),
      })
    ),
  },
  handler: async (ctx, { trains }) => {
    const [allLiveries, allTypes, allOperators] = await Promise.all([
      ctx.db.query("liveries").collect(),
      ctx.db.query("types").collect(),
      ctx.db.query("operators").collect(),
    ]);

    const liveryCache = new Map(allLiveries.map(l => [`${l.livery_name}||${l.css_class}`, l._id]));
    const typeCache = new Map(allTypes.map(t => [t.type_name, t._id]));
    
    const operatorCache = new Map<string, Id<"operators">>();
    for (const o of allOperators) {
      (o.operator_slugs ?? []).forEach(s => operatorCache.set(s, o._id));
    }

    const existingUnits = await ctx.db.query("units").collect();
    const existingUnitNumbers = new Set(existingUnits.map((u) => u.unit_number));

    let newLiveries = 0;
    let newTypes = 0;
    let newOperators = 0;
    let newUnits = 0;
    let skippedUnits = 0;

    for (const train of trains) {
      const liveryKey = `${train.livery.name}||${train.livery.css}`;
      let liveryId = liveryCache.get(liveryKey);

      if (!liveryId) {
        liveryId = await ctx.db.insert("liveries", {
          livery_name: train.livery.name,
          css_class: train.livery.css,
        });
        liveryCache.set(liveryKey, liveryId);
        newLiveries++;
      }

      let typeId = typeCache.get(train.type);
      if (!typeId) {
        typeId = await ctx.db.insert("types", { type_name: train.type });
        typeCache.set(train.type, typeId);
        newTypes++;
      }

      const slug = toSlug(train.operator);
      let operatorId = operatorCache.get(slug);
      if (!operatorId) {
        operatorId = await ctx.db.insert("operators", {
          display_name: train.operator,
          operator_names: [train.operator],
          operator_slugs: [slug],
          operator_codes: [toCode(train.operator)],
        });
        operatorCache.set(slug, operatorId);
        newOperators++;
      }

      const unit_number = train.fleetnumber;
      if (existingUnitNumbers.has(unit_number)) {
        skippedUnits++;
        continue;
      }

      await ctx.db.insert("units", {
        unit_number,
        unit_reg: "",
        type_id: typeId,
        operator_id: operatorId,
        livery_id: liveryId,
        search_text: unit_number,
      });
      existingUnitNumbers.add(unit_number);
      newUnits++;
    }

    return { newLiveries, newTypes, newOperators, newUnits, skippedUnits, totalProcessed: trains.length };
  },
});

export const importBulkUnits = mutation({
  args: {
    fleet: v.array(
      v.object({
        operator_id: v.number(),
        type: v.string(),
        livery_name: v.string(),
        livery_css: v.string(),
        fleet_numbers: v.array(v.number()),
      })
    ),
  },
  handler: async (ctx, { fleet }) => {
    const [existingUnits, allLiveries, allTypes, allOperators] = await Promise.all([
      ctx.db.query("units").collect(),
      ctx.db.query("liveries").collect(),
      ctx.db.query("types").collect(),
      ctx.db.query("operators").collect(),
    ]);

    const existingUnitNumbers = new Set(existingUnits.map((u) => u.unit_number));
    const liveryCache = new Map(allLiveries.map(l => [`${l.livery_name}||${l.css_class}`, l._id]));
    const typeCache = new Map(allTypes.map(t => [t.type_name, t._id]));
    
    const operatorCache = new Map<string, Id<"operators">>();
    for (const o of allOperators) {
      (o.operator_codes ?? []).forEach(c => operatorCache.set(c, o._id));
    }

    let newLiveries = 0;
    let newTypes = 0;
    let newOperators = 0;
    let newUnits = 0;
    let skippedUnits = 0;
    let totalProcessed = 0;

    for (const entry of fleet) {
      const liveryKey = `${entry.livery_name}||${entry.livery_css}`;
      let liveryId = liveryCache.get(liveryKey);
      if (!liveryId) {
        liveryId = await ctx.db.insert("liveries", {
          livery_name: entry.livery_name,
          css_class: entry.livery_css,
        });
        liveryCache.set(liveryKey, liveryId);
        newLiveries++;
      }

      let typeId = typeCache.get(entry.type);
      if (!typeId) {
        typeId = await ctx.db.insert("types", { type_name: entry.type });
        typeCache.set(entry.type, typeId);
        newTypes++;
      }

      const operatorCode = String(entry.operator_id);
      let operatorId = operatorCache.get(operatorCode);
      if (!operatorId) {
        operatorId = await ctx.db.insert("operators", {
          display_name: operatorCode,
          operator_names: [operatorCode],
          operator_slugs: [operatorCode],
          operator_codes: [operatorCode],
        });
        operatorCache.set(operatorCode, operatorId);
        newOperators++;
      }

      for (const fleetNumber of entry.fleet_numbers) {
        totalProcessed++;
        const unit_number = String(fleetNumber);
        if (existingUnitNumbers.has(unit_number)) {
          skippedUnits++;
          continue;
        }

        await ctx.db.insert("units", {
          unit_number,
          unit_reg: "",
          type_id: typeId,
          operator_id: operatorId,
          livery_id: liveryId,
          search_text: unit_number,
        });
        existingUnitNumbers.add(unit_number);
        newUnits++;
      }
    }

    return { newLiveries, newTypes, newOperators, newUnits, skippedUnits, totalProcessed };
  },
});