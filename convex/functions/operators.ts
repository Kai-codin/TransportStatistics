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
        .withIndex("by_operator_slug", (q) => q.eq("operator_slug", slug))
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
      .withIndex("by_operator_slug", (q) => q.eq("operator_slug", args.slug))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        operator_name: args.name,
        operator_code: args.noc,
      });
      return existing._id;
    }

    return await ctx.db.insert("operators", {
      operator_name: args.name,
      operator_slug: args.slug,
      operator_code: args.noc,
      bustimes_id: args.bustimes_id,
    });
  },
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function fetchFromBusTimes(
  slug: string,
): Promise<BusTimesOperator | null> {
  const nameQuery = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("+");

  const slugRes = await fetch(
    `https://bustimes.org/api/operators/?slug=${encodeURIComponent(slug)}`,
  );
  const slugData: BusTimesResponse = await slugRes.json();
  if (slugData.results?.length > 0) return slugData.results[0];

  const nameRes = await fetch(
    `https://bustimes.org/api/operators/?name=${nameQuery}`,
  );
  const nameData: BusTimesResponse = await nameRes.json();
  if (nameData.results?.length > 0) return nameData.results[0];

  const partialRes = await fetch(
    `https://bustimes.org/api/operators/?name__icontains=${nameQuery}`,
  );
  const partialData: BusTimesResponse = await partialRes.json();
  if (partialData.results?.length > 0) return partialData.results[0];

  return null;
}

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
    // Step 1: get all trip slugs
    const trips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.userId))
      .collect();

    if (!trips.length) return [];

    const riddenSlugs = [...new Set(trips.map((t) => t.operator_slug))];

    // Step 2: fetch operators in one pass — no round-trips
    const ops: Doc<"operators">[] = [];
    for (const slug of riddenSlugs) {
      const op = await ctx.db
        .query("operators")
        .withIndex("by_operator_slug", (q) => q.eq("operator_slug", slug))
        .unique();
      if (op) ops.push(op);
    }

    // Sort here so the API route doesn't have to
    return ops.sort((a, b) =>
      a.operator_name.localeCompare(b.operator_name)
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
