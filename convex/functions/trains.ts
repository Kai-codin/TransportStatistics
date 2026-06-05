import { action, mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { Doc } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

type trainDetailsSummaryDoc = Doc<"trainDetailsSummary">;

type SignalboxTrainRecord = {
  rid?: string | null;
  [key: string]: unknown;
};

function buildTrainDetailsSummary(train: Record<string, unknown>) {
  return {
    rid: train.rid as string,
    uid: typeof train.uid === "string" ? train.uid : null,
    headcode: typeof train.headcode === "string" ? train.headcode : null,
    train_operator: typeof train.train_operator === "string" ? train.train_operator : null,
    destination_name: typeof train.destination_name === "string" ? train.destination_name : null,
    origin_departure: typeof train.origin_departure === "string" ? train.origin_departure : null,
    unit_numbers: Array.isArray(train.unit_numbers) ? train.unit_numbers : undefined,
    updated_at: Date.now(),
  };
}

function getTrainDetailsLimit() {
  const raw = process.env.TRAIN_DETAILS_MAX_RECORDS;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

async function getTrainDetailsStats(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("trainDetailsStats")
    .withIndex("by_key", (q) => q.eq("key", "singleton"))
    .first();

  if (existing) return existing;

  const id = await ctx.db.insert("trainDetailsStats", {
    key: "singleton",
    count: 0,
  });

  return { _id: id, key: "singleton", count: 0 };
}

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
  args: { search: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    return await ctx.db
      .query("units")
      .withSearchIndex("search_units", (q) =>
        q.search("search_text", args.search)
      )
      .take(limit);
  },
});

async function getLatesttrainDetailsByIndex(
  ctx: QueryCtx,
  indexName: "by_uid" | "by_rid",
  field: "uid" | "rid",
  value: string,
) {
  // Use .first() to read only 1 document instead of all of them
  return await ctx.db
    .query("trainDetails")
    .withIndex(indexName, (q) => q.eq(field, value))
    .first();
}

export const getRidWithUID = query({
  args: { uid: v.string() },
  handler: async (ctx, args) => {
    const summary = await ctx.db
      .query("trainDetailsSummary")
      .withIndex("by_uid", (q) => q.eq("uid", args.uid))
      .first();

    if (summary) return summary;

    return await getLatesttrainDetailsByIndex(ctx, "by_uid", "uid", args.uid);
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
    // Upsert allocation and fetch trainDetails candidate in parallel
    const [existing, allRecords] = await Promise.all([
      ctx.db
        .query("trainAllocations")
        .withIndex("by_uid_date", (q) =>
          q.eq("uid", args.uid).eq("date", args.date)
        )
        .first(),
      ctx.db
        .query("trainDetails")
        .withIndex("by_uid", (q) => q.eq("uid", args.uid))
        .collect(),
    ]);

    const payload = {
      uid: args.uid,
      date: args.date,
      unit_numbers: args.unit_numbers,
      unit_allocation: args.unit_allocation,
      updated_at: Date.now(),
    };

    // Identify the matching trainDetails record from already-fetched results
    const match = allRecords.find((record) => {
      const departureDate =
        typeof record.origin_departure === "string" &&
        record.origin_departure.includes("T")
          ? record.origin_departure.split("T")[0]
          : null;
      return departureDate === args.date;
    });

    // Execute all writes in parallel
    await Promise.all([
      existing
        ? ctx.db.patch(existing._id, payload)
        : ctx.db.insert("trainAllocations", payload),
      match
        ? ctx.db.patch(match._id, { unit_numbers: args.unit_numbers })
        : Promise.resolve(),
    ]);
  },
});

export const backfillTrainDetailsSummary = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const BATCH_SIZE = 500;
    const cursor = args.cursor && args.cursor !== "null" ? args.cursor : null;

    const { page, continueCursor, isDone } = await ctx.db
      .query("trainDetails")
      .paginate({ cursor, numItems: BATCH_SIZE });

    if (page.length === 0) return { continueCursor, isDone, updated: 0 };

    // Batch-fetch all existing summaries for this page in parallel
    const summaries = page.map((r) =>
      buildTrainDetailsSummary(r as Record<string, unknown>)
    );

    const existingResults = await Promise.all(
      summaries.map((s) =>
        ctx.db
          .query("trainDetailsSummary")
          .withIndex("by_rid", (q) => q.eq("rid", s.rid))
          .first()
      )
    );

    // Execute all upserts in parallel
    await Promise.all(
      summaries.map((summary, i) => {
        const existing = existingResults[i];
        if (existing) {
          return ctx.db.patch(existing._id, summary);
        }
        return ctx.db.insert("trainDetailsSummary", summary);
      })
    );

    return { continueCursor, isDone, updated: page.length };
  },
});

