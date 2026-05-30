import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { TableNames } from "../_generated/dataModel";
import { ensureUserRecord } from "./users";

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

    await ensureUserRecord(ctx, identity);

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

// Append these to your existing file:

export const getEditRequests = query({
  args: {},
  handler: async (ctx) => {
    // Optional: Add admin role checks here if you have an admin flag on users
    return await ctx.db.query("editRequests").order("desc").collect();
  },
});

export const approveEditRequest = mutation({
  args: { id: v.id("editRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Edit request not found");
    if (request.status !== "pending") throw new Error("Request has already been processed");

    const targetTable = request.table as TableNames;
    const targetId = ctx.db.normalizeId(targetTable, request.recordId);
    if (!targetId) throw new Error("Invalid target record ID");

    // 1. Apply the modified fields ("to" snapshot) directly to the destination document
    await ctx.db.patch(targetId, request.to);

    // 2. Update status of the edit request to approved
    await ctx.db.patch(args.id, {
      status: "approved",
      updatedAt: Date.now(),
    });
  },
});

export const declineEditRequest = mutation({
  args: { 
    id: v.id("editRequests"),
    adminReason: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Edit request not found");
    if (request.status !== "pending") throw new Error("Request has already been processed");

    // Simply mark it as declined and save the rejection note
    await ctx.db.patch(args.id, {
      status: "declined",
      adminReason: args.adminReason,
      updatedAt: Date.now(),
    });
  },
});