import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

// ── Helpers ──

export async function areFriends(
  ctx: QueryCtx,
  userA: string,
  userB: string,
): Promise<boolean> {
  if (userA === userB) return false;
  const [aToB, bToA] = await Promise.all([
    ctx.db
      .query("friends")
      .withIndex("by_userA_userB", (q) => q.eq("userA", userA).eq("userB", userB))
      .first(),
    ctx.db
      .query("friends")
      .withIndex("by_userA_userB", (q) => q.eq("userA", userB).eq("userB", userA))
      .first(),
  ]);
  return aToB !== null || bToA !== null;
}

function deriveVehicleKeysForParticipation(trip: {
  transport_type?: string;
  operator?: string;
  vehicle_keys?: string[] | null;
  units?: Array<{
    unit_number?: string | null;
    unit_reg?: string | null;
  }> | null;
  unit_number?: string | null;
  unit_reg?: string | null;
}) {
  const operator = trip.operator ?? "Unknown";
  const keys = new Set<string>();

  if (Array.isArray(trip.vehicle_keys)) {
    for (const key of trip.vehicle_keys) {
      if (typeof key === "string" && key.trim()) {
        keys.add(key);
      }
    }
  }

  const units = Array.isArray(trip.units) ? trip.units : [];
  for (const unit of units) {
    const unitNumber = typeof unit.unit_number === "string" ? unit.unit_number.trim() : "";
    const unitReg = typeof unit.unit_reg === "string" ? unit.unit_reg.replace(/\s+/g, "").toUpperCase() : "";
    const rawKey =
      trip.transport_type === "Bus"
        ? (unitReg || unitNumber)
        : (unitNumber || unitReg);
    if (rawKey) keys.add(`${operator}_${rawKey}`);
  }

  const fallbackNumber = typeof trip.unit_number === "string" ? trip.unit_number.trim() : "";
  const fallbackReg = typeof trip.unit_reg === "string" ? trip.unit_reg.replace(/\s+/g, "").toUpperCase() : "";
  const fallbackKey =
    trip.transport_type === "Bus"
      ? (fallbackReg || fallbackNumber)
      : (fallbackNumber || fallbackReg);
  if (fallbackKey) keys.add(`${operator}_${fallbackKey}`);

  return [...keys];
}

function getHistoryTimestamp(trip: {
  logged_at?: number;
  service_date?: number;
  _creationTime?: number;
}) {
  if (typeof trip.logged_at === "number") return trip.logged_at;
  if (typeof trip.service_date === "number") return trip.service_date > 1_000_000_000_000 ? trip.service_date : trip.service_date * 1000;
  if (typeof trip._creationTime === "number") return trip._creationTime;
  return 0;
}

async function ensureFriendPair(
  ctx: MutationCtx,
  userA: string,
  userB: string,
) {
  const existing = await Promise.all([
    ctx.db
      .query("friends")
      .withIndex("by_userA_userB", (q) => q.eq("userA", userA).eq("userB", userB))
      .first(),
    ctx.db
      .query("friends")
      .withIndex("by_userA_userB", (q) => q.eq("userA", userB).eq("userB", userA))
      .first(),
  ]);
  if (existing[0] || existing[1]) return;
  const [aId, bId] = [userA, userB].sort();
  await ctx.db.insert("friends", {
    userA: aId,
    userB: bId,
    createdAt: Date.now(),
  });
}

// ── Queries ──

export const getIncomingRequestId = query({
  args: { fromUser: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = identity.subject;

    const request = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) =>
        q.eq("fromUser", args.fromUser).eq("toUser", me)
      )
      .first();

    return request?._id ?? null;
  },
});

export const getFriendStatus = query({
  args: { targetUserId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return "none" as const;
    const me = identity.subject;

    if (me === args.targetUserId) return "self" as const;

    const areF = await areFriends(ctx, me, args.targetUserId);
    if (areF) return "friends" as const;

    const sentRequest = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) =>
        q.eq("fromUser", me).eq("toUser", args.targetUserId)
      )
      .first();
    if (sentRequest) return sentRequest.status === "declined" ? "none" : sentRequest.status as "pending";

    const receivedRequest = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) =>
        q.eq("fromUser", args.targetUserId).eq("toUser", me)
      )
      .first();
    if (receivedRequest) return receivedRequest.status === "declined" ? "none" : "received" as const;

    return "none" as const;
  },
});

