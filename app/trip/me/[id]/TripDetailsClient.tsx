'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation } from 'convex/react';
import { useUser } from '@clerk/nextjs';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMapStyleUrl } from '@/components/mapStyleUrl';
import { useTheme } from '@/components/ThemeProvider';
import type { Id } from '@/convex/_generated/dataModel';
import { api } from '@/convex/_generated/api';
import { useQuery } from 'convex/react';
import { IWasHereButton } from '@/components/IWasHereButton';
import {
  ArrowLeft,
  BadgeInfo,
  Bus,
  CalendarDays,
  Copy,
  LoaderCircle,
  MapPinned,
  NotebookText,
  Route,
  TrainFront,
  TramFront,
  Trash2,
  UserRound,
  Waypoints,
} from 'lucide-react';

type StopRecord = {
  name?: string;
  commonName?: string;
  crsCode?: string | null;
  atcoCode?: string | null;
  lat?: number;
  lon?: number;
};

type RouteStopLike = {
  name?: string;
  commonName?: string;
  stop?: {
    name?: string;
    commonName?: string;
    lat?: number;
    lon?: number;
  };
  lat?: number;
  lon?: number;
  actual_departure?: string | null;
  actual_arrival?: string | null;
  scheduled_departure?: string | null;
  scheduled_arrival?: string | null;
};

type RouteGeometry = {
  coordinates?: [number, number][];
};

type RoutePayload = {
  geometry?: RouteGeometry;
  coordinates?: [number, number][];
  stops?: RouteStopLike[];
  full_locations?: RouteStopLike[];
};

type RailDetails = {
  rid: string;
  uid: string;
  headcode: string;
  train_operator: string | null;
  origin_name: string;
  destination_name: string;
  origin_departure: string | null;
  destination_arrival: string | null;
  unit_numbers?: string[];
};

type UnitInfo = {
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery?: string;
  livery_left?: string;
};

type TripDetailsData = {
  trip: {
    _id: Id<'tripLogs'>;
    user: string;
    transport_type: string;
    service_number: string;
    operator: string;
    operator_slug: string;
    service_date: number;
    origin_name: string;
    origin_stop_code: string;
    destination_name: string;
    destination_stop_code: string;
    scheduled_departure: string;
    actual_departure?: string;
    scheduled_arrival: string;
    actual_arrival?: string;
    full_route?: RoutePayload | null;
    ridden_route?: RoutePayload | null;
    full_locations?: RouteStopLike[] | null;
    units?: UnitInfo[];
    unit_number?: string;
    unit_reg?: string;
    unit_type?: string;
    livery_name?: string;
    livery_css?: string;
    notes?: string;
    first_time?: boolean;
    first_units?: string[];
    on_trip_with: string[];
  };
  originStop: StopRecord | null;
  destinationStop: StopRecord | null;
  operatorRecord: { display_name: string } | null;
  railDetails: RailDetails | null;
  units: UnitInfo[];
};

type TripParticipant = {
  userId: string;
  username: string;
  addedAt: number;
  first_time?: boolean;
  first_units?: string[];
};

