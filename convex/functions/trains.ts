import { action, mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { api } from "../_generated/api";

export const backfillSearchText = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const BATCH_SIZE = 1000;

    const { page, continueCursor, isDone } = await ctx.db
      .query("units")
      .paginate({ cursor: args.cursor, numItems: BATCH_SIZE });

    await Promise.all(
      page.map((unit) =>
        ctx.db.patch(unit._id, {
          search_text: `${unit.unit_reg} ${unit.unit_number ?? ""}`.trim(),
        })
      )
    );

    return { continueCursor, isDone, updated: page.length };
  },
});

export const getUnitDetails = query({
  args: { unitIds: v.array(v.id("units")) },
  handler: async (ctx, args) => {
    // Fetch all units
    const units = await Promise.all(
      args.unitIds.map((id) => ctx.db.get(id))
    );
    const validUnits = units.filter((u) => u !== null);

    // Get unique IDs
    const typeIds = [...new Set(validUnits.map((u) => u.type_id))];
    const operatorIds = [...new Set(validUnits.map((u) => u.operator_id))];
    const liveryIds = [...new Set(validUnits.map((u) => u.livery_id))];

    // Fetch all related records in parallel
    const [types, operators, liveries] = await Promise.all([
      Promise.all(typeIds.map((id) => ctx.db.get(id as Id<"types">))),
      Promise.all(operatorIds.map((id) => ctx.db.get(id as Id<"operators">))),
      Promise.all(liveryIds.map((id) => ctx.db.get(id as Id<"liveries">))),
    ]);

    return {
      types: types.filter((t) => t !== null),
      operators: operators.filter((o) => o !== null),
      liveries: liveries.filter((l) => l !== null),
    };
  },
});

export const searchForUnits = query({
  args: { search: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("units")
      .withSearchIndex("search_units", (q) =>
        q.search("search_text", args.search)
      )
      .collect();
  },
});

export const getRidWithUID = query({
  args: { uid: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("trainDetails")
      .withIndex("by_uid", (q) => q.eq("uid", args.uid))
      .unique(); // Returns the document or null if not found

    return record;
  }
});

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

export const syncAllTrains = action({
  args: {},
  handler: async (ctx) => {
    const res = await fetch("https://map-api.production.signalbox.io/api/locations");
    if (!res.ok) {
      console.error(`Signalbox fetch failed: ${res.status}`);
      return;
    }

    const data = await res.json();
    const allTrains: any[] = data.train_locations ?? [];
    const rids = [
      ...new Set(allTrains.map((t: any) => t.rid).filter(Boolean)),
    ] as string[];

    if (!rids.length) return;

    // Check which RIDs we already have — parallel chunks
    const CHUNK_SIZE = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < rids.length; i += CHUNK_SIZE) {
      chunks.push(rids.slice(i, i + CHUNK_SIZE));
    }

    const existingMaps = await Promise.all(
      chunks.map((chunk) =>
        ctx.runQuery(api.functions.trains.getDetailsForRids, { rids: chunk })
      )
    );
    const known = new Set(existingMaps.flatMap((m) => Object.keys(m)));
    const missing = rids.filter((rid) => !known.has(rid));

    if (!missing.length) return;

    // Fetch missing in parallel batches
    const PARALLEL = 10;
    const validData: any[] = [];

    for (let i = 0; i < missing.length; i += PARALLEL) {
      const batch = missing.slice(i, i + PARALLEL);
      const settled = await Promise.allSettled(
        batch.map((rid) =>
          fetch(`https://map-api.production.signalbox.io/api/train-information/${rid}`)
        )
      );

      for (const result of settled) {
        if (result.status === "rejected") continue;
        if (result.value.status === 429) {
          console.warn("Rate limited, stopping early");
          // Save what we have so far, continue next cron tick
          break;
        }
        if (result.value.ok) {
          validData.push(await result.value.json());
        }
      }

      if (i + PARALLEL < missing.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (validData.length > 0) {
      const SAVE_CHUNK = 100;
      for (let i = 0; i < validData.length; i += SAVE_CHUNK) {
        await ctx.runMutation(api.functions.trains.saveTrainDetailsBatch, {
          trains: validData.slice(i, i + SAVE_CHUNK),
        });
      }
    }
  },
});