export const getMyFriends = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const me = identity.subject;

    const asUserA = await ctx.db
      .query("friends")
      .withIndex("by_userA_userB", (q) => q.eq("userA", me))
      .collect();
    const asUserB = await ctx.db
      .query("friends")
      .withIndex("by_userB_userA", (q) => q.eq("userB", me))
      .collect();

    const friendIds = [
      ...asUserA.map((f) => f.userB),
      ...asUserB.map((f) => f.userA),
    ];

    const users = await Promise.all(
      friendIds.map((id) =>
        ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", id))
          .first()
      )
    );

    return users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({
        _id: u._id,
        clerkId: u.clerkId,
        username: u.username,
      }));
  },
});

export const getIncomingRequests = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const me = identity.subject;

    const requests = await ctx.db
      .query("friendRequests")
      .withIndex("by_toUser_status", (q) => q.eq("toUser", me).eq("status", "pending"))
      .order("desc")
      .collect();

    const fromUsers = await Promise.all(
      requests.map((r) =>
        ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", r.fromUser)).first()
      )
    );

    return requests.map((r, i) => ({
      _id: r._id,
      fromUser: r.fromUser,
      fromUsername: fromUsers[i]?.username ?? "Unknown",
      createdAt: r.createdAt,
    }));
  },
});

export const getOutgoingRequests = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const me = identity.subject;

    const requests = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) => q.eq("fromUser", me))
      .order("desc")
      .collect();

    const toUsers = await Promise.all(
      requests.map((r) =>
        ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", r.toUser)).first()
      )
    );

    return requests.map((r, i) => ({
      _id: r._id,
      toUser: r.toUser,
      toUsername: toUsers[i]?.username ?? "Unknown",
      status: r.status,
      createdAt: r.createdAt,
    }));
  },
});

export const searchUsers = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const me = identity.subject;

    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return [];

    const allUsers = await ctx.db.query("users").collect();
    const matching = allUsers.filter(
      (u) =>
        u.clerkId !== me &&
        u.username.toLowerCase().includes(q)
    );

    const results = await Promise.all(
      matching.slice(0, 20).map(async (u) => {
        const status = await getFriendStatusForUsers(ctx, me, u.clerkId);
        return { clerkId: u.clerkId, username: u.username, status };
      })
    );

    return results;
  },
});

async function getFriendStatusForUsers(
  ctx: QueryCtx,
  me: string,
  target: string,
): Promise<"none" | "pending" | "received" | "friends"> {
  if (await areFriends(ctx, me, target)) return "friends";
  const sent = await ctx.db
    .query("friendRequests")
    .withIndex("by_fromUser_toUser", (q) =>
      q.eq("fromUser", me).eq("toUser", target)
    )
    .first();
  if (sent) return sent.status === "pending" ? "pending" : "none";
  const recv = await ctx.db
    .query("friendRequests")
    .withIndex("by_fromUser_toUser", (q) =>
      q.eq("fromUser", target).eq("toUser", me)
    )
    .first();
  if (recv) return recv.status === "pending" ? "received" : "none";
  return "none";
}

// ── Mutations ──

export const sendFriendRequest = mutation({
  args: { toUser: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    if (me === args.toUser) throw new Error("Cannot send request to yourself");

    const existing = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) =>
        q.eq("fromUser", me).eq("toUser", args.toUser)
      )
      .first();
    if (existing) throw new Error("Friend request already sent");

    const reverse = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) =>
        q.eq("fromUser", args.toUser).eq("toUser", me)
      )
      .first();
    if (reverse && reverse.status === "pending") throw new Error("This user already sent you a request");

    const alreadyFriends = await areFriends(ctx, me, args.toUser);
    if (alreadyFriends) throw new Error("Already friends");

    await ctx.db.insert("friendRequests", {
      fromUser: me,
      toUser: args.toUser,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const acceptFriendRequest = mutation({
  args: { requestId: v.id("friendRequests") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const request = await ctx.db.get(args.requestId);
    if (!request || request.toUser !== me) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request is not pending");

    await ctx.db.patch(args.requestId, {
      status: "accepted",
      updatedAt: Date.now(),
    });

    await ensureFriendPair(ctx, request.fromUser, request.toUser);
  },
});

export const declineFriendRequest = mutation({
  args: { requestId: v.id("friendRequests") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const request = await ctx.db.get(args.requestId);
    if (!request || request.toUser !== me) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request is not pending");

    await ctx.db.patch(args.requestId, {
      status: "declined",
      updatedAt: Date.now(),
    });
  },
});

export const removeFriend = mutation({
  args: { friendId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const [aToB, bToA] = await Promise.all([
      ctx.db
        .query("friends")
        .withIndex("by_userA_userB", (q) => q.eq("userA", me).eq("userB", args.friendId))
        .first(),
      ctx.db
        .query("friends")
        .withIndex("by_userA_userB", (q) => q.eq("userA", args.friendId).eq("userB", me))
        .first(),
    ]);

    const friendship = aToB ?? bToA;
    if (!friendship) throw new Error("Friendship not found");

    await ctx.db.delete(friendship._id);
  },
});

export const cancelFriendRequest = mutation({
  args: { toUser: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const request = await ctx.db
      .query("friendRequests")
      .withIndex("by_fromUser_toUser", (q) =>
        q.eq("fromUser", me).eq("toUser", args.toUser)
      )
      .first();

    if (request) {
      await ctx.db.delete(request._id);
    }
  },
});

// ── Profile Visibility ──

export const getMyVisibility = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return "friends" as const;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();

    return (profile?.visibility ?? "friends") as "public" | "friends" | "private";
  },
});

