import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { Id } from "../_generated/dataModel";

type Direction = "asc" | "desc";

type FilterSpec = { field: string; value: unknown };

type SortSpec = { field: string; direction: Direction };

const ADMIN_TABLES = [
  "stops",
  "stopTypes",
  "trainDetails",
  "trainAllocations",
  "units",
  "liveries",
  "types",
  "operators",
  "historicalRoutes",
  "tripLogs",
] as const;

const SEARCH_INDEXES: Record<string, string[]> = {
  units: ["search_units"],
};

function assertTable(table: string) {
  if (!ADMIN_TABLES.includes(table as (typeof ADMIN_TABLES)[number])) {
    throw new Error(`Table not allowed: ${table}`);
  }
}

async function assertAdmin(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  const allowList = (process.env.ADMIN_SUBJECTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowList.length > 0 && !allowList.includes(identity.subject)) {
    throw new Error("Forbidden");
  }
}

function applyFilters<T extends { filter: (fn: any) => T }>(query: T, filters?: FilterSpec[]) {
  if (!filters || filters.length === 0) return query;
  let next = query;
  for (const filter of filters) {
    next = next.filter((q: any) => q.eq(q.field(filter.field), filter.value));
  }
  return next;
}

function sortRecords(records: any[], sort: SortSpec) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...records].sort((a, b) => {
    const av = a?.[sort.field];
    const bv = b?.[sort.field];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return av > bv ? direction : -direction;
    }
    const as = String(av);
    const bs = String(bv);
    return as.localeCompare(bs) * direction;
  });
}

export const list = query({
  args: {
    table: v.string(),
    search: v.optional(v.string()),
    searchIndex: v.optional(v.string()),
    searchField: v.optional(v.string()),
    filters: v.optional(v.array(v.object({ field: v.string(), value: v.any() }))),
    sort: v.optional(
      v.object({
        field: v.string(),
        direction: v.union(v.literal("asc"), v.literal("desc")),
      })
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    assertTable(args.table);

    const allowedSearchIndexes = SEARCH_INDEXES[args.table] ?? [];
    const useSearch =
      args.search &&
      args.searchIndex &&
      args.searchField &&
      allowedSearchIndexes.includes(args.searchIndex);

    let queryRef: any = ctx.db.query(args.table as any);

    if (useSearch) {
      queryRef = ctx.db
        .query(args.table as any)
        .withSearchIndex(args.searchIndex!, (q: any) => q.search(args.searchField!, args.search!));
    }

    queryRef = applyFilters(queryRef, args.filters as FilterSpec[] | undefined);

    if (args.sort) {
      const all = await queryRef.collect();
      const sorted = sortRecords(all, args.sort);
      const offset = args.paginationOpts?.cursor
        ? Number.parseInt(String(args.paginationOpts.cursor), 10) || 0
        : 0;
      const numItems = args.paginationOpts?.numItems ?? 25;
      const page = sorted.slice(offset, offset + numItems);
      const nextOffset = offset + numItems;
      const isDone = nextOffset >= sorted.length;
      return {
        page,
        isDone,
        continueCursor: isDone ? null : String(nextOffset),
      };
    }

    return await queryRef.paginate(args.paginationOpts);
  },
});

export const get = query({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    assertTable(args.table);
    return await ctx.db.get(args.id as Id<any>);
  },
});

export const getByIds = query({
  args: { table: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    assertTable(args.table);
    const records = await Promise.all(
      args.ids.map((id) => ctx.db.get(id as Id<any>))
    );
    return records.filter(Boolean);
  },
});

export const create = mutation({
  args: { table: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    assertTable(args.table);
    const payload = { ...(args.data ?? {}) };
    delete payload._id;
    delete payload._creationTime;
    const id = await ctx.db.insert(args.table as any, payload);
    return id;
  },
});

export const update = mutation({
  args: { table: v.string(), id: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    assertTable(args.table);
    const payload = { ...(args.data ?? {}) };
    delete payload._id;
    delete payload._creationTime;
    await ctx.db.patch(args.id as Id<any>, payload);
  },
});

export const remove = mutation({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    assertTable(args.table);
    await ctx.db.delete(args.id as Id<any>);
  },
});
