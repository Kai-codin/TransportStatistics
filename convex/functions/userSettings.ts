import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";

export const BUSTIMES_DEFAULT_BASE_URL = "https://bustimes.org";

const bustimesFeatureValidator = v.union(
  v.literal("vehicleSearch"),
  v.literal("fleet"),
  v.literal("routes"),
  v.literal("departures"),
  v.literal("tripLookup"),
  v.literal("routeInfo"),
  v.literal("liveVehicles"),
);

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return BUSTIMES_DEFAULT_BASE_URL;

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Bustimes source must be an HTTP or HTTPS URL.");
  }

  return parsed.toString().replace(/\/$/, "");
}

async function getSettingsByClerkId(ctx: QueryCtx | MutationCtx, clerkId: string) {
  return await ctx.db
    .query("userSettings")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .first();
}

export const getMyBustimesSource = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return {
        bustimesBaseUrl: BUSTIMES_DEFAULT_BASE_URL,
        bustimesEnabledFeatures: [],
      };
    }

    const settings = await getSettingsByClerkId(ctx, identity.subject);

    return {
      bustimesBaseUrl: settings?.bustimesBaseUrl ?? BUSTIMES_DEFAULT_BASE_URL,
      bustimesEnabledFeatures: settings?.bustimesEnabledFeatures ?? [],
    };
  },
});

export const saveMyBustimesSource = mutation({
  args: {
    bustimesBaseUrl: v.string(),
    bustimesEnabledFeatures: v.array(bustimesFeatureValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("You must be signed in to save settings.");
    }

    const bustimesBaseUrl = normalizeBaseUrl(args.bustimesBaseUrl);
    const bustimesEnabledFeatures = [...new Set(args.bustimesEnabledFeatures)];
    const existing = await getSettingsByClerkId(ctx, identity.subject);

    if (existing) {
      await ctx.db.patch(existing._id, {
        bustimesBaseUrl,
        bustimesEnabledFeatures,
      });
      return existing._id;
    }

    return await ctx.db.insert("userSettings", {
      clerkId: identity.subject,
      bustimesBaseUrl,
      bustimesEnabledFeatures,
    });
  },
});

export const getBustimesSourceForUser = query({
  args: {
    clerkId: v.optional(v.string()),
    feature: bustimesFeatureValidator,
  },
  handler: async (ctx, args) => {
    if (!args.clerkId) return BUSTIMES_DEFAULT_BASE_URL;

    const settings = await getSettingsByClerkId(ctx, args.clerkId);
    if (!settings) return BUSTIMES_DEFAULT_BASE_URL;

    return settings.bustimesEnabledFeatures.includes(args.feature)
      ? settings.bustimesBaseUrl
      : BUSTIMES_DEFAULT_BASE_URL;
  },
});
