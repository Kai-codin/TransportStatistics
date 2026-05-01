import { mutation } from "../_generated/server";
import { v } from "convex/values";

// Helper to determine stop type based on OSM tags
function getStopTypeId(types: any[], properties: any): string | null {
  const isRail = properties.railway === "station";
  const isTram = properties.railway === "tram_stop";
  const isBus = properties.bus === "yes" || properties.highway === "bus_stop";
  
  if (isRail) return types.find(t => t.name === "Rail Stations")?._id;
  if (isTram) return types.find(t => t.name === "Metro Station Platform")?._id;
  if (isBus) return types.find(t => t.name === "Bus Coach on street")?._id;
  
  return null;
}

function getCentroid(geometry: any): [number, number] {
  if (geometry.type === "Point") return [geometry.coordinates[0], geometry.coordinates[1]];
  if (geometry.type === "MultiPolygon" || geometry.type === "Polygon") {
    const flat = geometry.coordinates.flat(Infinity);
    const lons = [], lats = [];
    for (let i = 0; i < flat.length; i += 2) {
      lons.push(flat[i]); lats.push(flat[i + 1]);
    }
    return [
      lons.reduce((a, b) => a + b, 0) / lons.length,
      lats.reduce((a, b) => a + b, 0) / lats.length
    ];
  }
  return [0, 0];
}

// convex/functions/import.ts

export const importBatch = mutation({
  args: { features: v.array(v.any()) },
  handler: async (ctx, args) => {
    const types = await ctx.db.query("stopTypes").collect();

    for (const feature of args.features) {
      const p = feature.properties;
      const atcoCode = p["naptan:AtcoCode"] ?? "UNKNOWN";
      
      // 1. Check if it exists using the new index
      const existing = await ctx.db
        .query("stops")
        .withIndex("by_atcoCode", (q) => q.eq("atcoCode", atcoCode))
        .unique();

      const stopTypeId = getStopTypeId(types, p);
      if (!stopTypeId) continue;

      const stopData = {
        name: p.name ?? "Unknown",
        commonName: p["naptan:CommonName"] ?? p.name ?? "Unknown",
        atcoCode: atcoCode,
        naptanCode: p["naptan:NaptanCode"],
        stopTypeId: stopTypeId as any,
        active: true,
        hidden: false,
        lat: getCentroid(feature.geometry)[1],
        lon: getCentroid(feature.geometry)[0],
        indicator: p["naptan:Indicator"] ?? p.local_ref,
      };

      // 2. Decide: Patch (update) or Insert
      if (existing) {
        await ctx.db.patch(existing._id, stopData);
      } else {
        await ctx.db.insert("stops", stopData);
      }
    }
  },
});