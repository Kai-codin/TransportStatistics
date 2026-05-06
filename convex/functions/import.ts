import { mutation } from "../_generated/server";
import { v } from "convex/values";

// -----------------------------
// Helper: stop type detection
// -----------------------------
function getStopTypeId(types: any[], properties: any): string | null {
  if (!properties) return null;

  const isRail = properties.railway === "station";
  const isTram = properties.railway === "tram_stop";
  const isBus =
    properties.bus === "yes" || properties.highway === "bus_stop";

  if (isRail) return types.find(t => t.name === "Rail Stations")?._id ?? null;
  if (isTram) return types.find(t => t.name === "Metro Station Platform")?._id ?? null;
  if (isBus) return types.find(t => t.name === "Bus Coach on street")?._id ?? null;

  return null;
}

// -----------------------------
// Helper: centroid
// -----------------------------
function getCentroid(geometry: any): [number, number] {
  if (!geometry) return [0, 0];

  if (geometry.type === "Point") {
    return [geometry.coordinates[0], geometry.coordinates[1]];
  }

  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const flat = geometry.coordinates.flat(Infinity);
    const lons: number[] = [];
    const lats: number[] = [];

    for (let i = 0; i < flat.length; i += 2) {
      lons.push(flat[i]);
      lats.push(flat[i + 1]);
    }

    return [
      lons.reduce((a, b) => a + b, 0) / lons.length,
      lats.reduce((a, b) => a + b, 0) / lats.length,
    ];
  }

  return [0, 0];
}

// -----------------------------
// Mutation
// -----------------------------
export const importBatch = mutation({
  args: { features: v.array(v.any()) },

  handler: async (ctx, args) => {
    const start = Date.now();

    const types = await ctx.db.query("stopTypes").collect();

    const busTypeId =
      types.find(t => t.code === "BUS")?._id ??
      types.find(t => t.name === "Bus Coach on street")?._id ??
      null;

    const railTypeId =
      types.find(t => t.code === "RAIL")?._id ??
      types.find(t => t.name === "Rail Stations")?._id ??
      null;

    console.log("[IMPORT] stopTypes:", types.map(t => ({
      name: t.name,
      code: t.code,
      id: t._id,
    })));

    console.log("[IMPORT] busTypeId:", busTypeId);
    console.log("[IMPORT] railTypeId:", railTypeId);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < args.features.length; i++) {
      const feature = args.features[i];

      try {
        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!feature || typeof feature !== "object") {
          console.warn("[SKIP] Not an object", feature);
          skipped++;
          continue;
        }

        const { atcoCode, lat, lon } = feature;

        if (!atcoCode) {
          console.warn("[SKIP] Missing atcoCode", feature);
          skipped++;
          continue;
        }

        if (lat == null || lon == null) {
          console.warn("[SKIP] Missing coordinates", { atcoCode, lat, lon });
          skipped++;
          continue;
        }

        const latNum = Number(lat);
        const lonNum = Number(lon);

        if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
          console.warn("[SKIP] Invalid coordinates", {
            atcoCode,
            lat,
            lon,
          });
          skipped++;
          continue;
        }

        // -----------------------------
        // STOP TYPE RESOLUTION
        // -----------------------------
        let stopTypeId = null;

        if (feature.stopTypeId === "rail_station_id") {
          stopTypeId = railTypeId;
        } else {
          // default everything else to bus
          stopTypeId = busTypeId;
        }

        if (!stopTypeId) {
          console.error("[SKIP] Missing stopTypeId mapping", {
            atcoCode,
            sourceType: feature.stopTypeId,
          });
          skipped++;
          continue;
        }

        // -----------------------------
        // BUILD DATA
        // -----------------------------
        const stopData = {
          name: feature.name ?? "Unknown",
          commonName: feature.commonName ?? feature.name ?? "Unknown",
          atcoCode: String(atcoCode),
          crsCode: feature.crsCode ?? undefined,
          tiplocCode: feature.tiplocCode ?? undefined,
          naptanCode: feature.naptanCode ?? undefined,
          stopTypeId,
          active: feature.active ?? true,
          hidden: feature.hidden ?? false,
          lat: latNum,
          lon: lonNum,
          indicator: feature.indicator ?? undefined,
        };

        // -----------------------------
        // UPSERT
        // -----------------------------
        const existing = await ctx.db
          .query("stops")
          .withIndex("by_atcoCode", q =>
            q.eq("atcoCode", stopData.atcoCode)
          )
          .unique();

        if (existing) {
          await ctx.db.patch(existing._id, stopData);
          updated++;
        } else {
          await ctx.db.insert("stops", stopData);
          inserted++;
        }

        // -----------------------------
        // HEARTBEAT LOG
        // -----------------------------
        if (i % 500 === 0 && i > 0) {
          console.log("[IMPORT PROGRESS]", {
            processed: i,
            inserted,
            updated,
            skipped,
          });
        }

      } catch (err) {
        console.error("[ERROR] Failed feature", {
          index: i,
          feature,
          error: err,
        });
        skipped++;
      }
    }

    const duration = Date.now() - start;

    console.log("[IMPORT COMPLETE]", {
      total: args.features.length,
      inserted,
      updated,
      skipped,
      durationMs: duration,
    });
  },
});