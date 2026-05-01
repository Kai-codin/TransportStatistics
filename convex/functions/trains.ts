import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

// 1. READ: Fast, cheap local cache check
export const getDetailsForRids = query({
  args: { rids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const details = await Promise.all(
      args.rids.map((rid) =>
        ctx.db.query("trainDetails").withIndex("by_rid", (q) => q.eq("rid", rid)).unique()
      )
    );

    return details.reduce((acc, curr) => {
      if (curr) acc[curr.rid] = curr;
      return acc;
    }, {} as Record<string, any>);
  },
});

// 2. WRITE: Batch insertion with "upsert-style" logic
export const saveTrainDetailsBatch = mutation({
  args: { 
    trains: v.array(v.any()) // Using 'any' here for flexibility, or define your schema object
  },
  handler: async (ctx, args) => {
    for (const train of args.trains) {
      const existing = await ctx.db
        .query("trainDetails")
        .withIndex("by_rid", (q) => q.eq("rid", train.rid))
        .unique();

      if (!existing) {
        await ctx.db.insert("trainDetails", train);
      }
    }
  },
});

// 3. SYNC: The only action needed. Handles external fetching and saving in one go.
export const syncBatch = action({
  args: { rids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.rids.map(async (rid) => {
        try {
          const response = await fetch(`https://map-api.production.signalbox.io/api/train-information/${rid}`);
          return response.ok ? await response.json() : null;
        } catch { return null; }
      })
    );

    const validData = results.filter((data) => data !== null);
    if (validData.length > 0) {
      await ctx.runMutation(api.functions.trains.saveTrainDetailsBatch, { trains: validData });
    }
  },
});