export const setVisibility = mutation({
  args: {
    visibility: v.union(
      v.literal("public"),
      v.literal("friends"),
      v.literal("private")
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { visibility: args.visibility });
    } else {
      await ctx.db.insert("userProfiles", {
        clerkId: identity.subject,
        visibility: args.visibility,
      });
    }
  },
});

export const canViewProfile = query({
  args: { targetUserId: v.string(), viewerUserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let me: string | null = args.viewerUserId ?? null;
    if (!me) {
      const identity = await ctx.auth.getUserIdentity();
      me = identity?.subject ?? null;
    }
    if (!me) return { allowed: false, reason: "unauthenticated" as const };

    if (me === args.targetUserId) return { allowed: true, reason: "owner" as const };

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.targetUserId))
      .first();

    const visibility = profile?.visibility ?? "friends";

    if (visibility === "public") return { allowed: true, reason: "public" as const };
    if (visibility === "private") return { allowed: false, reason: "private" as const };

    const isFriend = await areFriends(ctx, me, args.targetUserId);
    if (isFriend) return { allowed: true, reason: "friend" as const };

    return { allowed: false, reason: "friends_only" as const };
  },
});

// ── Trip Participation ("I Was Here") ──

export const markTripParticipation = mutation({
  args: { tripId: v.id("tripLogs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const trip = await ctx.db.get(args.tripId);
    if (!trip) throw new Error("Trip not found");

    if (trip.user === me) throw new Error("Cannot mark your own trip");

    const existing = (await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId).eq("user", me))
      .first()) as Doc<"tripParticipants"> | null;

    const friendCheck = await areFriends(ctx, me, trip.user);
    if (!friendCheck) throw new Error("You can only participate in friends' trips");

    const ownedTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", me))
      .collect();

    const existingParticipations = await ctx.db
      .query("tripParticipants")
      .withIndex("by_user", (q) => q.eq("user", me))
      .collect();

    const previousParticipationTrips = (await Promise.all(
      existingParticipations.map((p) => ctx.db.get(p.tripId))
    )).filter((existingTrip): existingTrip is NonNullable<typeof existingTrip> => existingTrip !== null);

    const seenVehicleKeys = new Set<string>();
    const historyTrips = [...ownedTrips, ...previousParticipationTrips].filter(
      (historyTrip) => String(historyTrip._id) !== String(args.tripId)
    );

    for (const previousTrip of historyTrips) {
      for (const key of deriveVehicleKeysForParticipation(previousTrip)) {
        if (typeof key === "string" && key.trim()) {
          seenVehicleKeys.add(key);
        }
      }
    }

    const currentVehicleKeys = deriveVehicleKeysForParticipation(trip);
    const firstUnits = currentVehicleKeys.filter((key) => !seenVehicleKeys.has(key));
    const payload = {
      tripId: args.tripId,
      user: me,
      addedAt: Date.now(),
      first_time: firstUnits.length > 0,
      first_units: firstUnits,
      vehicle_key: currentVehicleKeys[0],
      vehicle_keys: currentVehicleKeys,
    };

    console.log("markTripParticipation:firstTime", {
      me,
      tripId: String(args.tripId),
      currentVehicleKeys,
      seenVehicleKeys: [...seenVehicleKeys],
      firstUnits,
      firstTime: payload.first_time,
    });

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return;
    }

    await ctx.db.insert("tripParticipants", payload);
  },
});

export const removeTripParticipation = mutation({
  args: { tripId: v.id("tripLogs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const existing = await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId).eq("user", me))
      .first();

    if (!existing) throw new Error("Not a participant");

    await ctx.db.delete(existing._id);
  },
});

export const getTripParticipants = query({
  args: { tripId: v.id("tripLogs") },
  handler: async (ctx, args) => {
    const participants = await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId))
      .collect();

    const users = await Promise.all(
      participants.map((p) =>
        ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", p.user)).first()
      )
    );

    return participants.map((p, i) => ({
      userId: p.user,
      username: users[i]?.username ?? "Unknown",
      addedAt: p.addedAt,
      first_time: p.first_time ?? false,
      first_units: p.first_units ?? [],
    }));
  },
});

