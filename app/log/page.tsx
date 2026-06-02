'use client';

import type { Id } from '@/convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState, useRef, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { LogMap } from '@/components/LogMap';
import { SignInButton, useUser } from '@clerk/nextjs';
import {
  AlertCircle,
  Bus,
  CheckCircle2,
  LoaderCircle,
  Map,
  NotebookText,
  Plus,
  Route,
  Save,
  TramFront,
  TrainFront,
  X,
  GripVertical,
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
  unit?: Partial<TripUnit> | Record<string, Partial<TripUnit>> | null;
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

type StoredRoutePayload = {
  geometry?: RouteGeometry | null;
  coordinates?: [number, number][];
  stops?: RouteStop[];
  full_locations?: RouteStop[];
};

type EditableTripRecord = {
  _id: string;
  service_number: string;
  operator: string;
  operator_slug: string;
  service_date: number;
  transport_type: StoredTransportType;
  bustimes_service_id?: number;
  bustimes_service_slug?: string;
  origin_name: string;
  origin_stop_code: string;
  destination_name: string;
  destination_stop_code: string;
  scheduled_departure: string;
  actual_departure?: string | null;
  scheduled_arrival: string;
  actual_arrival?: string | null;
  full_route?: StoredRoutePayload | RouteStop[] | null;
  ridden_route?: StoredRoutePayload | RouteStop[] | null;
  full_locations?: RouteStop[] | null;
  units?: TripUnit[] | null;
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery_name?: string;
  livery_css?: string;
  notes?: string;
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

function normalizeUnits(raw?: ApiLogResponse['unit']): TripUnit[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (entry && typeof entry === 'object' ? normalizeUnit(entry as Partial<TripUnit>) : null))
      .filter((entry): entry is TripUnit => Boolean(entry && (entry.unit_number || entry.unit_reg || entry.unit_type || entry.livery || entry.livery_left)));
  }

  if (!raw) return [];
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const maybeUnit = raw as Partial<TripUnit>;
    if (
      typeof maybeUnit.unit_number === 'string' ||
      typeof maybeUnit.unit_reg === 'string' ||
      typeof maybeUnit.unit_type === 'string' ||
      typeof maybeUnit.livery === 'string' ||
      typeof maybeUnit.livery_left === 'string'
    ) {
      return [normalizeUnit(maybeUnit)];
    }
    return Object.entries(raw as Record<string, Partial<TripUnit>>)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, value]) => normalizeUnit(value));
  }
  return [];
}

function normalizeRouteStops(raw: unknown): RouteStop[] {
  if (Array.isArray(raw)) {
    return raw.filter((stop): stop is RouteStop => Boolean(stop && typeof stop === 'object' && 'id' in stop));
  }

  if (!raw || typeof raw !== 'object') return [];

  const payload = raw as StoredRoutePayload;
  if (Array.isArray(payload.stops)) return payload.stops;
  if (Array.isArray(payload.full_locations)) return payload.full_locations;

  return [];
}

function normalizeRouteGeometry(raw: unknown): RouteGeometry | null {
  if (!raw || typeof raw !== 'object') return null;

  const payload = raw as StoredRoutePayload;
  const coordinates = payload.geometry?.coordinates ?? payload.coordinates ?? null;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  return { type: 'LineString', coordinates };
}

function transportTypeToVehicleMode(type: StoredTransportType): VehicleMode {
  if (type === 'Rail') return 'Train';
  if (type === 'Tram') return 'Tram';
  if (type === 'Bus') return 'Bus';
  return 'Other';
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
    if (Array.isArray(stop.track) && stop.track.length > 0) { coordinates.push(...stop.track); return; }
    if (Array.isArray(stop.stop.location) && stop.stop.location.length === 2) coordinates.push(stop.stop.location);
  });
  const deduped = dedupeCoordinates(coordinates);
  return deduped.length > 0 ? { type: 'LineString' as const, coordinates: deduped } : null;
}

