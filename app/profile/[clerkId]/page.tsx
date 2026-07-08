"use client";

import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { use, useMemo, useEffect, useRef } from "react";
import { TripRow } from "@/components/TripRow";
import { FriendRequestButton } from "@/components/FriendRequestButton";
import { ArrowLeft, Lock, Users } from "lucide-react";

type TripGroup = {
  dateLabel: string;
  dateKey: string;
  trips: TripRecord[];
};

type TripRecord = {
  _id: string;
  user?: string;
  on_trip_with?: string[];
  logged_at?: number;
  service_date: number;
  transport_type: string;
  service_number?: string;
  operator?: string;
  operator_slug?: string;
  scheduled_departure?: string;
  actual_departure?: string;
  scheduled_arrival?: string;
  actual_arrival?: string;
  origin_name?: string;
  origin_stop_code?: string;
  destination_name?: string;
  destination_stop_code?: string;
  units?: { unit_number?: string; unit_reg?: string; unit_type?: string; livery?: string; livery_left?: string }[];
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery_name?: string;
  livery_css?: string;
  notes?: string;
  first_time?: boolean;
  first_units?: string[];
  vehicle_key?: string;
  vehicle_keys?: string[];
  distance_km?: number;
};

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ clerkId: string }>;
}) {
  const { clerkId } = use(params);
  const currentUser = useQuery(api.functions.friends.getUserByClerkId, { clerkId });
  const access = useQuery(api.functions.friends.canViewProfile, { targetUserId: clerkId });
  const counts = useQuery(
    api.functions.trips.getUserTripCount,
    currentUser ? { userId: clerkId } : "skip",
  );

  const { results: trips, status, loadMore } = usePaginatedQuery(
    api.functions.trips.getUserTripsPaginated,
    currentUser ? { userId: clerkId } : "skip",
    { initialNumItems: 50 },
  );

  const participatedTrips = useQuery(
    api.functions.friends.getUserParticipatedTrips,
    currentUser ? { userId: clerkId } : "skip",
  );

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && status === "CanLoadMore") {
          loadMore(50);
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [status, loadMore]);

  const groupedTrips = useMemo<TripGroup[]>(() => {
    const combinedTrips = [...(trips ?? []), ...(participatedTrips ?? [])];
    if (combinedTrips.length === 0) return [];

    const groups = new Map<string, TripGroup>();

    combinedTrips
      .slice()
      .sort((a, b) => {
        const aTs = a.service_date > 1_000_000_000_000 ? a.service_date : a.service_date * 1000;
        const bTs = b.service_date > 1_000_000_000_000 ? b.service_date : b.service_date * 1000;
        const aKey = formatDateKey(aTs);
        const bKey = formatDateKey(bTs);
        if (aKey !== bKey) return bKey.localeCompare(aKey);
        return (b.scheduled_departure ?? "").localeCompare(a.scheduled_departure ?? "");
      })
      .forEach((trip) => {
      const timestamp = trip.service_date > 1_000_000_000_000
        ? trip.service_date
        : trip.service_date * 1000;
      const dateKey = formatDateKey(timestamp);
      const dateLabel = new Date(timestamp).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });
      const existing = groups.get(dateKey);
      if (existing) {
        existing.trips.push(trip);
        return;
      }
      groups.set(dateKey, { dateKey, dateLabel, trips: [trip] });
    });

    return [...groups.values()];
  }, [participatedTrips, trips]);

  if (!currentUser) {
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
              {currentUser.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-ts-text-1">{currentUser.username}</h1>
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

      {status === "LoadingFirstPage" ? (
        <div className="text-center text-slate-500 py-10">Loading...</div>
      ) : trips.length === 0 && (!participatedTrips || participatedTrips.length === 0) ? (
        <div className="text-center py-10 text-slate-400">No trips yet.</div>
      ) : (
        <>
          {groupedTrips.map(({ dateKey, dateLabel, trips: tripList }) => (
            <div key={dateKey} className="mb-8">

              <div className="sticky top-0 z-10 bg-ts-bg pt-1 pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <h3 className="text-base md:text-lg font-bold text-ts-text-1 truncate">{dateLabel}</h3>
                    <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                      {tripList.length} {tripList.length === 1 ? "trip" : "trips"}
                    </span>
                  </div>
                </div>
                <div className="mt-2 border-b border-white/5" />
              </div>

              <div className="flex flex-col gap-2 mt-2">
                {tripList.map((trip) => (
                  <TripRow key={trip._id} trip={trip} />
                ))}
              </div>
            </div>
          ))}

          <div ref={sentinelRef} className="py-4 text-center text-sm text-slate-500">
            {status === "LoadingMore" && "Loading more trips..."}
            {status === "Exhausted" && "All trips loaded"}
          </div>
        </>
      )}
    </div>
  );
}