export const getMyParticipationStatus = query({
  args: { tripId: v.id("tripLogs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const existing = await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId).eq("user", identity.subject))
      .first();

    return existing !== null;
  },
});

export const getMyParticipationRecord = query({
  args: { tripId: v.id("tripLogs") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const participation = await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId).eq("user", identity.subject))
      .first();

    if (!participation) return null;

    const currentTrip = await ctx.db.get(args.tripId);
    if (!currentTrip) return null;

    const ownedTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", identity.subject))
      .collect();

    const previousParticipations = await ctx.db
      .query("tripParticipants")
      .withIndex("by_user", (q) => q.eq("user", identity.subject))
      .collect();

    const previousTrips = (await Promise.all(
      previousParticipations
        .filter((p) => String(p.tripId) !== String(args.tripId))
        .map((p) => ctx.db.get(p.tripId))
    )).filter((trip): trip is NonNullable<typeof trip> => trip !== null);

    const historyEvents = [
      ...ownedTrips
        .filter((trip) => String(trip._id) !== String(args.tripId))
        .map((trip) => ({
          timestamp: getHistoryTimestamp(trip),
          trip,
        })),
      ...previousTrips.map((trip) => ({
        timestamp: getHistoryTimestamp(trip),
        trip,
      })),
      {
        timestamp: getHistoryTimestamp(currentTrip),
        trip: currentTrip,
      },
    ].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return String(a.trip._id).localeCompare(String(b.trip._id));
    });

    const seenVehicleKeys = new Set<string>();
    let computed: { first_time: boolean; first_units: string[] } | null = null;
    for (const event of historyEvents) {
      const keys = deriveVehicleKeysForParticipation(event.trip);
      const firstUnits = keys.filter((key) => !seenVehicleKeys.has(key));
      for (const key of keys) {
        seenVehicleKeys.add(key);
      }

      if (String(event.trip._id) === String(args.tripId)) {
        computed = {
          first_time: firstUnits.length > 0,
          first_units: firstUnits,
        };
        break;
      }
    }

    return {
      userId: participation.user,
      addedAt: participation.addedAt,
      first_time: computed?.first_time ?? participation.first_time ?? false,
      first_units: computed?.first_units ?? participation.first_units ?? [],
      vehicle_key: participation.vehicle_key ?? undefined,
      vehicle_keys: participation.vehicle_keys ?? [],
    };
  },
});

export const addTripParticipant = mutation({
  args: { tripId: v.id("tripLogs"), friendClerkId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const trip = await ctx.db.get(args.tripId);
    if (!trip) throw new Error("Trip not found");

    if (trip.user !== me) throw new Error("Only the trip owner can add participants");
    if (args.friendClerkId === me) throw new Error("Cannot add yourself as participant");

    const friendCheck = await areFriends(ctx, me, args.friendClerkId);
    if (!friendCheck) throw new Error("You can only add friends as participants");

    const existing = (await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId).eq("user", args.friendClerkId))
      .first()) as Doc<"tripParticipants"> | null;

    const friendOwnedTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.friendClerkId))
      .collect();

    const friendParticipations = await ctx.db
      .query("tripParticipants")
      .withIndex("by_user", (q) => q.eq("user", args.friendClerkId))
      .collect();

    const friendParticipationTrips = (await Promise.all(
      friendParticipations.map((p) => ctx.db.get(p.tripId))
    )).filter((t): t is NonNullable<typeof t> => t !== null);

    const seenVehicleKeys = new Set<string>();
    const historyTrips = [...friendOwnedTrips, ...friendParticipationTrips].filter(
      (historyTrip) => String(historyTrip._id) !== String(args.tripId)
    );

    for (const previousTrip of historyTrips) {
      for (const key of deriveVehicleKeysForParticipation(previousTrip)) {
        if (typeof key === "string" && key.trim()) {
          seenVehicleKeys.add(key);
        }
      }
    }

    const currentVehicleKeys = deriveVehicleKeysForParticipation(trip);
    const firstUnits = currentVehicleKeys.filter((key) => !seenVehicleKeys.has(key));
    const payload = {
      tripId: args.tripId,
      user: args.friendClerkId,
      addedAt: Date.now(),
      first_time: firstUnits.length > 0,
      first_units: firstUnits,
      vehicle_key: currentVehicleKeys[0],
      vehicle_keys: currentVehicleKeys,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return;
    }

    await ctx.db.insert("tripParticipants", payload);
  },
});