function buildRiddenRoute(fullRoute: RouteStop[], fromStopId: number | null, toStopId: number | null): RiddenRoute | null {
  if (fromStopId === null || toStopId === null || fromStopId === toStopId) return null;
  const fromIndex = fullRoute.findIndex((s) => s.id === fromStopId);
  const toIndex = fullRoute.findIndex((s) => s.id === toStopId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex > toIndex) return null;
  const stops = fullRoute.slice(fromIndex, toIndex + 1);
  const coordinates = dedupeCoordinates(
    stops.flatMap((stop, index) => {
      // With backward convention, stops[0] is the start stop. 
      // Its track is [prev -> start], which is OUTSIDE selection.
      if (index > 0 && Array.isArray(stop.track) && stop.track.length > 0) return stop.track;
      if (Array.isArray(stop.stop.location) && stop.stop.location.length === 2) return [stop.stop.location];
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

function getStartScheduledTime(stop?: RouteStop) { return toTimeInputValue(stop?.scheduled_departure || stop?.scheduled_arrival); }
function getStartActualTime(stop?: RouteStop) { return toTimeInputValue(stop?.actual_departure || stop?.actual_arrival); }
function getEndScheduledTime(stop?: RouteStop) { return toTimeInputValue(stop?.scheduled_arrival || stop?.scheduled_departure); }
function getEndActualTime(stop?: RouteStop) { return toTimeInputValue(stop?.actual_arrival || stop?.actual_departure); }

function mapVehicleModeToTransportType(mode: VehicleMode): StoredTransportType {
  if (mode === 'Train') return 'Rail';
  if (mode === 'Tram') return 'Tram';
  if (mode === 'Bus') return 'Bus';
  return 'Other';
}

function serializeJson(value: unknown) {
  try { return JSON.stringify(value ?? null); } catch { return 'null'; }
}

function resolveRequest(searchParams: URLSearchParams): RequestResolution {
  const serviceUid = searchParams.get('service_uid');
  if (serviceUid) {
    const parts = serviceUid.split(':');
    if (parts.length < 3) throw new Error('Expected `service_uid` in the format `gb-nr:UID:YYYY-MM-DD`.');
    const uid = parts[1]; const date = parts[2];
    return { url: `/api/log?date=${encodeURIComponent(date)}&type=train&uid=${encodeURIComponent(uid)}`, vehicleMode: 'Train', date, label: `Train ${uid} on ${date}` };
  }
  const serviceId = searchParams.get('service_id');
  const date = searchParams.get('date');
  if (serviceId && date) {
    return { url: `/api/log?date=${encodeURIComponent(date)}&type=bus&uid=${encodeURIComponent(serviceId)}`, vehicleMode: 'Bus', date, label: `Bus ${serviceId} on ${date}` };
  }
  const serviceRid = searchParams.get('service_rid');
  if (serviceRid) {
    return { url: `/api/log?service_rid=${encodeURIComponent(serviceRid)}`, vehicleMode: 'Train', date: '', label: `Train RID ${serviceRid}` };
  }
  throw new Error('Missing query parameters. Use `service_uid`, `service_id` with `date`, or `service_rid`.');
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

function inputCls() {
  return 'h-12 w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-4 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20 placeholder:text-ts-text-3';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">{label}</span>
      {children}
    </label>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-ts-border bg-ts-surface p-4 ${className}`}>
      {children}
    </div>
  );
}

function SegmentedControl({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full border border-ts-border bg-ts-surface-2 p-1 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${
            value === opt ? 'bg-ts-accent text-ts-text-inv shadow-md shadow-ts-accent/20' : 'text-ts-text-3 hover:text-ts-text-1'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function LogPage() {
  const { isSignedIn } = useUser();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const logTrip = useMutation(api.functions.trips.logTrip);
  const updateTrip = useMutation(api.functions.trips.updateTrip);
  const searchKey = useSyncExternalStore(
    () => () => {},
    () => (typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, '')),
    () => '',
  );

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
  const [stopSheetOpen, setStopSheetOpen] = useState(false);
  const [units, setUnits] = useState<TripUnit[]>([]);
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
  const [unitSearch, setUnitSearch] = useState('');
  const [unitSearchResults, setUnitSearchResults] = useState<SearchResult[]>([]);
  const [unitSearchLoading, setUnitSearchLoading] = useState(false);
  const [unitSearchOpen, setUnitSearchOpen] = useState(false);
  const unitSearchRef = useRef<HTMLDivElement>(null);
  const [draggedUnitIndex, setDraggedUnitIndex] = useState<number | null>(null);
  const [dragOverUnitIndex, setDragOverUnitIndex] = useState<number | null>(null);

  const editTripId = searchKey ? new URLSearchParams(searchKey).get('trip_id') : null;
  const editTrip = useQuery(
    api.functions.trips.getMyTripById,
    editTripId ? { tripId: editTripId as Id<'tripLogs'> } : 'skip',
  ) as EditableTripRecord | null | undefined;
  const isEditingTrip = Boolean(editTripId);

  const selectedStop = fullRoute.find((s) => s.id === selectedStopId) ?? null;
  const riddenRoute = buildRiddenRoute(fullRoute, fromStopId, toStopId);
  const selectedUnit = units[selectedUnitIndex] ?? null;

  useEffect(() => {
    const trimmedSearch = unitSearch.trim();
    if (trimmedSearch.length < 2) return;

    const t = setTimeout(async () => {
      setUnitSearchLoading(true);
      try {
        const type = vehicleMode === 'Train' ? 'train' : vehicleMode === 'Bus' ? 'bus' : '';
        const params = new URLSearchParams({ q: trimmedSearch });
        if (type) params.set('type', type);
        const res = await fetch(`/api/search?${params}`);
        const data: SearchResult[] = await res.json();
        setUnitSearchResults(data);
        setUnitSearchOpen(data.length > 0);
      } catch { setUnitSearchResults([]); }
      finally { setUnitSearchLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [unitSearch, vehicleMode]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (unitSearchRef.current && !unitSearchRef.current.contains(e.target as Node)) setUnitSearchOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (editTripId) {
        if (editTrip === undefined) {
          if (!cancelled) setLoading(true);
          return;
        }

        if (!editTrip) {
          if (!cancelled) {
            setLoadError('Trip not found or you do not have access.');
            setLoading(false);
          }
          return;
        }

        const storedRoute = normalizeRouteStops(editTrip.full_route);
        const fallbackRoute = normalizeRouteStops(editTrip.full_locations);
        const riddenRouteStops = normalizeRouteStops(editTrip.ridden_route);
        const route = storedRoute.length > 0 ? storedRoute : fallbackRoute;
        const activeRoute = riddenRouteStops.length > 0 ? riddenRouteStops : route;
        const resolvedGeometry = normalizeRouteGeometry(editTrip.full_route) ?? normalizeRouteGeometry(editTrip.ridden_route);
        const initialUnits = normalizeUnits(editTrip.units as ApiLogResponse['unit']);
        const firstStop = route[0] ?? activeRoute[0];
        const editDateLabel = new Date(editTrip.service_date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

        if (cancelled) return;

        setVehicleMode(transportTypeToVehicleMode(editTrip.transport_type));
        setSourceLabel(`Editing saved trip from ${editDateLabel}`);
        setFullRoute(route);
        setFullGeometry(resolvedGeometry);
        setUnits(initialUnits);
        setSelectedUnitIndex(0);
        setSelectedStopId(firstStop?.id ?? null);
        setFromStopId(activeRoute.length > 1 ? activeRoute[0]?.id ?? null : null);
        setToStopId(activeRoute.length > 1 ? activeRoute[activeRoute.length - 1]?.id ?? null : null);
        setNotes(safeString(editTrip.notes));
        setServiceForm({
          service_number: safeString(editTrip.service_number),
          operator: safeString(editTrip.operator),
          operator_slug: safeString(editTrip.operator_slug),
          service_date: toDateInputValue(editTrip.service_date),
          origin_name: safeString(editTrip.origin_name),
          origin_stop_code: safeString(editTrip.origin_stop_code),
          destination_name: safeString(editTrip.destination_name),
          destination_stop_code: safeString(editTrip.destination_stop_code),
          scheduled_departure: toTimeInputValue(editTrip.scheduled_departure),
          actual_departure: toTimeInputValue(editTrip.actual_departure),
          scheduled_arrival: toTimeInputValue(editTrip.scheduled_arrival),
          actual_arrival: toTimeInputValue(editTrip.actual_arrival),
          bustimes_service_id: editTrip.bustimes_service_id ? String(editTrip.bustimes_service_id) : '',
          bustimes_service_slug: safeString(editTrip.bustimes_service_slug),
        });

        setLoadError('');
        setSaveError('');
        setSaveSuccess('');
        setLoading(false);
        return;
      }

      try {
        setLoading(true); setLoadError(''); setSaveError(''); setSaveSuccess('');
        const res = resolveRequest(new URLSearchParams(searchKey));
        if (cancelled) return;
        setVehicleMode(res.vehicleMode);
        setSourceLabel(res.label);
        const response = await fetch(res.url, { cache: 'no-store' });
        const payload = (await response.json()) as ApiLogResponse;
        if (!response.ok) throw new Error(payload.details || payload.message || payload.error || 'Failed to load.');
        const route = Array.isArray(payload.full_route) ? payload.full_route : [];
        const resolvedGeometry = buildFullGeometry(route, payload.full_route_geometry);
        const initialUnits = normalizeUnits(payload.unit);
        const firstStop = route[0]; const lastStop = route[route.length - 1];
        if (cancelled) return;
        setFullRoute(route); setFullGeometry(resolvedGeometry);
        setUnits(initialUnits); setSelectedUnitIndex(0);
        setSelectedStopId(firstStop?.id ?? null);
        setFromStopId(route.length > 1 ? firstStop?.id ?? null : null);
        setToStopId(route.length > 1 ? lastStop?.id ?? null : null);
        setNotes('');
        setServiceForm({
          service_number: safeString(payload.service_number),
          operator: safeString(payload.operator),
          operator_slug: safeString(payload.operator_slug),
          service_date: toDateInputValue(payload.service_date, res.date),
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
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load this service.');
          setFullRoute([]); setFullGeometry(null); setUnits([]); setServiceForm(EMPTY_SERVICE_FORM);
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [editTrip, editTripId, searchKey]);

  function updateServiceField<K extends keyof ServiceFormState>(field: K, value: ServiceFormState[K]) {
    setServiceForm((c) => ({ ...c, [field]: value }));
  }

  function syncFormFromRoute(route: RouteStop[], nextFrom: number | null, nextTo: number | null) {
    const rr = buildRiddenRoute(route, nextFrom, nextTo);
    if (!rr) return;
    const first = rr.stops[0]; const last = rr.stops[rr.stops.length - 1];
    setServiceForm((c) => ({
      ...c,
      origin_name: safeString(first?.stop.name),
      origin_stop_code: safeString(first?.stop.stop_code),
      destination_name: safeString(last?.stop.name),
      destination_stop_code: safeString(last?.stop.stop_code),
      scheduled_departure: getStartScheduledTime(first),
      actual_departure: getStartActualTime(first),
      scheduled_arrival: getEndScheduledTime(last),
      actual_arrival: getEndActualTime(last),
    }));
  }

  function selectSearchResult(result: SearchResult) {
    const filled: TripUnit = { unit_number: result.unit_number, unit_reg: result.unit_reg, unit_type: result.type.type_name, livery: result.livery.livery_name, livery_left: result.livery.livery_css };
    setUnits((cur) => {
      if (vehicleMode === 'Bus') {
        const next = cur.length === 0 ? [filled] : [...cur];
        if (next.length > 0) next[selectedUnitIndex] = filled;
        setSelectedUnitIndex(0); return next;
      }
      if (cur.some((u) => u.unit_number === filled.unit_number && u.unit_reg === filled.unit_reg)) return cur;
      const hasData = cur[selectedUnitIndex] && (cur[selectedUnitIndex].unit_number || cur[selectedUnitIndex].unit_reg || cur[selectedUnitIndex].unit_type);
      if (cur.length === 0 || !hasData) {
        const next = [...cur];
        if (next.length === 0) { next.push(filled); setSelectedUnitIndex(0); } else next[selectedUnitIndex] = filled;
        return next;
      }
      const next = [...cur, filled]; setSelectedUnitIndex(next.length - 1); return next;
    });
    setUnitSearch(''); setUnitSearchOpen(false); setUnitSearchResults([]);
  }

  function updateUnitField(field: keyof TripUnit, value: string) {
    setUnits((c) => c.map((u, i) => i === selectedUnitIndex ? { ...u, [field]: value } : u));
  }

  function addUnit() {
    if (vehicleMode === 'Bus') return;
    setUnits((c) => { const next = [...c, { ...EMPTY_UNIT }]; setSelectedUnitIndex(next.length - 1); return next; });
  }

  function removeSelectedUnit() {
    setUnits((c) => {
      if (!c.length) return c;
      const next = c.filter((_, i) => i !== selectedUnitIndex);
      setSelectedUnitIndex(next.length ? Math.min(selectedUnitIndex, next.length - 1) : 0);
      return next;
    });
  }

  function setStartStop(stopId: number) {
    if (stopId === toStopId) return;
    let nextTo = toStopId;
    if (toStopId !== null) {
      const fi = fullRoute.findIndex((s) => s.id === stopId);
      const ti = fullRoute.findIndex((s) => s.id === toStopId);
      if (fi !== -1 && ti !== -1 && fi > ti) nextTo = null;
    }
    setFromStopId(stopId); setToStopId(nextTo); setSelectedStopId(stopId);
    syncFormFromRoute(fullRoute, stopId, nextTo);
  }

  function setEndStop(stopId: number) {
    if (stopId === fromStopId) return;
    let nextFrom = fromStopId;
    if (fromStopId !== null) {
      const fi = fullRoute.findIndex((s) => s.id === fromStopId);
      const ti = fullRoute.findIndex((s) => s.id === stopId);
      if (fi !== -1 && ti !== -1 && ti < fi) nextFrom = null;
    }
    setFromStopId(nextFrom); setToStopId(stopId); setSelectedStopId(stopId);
    syncFormFromRoute(fullRoute, nextFrom, stopId);
  }

  function resetToFullRoute() {
    const first = fullRoute[0]; const last = fullRoute[fullRoute.length - 1];
    const f = fullRoute.length > 1 ? first?.id ?? null : null;
    const t = fullRoute.length > 1 ? last?.id ?? null : null;
    setFromStopId(f); setToStopId(t); setSelectedStopId(first?.id ?? null);
    syncFormFromRoute(fullRoute, f, t);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isConvexAuthLoading) { setSaveError('Auth still loading.'); return; }
    if (!isAuthenticated) { setSaveError('Sign in before saving.'); return; }
    if (fromStopId !== null && toStopId !== null && fromStopId === toStopId) { setSaveError('Start and end cannot be the same stop.'); setActiveTab('Route'); return; }
    if (fullRoute.length > 1 && !riddenRoute) { setSaveError('Pick valid start and end stops.'); setActiveTab('Route'); return; }
    if (!serviceForm.service_date) { setSaveError('Service date is required.'); setActiveTab('Service'); return; }
    try {
      setSaving(true); setSaveError(''); setSaveSuccess('');
      const cleanedUnits = units.map((u) => ({
        unit_number: u.unit_number.trim() || undefined,
        unit_reg: u.unit_reg.trim() || undefined,
        unit_type: u.unit_type.trim() || undefined,
        livery: u.livery.trim() || undefined,
        livery_left: u.livery_left.trim() || undefined,
      })).filter((u) => Boolean(u.unit_number || u.unit_reg || u.unit_type || u.livery || u.livery_left));
      const parsedBustimesServiceId = serviceForm.bustimes_service_id.trim() ? Number(serviceForm.bustimes_service_id) : undefined;
      const payload = {
        service_number: serviceForm.service_number.trim() || 'Unknown',
        operator: serviceForm.operator.trim() || 'Unknown',
        operator_slug: serviceForm.operator_slug.trim() || 'unknown',
        service_date: new Date(`${serviceForm.service_date}T00:00:00`).getTime(),
        transport_type: mapVehicleModeToTransportType(vehicleMode),
        bustimes_service_id: typeof parsedBustimesServiceId === 'number' && !Number.isNaN(parsedBustimesServiceId) ? parsedBustimesServiceId : undefined,
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
      };

      if (isEditingTrip && editTripId) {
        await updateTrip({ tripId: editTripId as Id<'tripLogs'>, ...payload });
      } else {
        await logTrip(payload);
      }

      setSaveSuccess(isEditingTrip ? 'Trip updated!' : 'Trip saved!');
      window.location.href = '/profile';
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally { setSaving(false); }
  }

  // ─── Stop actions ──────────────────────────────────────────────────────────

  function renderStopActions({ stop, index, onDone }: { stop: RouteStop; index: number; onDone?: () => void }) {
    const isFirst = index === 0;
    const isLast = index === fullRoute.length - 1;
    return (
      <div className="flex gap-2 pt-2">
        {!isLast && (
          <button
            type="button"
            onClick={() => { setStartStop(stop.id); onDone?.(); }}
            disabled={stop.id === toStopId}
            className="flex-1 rounded-2xl border border-ts-border py-3 text-sm font-semibold text-ts-text-1 transition active:scale-95 hover:border-ts-accent hover:text-ts-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start here
          </button>
        )}
        {!isFirst && (
          <button
            type="button"
            onClick={() => { setEndStop(stop.id); onDone?.(); }}
            disabled={stop.id === fromStopId}
            className="flex-1 rounded-2xl border border-ts-border py-3 text-sm font-semibold text-ts-text-1 transition active:scale-95 hover:border-ts-accent hover:text-ts-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            End here
          </button>
        )}
      </div>
    );
  }

  // ─── Route tab ──────────────────────────────────────────────────────────────

  function renderRouteTab() {
    return (
      <div className="flex flex-col gap-3 sm:pt-4">
        {/* Desktop Summary / Mobile List Toggle */}
        <div className={`sm:block ${routeMode === 'Map' ? 'hidden' : 'block mb-3 px-4 sm:px-0'}`}>
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-ts-text-1">
                  {riddenRoute ? `${riddenRoute.origin_name} → ${riddenRoute.destination_name}` : 'Select journey stops'}
                </p>
                <p className="mt-0.5 text-xs text-ts-text-3">
                  {riddenRoute ? `${riddenRoute.stops.length} stops` : 'Tap a stop on the map or list below'}
                </p>
              </div>
              <button
                type="button"
                onClick={resetToFullRoute}
                className="shrink-0 rounded-full border border-ts-border px-3 py-1.5 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent hover:text-ts-accent active:scale-95"
              >
                Full route
              </button>
            </div>
            <div className="mt-3">
              <SegmentedControl
                options={ROUTE_MODES}
                value={routeMode}
                onChange={(v) => setRouteMode(v as RouteMode)}
              />
            </div>
          </Card>
        </div>

        {/* Map */}
        {routeMode === 'Map' ? (
          <div className="grid relative flex-1 min-h-[450px] overflow-hidden bg-ts-surface sm:rounded-3xl sm:border sm:border-ts-border">
            <LogMap
              fullRoute={fullRoute}
              fullGeometry={fullGeometry}
              highlightedGeometry={riddenRoute?.geometry ?? fullGeometry}
              onStopClick={(id) => { setSelectedStopId(id); setStopSheetOpen(true); }}
              fromStopId={fromStopId}
              toStopId={toStopId}
            />

            {/* Mobile Floating Overlay */}
            <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-3 px-3 sm:hidden">
              <div className="pointer-events-auto w-full rounded-2xl border border-ts-border bg-ts-bg/85 p-3 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ts-text-1">
                      {riddenRoute ? `${riddenRoute.origin_name} → ${riddenRoute.destination_name}` : 'Select stops'}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-ts-text-3">
                      {riddenRoute ? `${riddenRoute.stops.length} stops` : 'Tap map to start'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetToFullRoute}
                    className="shrink-0 rounded-full bg-ts-accent/10 px-2.5 py-1 text-[10px] font-bold text-ts-accent"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="pointer-events-auto scale-90">
                <SegmentedControl
                  options={ROUTE_MODES}
                  value={routeMode}
                  onChange={(v) => setRouteMode(v as RouteMode)}
                />
              </div>
            </div>

            {/* Bottom sheet */}
            {selectedStop && stopSheetOpen && (
              <div className="absolute inset-x-0 bottom-0 z-0 rounded-t-3xl border-t border-ts-border bg-ts-bg/98 px-4 pb-12 pt-3 sm:pb-6">
                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ts-border" />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-ts-text-1">{selectedStop.stop.name || 'Stop'}</p>
                    <p className="mt-0.5 text-xs text-ts-text-3">{selectedStop.stop.stop_code || 'No stop code'}</p>
                  </div>
                  <button type="button" onClick={() => setStopSheetOpen(false)} className="rounded-full bg-ts-surface-2 p-2 text-ts-text-3 hover:text-ts-text-1 transition">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { label: 'Scheduled', val: formatDisplayTime(selectedStop.scheduled_departure || selectedStop.scheduled_arrival) },
                    { label: 'Actual', val: formatDisplayTime(selectedStop.actual_departure || selectedStop.actual_arrival) },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-2xl bg-ts-surface-2 px-3 py-2.5 border border-ts-border-soft">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-ts-text-3">{label}</div>
                      <div className="mt-1 font-mono text-sm font-bold text-ts-text-1">{val}</div>
                    </div>
                  ))}
                </div>
                {renderStopActions({ stop: selectedStop, index: fullRoute.findIndex((s) => s.id === selectedStop.id), onDone: () => setStopSheetOpen(false) })}
              </div>
            )}
          </div>
        ) : (
          /* List */
          <div className="flex flex-col gap-2 px-4 sm:px-0">
            {fullRoute.map((stop, index) => {
              const isSelected = selectedStopId === stop.id;
              const isStart = fromStopId === stop.id;
              const isEnd = toStopId === stop.id;
              const inRidden = riddenRoute?.stops.some((s) => s.id === stop.id) ?? false;

              return (
                <div key={stop.id} className="flex gap-0 items-stretch">
                  {/* Timeline */}
                  <div className="flex flex-col items-center w-8 shrink-0 pt-5 pb-0">
                    <div className={`h-3 w-3 rounded-full border-2 shrink-0 z-0 ${
                      isStart ? 'border-ts-accent bg-ts-accent' :
                      isEnd ? 'border-sky-400 bg-sky-400' :
                      inRidden ? 'border-ts-accent/60 bg-ts-accent/20' :
                      'border-ts-border bg-ts-surface-2'
                    }`} />
                    {index < fullRoute.length - 1 && (
                      <div className={`w-0.5 flex-1 mt-1 ${inRidden && !isEnd ? 'bg-ts-accent/40' : 'bg-ts-border'}`} style={{ minHeight: 12 }} />
                    )}
                  </div>

                  {/* Card */}
                  <button
                    type="button"
                    onClick={() => { setSelectedStopId(stop.id); setStopSheetOpen(isSelected ? !stopSheetOpen : true); }}
                    className={`flex-1 mb-2 rounded-3xl border p-3.5 text-left transition active:scale-[0.99] ${
                      isSelected && stopSheetOpen
                        ? 'border-ts-accent bg-ts-accent/10'
                        : inRidden
                        ? 'border-ts-border-soft bg-ts-surface-2'
                        : 'border-ts-border bg-ts-surface'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isStart && <span className="rounded-full bg-ts-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-ts-accent">Start</span>}
                      {isEnd && <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-sky-400">End</span>}
                      {stop.stop.stop_code && <span className="text-[10px] text-ts-text-3">{stop.stop.stop_code}</span>}
                    </div>
                    <p className="mt-1 text-sm font-bold text-ts-text-1">{stop.stop.name || 'Stop'}</p>
                    {(stop.scheduled_departure || stop.scheduled_arrival || stop.actual_departure || stop.actual_arrival) && (
                      <div className="mt-1.5 flex gap-4 text-xs text-ts-text-3">
                        {(stop.scheduled_departure || stop.scheduled_arrival) && (
                          <span>S <span className="font-mono text-ts-text-2">{formatDisplayTime(stop.scheduled_departure || stop.scheduled_arrival)}</span></span>
                        )}
                        {(stop.actual_departure || stop.actual_arrival) && (
                          <span>A <span className="font-mono text-ts-text-2">{formatDisplayTime(stop.actual_departure || stop.actual_arrival)}</span></span>
                        )}
                      </div>
                    )}
                    {isSelected && stopSheetOpen && (
                      <div onClick={(e) => e.stopPropagation()}>
                        {renderStopActions({ stop, index })}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Vehicle tab ──────────────────────────────────────────────────────────

  function renderVehicleTab() {
    const modeIcon = (m: VehicleMode) => {
      if (m === 'Bus') return Bus;
      if (m === 'Train') return TrainFront;
      if (m === 'Tram') return TramFront;
      return NotebookText;
    };

    return (
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex flex-wrap gap-2">
            {VEHICLE_MODES.map((mode) => {
              const Icon = modeIcon(mode);
              const active = vehicleMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVehicleMode(mode)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition active:scale-95 ${
                    active ? 'border-ts-accent bg-ts-accent/10 text-ts-accent' : 'border-ts-border text-ts-text-2 hover:text-ts-text-1'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {mode}
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">Search vehicle</p>
          <div ref={unitSearchRef} className="relative">
            <div className="relative">
              <input
                value={unitSearch}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setUnitSearch(nextValue);
                  if (nextValue.trim().length < 2) {
                    setUnitSearchResults([]);
                    setUnitSearchOpen(false);
                    setUnitSearchLoading(false);
                  }
                }}
                onFocus={() => unitSearchResults.length > 0 && setUnitSearchOpen(true)}
                placeholder={vehicleMode === 'Bus' ? 'Reg or fleet number…' : 'Unit or reg…'}
                className={`${inputCls()} pr-10`}
              />
              {unitSearchLoading && <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ts-accent" />}
            </div>
            {unitSearchOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-3xl border border-ts-border bg-ts-surface">
                {unitSearchResults.map((r) => (
                  <button
                    key={`${r.source}-${r.id}`}
                    type="button"
                    onClick={() => selectSearchResult(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ts-surface-2 first:rounded-t-3xl last:rounded-b-3xl"
                  >
                    <div className="h-9 w-14 shrink-0 rounded-xl border border-ts-border-soft" style={{ background: r.livery.livery_css || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))' }} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-ts-text-1">{[r.unit_number, r.unit_reg].filter(Boolean).join(' · ')}</span>
                        {r.withdrawn && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-300">Withdrawn</span>}
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${r.source === 'train' ? 'bg-sky-500/15 text-sky-300' : 'bg-ts-accent/15 text-ts-accent'}`}>{r.source}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ts-text-3">{r.type.type_name}{r.type.type_name && r.operator.operator_name ? ' · ' : ''}{r.operator.operator_name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Unit carousel */}
        <Card>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">Formation</p>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {units.map((unit, index) => {
              const isActive = selectedUnitIndex === index;
              const isDragging = draggedUnitIndex === index;
              const isDragOver = dragOverUnitIndex === index;
              return (
                <div
                  key={`${unit.unit_number || 'u'}-${index}`}
                  draggable
                  onDragStart={() => setDraggedUnitIndex(index)}
                  onDragEnd={() => {
                    if (draggedUnitIndex !== null && dragOverUnitIndex !== null && draggedUnitIndex !== dragOverUnitIndex) {
                      setUnits((cur) => {
                        const next = [...cur];
                        const [moved] = next.splice(draggedUnitIndex, 1);
                        next.splice(dragOverUnitIndex, 0, moved);
                        if (selectedUnitIndex === draggedUnitIndex) setSelectedUnitIndex(dragOverUnitIndex);
                        else if (selectedUnitIndex > draggedUnitIndex && selectedUnitIndex <= dragOverUnitIndex) setSelectedUnitIndex(selectedUnitIndex - 1);
                        else if (selectedUnitIndex < draggedUnitIndex && selectedUnitIndex >= dragOverUnitIndex) setSelectedUnitIndex(selectedUnitIndex + 1);
                        return next;
                      });
                    }
                    setDraggedUnitIndex(null); setDragOverUnitIndex(null);
                  }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverUnitIndex(index); }}
                  onDragLeave={() => setDragOverUnitIndex(null)}
                  onClick={() => setSelectedUnitIndex(index)}
                  className={`min-w-[130px] cursor-grab select-none rounded-2xl border p-3 text-center transition active:cursor-grabbing active:scale-95 ${
                    isDragging ? 'scale-95 opacity-40' :
                    isDragOver ? 'scale-105 border-ts-accent bg-ts-accent/5' :
                    isActive ? 'border-ts-accent bg-ts-accent/10' :
                    'border-ts-border bg-ts-surface-2'
                  }`}
                >
                  <GripVertical className="mx-auto mb-1 h-3 w-3 text-ts-text-3" />
                  <div className="truncate text-xs font-bold text-ts-text-1">{[unit.unit_number, unit.unit_reg].filter(Boolean).join(' - ') || 'New unit'}</div>
                  <div className="mt-0.5 truncate text-[10px] text-ts-text-3">{unit.unit_type || '—'}</div>
                  <div className="mx-auto mt-3 aspect-[24/16] w-3/4 rounded-lg border border-ts-border-soft" style={{ background: unit.livery_left || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))' }} />
                </div>
              );
            })}
            {vehicleMode !== 'Bus' && (
              <button
                type="button"
                onClick={addUnit}
                className="flex min-w-[110px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ts-border bg-ts-surface-2 p-4 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent hover:text-ts-accent active:scale-95"
              >
                <Plus className="h-5 w-5" />
                Add unit
              </button>
            )}
          </div>
        </Card>

        {/* Unit detail */}
        <Card>
          {selectedUnit ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-ts-text-1">Unit details</p>
                  <p className="mt-0.5 text-xs text-ts-text-3">{selectedUnit.unit_number || selectedUnit.unit_reg || 'New unit'}</p>
                </div>
                <button
                  type="button"
                  onClick={removeSelectedUnit}
                  className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/15 active:scale-95"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fleet / Unit"><input value={selectedUnit.unit_number} onChange={(e) => updateUnitField('unit_number', e.target.value)} className={inputCls()} /></Field>
                <Field label="Registration"><input value={selectedUnit.unit_reg} onChange={(e) => updateUnitField('unit_reg', e.target.value)} className={inputCls()} /></Field>
                <Field label="Vehicle type"><input value={selectedUnit.unit_type} onChange={(e) => updateUnitField('unit_type', e.target.value)} className={inputCls()} /></Field>
                <Field label="Livery"><input value={selectedUnit.livery} onChange={(e) => updateUnitField('livery', e.target.value)} className={inputCls()} /></Field>
              </div>
              <Field label="Livery CSS">
                <div className="flex gap-3">
                  <textarea value={selectedUnit.livery_left} onChange={(e) => updateUnitField('livery_left', e.target.value)} className="min-h-[90px] flex-1 rounded-2xl border border-ts-border bg-ts-surface-2 px-3 py-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20" />
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ts-text-3">Preview</div>
                    <div className="aspect-[24/16] w-20 rounded-xl border border-ts-border-soft" style={{ background: selectedUnit.livery_left || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))' }} />
                  </div>
                </div>
              </Field>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-ts-text-3">
              {vehicleMode === 'Bus' ? 'No unit found for this service.' : 'Search for a vehicle or add a unit above.'}
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ─── Service tab ──────────────────────────────────────────────────────────

  function renderServiceTab() {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <p className="mb-4 text-sm font-bold text-ts-text-1">Basic info</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service number"><input value={serviceForm.service_number} onChange={(e) => updateServiceField('service_number', e.target.value)} className={inputCls()} /></Field>
            <Field label="Operator"><input value={serviceForm.operator} onChange={(e) => updateServiceField('operator', e.target.value)} className={inputCls()} /></Field>
            <div className="col-span-2">
              <Field label="Service date"><input type="date" value={serviceForm.service_date} onChange={(e) => updateServiceField('service_date', e.target.value)} className={inputCls()} /></Field>
            </div>
            <Field label="Origin"><input value={serviceForm.origin_name} onChange={(e) => updateServiceField('origin_name', e.target.value)} className={inputCls()} /></Field>
            <Field label="Destination"><input value={serviceForm.destination_name} onChange={(e) => updateServiceField('destination_name', e.target.value)} className={inputCls()} /></Field>
            <Field label="Sched departure"><input type="time" value={serviceForm.scheduled_departure} onChange={(e) => updateServiceField('scheduled_departure', e.target.value)} className={inputCls()} /></Field>
            <Field label="Actual departure"><input type="time" value={serviceForm.actual_departure} onChange={(e) => updateServiceField('actual_departure', e.target.value)} className={inputCls()} /></Field>
            <Field label="Sched arrival"><input type="time" value={serviceForm.scheduled_arrival} onChange={(e) => updateServiceField('scheduled_arrival', e.target.value)} className={inputCls()} /></Field>
            <Field label="Actual arrival"><input type="time" value={serviceForm.actual_arrival} onChange={(e) => updateServiceField('actual_arrival', e.target.value)} className={inputCls()} /></Field>
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-sm font-bold text-ts-text-1">Extra</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bustimes ID"><input value={serviceForm.bustimes_service_id} onChange={(e) => updateServiceField('bustimes_service_id', e.target.value)} className={inputCls()} /></Field>
            <Field label="Bustimes slug"><input value={serviceForm.bustimes_service_slug} onChange={(e) => updateServiceField('bustimes_service_slug', e.target.value)} className={inputCls()} /></Field>
            <Field label="Operator slug"><input value={serviceForm.operator_slug} onChange={(e) => updateServiceField('operator_slug', e.target.value)} className={inputCls()} /></Field>
            <Field label="Origin stop code"><input value={serviceForm.origin_stop_code} onChange={(e) => updateServiceField('origin_stop_code', e.target.value)} className={inputCls()} /></Field>
            <Field label="Destination stop code"><input value={serviceForm.destination_stop_code} onChange={(e) => updateServiceField('destination_stop_code', e.target.value)} className={inputCls()} /></Field>
          </div>
        </Card>
      </div>
    );
  }

  // ─── Notes tab ────────────────────────────────────────────────────────────

  function renderNotesTab() {
    return (
      <Card>
        <Field label="Trip notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering…"
            className="min-h-[200px] w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-4 py-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20 placeholder:text-ts-text-3"
          />
        </Field>
      </Card>
    );
  }

  // ─── Tab icons ────────────────────────────────────────────────────────────

  const tabIcons: Record<TabKey, ReactNode> = {
    Route: <Map className="h-[18px] w-[18px]" />,
    Vehicle: <TrainFront className="h-[18px] w-[18px]" />,
    Service: <Route className="h-[18px] w-[18px]" />,
    Notes: <NotebookText className="h-[18px] w-[18px]" />,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-svh flex-col bg-ts-bg transition-colors duration-300">
      {/* Sticky header + tabs */}
      <div className="sticky top-0 z-1 border-b border-ts-border bg-ts-bg/96 backdrop-blur-xl">
        <div className="mx-auto max-w-2xl px-4 lg:max-w-5xl">
          {/* Title row */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <h1 className="text-lg font-black tracking-tight text-ts-text-1 sm:text-xl">Log Trip</h1>
              {sourceLabel && <p className="truncate text-xs text-ts-text-3">{sourceLabel}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {saveSuccess && (
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-ts-accent/15 px-3 py-1 text-xs font-semibold text-ts-accent">
                  <CheckCircle2 className="h-3.5 w-3.5" />{saveSuccess}
                </span>
              )}
              <div className="flex items-center justify-between gap-3">
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {saveSuccess && <span className="text-xs font-semibold text-ts-accent sm:hidden">{saveSuccess}</span>}
                  {saveError && <span className="max-w-[200px] truncate text-xs text-red-300">{saveError}</span>}
                  {!isSignedIn && (
                    <SignInButton mode="modal">
                      <button type="button" className="rounded-full border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent hover:text-ts-accent active:scale-95">
                        Sign in
                      </button>
                    </SignInButton>
                  )}
                  {isSignedIn && !isConvexAuthLoading && !isAuthenticated && (
                    <span className="text-xs text-amber-400">Auth not connected</span>
                  )}
                  <button
                    type="submit"
                    form="log-trip-form" 
                    suppressHydrationWarning
                    disabled={loading || saving || isConvexAuthLoading || !isAuthenticated}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-ts-accent px-5 text-sm font-bold text-ts-text-inv transition hover:bg-ts-accent-h active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isEditingTrip ? 'Update trip' : 'Save log'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p className="min-w-0 flex-1 truncate text-xs text-ts-text-3">
            {riddenRoute
            ? `${riddenRoute.origin_name} → ${riddenRoute.destination_name}`
            : 'Choose start and end stops'}
          </p>

          {/* Tab bar */}
          <div className="flex">
            {TABS.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition active:scale-95 sm:flex-row sm:justify-center sm:gap-2 sm:text-sm sm:normal-case sm:tracking-normal ${
                    active ? 'text-ts-accent' : 'text-ts-text-3 hover:text-ts-text-2'
                  }`}
                >
                  {tabIcons[tab]}
                  <span>{tab}</span>
                  <span className={`absolute bottom-0 left-0 h-[2px] w-full rounded-full transition-opacity ${active ? 'bg-ts-accent opacity-100' : 'opacity-0'}`} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <form id="log-trip-form" onSubmit={handleSave} className="flex flex-1 flex-col">
        <input type="hidden" name="full_route" value={serializeJson(fullRoute)} readOnly />
        <input type="hidden" name="ridden_route" value={serializeJson(riddenRoute)} readOnly />

        <div className={`mx-auto w-full max-w-2xl flex-1 lg:max-w-5xl flex flex-col ${
          activeTab === 'Route' && routeMode === 'Map' ? 'px-0 py-0 grid' : 'px-4 py-4 pb-2'
        }`}>
          {loading ? (
            <Card className="flex items-center gap-3 text-sm text-ts-text-2 sm:mt-4 rounded-none sm:rounded-3xl sm:max-h-15 text-center justify-center  ">
              <LoaderCircle className="h-5 w-5 animate-spin text-ts-accent" />
              Loading service…
            </Card>
          ) : loadError ? (
            <Card className="flex items-start gap-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <span>
                {loadError === 'Missing service object'
                  ? 'Service not found. This can happen if the service was very recently created or not registered correctly by the operator.'
                  : loadError}
              </span>
            </Card>
          ) : (
            <>
              {activeTab === 'Route' && renderRouteTab()}
              {activeTab === 'Vehicle' && renderVehicleTab()}
              {activeTab === 'Service' && renderServiceTab()}
              {activeTab === 'Notes' && renderNotesTab()}
            </>
          )}
        </div>
      </form>
    </div>
  );
}