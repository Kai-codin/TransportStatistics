import { action, mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { Doc } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

type trainDetailsDoc = Doc<"trainDetails">;

type SignalboxTrainRecord = {
  rid?: string | null;
  [key: string]: unknown;
};

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

async function getLatesttrainDetailsByIndex(
  ctx: QueryCtx,
  indexName: "by_uid" | "by_rid",
  field: "uid" | "rid",
  value: string,
) {
  const records = await ctx.db
    .query("trainDetails")
    .withIndex(indexName, (q) => q.eq(field, value))
    .collect();

  if (records.length === 0) {
    return { latest: null, duplicates: [] as typeof records };
  }

  const sorted = [...records].sort((a, b) => b._creationTime - a._creationTime);
  return {
    latest: sorted[0],
    duplicates: sorted.slice(1),
  };
}

export const getRidWithUID = query({
  args: { uid: v.string() },
  handler: async (ctx, args) => {
    const { latest } = await getLatesttrainDetailsByIndex(ctx, "by_uid", "uid", args.uid);
    return latest;
  }
});

export const getAllocationByUidDate = query({
  args: { uid: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("trainAllocations")
      .withIndex("by_uid_date", (q) => q.eq("uid", args.uid).eq("date", args.date))
      .first();
    return record ?? null;
  },
});

export const saveAllocationByUidDate = mutation({
  args: {
    uid: v.string(),
    date: v.string(),
    unit_numbers: v.array(v.string()),
    unit_allocation: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("trainAllocations")
      .withIndex("by_uid_date", (q) => q.eq("uid", args.uid).eq("date", args.date))
      .first();

    const payload = {
      uid: args.uid,
      date: args.date,
      unit_numbers: args.unit_numbers,
      unit_allocation: args.unit_allocation,
      updated_at: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("trainAllocations", payload);
    }

    const records = await ctx.db
      .query("trainDetails")
      .withIndex("by_uid", (q) => q.eq("uid", args.uid))
      .collect();

    const match = records.find((record) => {
      const departureDate =
        typeof record.origin_departure === "string" && record.origin_departure.includes("T")
          ? record.origin_departure.split("T")[0]
          : null;
      return departureDate === args.date;
    });

    if (match) {
      await ctx.db.patch(match._id, {
        unit_numbers: args.unit_numbers,
      });
    }
  },
});

// 1. READ: Fast, cheap local cache check
export const getDetailsForRids = query({
  args: { rids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const details = await Promise.all(
      args.rids.map((rid) =>
        getLatesttrainDetailsByIndex(ctx, "by_rid", "rid", rid)
      )
    );

    return details.reduce((acc, curr) => {
      if (curr.latest) acc[curr.latest.rid] = curr.latest;
      return acc;
    }, {} as Record<string, trainDetailsDoc>);
  },
});

// 2. WRITE: Batch insertion with "upsert-style" logic
export const savetrainDetailsBatch = mutation({
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
        .collect();

      const sortedExisting = [...existing].sort((a, b) => b._creationTime - a._creationTime);
      const record = sortedExisting[0] ?? null;

      if (sortedExisting.length > 1) {
        await Promise.all(sortedExisting.slice(1).map((duplicate) => ctx.db.delete(duplicate._id)));
      }

      if (!record) {
        await ctx.db.insert("trainDetails", train);
      } else {
        // Optional: Patch/Update if the data is stale
        await ctx.db.patch(record._id, train);
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
    const validData: SignalboxTrainRecord[] = [];

    for (const rid of args.rids) {
      try {
        const response = await fetch(`https://map-api.production.signalbox.io/api/train-information/${rid}`);
        
        if (response.ok) {
          validData.push(await response.json() as SignalboxTrainRecord);
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
      await ctx.runMutation(api.functions.trains.savetrainDetailsBatch, { trains: validData });
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

    const data = (await res.json()) as { train_locations?: SignalboxTrainRecord[] };
    const allTrains: SignalboxTrainRecord[] = data.train_locations ?? [];
    const rids = [
      ...new Set(allTrains.map((t) => t.rid).filter((rid): rid is string => Boolean(rid))),
    ] as string[];

    if (!rids.length) return;

    // Check which RIDs we already have — parallel chunks
    const CHUNK_SIZE = 1000;
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
    const validData: SignalboxTrainRecord[] = [];

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
        await ctx.runMutation(api.functions.trains.savetrainDetailsBatch, {
          trains: validData.slice(i, i + SAVE_CHUNK),
        });
      }
    }
  },
});

export const cleanupOldtrainDetails = mutation({
  args: { maxDeletes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const MAX_DELETES = args.maxDeletes ?? 1000;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const { page } = await ctx.db
      .query("trainDetails")
      .paginate({ cursor: null, numItems: 100 });

    let deleted = 0;
    for (const record of page) {
      if (record._creationTime < cutoff) {
        await ctx.db.delete(record._id);
        deleted += 1;
        if (deleted >= MAX_DELETES) break;
      }
    }

    return { deleted, scanned: page.length };
  },
});