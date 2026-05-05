"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TripRow } from "@/components/TripRow";
import { useUser } from "@clerk/nextjs";
import { useMemo } from "react";

export default function ProfilePage() {
  const { isSignedIn, user } = useUser();
  const trips = useQuery(api.functions.trips.getMyTrips, user ? {} : "skip");

  const groupedTrips = useMemo(() => {
    if (!trips) return {};
    return trips.reduce((acc: any, trip) => {
      const date = new Date(trip.service_date * 1000).toLocaleDateString('en-GB', { 
        day: 'numeric', month: 'long', year: 'numeric' 
      });
      if (!acc[date]) acc[date] = [];
      acc[date].push(trip);
      return acc;
    }, {});
  }, [trips]);

  if (!isSignedIn) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center py-10 text-slate-400">Please sign in to view your profile.</div>
      </div>
    );
  }

  const totalDays = Object.keys(groupedTrips).length;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="flex justify-between items-end mb-8 border-b border-white/10 pb-6">
        <h1 className="text-3xl font-bold text-white">My Trips</h1>
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
        Object.entries(groupedTrips).map(([date, tripList]: [string, any]) => (
          <div key={date} className="mb-8">
            <div className="sticky top-0 flex items-center gap-4 bg-ts-bg pb-2 pt-2">
              <h3 className="text-lg font-bold text-white">{date}</h3>
              <span className="text-sm text-slate-500">{tripList.length} trips</span>
            </div>
            <div className="flex flex-col gap-2">
              {tripList.map((trip: any) => (
                <TripRow key={trip._id} trip={trip} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}