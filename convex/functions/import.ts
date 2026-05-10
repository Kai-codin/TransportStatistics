import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

export const importBatch = mutation({
  args: { features: v.array(v.any()) },
  handler: async (ctx, args) => {
    // 1. Sanitization — filter bad coords, missing type, and null naptanCode strings
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

    // 2. Look up ONLY the stops we need by atcoCode index (no full table scan)
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
        // v.optional() means undefined = omitted, null is NOT valid
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

      await ctx.db.insert('tripLogs', {
        user: args.userId,
        on_trip_with: Array.isArray(trip.on_trip_with)
          ? trip.on_trip_with
          : Array.isArray(trip.on_trip_usernames)
          ? trip.on_trip_usernames
          : [],
        logged_at: Date.now(),
        service_number: cleanString(trip.service_number) || cleanString(trip.headcode) || 'N/A',
        operator: trip.operator ?? 'Unknown',
        operator_slug: (trip.operator ?? 'unknown').toLowerCase().replace(/\s+/g, '-'),
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
        notes: cleanString(trip.notes),
      });
    }
  },
});

interface TrainEntry {
  operator: string;
  fleetnumber: string;
  type: string;
  livery: {
    name: string;
    css: string;
  };
}

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
    // ── Pre-fetch all existing unit numbers in one query ──────────────
    // This avoids one DB read per unit in the loop below.
    const existingUnits = await ctx.db.query("units").collect();
    const existingUnitNumbers = new Set(
      existingUnits.map((u) => u.unit_number).filter(Boolean)
    );

    // ── Pre-fetch all existing liveries, types, operators ─────────────
    const [allLiveries, allTypes, allOperators] = await Promise.all([
      ctx.db.query("liveries").collect(),
      ctx.db.query("types").collect(),
      ctx.db.query("operators").collect(),
    ]);

    // ── Seed in-memory caches from pre-fetched data ───────────────────
    const liveryCache = new Map<string, string>();
    for (const l of allLiveries) {
      liveryCache.set(`${l.livery_name}||${l.css_class}`, l._id);
    }

    const typeCache = new Map<string, string>();
    for (const t of allTypes) {
      typeCache.set(t.type_name, t._id);
    }

    const operatorCache = new Map<string, string>();
    for (const o of allOperators) {
      operatorCache.set(o.operator_slug, o._id);
    }

    let newLiveries = 0;
    let newTypes = 0;
    let newOperators = 0;
    let newUnits = 0;
    let skippedUnits = 0;

    for (const train of trains as TrainEntry[]) {
      // ── 1. Resolve / create livery ──────────────────────────────────
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

      // ── 2. Resolve / create type ────────────────────────────────────
      let typeId = typeCache.get(train.type);

      if (!typeId) {
        typeId = await ctx.db.insert("types", { type_name: train.type });
        typeCache.set(train.type, typeId);
        newTypes++;
      }

      // ── 3. Resolve / create operator ────────────────────────────────
      const slug = toSlug(train.operator);
      let operatorId = operatorCache.get(slug);

      if (!operatorId) {
        operatorId = await ctx.db.insert("operators", {
          operator_name: train.operator,
          operator_slug: slug,
          operator_code: toCode(train.operator),
        });
        operatorCache.set(slug, operatorId);
        newOperators++;
      }

      // ── 4. Resolve / create unit ────────────────────────────────────
      const unit_number = train.fleetnumber;

      if (existingUnitNumbers.has(unit_number)) {
        skippedUnits++;
        continue;
      }

      // its a train it will never have a unit reg
      const unitReg = ``;
      await ctx.db.insert("units", {
        unit_number,
        unit_reg: unitReg,
        type_id: typeId,
        operator_id: operatorId,
        livery_id: liveryId,
        search_text: unit_number,
      });
      existingUnitNumbers.add(unit_number); // prevent duplicates within this batch
      newUnits++;
    }

    return {
      newLiveries,
      newTypes,
      newOperators,
      newUnits,
      skippedUnits,
      totalProcessed: trains.length,
    };
  },
});



interface FleetEntry {
  operator_id: number;
  type: string;
  livery_name: string;
  livery_css: string;
  fleet_numbers: number[];
}

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
    // ── Pre-fetch everything upfront to stay under the 4096 read limit ──
    const [existingUnits, allLiveries, allTypes, allOperators] = await Promise.all([
      ctx.db.query("units").collect(),
      ctx.db.query("liveries").collect(),
      ctx.db.query("types").collect(),
      ctx.db.query("operators").collect(),
    ]);

    const existingUnitNumbers = new Set(
      existingUnits.map((u) => u.unit_number).filter(Boolean)
    );

    const liveryCache = new Map<string, string>(); // "name||css" → _id
    for (const l of allLiveries) {
      liveryCache.set(`${l.livery_name}||${l.css_class}`, l._id);
    }

    const typeCache = new Map<string, string>(); // type_name → _id
    for (const t of allTypes) {
      typeCache.set(t.type_name, t._id);
    }

    // Keyed by operator_code (the old numeric ID stored as string)
    const operatorCache = new Map<string, string>(); // operator_code → _id
    for (const o of allOperators) {
      operatorCache.set(o.operator_code, o._id);
    }

    let newLiveries = 0;
    let newTypes = 0;
    let newOperators = 0;
    let newUnits = 0;
    let skippedUnits = 0;
    let totalProcessed = 0;

    for (const entry of fleet as FleetEntry[]) {
      // ── 1. Resolve / create livery ──────────────────────────────────
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

      // ── 2. Resolve / create type ────────────────────────────────────
      let typeId = typeCache.get(entry.type);

      if (!typeId) {
        typeId = await ctx.db.insert("types", { type_name: entry.type });
        typeCache.set(entry.type, typeId);
        newTypes++;
      }

      // ── 3. Resolve / create operator by old numeric ID ──────────────
      const operatorCode = String(entry.operator_id);
      let operatorId = operatorCache.get(operatorCode);

      if (!operatorId) {
        operatorId = await ctx.db.insert("operators", {
          operator_name: operatorCode,
          operator_slug: operatorCode,
          operator_code: operatorCode,
        });
        operatorCache.set(operatorCode, operatorId);
        newOperators++;
      }

      // ── 4. Loop over each fleet number and resolve / create unit ────
      for (const fleetNumber of entry.fleet_numbers) {
        totalProcessed++;
        const unit_number = String(fleetNumber);

        if (existingUnitNumbers.has(unit_number)) {
          skippedUnits++;
          continue;
        }

        await ctx.db.insert("units", {
          unit_number,
          unit_reg: ``, // No unit reg its a train
          type_id: typeId,
          operator_id: operatorId,
          livery_id: liveryId,
          search_text: unit_number,
        });
        existingUnitNumbers.add(unit_number);
        newUnits++;
      }
    }

    return {
      newLiveries,
      newTypes,
      newOperators,
      newUnits,
      skippedUnits,
      totalProcessed,
    };
  },
});