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
    trains: v.array(v.any()) 
  },
  handler: async (ctx, args) => {
    for (const train of args.trains) {
      console.log(`Saving train details for RID: ${train.rid}`); // Debug log
      // Validate that we actually have a rid before trying to save
      if (!train.rid) {
        console.warn("Attempted to save train without RID:", train);
        continue; 
      }

      const existing = await ctx.db
        .query("trainDetails")
        .withIndex("by_rid", (q) => q.eq("rid", train.rid))
        .unique();

      if (!existing) {
        await ctx.db.insert("trainDetails", train);
      } else {
        // Optional: Patch/Update if the data is stale
        await ctx.db.patch(existing._id, train);
      }
    }
  },
});

// 3. SYNC: The only action needed. Handles external fetching and saving in one go.
export const syncBatch = action({
  args: { rids: v.array(v.string()) },
  handler: async (ctx, args) => {
    // 1. Helper to sleep between requests
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const validData = [];

    for (const rid of args.rids) {
      try {
        const response = await fetch(`https://map-api.production.signalbox.io/api/train-information/${rid}`);
        
        if (response.ok) {
          validData.push(await response.json());
        } else if (response.status === 429) {
//          console.warn(`Rate limited for RID ${rid}. Backing off...`);
          // If we hit a 429, wait longer before continuing
          await sleep(2000); 
        } else {
          //console.warn(`Fetch failed for ${rid}: ${response.status}`);
        }
      } catch (e) {
        console.error(`Fetch error for ${rid}:`, e);
      }

      // 2. Throttle: 250ms delay = 4 requests per second
      await sleep(250); 
    }

    if (validData.length > 0) {
      await ctx.runMutation(api.functions.trains.saveTrainDetailsBatch, { trains: validData });
    }
  },
});