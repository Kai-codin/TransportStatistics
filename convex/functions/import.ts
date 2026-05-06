import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const importBatch = mutation({
  args: { features: v.array(v.any()) },
  handler: async (ctx, args) => {
    // 1. Quick Data Sanitization (Filter bad data first)
    const validFeatures = args.features.filter(f => f?.atcoCode && f.lat != null && f.lon != null);
    if (validFeatures.length === 0) return { inserted: 0, updated: 0, skipped: args.features.length };

    // 2. Fetch dependencies ONCE
    const types = await ctx.db.query("stopTypes").collect();
    const busTypeId = types.find(t => t.code === "BUS")?._id ?? types.find(t => t.name === "Bus Coach on street")?._id;
    const railTypeId = types.find(t => t.code === "RAIL")?._id ?? types.find(t => t.name === "Rail Stations")?._id;

    // 3. Bulk Query (SAFE because we limited the chunk size to ~50-100)
    const allStops = await ctx.db.query("stops").collect();
    const stopMap = new Map(allStops.map(s => [s.atcoCode, s]));

    // 4. Batch Operations
    let inserted = 0;
    let updated = 0;

    for (const feature of validFeatures) {
      const stopTypeId = feature.stopTypeId === "rail_station_id" ? railTypeId : busTypeId;
      
      // Skip if type not found
      if (!stopTypeId) continue;

      const stopData = {
        name: feature.name ?? "Unknown",
        commonName: feature.commonName ?? feature.name ?? "Unknown",
        atcoCode: String(feature.atcoCode),
        crsCode: feature.crsCode,
        tiplocCode: feature.tiplocCode,
        naptanCode: feature.naptanCode,
        stopTypeId,
        active: feature.active ?? true,
        hidden: feature.hidden ?? false,
        lat: Number(feature.lat),
        lon: Number(feature.lon),
        indicator: feature.indicator,
      };

      const existing = stopMap.get(stopData.atcoCode);

      if (existing) {
        // Only patch if something actually changed
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

    return { inserted, updated, skipped: args.features.length - validFeatures.length };
  },
});