// 1. READ: Fast, cheap local cache check
export const getDetailsForRids = query({
  args: { rids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const details = await Promise.all(
      args.rids.map((rid) =>
        ctx.db
          .query("trainDetailsSummary")
          .withIndex("by_rid", (q) => q.eq("rid", rid))
          .first()
      )
    );

    return details.reduce((acc, doc) => {
      if (doc) acc[doc.rid] = doc;
      return acc;
    }, {} as Record<string, trainDetailsSummaryDoc>);
  },
});

/**
 * Highly efficient pre-flight check for syncAllTrains.
 * Returns only the RIDs that already have records in the database.
 */
export const checkExistingRids = query({
  args: { rids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.rids.map((rid) =>
        ctx.db
          .query("ridIndex")
          .withIndex("by_rid", (q) => q.eq("rid", rid))
          .first()
      )
    );
    return results
      .map((doc, i) => (doc ? args.rids[i] : null))
      .filter((r): r is string => r !== null);
  },
});

// 2. WRITE: Batch insertion with strict "upsert" logic
export const savetrainDetailsBatch = mutation({
  args: {
    trains: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const validTrains = (args.trains as Record<string, unknown>[]).filter(
      (t) => typeof t.rid === "string" && t.rid.length > 0
    );
    if (validTrains.length === 0) return;

    const limit = getTrainDetailsLimit();
    const rids = validTrains.map((t) => t.rid as string);

    // Batch-fetch all three tables in parallel
    const [detailResults, summaryResults, ridIndexResults] = await Promise.all([
      Promise.all(
        rids.map((rid) =>
          ctx.db
            .query("trainDetails")
            .withIndex("by_rid", (q) => q.eq("rid", rid))
            .first()
        )
      ),
      Promise.all(
        rids.map((rid) =>
          ctx.db
            .query("trainDetailsSummary")
            .withIndex("by_rid", (q) => q.eq("rid", rid))
            .first()
        )
      ),
      Promise.all(
        rids.map((rid) =>
          ctx.db
            .query("ridIndex")
            .withIndex("by_rid", (q) => q.eq("rid", rid))
            .first()
        )
      ),
    ]);

    const existingDetails = new Map(
      detailResults
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .map((d) => [d.rid, d])
    );
    const existingSummaries = new Map(
      summaryResults
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => [s.rid, s])
    );
    const existingRidIndex = new Map(
      ridIndexResults
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => [r.rid, r])
    );

    const toInsert = validTrains.filter((t) => !existingDetails.has(t.rid as string));
    const toUpdate = validTrains.filter((t) => existingDetails.has(t.rid as string));

    // Handle eviction — delete from all three tables together
    if (limit !== null && toInsert.length > 0) {
      const stats = await getTrainDetailsStats(ctx);
      const evictionsNeeded = Math.max(0, stats.count + toInsert.length - limit);

      if (evictionsNeeded > 0) {
        const oldest = await ctx.db
          .query("trainDetails")
          .order("asc")
          .take(evictionsNeeded);

        const evictedRids = oldest.map((r) => r.rid);

        const [evictedSummaries, evictedRidIndexDocs] = await Promise.all([
          Promise.all(
            evictedRids.map((rid) =>
              ctx.db
                .query("trainDetailsSummary")
                .withIndex("by_rid", (q) => q.eq("rid", rid))
                .first()
            )
          ),
          Promise.all(
            evictedRids.map((rid) =>
              ctx.db
                .query("ridIndex")
                .withIndex("by_rid", (q) => q.eq("rid", rid))
                .first()
            )
          ),
        ]);

        await Promise.all([
          ...oldest.map((r) => ctx.db.delete(r._id)),
          ...evictedSummaries
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map((s) => ctx.db.delete(s._id)),
          ...evictedRidIndexDocs
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .map((r) => ctx.db.delete(r._id)),
        ]);

        const netChange = toInsert.length - oldest.length;
        await ctx.db.patch(stats._id, {
          count: Math.max(0, stats.count + netChange),
        });
      } else {
        await ctx.db.patch(stats._id, {
          count: stats.count + toInsert.length,
        });
      }
    }

    // All writes in parallel across all three tables
    await Promise.all([
      // trainDetails
      ...toInsert.map((train) =>
        ctx.db.insert("trainDetails", train as Parameters<typeof ctx.db.insert<"trainDetails">>[1])
      ),
      ...toUpdate.map((train) =>
        ctx.db.patch(existingDetails.get(train.rid as string)!._id, train)
      ),
      // trainDetailsSummary
      ...validTrains.map((train) => {
        const summary = buildTrainDetailsSummary(train);
        const existing = existingSummaries.get(summary.rid);
        return existing
          ? ctx.db.patch(existing._id, summary)
          : ctx.db.insert("trainDetailsSummary", summary);
      }),
      // ridIndex — only insert if not already present, never needs patching
      ...toInsert
        .filter((train) => !existingRidIndex.has(train.rid as string))
        .map((train) => ctx.db.insert("ridIndex", { rid: train.rid as string })),
    ]);
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

    // Check which RIDs we already have — using efficient existence check
    const CHUNK_SIZE = 1000;
    const knownRids = new Set<string>();
    
    for (let i = 0; i < rids.length; i += CHUNK_SIZE) {
      const chunk = rids.slice(i, i + CHUNK_SIZE);
      const existing = await ctx.runQuery(api.functions.trains.checkExistingRids, { rids: chunk });
      existing.forEach(rid => knownRids.add(rid));
    }

    const missing = rids.filter((rid) => !knownRids.has(rid));
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
    const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;

    const candidates = await ctx.db
      .query("trainDetails")
      .order("asc")
      .take(MAX_DELETES);

    const toDelete = candidates.filter((r) => r._creationTime < cutoff);
    if (toDelete.length === 0) return { deleted: 0, scanned: candidates.length };

    const evictedRids = toDelete.map((r) => r.rid);

    // Fetch ridIndex docs for evicted records in parallel with stats
    const [ridIndexDocs, stats] = await Promise.all([
      Promise.all(
        evictedRids.map((rid) =>
          ctx.db
            .query("ridIndex")
            .withIndex("by_rid", (q) => q.eq("rid", rid))
            .first()
        )
      ),
      getTrainDetailsStats(ctx),
    ]);

    await Promise.all([
      ...toDelete.map((r) => ctx.db.delete(r._id)),
      ...ridIndexDocs
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => ctx.db.delete(r._id)),
    ]);

    await ctx.db.patch(stats._id, {
      count: Math.max(0, stats.count - toDelete.length),
    });

    return { deleted: toDelete.length, scanned: candidates.length };
  },
});

export const backfillRidIndex = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { page, continueCursor, isDone } = await ctx.db
      .query("trainDetails")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });
      
    if (page.length === 0) return { continueCursor, isDone, inserted: 0 };

    // Check which rids already have a ridIndex entry
    const existingResults = await Promise.all(
      page.map((r) =>
        ctx.db
          .query("ridIndex")
          .withIndex("by_rid", (q) => q.eq("rid", r.rid))
          .first()
      )
    );

    const toInsert = page.filter((_, i) => existingResults[i] === null);

    await Promise.all(
      toInsert.map((r) => ctx.db.insert("ridIndex", { rid: r.rid }))
    );

    return { continueCursor, isDone, inserted: toInsert.length };
  },
});

export const cleanupOldtrainDetailsSummary = mutation({
  args: { maxDeletes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const MAX_DELETES = args.maxDeletes ?? 1000;
    const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;

    const candidates = await ctx.db
      .query("trainDetailsSummary")
      .order("asc")
      .take(MAX_DELETES);

    const toDelete = candidates.filter((r) => r._creationTime < cutoff);

    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((r) => ctx.db.delete(r._id)));
    }

    return { deleted: toDelete.length, scanned: candidates.length };
  },
});