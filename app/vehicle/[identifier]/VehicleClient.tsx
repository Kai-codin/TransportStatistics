'use client';

import Link from 'next/link';
import { Bus, TrainFront, TramFront, CalendarDays, MapPinned, Waypoints, ArrowLeft } from 'lucide-react';
import { TripRow } from '@/components/TripRow';

type VehicleStats = {
  totalTrips: number;
  totalDistanceKm: number;
  totalMinutes: number;
  frequentRoutes: Array<{ route: string; count: number }>;
};

type TripRecord = {
  _id: string;
  service_date: number;
  transport_type: string;
  service_number?: string;
  operator?: string;
  scheduled_departure?: string;
  actual_departure?: string;
  scheduled_arrival?: string;
  actual_arrival?: string;
  origin_name?: string;
  destination_name?: string;
  units?: Array<{ unit_number?: string; unit_reg?: string; unit_type?: string; livery?: string; livery_left?: string }>;
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery_name?: string;
  livery_css?: string;
  first_time?: boolean;
  first_units?: string[];
  coupling_events?: any[];
  distance_km?: number;
};

type VehicleClientProps = {
  vehicleIdentifier: string;
  data: {
    trips: TripRecord[];
    stats: VehicleStats | null;
  };
};

function normalizeTimestamp(value: number) {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function formatTime(value?: string) {
  if (!value) return '--:--';
  return value.substring(0, 5);
}

function formatDistance(km: number) {
  if (!km || km <= 0) return '—';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function formatDuration(minutes: number) {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-ts-border bg-ts-surface p-4 md:p-5">
      <div className="text-[10px] font-semibold tracking-[0.18em] text-ts-text-3">{label}</div>
      <div className="mt-2 text-xl font-bold text-ts-text-1 tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-ts-text-3">{sub}</div>}
    </div>
  );
}

function getTransportIcon(type: string) {
  switch (type) {
    case 'Rail':
      return <TrainFront className="h-4 w-4" />;
    case 'Tram':
      return <TramFront className="h-4 w-4" />;
    default:
      return <Bus className="h-4 w-4" />;
  }
}

export function VehicleClient({ vehicleIdentifier, data }: VehicleClientProps) {
  const { trips, stats } = data;

  // Get the most common transport type from trips
  const transportType = trips.length > 0 ? trips[0].transport_type : 'Bus';

  // Handle empty state
  if (trips.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Back to profile
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-xs text-ts-text-3">
            {getTransportIcon(transportType)}
            <span className="truncate max-w-[180px] sm:max-w-none">{vehicleIdentifier}</span>
          </div>
        </div>

        {/* Empty state */}
        <div className="rounded-3xl border border-dashed border-ts-border bg-ts-surface p-8 text-center md:p-10">
          <CalendarDays className="mx-auto h-10 w-10 text-ts-text-3" />
          <h2 className="mt-4 text-xl font-bold text-ts-text-1 md:text-2xl">
            No trips recorded for this vehicle
          </h2>
          <p className="mt-2 text-sm text-ts-text-3">
            This vehicle has not been used in any logged trips yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back to profile
        </Link>

        <div className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-xs text-ts-text-3">
          {getTransportIcon(transportType)}
          <span className="truncate max-w-[180px] sm:max-w-none">{vehicleIdentifier}</span>
        </div>
      </div>

      {/* Summary card */}
      <section className="mb-6 overflow-hidden rounded-3xl border border-ts-border bg-ts-surface shadow-sm">
        <div className="border-b border-ts-border px-4 py-4 md:px-6 md:py-5">
          {/* Pill row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-semibold text-ts-text-1">
              {stats?.totalTrips ?? 0} trip{stats?.totalTrips === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-ts-text-2">
              {getTransportIcon(transportType)}
              Vehicle history
            </span>
          </div>

          {/* Title */}
          <div className="mt-4">
            <div className="text-xs font-medium tracking-[0.16em] text-ts-text-3">
              Usage statistics for
            </div>
            <h1 className="mt-1.5 text-2xl font-bold text-ts-text-1 sm:text-3xl md:text-4xl">
              {vehicleIdentifier}
            </h1>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-ts-border px-4 py-4 md:px-6">
            <StatCard
              label="Total Distance"
              value={formatDistance(stats.totalDistanceKm)}
            />
            <StatCard
              label="Total Time"
              value={formatDuration(stats.totalMinutes)}
            />
            <StatCard
              label="Total Trips"
              value={String(stats.totalTrips)}
            />
          </div>
        )}
      </section>

      {/* Frequent routes */}
      {stats && stats.frequentRoutes.length > 0 && (
        <section className="mb-6 rounded-3xl border border-ts-border bg-ts-surface p-4 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Waypoints className="h-5 w-5 text-ts-text-2" />
            <h2 className="text-sm font-semibold tracking-[0.14em] text-ts-text-1">
              Frequently Used Routes
            </h2>
          </div>
          <div className="space-y-2">
            {stats.frequentRoutes.map(({ route, count }) => (
              <div
                key={route}
                className="flex items-center justify-between rounded-xl border border-ts-border bg-ts-surface-2 px-4 py-3"
              >
                <span className="text-sm font-medium text-ts-text-1 truncate">{route}</span>
                <span className="ml-2 text-xs font-bold text-ts-text-3 tabular-nums">
                  ×{count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trip history */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="h-5 w-5 text-ts-text-2" />
          <h2 className="text-sm font-semibold tracking-[0.14em] text-ts-text-1">
            Trip History
          </h2>
          <span className="ml-auto text-xs font-bold text-ts-text-3 tabular-nums">
            {trips.length} trip{trips.length === 1 ? '' : 's'}
          </span>
        </div>

        {trips.length > 0 ? (
          <div className="space-y-3">
            {trips.map((trip) => (
              <div className="mb-3">
                <TripRow key={trip._id} trip={trip} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-ts-border bg-ts-surface p-8 text-center md:p-10">
            <CalendarDays className="mx-auto h-10 w-10 text-ts-text-3" />
            <h2 className="mt-4 text-xl font-bold text-ts-text-1 md:text-2xl">
              No trips recorded for this vehicle
            </h2>
            <p className="mt-2 text-sm text-ts-text-3">
              This vehicle has not been used in any logged trips yet.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}