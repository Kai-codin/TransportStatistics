import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { TableNames } from "../_generated/dataModel";

export const createEditRequest = mutation({
  args: {
    table: v.string(),
    recordId: v.string(),
    from: v.any(),
    to: v.any(),
    userReason: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("You must be logged in to request changes.");

    return await ctx.db.insert("editRequests", {
      userId: identity.subject,
      userEmail: identity.email ?? "Unknown",
      table: args.table,
      recordId: args.recordId,
      from: args.from,
      to: args.to,
      status: "pending",
      userReason: args.userReason,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const getRecordByTableAndId = query({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const targetTable = args.table as TableNames;
    const targetId = ctx.db.normalizeId(targetTable, args.id);
    if (!targetId) return null;
    return await ctx.db.get(targetId);
  },
});