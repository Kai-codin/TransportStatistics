"use client";

import Link from "next/link";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TripRow } from "@/components/TripRow";
import { CompactTripRow } from "@/components/CompactTripRow";
import { useUser } from "@clerk/nextjs";
import { useMemo, useEffect, useRef, useState } from "react";
import { MapPinned, Info, LayoutList, Rows3 } from "lucide-react";

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

const LAYOUT_STORAGE_KEY = "ts_trip_layout";
type TripLayout = "comfortable" | "compact";

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ProfilePage() {
  const { isSignedIn, user } = useUser();

  const { results: trips, status, loadMore } = usePaginatedQuery(
    api.functions.trips.getMyTripsPaginated,
    user ? {} : "skip",
    { initialNumItems: 50 },
  );

  const counts = useQuery(api.functions.trips.getMyTripCount, user ? {} : "skip");
  const participatedTrips = useQuery(
    api.functions.friends.getUserParticipatedTrips,
    user ? { userId: user.id } : "skip",
  );

  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Layout preference (comfortable / compact), persisted locally ──
  const [layout, setLayout] = useState<TripLayout>("comfortable");

  useEffect(() => {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (stored === "compact" || stored === "comfortable") {
      setLayout(stored);
    }
  }, []);

  const toggleLayout = () => {
    setLayout((prev) => {
      const next = prev === "comfortable" ? "compact" : "comfortable";
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
      return next;
    });
  };

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

  if (!isSignedIn) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center py-10 text-slate-400">Please sign in to view your profile.</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-8 md:px-8 md:pt-8">

      {/* ── Header ── */}
      <div className="mb-6 md:mb-8">
        {/* Title row */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl md:text-3xl font-bold text-ts-text-1">My Trips</h1>

          {/* Stats — inline on mobile, same row as title */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xl md:text-2xl font-bold text-ts-text-1 leading-none">{counts?.trips ?? 0}</div>
              <div className="text-[10px] md:text-xs text-slate-400 uppercase tracking-wider mt-0.5">Trips</div>
            </div>
            <div className="text-right">
              <div className="text-xl md:text-2xl font-bold text-ts-text-1 leading-none">{counts?.days ?? 0}</div>
              <div className="text-[10px] md:text-xs text-slate-400 uppercase tracking-wider mt-0.5">Days</div>
            </div>
          </div>
        </div>

        {/* Map button + Layout toggle */}
        <div className="flex flex-wrap items-center gap-3">
          {trips && trips.length > 0 && (
            <Link
              href="/trip/all/map"
              className="flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
            >
              <MapPinned className="h-4 w-4 shrink-0" />
              View all on map
            </Link>
          )}

          {/* Layout toggle */}
          <button
            type="button"
            onClick={toggleLayout}
            className="flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent ml-auto"
            title={layout === "comfortable" ? "Switch to compact view" : "Switch to comfortable view"}
          >
            {layout === "comfortable" ? (
              <>
                <Rows3 className="h-4 w-4 shrink-0" />
                Compact view
              </>
            ) : (
              <>
                <LayoutList className="h-4 w-4 shrink-0" />
                Comfortable view
              </>
            )}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-b border-white/10 mb-6 md:mb-8" />

      {/* ── Trip list ── */}
      {status === "LoadingFirstPage" ? (
        <div className="text-center text-slate-500 py-10">Loading...</div>
      ) : trips.length === 0 && (!participatedTrips || participatedTrips.length === 0) ? (
        <div className="text-center py-10 text-slate-400">No trips yet.</div>
      ) : (
        <>
          {groupedTrips.map(({ dateKey, dateLabel, trips: tripList }) => (
            <div key={dateKey} className="mb-8">

              {/* Sticky date group header */}
              <div className="sticky top-0 z-10 bg-ts-bg pt-1 pb-2">
                <div className="flex items-center gap-3">
                  {/* Date — clickable via Link */}
                  <Link href={`/trip/${dateKey}`} className="flex items-center gap-3 min-w-0 flex-1">
                    <h3 className="text-base md:text-lg font-bold text-ts-text-1 truncate">{dateLabel}</h3>
                    <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                      {tripList.length} {tripList.length === 1 ? "trip" : "trips"}
                    </span>
                  </Link>

                  {/* Day map link — pushed to the right */}
                  <div className="inline-flex gap-2 ml-auto">
                    <Link
                      href={`/trip/${dateKey}`}
                      className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
                    >
                      <Info className="h-3 w-3" />
                      Details
                    </Link>
                    <Link
                      href={`/trip/${dateKey}/map`}
                      className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
                    >
                      <MapPinned className="h-3 w-3" />
                      Map
                    </Link>
                  </div>
                </div>
                <div className="mt-2 border-b border-white/5" />
              </div>

              {/* Trip cards */}
              <div className="flex flex-col gap-2 mt-2">
                {tripList.map((trip) =>
                  layout === "compact" ? (
                    <CompactTripRow key={trip._id} trip={trip} />
                  ) : (
                    <TripRow key={trip._id} trip={trip} />
                  )
                )}
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="py-4 text-center text-sm text-slate-500">
            {status === "LoadingMore" && "Loading more trips..."}
            {status === "Exhausted" && "All trips loaded"}
          </div>
        </>
      )}
    </div>
  );
}