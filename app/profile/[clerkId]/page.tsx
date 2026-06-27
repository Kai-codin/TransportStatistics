"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { use, useMemo } from "react";
import { TripRow } from "@/components/TripRow";
import { FriendRequestButton } from "@/components/FriendRequestButton";
import { ArrowLeft, Lock, Users } from "lucide-react";

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ clerkId: string }>;
}) {
  const { clerkId } = use(params);
  const user = useQuery(api.functions.friends.getUserByClerkId, { clerkId });
  const access = useQuery(api.functions.friends.canViewProfile, { targetUserId: clerkId });
  const counts = useQuery(
    api.functions.trips.getUserTripCount,
    user ? { userId: clerkId } : "skip",
  );
  const tripSummaries = useQuery(
    api.functions.trips.getUserTripsPaginated,
    user ? { userId: clerkId, paginationOpts: { numItems: 50, cursor: null } } : "skip",
  );

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center py-10 text-slate-400">User not found.</div>
      </div>
    );
  }

  if (!access || !access.allowed) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to my profile
        </Link>
        <div className="text-center py-16">
          <Lock className="h-12 w-12 mx-auto mb-4 text-ts-text-3 opacity-40" />
          <h2 className="text-xl font-bold text-ts-text-1 mb-2">Profile Private</h2>
          <p className="text-sm text-ts-text-3">
            {access?.reason === "friends_only"
              ? "This profile is only visible to friends."
              : "This profile is set to private."}
          </p>
        </div>
      </div>
    );
  }

  const trips = tripSummaries?.page ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-8 md:px-8 md:pt-8">
      <Link
        href="/profile"
        className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to my profile
      </Link>

      <div className="mb-6 md:mb-8">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ts-accent/10 text-xl font-bold text-ts-accent">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-ts-text-1">{user.username}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Users className="h-3.5 w-3.5 text-ts-text-3" />
                <span className="text-sm text-ts-text-3">
                  {counts?.trips ?? 0} trips · {counts?.days ?? 0} days
                </span>
              </div>
            </div>
          </div>
          <FriendRequestButton targetUserId={clerkId} />
        </div>
      </div>

      <div className="border-b border-white/10 mb-6 md:mb-8" />

      {trips.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No trips yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {trips.map((trip) => (
            <TripRow key={trip._id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}
