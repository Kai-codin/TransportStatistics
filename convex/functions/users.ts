import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

function normalizeUsername(username: string | null | undefined) {
  if (typeof username !== "string") {
    return null;
  }

  const trimmed = username.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const getByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .unique();
  },
});

export const upsertFromClerk = mutation({
  args: {
    clerkId: v.string(),
    username: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const username = normalizeUsername(args.username);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (existing) {
      if (existing.username !== username) {
        await ctx.db.patch(existing._id, { username });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkId: args.clerkId,
      username,
    });
  },
});

export const deleteByClerkId = mutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);
    return existing._id;
  },
});