type Props = {
  data: TripDetailsData;
  isOwner?: boolean;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function normalizeTimestamp(value: number) {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function dateKeyFromTimestamp(value: number) {
  const date = new Date(normalizeTimestamp(value));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimeValue(value?: string | null) {
  if (!value) return '—';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function parseTimeMs(serviceDate: number, value?: string | null) {
  if (!value) return null;

  if (value.includes('T')) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  const dateKey = dateKeyFromTimestamp(serviceDate);
  const parsed = new Date(`${dateKey}T${value}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function getDelayMs(serviceDate: number, scheduled?: string | null, actual?: string | null) {
  const scheduledMs = parseTimeMs(serviceDate, scheduled);
  const actualMs = parseTimeMs(serviceDate, actual);

  if (scheduledMs === null || actualMs === null) return null;
  return actualMs - scheduledMs;
}

function formatDuration(ms: number | null) {
  if (ms === null || Number.isNaN(ms)) return '—';
  const totalMinutes = Math.round(ms / 60000);
  const sign = totalMinutes < 0 ? '-' : '+';
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;

  if (hours === 0) return `${sign}${minutes}m`;
  return `${sign}${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

function haversineKm(start: [number, number], end: [number, number]) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const radiusKm = 6371;

  const latitude1 = toRadians(start[1]);
  const latitude2 = toRadians(end[1]);
  const latitudeDelta = toRadians(end[1] - start[1]);
  const longitudeDelta = toRadians(end[0] - start[0]);

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(latitude1) * Math.cos(latitude2) *
    Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);

  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractCoordinates(route?: RoutePayload | null): [number, number][] {
  const candidate = route?.geometry?.coordinates ?? route?.coordinates;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((point): point is [number, number] => Array.isArray(point) && point.length === 2);
}

function extractStops(route?: RoutePayload | null) {
  const candidate = route?.stops ?? route?.full_locations;
  if (!Array.isArray(candidate)) return [];
  return candidate;
}

function getStopLabel(stop: RouteStopLike, fallback: string) {
  return stop?.name ?? stop?.commonName ?? stop?.stop?.name ?? stop?.stop?.commonName ?? fallback;
}

function getStopTime(stop: RouteStopLike) {
  return stop?.actual_departure ?? stop?.actual_arrival ?? stop?.scheduled_departure ?? stop?.scheduled_arrival ?? null;
}

function getStopCoordinates(stop: RouteStopLike, fallback?: StopRecord | null) {
  const lat = stop?.lat ?? stop?.stop?.lat ?? fallback?.lat;
  const lon = stop?.lon ?? stop?.stop?.lon ?? fallback?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return [lon, lat] as [number, number];
}

function getAccentClasses(type: string) {
  switch (type) {
    case 'Rail':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
    case 'Bus':
      return 'border-orange-500/25 bg-orange-500/10 text-orange-300';
    case 'Tram':
      return 'border-purple-500/25 bg-purple-500/10 text-purple-300';
    default:
      return 'border-sky-500/25 bg-sky-500/10 text-sky-300';
  }
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

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-ts-border bg-ts-surface p-4 md:p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ts-text-3">{label}</div>
      <div className="mt-2 text-xl font-bold text-ts-text-1 tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-ts-text-3">{sub}</div> : null}
    </div>
  );
}

function normalizeUnitInfo(unit?: UnitInfo | null): UnitInfo {
  return {
    unit_number: typeof unit?.unit_number === 'string' ? unit.unit_number : undefined,
    unit_reg: typeof unit?.unit_reg === 'string' ? unit.unit_reg : undefined,
    unit_type: typeof unit?.unit_type === 'string' ? unit.unit_type : undefined,
    livery: typeof unit?.livery === 'string' ? unit.livery : undefined,
    livery_left: typeof unit?.livery_left === 'string' ? unit.livery_left : undefined,
  };
}

function normalizeTripUnits(trip: TripDetailsData['trip']): UnitInfo[] {
  if (Array.isArray(trip.units) && trip.units.length > 0) {
    return trip.units.map((unit) => normalizeUnitInfo(unit));
  }

  const fallback = normalizeUnitInfo({
    unit_number: trip.unit_number,
    unit_reg: trip.unit_reg,
    unit_type: trip.unit_type,
    livery: trip.livery_name,
    livery_left: trip.livery_css,
  });

  return fallback.unit_number || fallback.unit_reg || fallback.unit_type || fallback.livery || fallback.livery_left ? [fallback] : [];
}

function SectionCard({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-ts-border bg-ts-surface ${className}`}>
      <div className="flex items-center gap-2 border-b border-ts-border px-4 py-3 md:px-5">
        <div className="text-ts-text-2">{icon}</div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ts-text-1">{title}</h2>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

export function TripDetailsClient({ data, isOwner = true }: Props) {
  const { theme } = useTheme();
  const router = useRouter();
  const deleteTrip = useMutation(api.functions.trips.deleteTrip);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [isDeleting, setIsDeleting] = useState(false);

  const trip = data.trip;
  const isParticipating = useQuery(
    api.functions.friends.getMyParticipationStatus,
    !isOwner ? { tripId: trip._id } : "skip",
  );
  const tripOwner = useQuery(
    api.functions.friends.getUserByClerkId,
    !isOwner ? { clerkId: trip.user } : "skip",
  );
  const { user } = useUser();
  const tripParticipants = useQuery(api.functions.friends.getTripParticipants, { tripId: trip._id }) as TripParticipant[] | undefined;
  const participatedTrips = useQuery(
    api.functions.friends.getUserParticipatedTrips,
    user ? { userId: user.id } : "skip",
  ) as Array<{ _id: string; first_time?: boolean; first_units?: string[] }> | undefined;
  const accentClasses = getAccentClasses(trip.transport_type);
  const operatorName = data.operatorRecord?.display_name ?? trip.operator;
  const tripUnits = useMemo(() => normalizeTripUnits(trip), [trip]);
  const viewerParticipation = useMemo(
    () => participatedTrips?.find((participant) => participant._id === trip._id) ?? null,
    [participatedTrips, trip._id],
  );
  const isFirstTime = isOwner
    ? Boolean(trip.first_units?.length || trip.first_time)
    : Boolean(viewerParticipation?.first_time || viewerParticipation?.first_units?.length);

  const fullCoordinates = useMemo(() => extractCoordinates(trip.full_route), [trip.full_route]);
  const riddenCoordinates = useMemo(() => extractCoordinates(trip.ridden_route), [trip.ridden_route]);
  const routeStops = useMemo(() => {
    const riddenStops = extractStops(trip.ridden_route);
    if (riddenStops.length > 0) return riddenStops;
    const fullStops = extractStops(trip.full_route);
    if (fullStops.length > 0) return fullStops;
    return Array.isArray(trip.full_locations) ? trip.full_locations : [];
  }, [trip.full_locations, trip.full_route, trip.ridden_route]);

  const originCoord = useMemo(
    () => getStopCoordinates(routeStops[0], data.originStop),
    [data.originStop, routeStops],
  );
  const destinationCoord = useMemo(
    () => getStopCoordinates(routeStops[routeStops.length - 1], data.destinationStop),
    [data.destinationStop, routeStops],
  );

  const departureDelayMs = useMemo(
    () => getDelayMs(trip.service_date, trip.scheduled_departure, trip.actual_departure),
    [trip.actual_departure, trip.scheduled_departure, trip.service_date],
  );
  const arrivalDelayMs = useMemo(
    () => getDelayMs(trip.service_date, trip.scheduled_arrival, trip.actual_arrival),
    [trip.actual_arrival, trip.scheduled_arrival, trip.service_date],
  );
  const primaryDelayMs = departureDelayMs ?? arrivalDelayMs ?? null;
  const isDelayed = primaryDelayMs !== null && primaryDelayMs > 60_000;
  const isEarly = primaryDelayMs !== null && primaryDelayMs < 0;
  const delayLabel = primaryDelayMs !== null ? (isDelayed ? 'Delayed' : isEarly ? 'Early' : 'On time') : null;

  const durationMs = useMemo(() => {
    const actualDeparture = parseTimeMs(trip.service_date, trip.actual_departure);
    const actualArrival = parseTimeMs(trip.service_date, trip.actual_arrival);
    if (actualDeparture !== null && actualArrival !== null) return actualArrival - actualDeparture;

    const scheduledDeparture = parseTimeMs(trip.service_date, trip.scheduled_departure);
    const scheduledArrival = parseTimeMs(trip.service_date, trip.scheduled_arrival);
    if (scheduledDeparture !== null && scheduledArrival !== null) return scheduledArrival - scheduledDeparture;

    return null;
  }, [trip.actual_arrival, trip.actual_departure, trip.scheduled_arrival, trip.scheduled_departure, trip.service_date]);

  const distanceKm = useMemo(() => {
    const riddenPath = riddenCoordinates.length > 1 ? riddenCoordinates : fullCoordinates;
    if (riddenPath.length > 1) {
      let total = 0;
      for (let index = 1; index < riddenPath.length; index += 1) {
        total += haversineKm(riddenPath[index - 1], riddenPath[index]);
      }
      return total;
    }

    if (originCoord && destinationCoord) {
      return haversineKm(originCoord, destinationCoord);
    }

    return null;
  }, [destinationCoord, fullCoordinates, originCoord, riddenCoordinates]);

  const stopCount = routeStops.length > 0 ? routeStops.length : riddenCoordinates.length > 0 ? riddenCoordinates.length : fullCoordinates.length;

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const hasMapData = riddenCoordinates.length > 1 || fullCoordinates.length > 1;
    if (!hasMapData) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getMapStyleUrl(theme),
      center: riddenCoordinates[0] ?? fullCoordinates[0] ?? [-1.5, 52.5],
      zoom: 11,
    });

    mapRef.current = map;

    map.on('load', () => {
      type RouteFeature = {
        type: 'Feature';
        geometry:
          | { type: 'LineString'; coordinates: [number, number][] }
          | { type: 'Point'; coordinates: [number, number] };
        properties: { kind: 'full' | 'ridden' | 'origin' | 'destination' };
      };

      const features: RouteFeature[] = [];
      const bounds = new maplibregl.LngLatBounds();

      if (fullCoordinates.length > 1) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: fullCoordinates },
          properties: { kind: 'full' },
        });

        fullCoordinates.forEach((coord) => bounds.extend(coord));
      }

      if (riddenCoordinates.length > 1) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: riddenCoordinates },
          properties: { kind: 'ridden' },
        });

        riddenCoordinates.forEach((coord) => bounds.extend(coord));
      }

      if (originCoord) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: originCoord },
          properties: { kind: 'origin' },
        });
        bounds.extend(originCoord);
      }

      if (destinationCoord) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: destinationCoord },
          properties: { kind: 'destination' },
        });
        bounds.extend(destinationCoord);
      }

      if (!map.getSource('trip-route')) {
        map.addSource('trip-route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });
      }

      map.addLayer({
        id: 'full-route',
        type: 'line',
        source: 'trip-route',
        filter: ['==', ['get', 'kind'], 'full'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#64748b',
          'line-width': 4,
          'line-opacity': 0.35,
        },
      });

      map.addLayer({
        id: 'ridden-route',
        type: 'line',
        source: 'trip-route',
        filter: ['==', ['get', 'kind'], 'ridden'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#60a5fa',
          'line-width': 5,
          'line-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'origin-point',
        type: 'circle',
        source: 'trip-route',
        filter: ['==', ['get', 'kind'], 'origin'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#60a5fa',
        },
      });

      map.addLayer({
        id: 'destination-point',
        type: 'circle',
        source: 'trip-route',
        filter: ['==', ['get', 'kind'], 'destination'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#60a5fa',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 44, duration: 500, maxZoom: 14 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [destinationCoord, fullCoordinates, originCoord, riddenCoordinates, theme]);

  const routeTitle = `${trip.origin_name} → ${trip.destination_name}`;

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    await navigator.clipboard.writeText(window.location.href);
    setShareState('copied');
    window.setTimeout(() => setShareState('idle'), 1800);
  };

  const handleDelete = async () => {
    if (isDeleting) return;

    const confirmed = window.confirm('Delete this trip? This cannot be undone.');
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      await deleteTrip({ tripId: trip._id });
      router.replace('/profile');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        {isOwner ? (
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to trips
          </Link>
        ) : (
          <Link
            href={`/profile/${trip.user}`}
            className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-2 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            {tripOwner?.username ?? 'User'}&apos;s trips
          </Link>
        )}

        <div className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface px-3 py-2 text-xs text-ts-text-3">
          <CalendarDays className="h-3.5 w-3.5" />
          {new Date(normalizeTimestamp(trip.service_date)).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </div>
      </div>

      <section className={`mb-6 overflow-hidden rounded-3xl border ${accentClasses} bg-ts-surface shadow-sm`}>
        <div className="border-b border-white/10 px-5 py-4 md:px-6 md:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-semibold text-ts-text-1">
              {trip.service_number}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-ts-text-2">
              {operatorName}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-ts-text-2 inline-flex items-center gap-1.5">
              {getTransportIcon(trip.transport_type)}
              {trip.transport_type}
            </span>
            {!isOwner && tripOwner ? (
              <Link
                href={`/profile/${trip.user}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300 hover:border-sky-400/50 hover:bg-sky-500/20 transition-colors"
              >
                <UserRound className="h-3 w-3" />
                Trip by {tripOwner.username}
              </Link>
            ) : null}
            {!isOwner && isParticipating ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                <MapPinned className="h-3 w-3" />
                You were on this trip
              </span>
            ) : null}
            {isFirstTime ? (
              <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
                <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 1l1.2 3.6H11l-3 2.2 1.1 3.6L6 8.2l-3.1 2.2L4 7 1 4.8h3.8z"/>
                </svg>
                First Time
              </div>
            ) : null}
            {primaryDelayMs !== null ? (
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                  isDelayed
                    ? 'border-rose-400/25 bg-rose-400/10 text-rose-300'
                    : isEarly
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                      : 'border-sky-400/25 bg-sky-400/10 text-sky-300'
                }`}
              >
                {delayLabel} {formatDuration(primaryDelayMs)}
              </span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium uppercase tracking-[0.16em] text-ts-text-3">
                {formatTimeValue(trip.scheduled_departure)} → {formatTimeValue(trip.scheduled_arrival)}
              </div>
              <h1 className="mt-2 text-2xl font-bold text-ts-text-1 md:text-2xl">{routeTitle}</h1>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-white/10 px-5 py-4 md:grid-cols-2 lg:grid-cols-4 md:px-6">
          <StatCard
            label="Duration"
            value={formatDuration(durationMs)}
          />
          <StatCard
            label="Distance"
            value={distanceKm !== null ? `${distanceKm.toFixed(1)} km` : '—'}
          />
          <StatCard
            label="Delay"
            value={`Dep: ${formatDuration(departureDelayMs)} | Arr: ${formatDuration(arrivalDelayMs)}`}
          />
          <StatCard
            label="Stops"
            value={String(stopCount || '—')}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <SectionCard title="Map" icon={<MapPinned className="h-4 w-4" />}>
            {fullCoordinates.length > 1 || riddenCoordinates.length > 1 ? (
              <div className="space-y-3">
                <div className="h-[500px] overflow-hidden rounded-2xl border border-ts-border bg-ts-bg">
                  <div ref={mapContainerRef} className="h-full w-full" />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-ts-border p-4 text-sm text-ts-text-3">
                Route geometry is unavailable for this trip, so the stop timeline below acts as the fallback view.
              </div>
            )}
          </SectionCard>

          <SectionCard title="Stops" icon={<Route className="h-4 w-4" />}>
            {routeStops.length > 0 ? (
              <div className="space-y-3">
                {routeStops.map((stop, index) => {
                  const isEdge = index === 0 || index === routeStops.length - 1;
                  const label = getStopLabel(stop, index === 0 ? trip.origin_name : index === routeStops.length - 1 ? trip.destination_name : `Stop ${index + 1}`);
                  const time = getStopTime(stop);

                  return (
                    <div key={`${label}-${index}`} className="flex gap-3 rounded-2xl border border-ts-border bg-ts-surface-2 px-4 py-3">
                      <div className="flex flex-col items-center pt-0.5">
                        <div className={`h-3 w-3 rounded-full ${isEdge ? 'bg-ts-accent' : 'bg-white/40'}`} />
                        {index < routeStops.length - 1 ? <div className="mt-1 h-full min-h-8 w-px bg-white/10" /> : null}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ts-text-1">{label}</span>
                          {isEdge ? (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ts-text-3">
                              {index === 0 ? 'Origin' : 'Destination'}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-ts-text-3">
                          {time ? formatTimeValue(time) : 'No stop time available'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-ts-border bg-ts-surface-2 p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-ts-text-3">Origin</div>
                  <div className="mt-1 font-semibold text-ts-text-1">{trip.origin_name}</div>
                </div>
                <div className="rounded-2xl border border-ts-border bg-ts-surface-2 p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-ts-text-3">Destination</div>
                  <div className="mt-1 font-semibold text-ts-text-1">{trip.destination_name}</div>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Vehicle" icon={<Waypoints className="h-4 w-4" />}>
            {tripUnits.length > 0 ? (
              <div className="space-y-3">
                {tripUnits.map((unit, index) => {
                  const liveryCss = unit.livery_left ?? trip.livery_css ?? null;
                  const unitLabel = [unit.unit_number, unit.unit_reg].filter(Boolean).join(' · ') || 'Unknown unit';

                  return (
                    <div key={`${unitLabel}-${index}`} className="rounded-2xl border border-ts-border bg-ts-surface-2 p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className="h-12 w-16 shrink-0 rounded-xl border border-ts-border-soft"
                          style={{ background: liveryCss ?? undefined }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-mono text-sm font-semibold text-ts-text-1">{unitLabel}</div>
                            {unit.unit_type ? (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-ts-text-3">
                                {unit.unit_type}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-ts-text-3">
                            {unit.livery ?? 'Vehicle data from trip payload'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-ts-border p-4 text-sm text-ts-text-3">
                Vehicle details were not recorded on this trip.
              </div>
            )}
          </SectionCard>

          <SectionCard title="Companions" icon={<UserRound className="h-4 w-4" />}>
            {tripParticipants && tripParticipants.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tripParticipants.map((participant) => (
                  <span key={participant.userId} className="rounded-full border border-ts-border bg-ts-surface-2 px-3 py-1.5 text-sm text-ts-text-1">
                    {participant.username}
                  </span>
                ))}
              </div>
            ) : trip.on_trip_with.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {trip.on_trip_with.map((name) => (
                  <span key={name} className="rounded-full border border-ts-border bg-ts-surface-2 px-3 py-1.5 text-sm text-ts-text-1">
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-sm text-ts-text-3">No companions recorded for this trip.</div>
            )}
          </SectionCard>

          {trip.notes ? (
            <SectionCard title="Notes" icon={<NotebookText className="h-4 w-4" />}>
              <div className="whitespace-pre-wrap rounded-2xl border border-ts-border bg-ts-surface-2 p-4 text-sm leading-6 text-ts-text-2">
                {trip.notes}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Actions" icon={<BadgeInfo className="h-4 w-4" />}>
            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <>
                  <Link
                    href={`/log?trip_id=${trip._id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
                  >
                    <LoaderCircle className="h-4 w-4" />
                    Edit trip
                  </Link>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300 transition hover:border-rose-400/50 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    title="Delete your own trip"
                  >
                    <Trash2 className="h-4 w-4" />
                    {isDeleting ? 'Deleting...' : 'Delete trip'}
                  </button>
                </>
              ) : (
                <IWasHereButton tripId={trip._id} tripUserId={trip.user} />
              )}
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm text-ts-text-1 transition hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent"
              >
                <Copy className="h-4 w-4" />
                {shareState === 'copied' ? 'Link copied' : 'Share trip'}
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
