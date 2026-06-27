import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import { getAllUserTrips } from "./userTrips";

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
        .withIndex("by_operator_slugs", (q) => q.eq("operator_slugs", [slug]))
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
      .withIndex("by_operator_slugs", (q) => q.eq("operator_slugs", [args.slug]))
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
    const trips = await getAllUserTrips(ctx, args.userId);
    return trips.map((t) => t.operator_slug);
  },
});

export const getUserRiddenOperators = query({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Doc<"operators">[]> => {
    const trips = await getAllUserTrips(ctx, args.userId);

    if (!trips.length) return [];

    const riddenSlugs = [
      ...new Set(
        trips.map((t) => t.operator_slug?.toLowerCase().trim()).filter(Boolean)
      ),
    ];

    // Single pass: build slug→op and code→op maps in memory.
    const allOps = await ctx.db.query("operators").collect();
    const slugToOp = new Map<string, Doc<"operators">>();
    const codeToOp = new Map<string, Doc<"operators">>();
    for (const op of allOps) {
      for (const slug of op.operator_slugs ?? []) {
        slugToOp.set(slug.toLowerCase(), op);
      }
      for (const code of op.operator_codes ?? []) {
        codeToOp.set(code.toLowerCase(), op);
      }
    }

    const results = new Map<string, Doc<"operators">>();
    for (const slug of riddenSlugs) {
      const op = slugToOp.get(slug) ?? codeToOp.get(slug);
      if (op) results.set(op._id, op);
    }

    return [...results.values()].sort((a, b) =>
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
