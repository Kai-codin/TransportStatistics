import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";

interface BusTimesOperator {
  id: number;
  noc: string;
  slug: string;
  name: string;
  aka: string;
  vehicle_mode: string;
  region_id: string;
  url: string;
  twitter: string;
}

interface BusTimesResponse {
  next: string | null;
  previous: string | null;
  results: BusTimesOperator[];
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getAllOperators = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("operators").collect();
  },
});

export const getOperatorsBySlugs = query({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, args) => {
    const results: Doc<"operators">[] = [];
    for (const slug of args.slugs) {
      const op = await ctx.db
        .query("operators")
        .withIndex("by_operator_slugs", (q) => q.eq("operator_slugs", slug as any))
        .unique();
      if (op) results.push(op);
    }
    return results;
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const upsertOperator = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    noc: v.string(),
    bustimes_id: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("operators")
      .withIndex("by_operator_slugs", (q) => q.eq("operator_slugs", args.slug as any))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        display_name: args.name,
        operator_names: Array.from(new Set([...(existing.operator_names ?? []), args.name])),
        operator_codes: Array.from(new Set([...(existing.operator_codes ?? []), args.noc])),
        bustimes_id: args.bustimes_id ?? existing.bustimes_id,
      });
      return existing._id;
    }

    return await ctx.db.insert("operators", {
      display_name: args.name,
      operator_names: [args.name],
      operator_slugs: [args.slug],
      operator_codes: [args.noc],
      bustimes_id: args.bustimes_id,
    });
  },
});

// ─── Actions ─────────────────────────────────────────────────────────────────

export const getUserTripSlugs = query({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<string[]> => {
    const trips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.userId))
      .collect();
    return trips.map((t) => t.operator_slug);
  },
});

export const getUserRiddenOperators = query({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Doc<"operators">[]> => {
    const trips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.userId))
      .collect();

    if (!trips.length) return [];

    // Clean and normalize slugs from trip logs
    const riddenSlugs = [...new Set(
      trips.map((t) => t.operator_slug?.toLowerCase().trim()).filter(Boolean)
    )];

    const results: Doc<"operators">[] = [];
    
    // We'll fetch all operators once to do a manual "in-memory" match 
    // as a fallback if the index match is being finicky with array types.
    const allOps = await ctx.db.query("operators").collect();

    for (const slug of riddenSlugs) {
      // 1. Try the optimized index path first
      let op = await ctx.db
        .query("operators")
        .withIndex("by_operator_slugs", (q) => q.eq("operator_slugs", slug as any))
        .unique();
      
      // 2. Fallback: Manual search in the local list (prevents index/type mismatches)
      if (!op) {
        op = allOps.find(o => 
          o.operator_slugs?.some(s => s.toLowerCase() === slug)
        ) ?? null;
      }
      
      if (op && !results.some(r => r._id === op._id)) {
        results.push(op);
      }
    }

    return results.sort((a, b) => 
      (a.display_name ?? "").localeCompare(b.display_name ?? "")
    );
  },
});

export const syncOperatorsPage = action({
  args: { pageUrl: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ nextUrl: string | null; count: number; saved: number }> => {
    const url =
      args.pageUrl ??
      "https://bustimes.org/api/operators/?name__icontains=&name=&slug=&vehicle_mode=&region=";

    const response = await fetch(url);
    const data: BusTimesResponse = await response.json();
    const results = data.results ?? [];

    for (const op of results) {
      await ctx.runMutation(api.functions.operators.upsertOperator, {
        bustimes_id: op.id,
        name: op.name,
        slug: op.slug,
        noc: op.noc || "UNK",
      });
    }

    return { nextUrl: data.next, count: results.length, saved: results.length };
  },
});