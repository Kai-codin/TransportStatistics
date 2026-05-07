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