export const removeTripParticipant = mutation({
  args: { tripId: v.id("tripLogs"), participantClerkId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const me = identity.subject;

    const trip = await ctx.db.get(args.tripId);
    if (!trip) throw new Error("Trip not found");

    if (trip.user !== me) throw new Error("Only the trip owner can remove participants");

    const existing = await ctx.db
      .query("tripParticipants")
      .withIndex("by_tripId_user", (q) => q.eq("tripId", args.tripId).eq("user", args.participantClerkId))
      .first();

    if (!existing) throw new Error("Not a participant");

    await ctx.db.delete(existing._id);
  },
});

export const getUserByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .first();
    if (!user) return null;
    return { _id: user._id, clerkId: user.clerkId, username: user.username };
  },
});

export const getUserParticipatedTrips = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const participations = await ctx.db
      .query("tripParticipants")
      .withIndex("by_user", (q) => q.eq("user", args.userId))
      .order("desc")
      .collect();

    const participatedTrips = await Promise.all(
      participations.map((p) => ctx.db.get(p.tripId))
    );

    const ownedTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.userId))
      .collect();

    const historyEvents = [
      ...ownedTrips.map((trip) => ({
        kind: "owned" as const,
        timestamp: getHistoryTimestamp(trip),
        trip,
        participation: null as null | (typeof participations)[number],
      })),
      ...participations
        .map((participation, index) => {
          const trip = participatedTrips[index];
          if (!trip) return null;
          return {
            kind: "participated" as const,
            timestamp: participation.addedAt,
            trip,
            participation,
          };
        })
        .filter((event): event is NonNullable<typeof event> => event !== null),
    ].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return String(a.trip._id).localeCompare(String(b.trip._id));
    });

    const seenVehicleKeys = new Set<string>();
    const computed = new Map<string, { first_time: boolean; first_units: string[] }>();

    for (const event of historyEvents) {
      const keys = deriveVehicleKeysForParticipation(event.trip);
      const firstUnits = keys.filter((key) => !seenVehicleKeys.has(key));
      for (const key of keys) {
        seenVehicleKeys.add(key);
      }

      if (event.kind === "participated") {
        computed.set(String(event.trip._id), {
          first_time: firstUnits.length > 0,
          first_units: firstUnits,
        });
      }
    }

    return participations
      .map((participation, index) => {
        const trip = participatedTrips[index];
        if (!trip) return null;

        const computedState = computed.get(String(trip._id));
        const finalFirstUnits = participation.first_units ?? computedState?.first_units ?? trip.first_units ?? [];
        const finalFirstTime = participation.first_time ?? computedState?.first_time ?? trip.first_time ?? false;

        if (process.env.NODE_ENV !== "production") {
          console.log("getUserParticipatedTrips:firstTime", {
            userId: args.userId,
            tripId: String(trip._id),
            storedFirstTime: participation.first_time,
            computedState,
            finalFirstTime,
            finalFirstUnits,
          });
        }

        return {
          _id: trip._id,
          user: trip.user,
          on_trip_with: trip.on_trip_with,
          logged_at: trip.logged_at,
          service_number: trip.service_number,
          operator: trip.operator,
          operator_slug: trip.operator_slug,
          service_date: trip.service_date,
          transport_type: trip.transport_type,
          bustimes_service_id: trip.bustimes_service_id,
          bustimes_service_slug: trip.bustimes_service_slug,
          origin_name: trip.origin_name,
          origin_stop_code: trip.origin_stop_code,
          destination_name: trip.destination_name,
          destination_stop_code: trip.destination_stop_code,
          scheduled_departure: trip.scheduled_departure,
          actual_departure: trip.actual_departure,
          scheduled_arrival: trip.scheduled_arrival,
          actual_arrival: trip.actual_arrival,
          units: trip.units,
          unit_number: trip.unit_number,
          unit_reg: trip.unit_reg,
          unit_type: trip.unit_type,
          livery_name: trip.livery_name,
          livery_css: trip.livery_css,
          notes: trip.notes,
          first_time: finalFirstTime,
          first_units: finalFirstUnits,
          vehicle_key: participation.vehicle_key ?? trip.vehicle_key,
          vehicle_keys: participation.vehicle_keys ?? trip.vehicle_keys,
          distance_km: trip.distance_km,
        };
      })
      .filter((trip): trip is NonNullable<typeof trip> => trip !== null);
  },
});
