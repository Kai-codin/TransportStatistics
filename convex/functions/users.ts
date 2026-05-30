import type { UserIdentity } from "convex/server";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";

function usernameFromIdentity(identity: UserIdentity) {
  return (
    identity.preferredUsername ||
    identity.nickname ||
    identity.name ||
    identity.email ||
    identity.subject
  );
}

async function upsertUserRecord(ctx: MutationCtx, clerkId: string, username: string) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .first();

  if (existing) {
    if (existing.username !== username) {
      await ctx.db.patch(existing._id, { username });
    }

    return existing._id;
  }

  return await ctx.db.insert("users", {
    clerkId,
    username,
  });
}

function validateSyncSecret(syncSecret: string) {
  const expectedSecret = process.env.CLERK_CONVEX_SYNC_SECRET;

  if (!expectedSecret || syncSecret !== expectedSecret) {
    throw new Error("Invalid Clerk user sync secret.");
  }
}

export async function ensureUserRecord(
  ctx: MutationCtx,
  identity: UserIdentity,
  username = usernameFromIdentity(identity),
) {
  return await upsertUserRecord(ctx, identity.subject, username);
}

export const syncCurrentUser = mutation({
  args: {
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("You must be signed in to sync your user record.");
    }

    return await ensureUserRecord(ctx, identity, args.username);
  },
});

export const upsertFromClerkWebhook = mutation({
  args: {
    clerkId: v.string(),
    username: v.string(),
    syncSecret: v.string(),
  },
  handler: async (ctx, args) => {
    validateSyncSecret(args.syncSecret);

    return await upsertUserRecord(ctx, args.clerkId, args.username);
  },
});

export const deleteFromClerkWebhook = mutation({
  args: {
    clerkId: v.string(),
    syncSecret: v.string(),
  },
  handler: async (ctx, args) => {
    validateSyncSecret(args.syncSecret);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .first();

    if (!existing) return null;

    await ctx.db.delete(existing._id);

    return existing._id;
  },
});
