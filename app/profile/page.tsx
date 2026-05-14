"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TripRow } from "@/components/TripRow";
import { useUser } from "@clerk/nextjs";
import { useMemo } from "react";
import { MapPinned } from "lucide-react";

type TripGroup = {
  dateLabel: string;
  dateKey: string;
  trips: TripRecord[];
};

type TripRecord = {
  _id: string;
  service_date: number;
  transport_type: string;
  service_number?: string;
  operator?: string;
  scheduled_departure?: string;
  origin_name?: string;
  destination_name?: string;
  units?: { unit_number?: string; unit_reg?: string; unit_type?: string; livery?: string; livery_left?: string }[];
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery_name?: string;
  livery_css?: string;
};

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ProfilePage() {
  const { isSignedIn, user } = useUser();
  const trips = useQuery(api.functions.trips.getMyTrips, user ? {} : "skip");

  const groupedTrips = useMemo<TripGroup[]>(() => {
    if (!trips) return [];

    const groups = new Map<string, TripGroup>();

    trips.forEach((trip) => {
      const timestamp = trip.service_date > 1_000_000_000_000
        ? trip.service_date
        : trip.service_date * 1000;
      const dateKey = formatDateKey(timestamp);
      const dateLabel = new Date(timestamp).toLocaleDateString('en-GB', { 
        day: 'numeric', month: 'long', year: 'numeric' 
      });
      const existing = groups.get(dateKey);
      if (existing) {
        existing.trips.push(trip);
        return;
      }

      groups.set(dateKey, {
        dateKey,
        dateLabel,
        trips: [trip],
      });
    });

    return [...groups.values()];
  }, [trips]);

  if (!isSignedIn) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center py-10 text-slate-400">Please sign in to view your profile.</div>
      </div>
    );
  }

  const totalDays = groupedTrips.length;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="flex justify-between items-end mb-8 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">My Trips</h1>
          {trips && trips.length > 0 && (
            <Link
              href="/trip/all/map"
              className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
            >
              <MapPinned className="h-3.5 w-3.5" />
              View map
            </Link>
          )}
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-2xl font-bold text-white">{trips?.length || 0}</div>
            <div className="text-xs text-slate-400 uppercase tracking-wider">Trips</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">{totalDays}</div>
            <div className="text-xs text-slate-400 uppercase tracking-wider">Days</div>
          </div>
        </div>
      </div>

      {!trips ? (
        <div className="text-center text-slate-500 py-10">Loading...</div>
      ) : trips.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No trips yet.</div>
      ) : (
        groupedTrips.map(({ dateKey, dateLabel, trips: tripList }) => (
          <div key={dateKey} className="mb-8">
            <div className="sticky top-0 flex items-center gap-4 bg-ts-bg pb-2 pt-2">
              <h3 className="text-lg font-bold text-white">{dateLabel}</h3>
              <span className="text-sm text-slate-500">{tripList.length} trips</span>
              <Link
                href={`/trip/${dateKey}/map`}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-300 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
              >
                <MapPinned className="h-3 w-3" />
                Map
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              {tripList.map((trip) => (
                <TripRow key={trip._id} trip={trip} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
