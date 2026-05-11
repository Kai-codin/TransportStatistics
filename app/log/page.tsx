'use client';

import { useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import { useMutation } from 'convex/react';
import { useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { LogMap } from '@/components/LogMap';
import { SignInButton, useUser } from '@clerk/nextjs';
import {
  AlertCircle,
  Bus,
  CheckCircle2,
  List,
  LoaderCircle,
  Map,
  NotebookText,
  Plus,
  Route,
  Save,
  TramFront,
  TrainFront,
} from 'lucide-react';

type TabKey = 'Route' | 'Vehicle' | 'Service' | 'Notes';
type RouteMode = 'Map' | 'List';
type VehicleMode = 'Bus' | 'Train' | 'Tram' | 'Other';
type StoredTransportType = 'Rail' | 'Bus' | 'Tram' | 'Other';

type RouteGeometry = {
  type: 'LineString';
  coordinates: [number, number][];
};

type SearchResult = {
  id: string;
  source: 'train' | 'bus';
  unit_number: string;
  unit_reg: string;
  withdrawn?: boolean;
  type: { type_id: string; type_name: string };
  operator: { operator_id: string; operator_name: string; operator_slug: string; operator_code: string };
  livery: { livery_id: string; livery_name: string; livery_css: string };
};

type RouteStop = {
  id: number;
  stop: {
    stop_code?: string | null;
    name?: string | null;
    location?: [number, number] | null;
    bearing?: number | null;
    icon?: string | null;
  };
  scheduled_arrival?: string | null;
  scheduled_departure?: string | null;
  actual_arrival?: string | null;
  actual_departure?: string | null;
  track?: [number, number][] | null;
  timing_status?: string | null;
  pick_up?: boolean;
  set_down?: boolean;
};

type TripUnit = {
  unit_number: string;
  unit_reg: string;
  unit_type: string;
  livery: string;
  livery_left: string;
};

type ApiLogResponse = {
  service_number?: string;
  operator?: string;
  operator_slug?: string;
  service_date?: number;
  bustimes_service_id?: number;
  bustimes_service_slug?: string;
  origin_name?: string;
  origin_stop_code?: string | null;
  destination_name?: string;
  destination_stop_code?: string | null;
  scheduled_departure?: string | null;
  actual_departure?: string | null;
  scheduled_arrival?: string | null;
  actual_arrival?: string | null;
  full_route?: RouteStop[];
  full_route_geometry?: RouteGeometry | null;
  unit?: Partial<TripUnit> | null;
  error?: string;
  details?: string;
  message?: string;
};

type ServiceFormState = {
  service_number: string;
  operator: string;
  operator_slug: string;
  service_date: string;
  origin_name: string;
  origin_stop_code: string;
  destination_name: string;
  destination_stop_code: string;
  scheduled_departure: string;
  actual_departure: string;
  scheduled_arrival: string;
  actual_arrival: string;
  bustimes_service_id: string;
  bustimes_service_slug: string;
};

type RiddenRoute = {
  from_stop_id: number;
  to_stop_id: number;
  origin_name: string;
  destination_name: string;
  stops: RouteStop[];
  geometry: RouteGeometry | null;
};

type RequestResolution = {
  url: string;
  vehicleMode: VehicleMode;
  date: string;
  label: string;
};

const TABS: TabKey[] = ['Route', 'Vehicle', 'Service', 'Notes'];
const ROUTE_MODES: RouteMode[] = ['Map', 'List'];
const VEHICLE_MODES: VehicleMode[] = ['Bus', 'Train', 'Tram', 'Other'];

const EMPTY_SERVICE_FORM: ServiceFormState = {
  service_number: '',
  operator: '',
  operator_slug: '',
  service_date: '',
  origin_name: '',
  origin_stop_code: '',
  destination_name: '',
  destination_stop_code: '',
  scheduled_departure: '',
  actual_departure: '',
  scheduled_arrival: '',
  actual_arrival: '',
  bustimes_service_id: '',
  bustimes_service_slug: '',
};

const EMPTY_UNIT: TripUnit = {
  unit_number: '',
  unit_reg: '',
  unit_type: '',
  livery: '',
  livery_left: '',
};

function safeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateInputValue(timestamp?: number, fallbackDate?: string) {
  if (fallbackDate) return fallbackDate;
  if (typeof timestamp !== 'number') return '';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function toTimeInputValue(value?: string | null) {
  if (!value) return '';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function formatDisplayTime(value?: string | null) {
  const formatted = toTimeInputValue(value);
  return formatted || '—';
}

function normalizeUnit(unit?: Partial<TripUnit> | null): TripUnit {
  return {
    unit_number: safeString(unit?.unit_number),
    unit_reg: safeString(unit?.unit_reg),
    unit_type: safeString(unit?.unit_type),
    livery: safeString(unit?.livery),
    livery_left: safeString(unit?.livery_left),
  };
}

function dedupeCoordinates(coordinates: [number, number][]) {
  return coordinates.filter((coordinate, index) => {
    if (index === 0) return true;
    const previous = coordinates[index - 1];
    return previous[0] !== coordinate[0] || previous[1] !== coordinate[1];
  });
}

function buildFullGeometry(fullRoute: RouteStop[], geometry?: RouteGeometry | null) {
  if (geometry?.coordinates?.length) return geometry;

  const coordinates: [number, number][] = [];

  fullRoute.forEach((stop) => {
    if (Array.isArray(stop.track) && stop.track.length > 0) {
      coordinates.push(...stop.track);
      return;
    }
    if (Array.isArray(stop.stop.location) && stop.stop.location.length === 2) {
      coordinates.push(stop.stop.location);
    }
  });

  const deduped = dedupeCoordinates(coordinates);
  return deduped.length > 0 ? { type: 'LineString' as const, coordinates: deduped } : null;
}

function buildRiddenRoute(fullRoute: RouteStop[], fromStopId: number | null, toStopId: number | null): RiddenRoute | null {
  if (fromStopId === null || toStopId === null || fromStopId === toStopId) return null;

  const fromIndex = fullRoute.findIndex((stop) => stop.id === fromStopId);
  const toIndex = fullRoute.findIndex((stop) => stop.id === toStopId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex > toIndex) return null;

  const stops = fullRoute.slice(fromIndex, toIndex + 1);
  const coordinates = dedupeCoordinates(
    stops.flatMap((stop, index) => {
      const isLastStop = index === stops.length - 1;

      // Don't include the last stop's track — it leads to the *next* stop beyond the selection
      if (!isLastStop && Array.isArray(stop.track) && stop.track.length > 0) {
        return stop.track;
      }
      // For the last stop, just pin its location
      if (Array.isArray(stop.stop.location) && stop.stop.location.length === 2) {
        return [stop.stop.location];
      }
      return [];
    }),
  );

  return {
    from_stop_id: fromStopId,
    to_stop_id: toStopId,
    origin_name: safeString(stops[0]?.stop.name),
    destination_name: safeString(stops[stops.length - 1]?.stop.name),
    stops,
    geometry: coordinates.length > 0 ? { type: 'LineString', coordinates } : null,
  };
}

function getStartScheduledTime(stop?: RouteStop) {
  return toTimeInputValue(stop?.scheduled_departure || stop?.scheduled_arrival);
}

function getStartActualTime(stop?: RouteStop) {
  return toTimeInputValue(stop?.actual_departure || stop?.actual_arrival);
}

function getEndScheduledTime(stop?: RouteStop) {
  return toTimeInputValue(stop?.scheduled_arrival || stop?.scheduled_departure);
}

function getEndActualTime(stop?: RouteStop) {
  return toTimeInputValue(stop?.actual_arrival || stop?.actual_departure);
}

function mapVehicleModeToTransportType(mode: VehicleMode): StoredTransportType {
  if (mode === 'Train') return 'Rail';
  if (mode === 'Tram') return 'Tram';
  if (mode === 'Bus') return 'Bus';
  return 'Other';
}

function serializeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

function resolveRequest(searchParams: URLSearchParams): RequestResolution {
  const serviceUid = searchParams.get('service_uid');
  if (serviceUid) {
    const parts = serviceUid.split(':');
    if (parts.length < 3) {
      throw new Error('Expected `service_uid` in the format `gb-nr:UID:YYYY-MM-DD`.');
    }
    const uid = parts[1];
    const date = parts[2];
    return {
      url: `/api/log?date=${encodeURIComponent(date)}&type=train&uid=${encodeURIComponent(uid)}`,
      vehicleMode: 'Train',
      date,
      label: `Train ${uid} on ${date}`,
    };
  }

  const serviceId = searchParams.get('service_id');
  const date = searchParams.get('date');
  if (serviceId && date) {
    return {
      url: `/api/log?date=${encodeURIComponent(date)}&type=bus&uid=${encodeURIComponent(serviceId)}`,
      vehicleMode: 'Bus',
      date,
      label: `Bus ${serviceId} on ${date}`,
    };
  }

  const serviceRid = searchParams.get('service_rid');
  if (serviceRid) {
    return {
      url: `/api/log?service_rid=${encodeURIComponent(serviceRid)}`,
      vehicleMode: 'Train',
      date: '',
      label: `Train RID ${serviceRid}`,
    };
  }

  throw new Error('Missing query parameters. Use `service_uid`, `service_id` with `date`, or `service_rid`.');
}

function textInputClassName() {
  return 'h-11 rounded-xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20';
}

function sectionClassName() {
  return 'rounded-[20px] border border-ts-border bg-ts-surface p-4 md:p-5';
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-ts-text-3">{label}</span>
      {children}
    </label>
  );
}

export default function LogPage() {
  const [mounted, setMounted] = useState(false);
  const [searchKey, setSearchKey] = useState('');
  const [queryReady, setQueryReady] = useState(false);
  const { isSignedIn } = useUser();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const logTrip = useMutation(api.functions.trips.logTrip);

  const [activeTab, setActiveTab] = useState<TabKey>('Route');
  const [routeMode, setRouteMode] = useState<RouteMode>('Map');
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>('Train');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(EMPTY_SERVICE_FORM);
  const [notes, setNotes] = useState('');
  const [fullRoute, setFullRoute] = useState<RouteStop[]>([]);
  const [fullGeometry, setFullGeometry] = useState<RouteGeometry | null>(null);
  const [fromStopId, setFromStopId] = useState<number | null>(null);
  const [toStopId, setToStopId] = useState<number | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [units, setUnits] = useState<TripUnit[]>([]);
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);

  const [unitSearch, setUnitSearch] = useState('');
  const [unitSearchResults, setUnitSearchResults] = useState<SearchResult[]>([]);
  const [unitSearchLoading, setUnitSearchLoading] = useState(false);
  const [unitSearchOpen, setUnitSearchOpen] = useState(false);
  const unitSearchRef = useRef<HTMLDivElement>(null);

  const [draggedUnitIndex, setDraggedUnitIndex] = useState<number | null>(null);
  const [dragOverUnitIndex, setDragOverUnitIndex] = useState<number | null>(null);

  const selectedStop = fullRoute.find((stop) => stop.id === selectedStopId) ?? null;
  const riddenRoute = buildRiddenRoute(fullRoute, fromStopId, toStopId);
  const selectedUnit = units[selectedUnitIndex] ?? null;

  useEffect(() => {
    setMounted(true);
    setSearchKey(window.location.search.startsWith('?') ? window.location.search.slice(1) : '');
    setQueryReady(true);
  }, []);

  useEffect(() => {
    if (unitSearch.trim().length < 2) {
      setUnitSearchResults([]);
      setUnitSearchOpen(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setUnitSearchLoading(true);
      try {
        const type = vehicleMode === 'Train' ? 'train' : vehicleMode === 'Bus' ? 'bus' : '';
        const params = new URLSearchParams({ q: unitSearch });
        if (type) params.set('type', type);
        const res = await fetch(`/api/search?${params}`);
        const data: SearchResult[] = await res.json();
        setUnitSearchResults(data);
        setUnitSearchOpen(data.length > 0);
      } catch {
        setUnitSearchResults([]);
      } finally {
        setUnitSearchLoading(false);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [unitSearch, vehicleMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (unitSearchRef.current && !unitSearchRef.current.contains(e.target as Node)) {
        setUnitSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!queryReady) return;

    let cancelled = false;

    async function loadTripData() {
      try {
        setLoading(true);
        setLoadError('');
        setSaveError('');
        setSaveSuccess('');

        const resolution = resolveRequest(new URLSearchParams(searchKey));
        if (cancelled) return;

        setVehicleMode(resolution.vehicleMode);
        setSourceLabel(resolution.label);

        const response = await fetch(resolution.url, { cache: 'no-store' });
        const payload = (await response.json()) as ApiLogResponse;

        if (!response.ok) {
          throw new Error(payload.details || payload.message || payload.error || 'Failed to load service details.');
        }

        const route = Array.isArray(payload.full_route) ? payload.full_route : [];
        const resolvedGeometry = buildFullGeometry(route, payload.full_route_geometry);
        const initialUnits = payload.unit ? [normalizeUnit(payload.unit)] : [];
        const firstStop = route[0];
        const lastStop = route[route.length - 1];

        if (cancelled) return;

        setFullRoute(route);
        setFullGeometry(resolvedGeometry);
        setUnits(initialUnits);
        setSelectedUnitIndex(0);
        setSelectedStopId(firstStop?.id ?? null);
        setFromStopId(route.length > 1 ? firstStop?.id ?? null : null);
        setToStopId(route.length > 1 ? lastStop?.id ?? null : null);
        setNotes('');
        setServiceForm({
          service_number: safeString(payload.service_number),
          operator: safeString(payload.operator),
          operator_slug: safeString(payload.operator_slug),
          service_date: toDateInputValue(payload.service_date, resolution.date),
          origin_name: safeString(payload.origin_name),
          origin_stop_code: safeString(payload.origin_stop_code),
          destination_name: safeString(payload.destination_name),
          destination_stop_code: safeString(payload.destination_stop_code),
          scheduled_departure: toTimeInputValue(payload.scheduled_departure),
          actual_departure: toTimeInputValue(payload.actual_departure),
          scheduled_arrival: toTimeInputValue(payload.scheduled_arrival),
          actual_arrival: toTimeInputValue(payload.actual_arrival),
          bustimes_service_id: payload.bustimes_service_id ? String(payload.bustimes_service_id) : '',
          bustimes_service_slug: safeString(payload.bustimes_service_slug),
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load this service.');
          setFullRoute([]);
          setFullGeometry(null);
          setUnits([]);
          setServiceForm(EMPTY_SERVICE_FORM);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTripData();

    return () => {
      cancelled = true;
    };
  }, [queryReady, searchKey]);

  function updateServiceField<K extends keyof ServiceFormState>(field: K, value: ServiceFormState[K]) {
    setServiceForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function selectSearchResult(result: SearchResult) {
    const filled: TripUnit = {
      unit_number: result.unit_number,
      unit_reg: result.unit_reg,
      unit_type: result.type.type_name,
      livery: result.livery.livery_name,
      livery_left: result.livery.livery_css,
    };

    setUnits((current) => {
      // Bus: always replace the current slot (only one unit for a bus)
      if (vehicleMode === 'Bus') {
        const next = current.length === 0 ? [filled] : [...current];
        if (next.length > 0) next[selectedUnitIndex] = filled;
        setSelectedUnitIndex(0);
        return next;
      }

      // Train/Tram/Other: deduplicate
      const unitExists = current.some(
        (u) => u.unit_number === filled.unit_number && u.unit_reg === filled.unit_reg,
      );
      if (unitExists) return current;

      const currentHasData =
        current[selectedUnitIndex] &&
        (current[selectedUnitIndex].unit_number ||
          current[selectedUnitIndex].unit_reg ||
          current[selectedUnitIndex].unit_type);

      if (current.length === 0 || !currentHasData) {
        const next = [...current];
        if (next.length === 0) {
          next.push(filled);
          setSelectedUnitIndex(0);
        } else {
          next[selectedUnitIndex] = filled;
        }
        return next;
      }

      // Slot has data — add as new unit
      const next = [...current, filled];
      setSelectedUnitIndex(next.length - 1);
      return next;
    });

    setUnitSearch('');
    setUnitSearchOpen(false);
    setUnitSearchResults([]);
  }

  function syncServiceFormWithSelection(route: RouteStop[], nextFromStopId: number | null, nextToStopId: number | null) {
    const nextRiddenRoute = buildRiddenRoute(route, nextFromStopId, nextToStopId);
    if (!nextRiddenRoute) return;

    const firstStop = nextRiddenRoute.stops[0];
    const lastStop = nextRiddenRoute.stops[nextRiddenRoute.stops.length - 1];

    setServiceForm((current) => ({
      ...current,
      origin_name: safeString(firstStop?.stop.name),
      origin_stop_code: safeString(firstStop?.stop.stop_code),
      destination_name: safeString(lastStop?.stop.name),
      destination_stop_code: safeString(lastStop?.stop.stop_code),
      scheduled_departure: getStartScheduledTime(firstStop),
      actual_departure: getStartActualTime(firstStop),
      scheduled_arrival: getEndScheduledTime(lastStop),
      actual_arrival: getEndActualTime(lastStop),
    }));
  }

  function updateUnitField(field: keyof TripUnit, value: string) {
    setUnits((current) =>
      current.map((unit, index) =>
        index === selectedUnitIndex
          ? {
              ...unit,
              [field]: value,
            }
          : unit,
      ),
    );
  }

  function addUnit() {
    if (vehicleMode === 'Bus') return;
    setUnits((current) => {
      const next = [...current, { ...EMPTY_UNIT }];
      setSelectedUnitIndex(next.length - 1);
      return next;
    });
    setActiveTab('Vehicle');
  }

  function removeSelectedUnit() {
    setUnits((current) => {
      if (current.length === 0) return current;

      const next = current.filter((_, index) => index !== selectedUnitIndex);

      if (next.length === 0) {
        setSelectedUnitIndex(0);
        return next;
      }

      setSelectedUnitIndex(Math.min(selectedUnitIndex, next.length - 1));
      return next;
    });
  }

  function setStartStop(stopId: number) {
    if (stopId === toStopId) return;
    let nextToStopId = toStopId;

    if (toStopId !== null) {
      const fromIndex = fullRoute.findIndex((stop) => stop.id === stopId);
      const toIndex = fullRoute.findIndex((stop) => stop.id === toStopId);
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex > toIndex) {
        nextToStopId = null;
      }
    }

    setFromStopId(stopId);
    setToStopId(nextToStopId);
    setSelectedStopId(stopId);
    syncServiceFormWithSelection(fullRoute, stopId, nextToStopId);
  }

  function setEndStop(stopId: number) {
    if (stopId === fromStopId) return;
    let nextFromStopId = fromStopId;

    if (fromStopId !== null) {
      const fromIndex = fullRoute.findIndex((stop) => stop.id === fromStopId);
      const toIndex = fullRoute.findIndex((stop) => stop.id === stopId);
      if (fromIndex !== -1 && toIndex !== -1 && toIndex < fromIndex) {
        nextFromStopId = null;
      }
    }

    setFromStopId(nextFromStopId);
    setToStopId(stopId);
    setSelectedStopId(stopId);
    syncServiceFormWithSelection(fullRoute, nextFromStopId, stopId);
  }

  function resetToFullRoute() {
    const firstStop = fullRoute[0];
    const lastStop = fullRoute[fullRoute.length - 1];
    const nextFromStopId = fullRoute.length > 1 ? firstStop?.id ?? null : null;
    const nextToStopId = fullRoute.length > 1 ? lastStop?.id ?? null : null;
    setFromStopId(nextFromStopId);
    setToStopId(nextToStopId);
    setSelectedStopId(firstStop?.id ?? null);
    syncServiceFormWithSelection(fullRoute, nextFromStopId, nextToStopId);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isConvexAuthLoading) {
      setSaveError('Convex auth is still loading. Wait a moment and try again.');
      return;
    }

    if (!isAuthenticated) {
      setSaveError('You need to sign in before saving a log.');
      return;
    }

    if (fromStopId !== null && toStopId !== null && fromStopId === toStopId) {
      setSaveError('Start and end cannot be the same stop.');
      setActiveTab('Route');
      return;
    }

    if (fullRoute.length > 1 && !riddenRoute) {
      setSaveError('Pick a valid start and end stop before saving.');
      setActiveTab('Route');
      return;
    }

    if (!serviceForm.service_date) {
      setSaveError('Service date is required.');
      setActiveTab('Service');
      return;
    }

    try {
      setSaving(true);
      setSaveError('');
      setSaveSuccess('');

      const cleanedUnits = units
        .map((unit) => ({
          unit_number: unit.unit_number.trim() || undefined,
          unit_reg: unit.unit_reg.trim() || undefined,
          unit_type: unit.unit_type.trim() || undefined,
          livery: unit.livery.trim() || undefined,
          livery_left: unit.livery_left.trim() || undefined,
        }))
        .filter((unit) =>
          Boolean(unit.unit_number || unit.unit_reg || unit.unit_type || unit.livery || unit.livery_left),
        );

      const parsedBustimesServiceId = serviceForm.bustimes_service_id.trim()
        ? Number(serviceForm.bustimes_service_id)
        : undefined;

      await logTrip({
        service_number: serviceForm.service_number.trim() || 'Unknown',
        operator: serviceForm.operator.trim() || 'Unknown',
        operator_slug: serviceForm.operator_slug.trim() || 'unknown',
        service_date: new Date(`${serviceForm.service_date}T00:00:00`).getTime(),
        transport_type: mapVehicleModeToTransportType(vehicleMode),
        bustimes_service_id: typeof parsedBustimesServiceId === 'number' && !Number.isNaN(parsedBustimesServiceId)
          ? parsedBustimesServiceId
          : undefined,
        bustimes_service_slug: serviceForm.bustimes_service_slug.trim() || undefined,
        origin_name: serviceForm.origin_name.trim() || 'Unknown Origin',
        origin_stop_code: serviceForm.origin_stop_code.trim() || '',
        destination_name: serviceForm.destination_name.trim() || 'Unknown Destination',
        destination_stop_code: serviceForm.destination_stop_code.trim() || '',
        scheduled_departure: serviceForm.scheduled_departure || '',
        actual_departure: serviceForm.actual_departure || undefined,
        scheduled_arrival: serviceForm.scheduled_arrival || '',
        actual_arrival: serviceForm.actual_arrival || undefined,
        full_route: fullRoute,
        ridden_route: riddenRoute,
        units: cleanedUnits,
        notes: notes.trim() || undefined,
      });

      setSaveSuccess('Trip log saved.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save trip log.');
    } finally {
      setSaving(false);
    }
  }

  function renderStopActions(stop: RouteStop, index: number) {
    const isFirstStop = index === 0;
    const isLastStop = index === fullRoute.length - 1;
    const isStartDisabled = isLastStop || stop.id === toStopId;
    const isEndDisabled = isFirstStop || stop.id === fromStopId;

    return (
      <div className="flex flex-wrap items-center gap-2">
        {!isLastStop && (
          <button
            type="button"
            onClick={() => setStartStop(stop.id)}
            disabled={isStartDisabled}
            className="rounded-full border border-ts-border px-3 py-1 text-xs font-medium text-ts-text-1 transition hover:border-ts-accent hover:text-ts-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start here
          </button>
        )}
        {!isFirstStop && (
          <button
            type="button"
            onClick={() => setEndStop(stop.id)}
            disabled={isEndDisabled}
            className="rounded-full border border-ts-border px-3 py-1 text-xs font-medium text-ts-text-1 transition hover:border-ts-accent hover:text-ts-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            End here
          </button>
        )}
      </div>
    );
  }

  function renderRouteTab() {
    return (
      <div className="flex flex-col gap-4">
        <section className={sectionClassName()}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-ts-text-1">Ridden route</p>
              <p className="mt-1 text-sm text-ts-text-2">
                {riddenRoute
                  ? `${riddenRoute.origin_name} to ${riddenRoute.destination_name}`
                  : 'Choose the stops you travelled between.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-ts-border bg-ts-surface-2 p-1">
                {ROUTE_MODES.map((mode) => {
                  const active = routeMode === mode;
                  const Icon = mode === 'Map' ? Map : List;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRouteMode(mode)}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                        active
                          ? 'bg-ts-accent text-ts-text-inv'
                          : 'text-ts-text-2 hover:text-ts-text-1'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {mode}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={resetToFullRoute}
                className="rounded-full border border-ts-border px-4 py-2 text-sm font-medium text-ts-text-1 transition hover:border-ts-accent hover:text-ts-accent"
              >
                Reset to full route
              </button>
            </div>
          </div>
        </section>

        {routeMode === 'Map' ? (
          <section className={`relative ${sectionClassName()} p-3`}>
            <div className="h-[440px]">
              <LogMap
                fullRoute={fullRoute}
                fullGeometry={fullGeometry}
                highlightedGeometry={riddenRoute?.geometry ?? fullGeometry}
                onStopClick={setSelectedStopId}
                fromStopId={fromStopId}
                toStopId={toStopId}
              />
            </div>

            {selectedStop && (
              <div className="pointer-events-none absolute right-6 top-6 max-w-[280px]">
                <div className="pointer-events-auto rounded-2xl border border-ts-border bg-ts-bg/95 p-4 shadow-xl backdrop-blur">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ts-text-1">{selectedStop.stop.name || 'Stop'}</p>
                      <p className="mt-1 text-xs text-ts-text-3">{selectedStop.stop.stop_code || 'No stop code'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedStopId(null)}
                      className="text-xs text-ts-text-3 transition hover:text-ts-text-1"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ts-text-2">
                    <div>
                      <div className="text-ts-text-3">Sched</div>
                      <div>{formatDisplayTime(selectedStop.scheduled_departure || selectedStop.scheduled_arrival)}</div>
                    </div>
                    <div>
                      <div className="text-ts-text-3">Actual</div>
                      <div>{formatDisplayTime(selectedStop.actual_departure || selectedStop.actual_arrival)}</div>
                    </div>
                  </div>

                  <div className="mt-4">{renderStopActions(selectedStop, fullRoute.findIndex((stop) => stop.id === selectedStop.id))}</div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className={`${sectionClassName()} p-3`}>
            <div className="flex flex-col gap-2">
              {fullRoute.map((stop, index) => {
                const isSelected = selectedStopId === stop.id;
                const isStart = fromStopId === stop.id;
                const isEnd = toStopId === stop.id;

                return (
                  <button
                    key={stop.id}
                    type="button"
                    onClick={() => setSelectedStopId(stop.id)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-ts-accent bg-ts-accent/10'
                        : 'border-ts-border bg-ts-surface-2 hover:border-ts-border-soft'
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {isStart && (
                            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                              Start
                            </span>
                          )}
                          {isEnd && (
                            <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-300">
                              End
                            </span>
                          )}
                          <span className="text-xs text-ts-text-3">{stop.stop.stop_code || 'No code'}</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-ts-text-1">{stop.stop.name || 'Stop'}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm text-ts-text-2 sm:grid-cols-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.12em] text-ts-text-3">Sched Arr</div>
                          <div className="mt-1 font-mono">{formatDisplayTime(stop.scheduled_arrival)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.12em] text-ts-text-3">Sched Dep</div>
                          <div className="mt-1 font-mono">{formatDisplayTime(stop.scheduled_departure)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.12em] text-ts-text-3">Actual Arr</div>
                          <div className="mt-1 font-mono">{formatDisplayTime(stop.actual_arrival)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.12em] text-ts-text-3">Actual Dep</div>
                          <div className="mt-1 font-mono">{formatDisplayTime(stop.actual_departure)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">{renderStopActions(stop, index)}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderVehicleTab() {
    const modeIcon = (mode: VehicleMode) => {
      if (mode === 'Bus') return Bus;
      if (mode === 'Train') return TrainFront;
      if (mode === 'Tram') return TramFront;
      return NotebookText;
    };

    return (
      <div className="flex flex-col gap-4">
        <section className={sectionClassName()}>
          <div className="inline-flex flex-wrap rounded-full border border-ts-border bg-ts-surface-2 p-1">
            {VEHICLE_MODES.map((mode) => {
              const active = vehicleMode === mode;
              const Icon = modeIcon(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVehicleMode(mode)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                    active ? 'bg-ts-accent text-ts-text-inv' : 'text-ts-text-2 hover:text-ts-text-1'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {mode}
                </button>
              );
            })}
          </div>
        </section>

        {/* Search combobox */}
        <section className={sectionClassName()}>
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-ts-text-3">
            Search vehicle
          </div>
          <div ref={unitSearchRef} className="relative">
            <div className="relative">
              <input
                value={unitSearch}
                onChange={(e) => setUnitSearch(e.target.value)}
                onFocus={() => unitSearchResults.length > 0 && setUnitSearchOpen(true)}
                placeholder={vehicleMode === 'Bus' ? 'Search by reg or fleet number…' : 'Search by unit or reg…'}
                className={`${textInputClassName()} w-full pr-10`}
              />
              {unitSearchLoading && (
                <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ts-accent" />
              )}
            </div>

            {unitSearchOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-ts-border bg-ts-surface shadow-2xl">
                {unitSearchResults.map((result) => (
                  <button
                    key={`${result.source}-${result.id}`}
                    type="button"
                    onClick={() => selectSearchResult(result)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-ts-surface-2 first:rounded-t-2xl last:rounded-b-2xl"
                  >
                    {/* Livery swatch */}
                    <div
                      className="h-9 w-14 shrink-0 rounded-lg border border-ts-border-soft"
                      style={{
                        background: result.livery.livery_css || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))',
                      }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ts-text-1">
                          {[result.unit_number, result.unit_reg].filter(Boolean).join(' · ')}
                        </span>
                        {result.withdrawn && (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                            Withdrawn
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          result.source === 'train'
                            ? 'bg-sky-500/15 text-sky-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}>
                          {result.source}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ts-text-3">
                        {result.type.type_name}
                        {result.type.type_name && result.operator.operator_name ? ' · ' : ''}
                        {result.operator.operator_name}
                      </div>
                      <div className="mt-0.5 text-xs text-ts-text-3">{result.livery.livery_name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={sectionClassName()}>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {units.map((unit, index) => {
              const isActive = selectedUnitIndex === index;
              const isDragging = draggedUnitIndex === index;
              const isDragOver = dragOverUnitIndex === index;

              return (
                <div
                  key={`${unit.unit_number || 'unit'}-${index}`}
                  draggable
                  onDragStart={() => setDraggedUnitIndex(index)}
                  onDragEnd={() => {
                    if (draggedUnitIndex !== null && dragOverUnitIndex !== null && draggedUnitIndex !== dragOverUnitIndex) {
                      setUnits((current) => {
                        const next = [...current];
                        const [moved] = next.splice(draggedUnitIndex, 1);
                        next.splice(dragOverUnitIndex, 0, moved);

                        // Keep selectedUnitIndex pointing at the same unit
                        if (selectedUnitIndex === draggedUnitIndex) {
                          setSelectedUnitIndex(dragOverUnitIndex);
                        } else if (
                          selectedUnitIndex > draggedUnitIndex &&
                          selectedUnitIndex <= dragOverUnitIndex
                        ) {
                          setSelectedUnitIndex(selectedUnitIndex - 1);
                        } else if (
                          selectedUnitIndex < draggedUnitIndex &&
                          selectedUnitIndex >= dragOverUnitIndex
                        ) {
                          setSelectedUnitIndex(selectedUnitIndex + 1);
                        }

                        return next;
                      });
                    }
                    setDraggedUnitIndex(null);
                    setDragOverUnitIndex(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverUnitIndex(index);
                  }}
                  onDragLeave={() => setDragOverUnitIndex(null)}
                  className={`min-w-[160px] max-w-[160px] cursor-grab rounded-2xl border p-4 text-center transition select-none active:cursor-grabbing ${
                    isDragging
                      ? 'opacity-40 scale-95'
                      : isDragOver
                      ? 'border-ts-accent bg-ts-accent/5 scale-105'
                      : isActive
                      ? 'border-ts-accent bg-ts-accent/10'
                      : 'border-ts-border bg-ts-surface-2 hover:border-ts-border-soft'
                  }`}
                  onClick={() => setSelectedUnitIndex(index)}
                >
                  <div className="text-sm font-semibold text-ts-text-1">
                    {[unit.unit_number, unit.unit_reg].filter(Boolean).join(' - ')}
                  </div>
                  <div className="text-xs font-semibold text-ts-text-3">{unit.unit_type || ''}</div>
                  <div
                    className="mx-auto mt-4 aspect-[24/16] w-2/3 border border-ts-border-soft"
                    style={{
                      background: unit.livery_left || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))',
                    }}
                  />
                </div>
              );
            })}

            {vehicleMode !== 'Bus' && (
              <button
                type="button"
                onClick={addUnit}
                className="flex min-w-[150px] items-center justify-center rounded-2xl border border-dashed border-ts-border bg-ts-surface-2 p-4 text-sm font-semibold text-ts-text-2 transition hover:border-ts-accent hover:text-ts-accent"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add unit
                </span>
              </button>
            )}
          </div>
        </section>

        {/* rest of selected unit form unchanged */}
        <section className={sectionClassName()}>
          {selectedUnit ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between md:col-span-2">
                <div>
                  <div className="text-sm font-semibold text-ts-text-1">Selected unit</div>
                  <div className="mt-1 text-xs text-ts-text-3">
                    {selectedUnit.unit_number || selectedUnit.unit_reg || 'New unit'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeSelectedUnit}
                  className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200"
                >
                  Remove unit
                </button>
              </div>
              <Field label="Unit / Fleet number">
                <input value={selectedUnit.unit_number} onChange={(e) => updateUnitField('unit_number', e.target.value)} className={textInputClassName()} />
              </Field>
              <Field label="Registration">
                <input value={selectedUnit.unit_reg} onChange={(e) => updateUnitField('unit_reg', e.target.value)} className={textInputClassName()} />
              </Field>
              <Field label="Vehicle type">
                <input value={selectedUnit.unit_type} onChange={(e) => updateUnitField('unit_type', e.target.value)} className={textInputClassName()} />
              </Field>
              <Field label="Livery name">
                <input value={selectedUnit.livery} onChange={(e) => updateUnitField('livery', e.target.value)} className={textInputClassName()} />
              </Field>
              <div className="grid gap-4 md:col-span-2 md:grid-cols-[minmax(0,1fr)_150px] md:items-start">
                <Field label="Livery CSS">
                  <textarea
                    value={selectedUnit.livery_left}
                    onChange={(e) => updateUnitField('livery_left', e.target.value)}
                    className="min-h-[100px] rounded-xl border border-ts-border bg-ts-surface-2 px-3 py-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
                  />
                </Field>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ts-text-3">Preview</div>
                  <div
                    className="livery-cell aspect-[24/16] w-full rounded-xl border border-ts-border-soft"
                    style={{
                      background: selectedUnit.livery_left || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-ts-border p-8 text-sm text-ts-text-2">
              {vehicleMode === 'Bus'
                ? 'No unit came back from the API for this bus service.'
                : 'Add a unit or search above, then pick it to edit the details here.'}
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderServiceTab() {
    return (
      <div className="flex flex-col gap-4">
        <section className={sectionClassName()}>
          <div className="mb-4 flex items-center gap-2">
            <Route className="h-4 w-4 text-ts-accent" />
            <h2 className="text-sm font-semibold text-ts-text-1">Basic</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Service number">
              <input
                value={serviceForm.service_number}
                onChange={(event) => updateServiceField('service_number', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Operator">
              <input
                value={serviceForm.operator}
                onChange={(event) => updateServiceField('operator', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Service date">
              <input
                type="date"
                value={serviceForm.service_date}
                onChange={(event) => updateServiceField('service_date', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Origin">
              <input
                value={serviceForm.origin_name}
                onChange={(event) => updateServiceField('origin_name', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Destination">
              <input
                value={serviceForm.destination_name}
                onChange={(event) => updateServiceField('destination_name', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Scheduled departure">
              <input
                type="time"
                value={serviceForm.scheduled_departure}
                onChange={(event) => updateServiceField('scheduled_departure', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Actual departure">
              <input
                type="time"
                value={serviceForm.actual_departure}
                onChange={(event) => updateServiceField('actual_departure', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Scheduled arrival">
              <input
                type="time"
                value={serviceForm.scheduled_arrival}
                onChange={(event) => updateServiceField('scheduled_arrival', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Actual arrival">
              <input
                type="time"
                value={serviceForm.actual_arrival}
                onChange={(event) => updateServiceField('actual_arrival', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
          </div>
        </section>

        <section className={sectionClassName()}>
          <div className="mb-4 flex items-center gap-2">
            <NotebookText className="h-4 w-4 text-ts-accent" />
            <h2 className="text-sm font-semibold text-ts-text-1">Extra</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Bustimes service ID">
              <input
                value={serviceForm.bustimes_service_id}
                onChange={(event) => updateServiceField('bustimes_service_id', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Bustimes service slug">
              <input
                value={serviceForm.bustimes_service_slug}
                onChange={(event) => updateServiceField('bustimes_service_slug', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Operator slug">
              <input
                value={serviceForm.operator_slug}
                onChange={(event) => updateServiceField('operator_slug', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Origin stop code">
              <input
                value={serviceForm.origin_stop_code}
                onChange={(event) => updateServiceField('origin_stop_code', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Destination stop code">
              <input
                value={serviceForm.destination_stop_code}
                onChange={(event) => updateServiceField('destination_stop_code', event.target.value)}
                className={textInputClassName()}
              />
            </Field>
          </div>
        </section>
      </div>
    );
  }

  function renderNotesTab() {
    return (
      <section className={sectionClassName()}>
        <Field label="Trip notes">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add anything useful about the journey."
            className="min-h-[260px] rounded-2xl border border-ts-border bg-ts-surface-2 px-4 py-4 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
          />
        </Field>
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-col gap-4 rounded-[24px] border border-ts-border bg-ts-surface px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <h1 className="text-2xl font-bold text-ts-text-1 md:text-3xl">Log Trip</h1>
          <p className="mt-1 text-sm text-ts-text-2">{sourceLabel || 'Resolve a service from the query string to start logging.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {saveSuccess && (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {saveSuccess}
            </span>
          )}
          <button
            type="submit"
            form="log-trip-form"
            suppressHydrationWarning
            disabled={!mounted || loading || saving || isConvexAuthLoading || !isAuthenticated}
            className="inline-flex items-center gap-2 rounded-full bg-ts-accent px-5 py-3 text-sm font-semibold text-ts-text-inv transition hover:bg-ts-accent-h disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save log
          </button>
        </div>
      </div>

      <form id="log-trip-form" onSubmit={handleSave} className="flex flex-col gap-6">
        <input type="hidden" name="full_route" value={serializeJson(fullRoute)} readOnly />
        <input type="hidden" name="ridden_route" value={serializeJson(riddenRoute)} readOnly />

        <div className="border-b border-ts-border">
          <div className="flex gap-6 overflow-x-auto px-1">
            {TABS.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`relative py-3 text-sm font-medium whitespace-nowrap transition ${
                    active ? 'text-ts-accent' : 'text-ts-text-2 hover:text-ts-text-1'
                  }`}
                >
                  {tab}
                  <span
                    className={`absolute bottom-0 left-0 h-[2px] w-full transition ${
                      active ? 'bg-ts-accent opacity-100' : 'opacity-0'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className={`${sectionClassName()} flex items-center gap-3 text-sm text-ts-text-2`}>
            <LoaderCircle className="h-4 w-4 animate-spin text-ts-accent" />
            Loading service details...
          </div>
        ) : loadError ? (
          <div className={`${sectionClassName()} flex items-start gap-3 text-sm text-red-300`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{loadError}</div>
          </div>
        ) : (
          <>
            {activeTab === 'Route' && renderRouteTab()}
            {activeTab === 'Vehicle' && renderVehicleTab()}
            {activeTab === 'Service' && renderServiceTab()}
            {activeTab === 'Notes' && renderNotesTab()}
          </>
        )}

        <div className="sticky bottom-4 flex flex-col gap-3 rounded-[22px] border border-ts-border bg-ts-bg/92 p-4 shadow-xl backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-ts-text-2">
            {riddenRoute
              ? `Logging ${riddenRoute.origin_name} to ${riddenRoute.destination_name}`
              : 'Choose a start and end stop to build the ridden route.'}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isSignedIn && !isConvexAuthLoading && !isAuthenticated && (
              <span className="text-sm text-amber-300">
                Signed in, but Convex auth is not connected. This app is currently wired for Clerk-backed Convex auth.
              </span>
            )}
            {!isSignedIn && (
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-full border border-ts-border px-4 py-2 text-sm font-medium text-ts-text-1 transition hover:border-ts-accent hover:text-ts-accent"
                >
                  Sign in to save
                </button>
              </SignInButton>
            )}
            {saveError && <span className="text-sm text-red-300">{saveError}</span>}
            <button
              type="submit"
              suppressHydrationWarning
              disabled={!mounted || loading || saving || isConvexAuthLoading || !isAuthenticated}
              className="inline-flex items-center gap-2 rounded-full bg-ts-accent px-5 py-3 text-sm font-semibold text-ts-text-inv transition hover:bg-ts-accent-h disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save log
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
