'use client';

import Link from 'next/link';
import { use, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { useUser } from '@clerk/nextjs';
import { api } from '@/convex/_generated/api';
import { TripRow } from '@/components/TripRow';
import { ArrowLeft, CalendarDays, MapPinned, NotebookText } from 'lucide-react';

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
  first_time?: boolean;
  first_units?: string[];
};

type TripDatePageProps = {
  params: Promise<{ date: string }>;
};

function normalizeTimestamp(value: number) {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function formatDateLabel(dateKey: string) {
  const parsed = new Date(`${dateKey}T00:00:00`);
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(value?: string) {
  if (!value) return '--:--';
  return value.substring(0, 5);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ts-border bg-ts-surface p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ts-text-3">{label}</div>
      <div className="mt-1.5 text-xl font-bold text-ts-text-1 tabular-nums leading-tight">{value}</div>
    </div>
  );
}

export default function TripDatePage({ params }: TripDatePageProps) {
  const { date } = use(params);
  const { isSignedIn, user } = useUser();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const trips = useQuery(
    api.functions.trips.getMyTripsByDate,
    user?.id ? { user: user.id, date, timeZone } : 'skip',
  ) as TripRecord[] | undefined;

  const summary = useMemo(() => {
    if (!trips) {
      return {
        totalTrips: 0,
        firstTimeTrips: 0,
        operators: 0,
        firstDeparture: '--:--',
        lastArrival: '--:--',
      };
    }

    const uniqueOperators = new Set(trips.map((trip) => trip.operator).filter(Boolean));
    const firstTimeTrips = trips.filter(
      (trip) => Boolean((trip.first_units?.length ?? 0) > 0 || trip.first_time),
    ).length;
    const sortedByTime = [...trips].sort(
      (a, b) => normalizeTimestamp(a.service_date) - normalizeTimestamp(b.service_date),
    );
    const firstDeparture = formatTime(sortedByTime[0]?.scheduled_departure);
    const lastArrival = formatTime(sortedByTime[sortedByTime.length - 1]?.scheduled_departure);

    return {
      totalTrips: trips.length,
      firstTimeTrips,
      operators: uniqueOperators.size,
      firstDeparture,
      lastArrival,
    };
  }, [trips]);

  const accentLabel =
    trips && trips.length > 0
      ? `${trips.length} trip${trips.length === 1 ? '' : 's'} logged`
      : 'No trips logged';
  const dateLabel = formatDateLabel(date);

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-8 md:py-12">
        <div className="rounded-3xl border border-ts-border bg-ts-surface p-8 text-center text-ts-text-2">
          <NotebookText className="mx-auto h-10 w-10 text-ts-text-3" />
          <h1 className="mt-4 text-2xl font-bold text-ts-text-1">Sign in to view your trips</h1>
          <p className="mt-2 text-sm text-ts-text-3">
            This daily overview is only available when you are signed in.
          </p>
        </div>
      </div>
    );
  }

  if (trips === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-8 md:py-12">
        <div className="rounded-3xl border border-ts-border bg-ts-surface p-8 text-center text-ts-text-2">
          Loading trips…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      {/* Top nav row — stacks gracefully on narrow screens */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back to trips
        </Link>

        <div className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-xs text-ts-text-3">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[180px] sm:max-w-none">{dateLabel}</span>
        </div>
      </div>

      {/* Summary card */}
      <section className="mb-6 overflow-hidden rounded-3xl border border-ts-border bg-ts-surface shadow-sm">
        <div className="border-b border-ts-border px-4 py-4 md:px-6 md:py-5">
          {/* Pill row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-semibold text-ts-text-1">
              {accentLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-ts-text-2">
              {summary.operators} operator{summary.operators === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-ts-text-2">
              <MapPinned className="h-4 w-4 shrink-0" />
              Day overview
            </span>
          </div>

          {/* Title + actions — stack on mobile, row on md+ */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-ts-text-3">
                Trips recorded on this date
              </div>
              <h1 className="mt-1.5 text-2xl font-bold text-ts-text-1 sm:text-3xl md:text-4xl">
                {dateLabel}
              </h1>
            </div>

            <div className="shrink-0">
              <Link
                href={`/trip/${date}/map`}
                className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm font-semibold text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
              >
                <MapPinned className="h-4 w-4 shrink-0" />
                View map
              </Link>
            </div>
          </div>
        </div>

        {/* Stats — 3 equal columns at all sizes */}
        <div className="grid grid-cols-3 gap-3 border-t border-ts-border px-4 py-4 md:px-6">
          <StatCard label="Trips" value={String(summary.totalTrips)} />
          <StatCard label="First time" value={String(summary.firstTimeTrips)} />
          <StatCard
            label="Time span"
            value={`${summary.firstDeparture} → ${summary.lastArrival}`}
          />
        </div>
      </section>

      {/* Trip list */}
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
            No trips recorded on this date
          </h2>
          <p className="mt-2 text-sm text-ts-text-3">
            Use the map view if you want the route layout for this day.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              href={`/trip/${date}/map`}
              className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm font-semibold text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
            >
              <MapPinned className="h-4 w-4 shrink-0" />
              Open map
            </Link>
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm font-semibold text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to profile
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}