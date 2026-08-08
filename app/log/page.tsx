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
  Link2,
  Link2Off,
  LoaderCircle,
  Map,
  NotebookText,
  Pencil,
  Plus,
  Route,
  Save,
  TramFront,
  TrainFront,
  X,
  GripVertical,
} from 'lucide-react';

type TabKey = 'Route' | 'Vehicle' | 'Coupling' | 'Service' | 'Notes';
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

type CouplingEvent = {
  type: 'couple' | 'uncouple';
  unit: TripUnit;
  stop_name: string;
  stop_code: string;
  stop_id: number | null;
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
  polyline_path?: [number, number][] | null;
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
  coupling_events?: CouplingEvent[] | null;
};

type RequestResolution = {
  url: string;
  vehicleMode: VehicleMode;
  date: string;
  label: string;
};

const TABS: TabKey[] = ['Route', 'Vehicle', 'Coupling', 'Service', 'Notes'];
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

const EMPTY_COUPLING_UNIT: TripUnit = {
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

function snapPointToPolyline(
  point: [number, number],
  polyline: [number, number][],
): { snapped: [number, number]; insertAt: number; segmentIndex: number } | null {
  if (!polyline || polyline.length < 2 || !point || point.length !== 2) return null;
  if (isNaN(point[0]) || isNaN(point[1])) return null;

  let bestSnapped: [number, number] = [polyline[0][0], polyline[0][1]];
  let bestDist = Infinity;
  let bestInsertAt = 1;
  let bestSegIdx = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];

    if (!a || !b || a.length !== 2 || b.length !== 2) continue;
    if (isNaN(a[0]) || isNaN(a[1]) || isNaN(b[0]) || isNaN(b[1])) continue;

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-24) {
      const dist = Math.hypot(point[0] - a[0], point[1] - a[1]);
      if (dist < bestDist) {
        bestDist = dist;
        bestSnapped = [a[0], a[1]];
        bestInsertAt = i + 1;
        bestSegIdx = i;
      }
      continue;
    }

    let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = a[0] + t * dx;
    const projY = a[1] + t * dy;

    if (isNaN(projX) || isNaN(projY)) continue;

    const dist = Math.hypot(point[0] - projX, point[1] - projY);

    if (dist < bestDist) {
      bestDist = dist;
      bestSnapped = [projX, projY];
      bestInsertAt = i + 1;
      bestSegIdx = i;
    }
  }

  if (isNaN(bestSnapped[0]) || isNaN(bestSnapped[1])) return null;

  return { snapped: bestSnapped, insertAt: bestInsertAt, segmentIndex: bestSegIdx };
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

function isRouteCircular(fullRoute: RouteStop[]): boolean {
  if (fullRoute.length < 2) return false;
  const first = fullRoute[0];
  const last = fullRoute[fullRoute.length - 1];
  const firstLoc = first?.stop?.location;
  const lastLoc = last?.stop?.location;
  const firstName = first?.stop?.name;
  const lastName = last?.stop?.name;
  if (firstName && lastName && firstName === lastName) return true;
  if (firstLoc && lastLoc && firstLoc.length === 2 && lastLoc.length === 2) {
    if (firstLoc[0] === lastLoc[0] && firstLoc[1] === lastLoc[1]) return true;
  }
  const seen = new Set<number>();
  for (const s of fullRoute) {
    if (seen.has(s.id)) return true;
    seen.add(s.id);
  }
  return false;
}

function buildRiddenRoute(fullRoute: RouteStop[], fromStopId: number | null, toStopId: number | null, polylinePath?: [number, number][] | null): RiddenRoute | null {
  if (fromStopId === null || toStopId === null || fromStopId === toStopId) return null;
  const circular = isRouteCircular(fullRoute);
  const fromIndex = fullRoute.findIndex((s) => s.id === fromStopId);
  const toIndexFirst = fullRoute.findIndex((s) => s.id === toStopId);
  if (fromIndex === -1 || toIndexFirst === -1) return null;

  let toIndex = toIndexFirst;
  if (circular && fromIndex > toIndexFirst) {
    for (let i = fullRoute.length - 1; i >= 0; i--) {
      if (fullRoute[i].id === toStopId) { toIndex = i; break; }
    }
  }

  if (!circular && fromIndex > toIndex) return null;

  const wrapsAround = circular && fromIndex > toIndex;
  const stops = wrapsAround
    ? [...fullRoute.slice(fromIndex), ...fullRoute.slice(0, toIndex + 1)]
    : fullRoute.slice(fromIndex, toIndex + 1);

  let coordinates: [number, number][];

  if (polylinePath && polylinePath.length > 1) {
    const fromStop = wrapsAround ? fullRoute[fromIndex] : stops[0];
    const toStop = wrapsAround ? fullRoute[toIndex] : stops[stops.length - 1];

    const findClosestIndex = (target: [number, number] | null | undefined) => {
      if (!target || target.length !== 2) return null;

      let minDist = Infinity;
      let idx = 0;

      for (let i = 0; i < polylinePath.length; i++) {
        const p = polylinePath[i];
        const d = Math.hypot(p[0] - target[0], p[1] - target[1]);
        if (d < minDist) {
          minDist = d;
          idx = i;
        }
      }

      // 🔑 CRITICAL: reject if too far (not snapped)
      if (minDist > 0.01) return null;

      return idx;
    };

    let fromIdx = findClosestIndex(fromStop?.stop?.location);
    let toIdx = findClosestIndex(toStop?.stop?.location);

    // 🔁 fallback ONLY to OTHER SNAPPED STOPS (not raw coords)
    if (fromIdx === null) {
      for (const s of stops) {
        if (s.id >= 0) {
          const idx = findClosestIndex(s.stop?.location);
          if (idx !== null) {
            fromIdx = idx;
            break;
          }
        }
      }
    }

    if (toIdx === null) {
      for (let i = stops.length - 1; i >= 0; i--) {
        const s = stops[i];
        if (s.id >= 0) {
          const idx = findClosestIndex(s.stop?.location);
          if (idx !== null) {
            toIdx = idx;
            break;
          }
        }
      }
    }

    // 🚫 If still null → DO NOT fake it
    if (fromIdx === null || toIdx === null) {
      coordinates = dedupeCoordinates(polylinePath);
    } else {
      if (wrapsAround && fromIdx > toIdx) {
        coordinates = dedupeCoordinates([
          ...polylinePath.slice(fromIdx),
          ...polylinePath.slice(0, toIdx + 1),
        ]);
      } else {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        coordinates = dedupeCoordinates(polylinePath.slice(start, end + 1));
      }
    }

  } else {
    // fallback ONLY when no polyline exists
    coordinates = dedupeCoordinates(
      stops.flatMap((stop) => {
        if (Array.isArray(stop.track) && stop.track.length > 0) return stop.track;
        if (Array.isArray(stop.stop.location)) return [stop.stop.location];
        return [];
      }),
    );
  }

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

function findNearestStop(route: RouteStop[], lat: number, lon: number): RouteStop | undefined {
  let nearest: RouteStop | undefined;
  let minDist = Infinity;
  for (const stop of route) {
    const loc = stop.stop.location;
    if (!loc || loc.length < 2) continue;
    const d = Math.hypot(loc[1] - lat, loc[0] - lon);
    if (d < minDist) { minDist = d; nearest = stop; }
  }
  return nearest;
}

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
  const journeyID = searchParams.get('journey_id');
  if (journeyID) {
    return { url: `/api/log?journey_id=${encodeURIComponent(journeyID)}`, vehicleMode: 'Bus', date: '', label: `Bus Journey ${journeyID}` };
  }
  throw new Error('Oops we couldn\'t find that service, please send this links and any vehicle details to Kai.');
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
    <div className={`${className}`}>
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
  const [polylinePath, setPolylinePath] = useState<[number, number][] | null>(null);
  const [fromStopId, setFromStopId] = useState<number | null>(null);
  const [toStopId, setToStopId] = useState<number | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [stopSheetOpen, setStopSheetOpen] = useState(false);
  const [addStopAfterId, setAddStopAfterId] = useState<number | null>(null);
  const [newStopName, setNewStopName] = useState('');
  const [newStopTime, setNewStopTime] = useState('');
  const [newStopArrivalTime, setNewStopArrivalTime] = useState('');
  const [customStopCounter, setCustomStopCounter] = useState(0);
  const [customStopLocation, setCustomStopLocation] = useState<[number, number] | null>(null);
  const [editingStopId, setEditingStopId] = useState<number | null>(null);

  useEffect(() => { setStopSheetOpen(false); }, [routeMode]);
  const [units, setUnits] = useState<TripUnit[]>([]);
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
  const [unitSearch, setUnitSearch] = useState('');
  const [unitSearchResults, setUnitSearchResults] = useState<SearchResult[]>([]);
  const [unitSearchLoading, setUnitSearchLoading] = useState(false);
  const [unitSearchOpen, setUnitSearchOpen] = useState(false);
  const unitSearchRef = useRef<HTMLDivElement>(null);
  const [draggedUnitIndex, setDraggedUnitIndex] = useState<number | null>(null);
  const [dragOverUnitIndex, setDragOverUnitIndex] = useState<number | null>(null);
  const [couplingEvents, setCouplingEvents] = useState<CouplingEvent[]>([]);
  const [couplingSearchIndex, setCouplingSearchIndex] = useState<number | null>(null);
  const [couplingSearchResults, setCouplingSearchResults] = useState<SearchResult[]>([]);
  const [couplingSearchLoading, setCouplingSearchLoading] = useState(false);
  const [couplingSearchOpen, setCouplingSearchOpen] = useState(false);
  const couplingSearchRef = useRef<HTMLDivElement>(null);
  const couplingSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editTripId = searchKey ? new URLSearchParams(searchKey).get('trip_id') : null;
  const isCustomTrip = searchKey ? new URLSearchParams(searchKey).get('custom') === 'true' : false;
  const editTrip = useQuery(
    api.functions.trips.getMyTripById,
    editTripId ? { tripId: editTripId as Id<'tripLogs'> } : 'skip',
  ) as EditableTripRecord | null | undefined;
  const isEditingTrip = Boolean(editTripId);

  const selectedStop = fullRoute.find((s) => s.id === selectedStopId) ?? null;
  const riddenRoute = buildRiddenRoute(fullRoute, fromStopId, toStopId, polylinePath ?? fullGeometry?.coordinates ?? null);
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
        setCouplingEvents(Array.isArray(editTrip.coupling_events) ? editTrip.coupling_events as CouplingEvent[] : []);
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

      if (isCustomTrip) {
        setLoading(true); setLoadError(''); setSaveError(''); setSaveSuccess('');
        const params = new URLSearchParams(searchKey);
        const stopName = params.get('stop_name') || 'Start';
        const stopCode = params.get('stop_code') || '';
        const stopLat = parseFloat(params.get('stop_lat') || '0');
        const stopLon = parseFloat(params.get('stop_lon') || '0');
        const customDate = params.get('custom_date') || '';
        const customTime = params.get('custom_time') || '';

        const startStop: RouteStop = {
          id: 0,
          stop: { name: stopName, stop_code: stopCode, location: stopLat && stopLon ? [stopLon, stopLat] : null },
          scheduled_departure: null,
          scheduled_arrival: null,
        };

        if (cancelled) return;
        setFullRoute([startStop]);
        setFullGeometry(null);
        setFromStopId(0);
        setToStopId(null);
        setSelectedStopId(0);
        setSourceLabel(`Custom trip from ${stopName}`);
        setVehicleMode('Bus');
        setUnits([]);
        setSelectedUnitIndex(0);
        setNotes('');
        setCouplingEvents([]);
        setServiceForm({
          ...EMPTY_SERVICE_FORM,
          service_date: customDate,
          scheduled_departure: customTime,
        });
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
        setPolylinePath(Array.isArray(payload.polyline_path) ? payload.polyline_path : null);
        setUnits(initialUnits); setSelectedUnitIndex(0);
        const logParams = new URLSearchParams(searchKey);
        const stopCodeParam = logParams.get('stop_code');
        const latParam = logParams.get('lat');
        const lonParam = logParams.get('lon');
        let startStop = firstStop;
        if (stopCodeParam) {
          startStop = route.find((s) => s.stop.stop_code === stopCodeParam) || firstStop;
        } else if (latParam && lonParam) {
          startStop = findNearestStop(route, parseFloat(latParam), parseFloat(lonParam)) || firstStop;
        }
        setSelectedStopId(startStop?.id ?? null);
        setFromStopId(route.length > 1 ? startStop?.id ?? null : null);
        setToStopId(route.length > 1 ? lastStop?.id ?? null : null);
        setNotes('');
        setCouplingEvents([]);
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
          setFullRoute([]); setFullGeometry(null); setPolylinePath(null); setUnits([]); setServiceForm(EMPTY_SERVICE_FORM);
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [editTrip, editTripId, searchKey, isCustomTrip]);

  function handleMapClick(coords: { lng: number; lat: number }) {
    if (isCustomTrip) {
      const finishStop: RouteStop = {
        id: 999999,
        stop: { name: 'Custom destination', stop_code: '', location: [coords.lng, coords.lat] },
        scheduled_departure: null,
        scheduled_arrival: null,
      };
      setFullRoute((prev) => {
        if (prev.length <= 1) return [...prev, finishStop];
        return [...prev.slice(0, 1), finishStop];
      });
      setToStopId(999999);
      setSelectedStopId(999999);
    } else if (addStopAfterId !== null) {
      setCustomStopLocation([coords.lng, coords.lat]);
    }
  }

  useEffect(() => {
    if (!isCustomTrip || fullRoute.length < 2) return;
    const startStop = fullRoute[0];
    const finishStop = fullRoute[1];
    const startLoc = startStop?.stop?.location;
    const finishLoc = finishStop?.stop?.location;
    if (startLoc && finishLoc) {
      setFullGeometry({ type: 'LineString', coordinates: [startLoc, finishLoc] });
    }
    syncFormFromRoute(fullRoute, 0, 999999);
  }, [isCustomTrip, fullRoute]);

  function updateServiceField<K extends keyof ServiceFormState>(field: K, value: ServiceFormState[K]) {
    setServiceForm((c) => ({ ...c, [field]: value }));
  }

  function syncFormFromRoute(route: RouteStop[], nextFrom: number | null, nextTo: number | null) {
    const rr = buildRiddenRoute(route, nextFrom, nextTo, polylinePath);
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

  function startAddStop(afterId: number | null) {
    setAddStopAfterId(afterId);
    setNewStopName('');
    setNewStopTime('');
    setNewStopArrivalTime('');
    setCustomStopLocation(null);
    setStopSheetOpen(false);
  }

  function cancelAddStop() {
    setAddStopAfterId(null);
    setNewStopName('');
    setNewStopTime('');
    setNewStopArrivalTime('');
    setCustomStopLocation(null);
  }

  async function commitCustomStop() {
    if (!newStopName.trim()) return;
    const newId = -1 - customStopCounter;

    let stopLocation: [number, number] | null = customStopLocation;

    if (customStopLocation && customStopLocation.length === 2) {
      if (polylinePath && polylinePath.length > 1) {
        const snapResult = snapPointToPolyline(customStopLocation, polylinePath);
        if (snapResult) {
          stopLocation = snapResult.snapped;

          const { snapped, insertAt } = snapResult;
          const newPoly = [
            ...polylinePath.slice(0, insertAt),
            snapped,
            ...polylinePath.slice(insertAt),
          ];
          setPolylinePath(dedupeCoordinates(newPoly));

          if (fullGeometry?.coordinates?.length) {
            const geomSnap = snapPointToPolyline(snapped, fullGeometry.coordinates);
            if (geomSnap) {
              const newGeomCoords = [
                ...fullGeometry.coordinates.slice(0, geomSnap.insertAt),
                snapped,
                ...fullGeometry.coordinates.slice(geomSnap.insertAt),
              ];
              setFullGeometry({ type: 'LineString', coordinates: dedupeCoordinates(newGeomCoords) });
            } else {
              const prevRoute = fullRoute;
              const insertionIdx = addStopAfterId !== null
                ? fullRoute.findIndex((s) => s.id === addStopAfterId)
                : -1;
              const insertedAt = insertionIdx !== -1 ? insertionIdx + 1 : fullRoute.length;
              const priorRealStops = prevRoute.slice(0, insertedAt).filter((s) => s.id >= 0);
              const stopIndexFraction = priorRealStops.length / Math.max(1, prevRoute.filter((s) => s.id >= 0).length);
              const coords = fullGeometry.coordinates;
              const geomInsertAt = insertedAt >= prevRoute.length
                ? coords.length
                : Math.round(stopIndexFraction * coords.length);
              const newGeomCoords = [
                ...coords.slice(0, geomInsertAt),
                snapped,
                ...coords.slice(geomInsertAt),
              ];
              setFullGeometry({ type: 'LineString', coordinates: dedupeCoordinates(newGeomCoords) });
            }
          }
        }
      } else if (fullGeometry?.coordinates?.length) {
        const snapResult = snapPointToPolyline(customStopLocation, fullGeometry.coordinates);
        if (snapResult) {
          stopLocation = snapResult.snapped;

          const { snapped, insertAt } = snapResult;
          const newGeomCoords = [
            ...fullGeometry.coordinates.slice(0, insertAt),
            snapped,
            ...fullGeometry.coordinates.slice(insertAt),
          ];
          setFullGeometry({ type: 'LineString', coordinates: dedupeCoordinates(newGeomCoords) });
        }
      }
    }

    const newStop: RouteStop = {
      id: newId,
      stop: {
        name: newStopName.trim(),
        stop_code: '',
        location: stopLocation,
      },
      scheduled_departure: newStopTime || null,
      scheduled_arrival: newStopArrivalTime || null,
    };

    const insertionIdx = addStopAfterId !== null
      ? fullRoute.findIndex((s) => s.id === addStopAfterId)
      : -1;
    const newFullRoute = insertionIdx !== -1
      ? [...fullRoute.slice(0, insertionIdx + 1), newStop, ...fullRoute.slice(insertionIdx + 1)]
      : [...fullRoute, newStop];

    setFullRoute(newFullRoute);
    setCustomStopCounter((c) => c + 1);
    cancelAddStop();
  }

  function removeCustomStop(id: number) {
    const stopToRemove = fullRoute.find((s) => s.id === id);
    const removedLoc = stopToRemove?.stop?.location;

    setFullRoute((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (id === fromStopId) setFromStopId(filtered.length > 0 ? filtered[0].id : null);
      if (id === toStopId) setToStopId(filtered.length > 0 ? filtered[filtered.length - 1].id : null);
      if (id === selectedStopId) setSelectedStopId(null);
      if (addStopAfterId === id) setAddStopAfterId(null);
      return filtered;
    });

    // Clean up geometry for custom stops with location
    if (removedLoc && removedLoc.length === 2) {
      setFullGeometry((geom) => {
        if (!geom?.coordinates) return geom;
        let closestIdx = 0;
        let minDist = Infinity;
        geom.coordinates.forEach((coord, i) => {
          const d = Math.hypot(coord[0] - removedLoc[0], coord[1] - removedLoc[1]);
          if (d < minDist) { minDist = d; closestIdx = i; }
        });
        // Only remove if it's a close match (within ~100m in lng/lat degrees ≈ ~0.001)
        if (minDist < 0.005) {
          const newCoords = [...geom.coordinates];
          newCoords.splice(closestIdx, 1);
          return { type: 'LineString', coordinates: newCoords.length > 0 ? newCoords : geom.coordinates };
        }
        return geom;
      });
      setPolylinePath((path) => {
        if (!path) return path;
        let closestIdx = 0;
        let minDist = Infinity;
        path.forEach((coord, i) => {
          const d = Math.hypot(coord[0] - removedLoc[0], coord[1] - removedLoc[1]);
          if (d < minDist) { minDist = d; closestIdx = i; }
        });
        if (minDist < 0.005) {
          const newPath = [...path];
          newPath.splice(closestIdx, 1);
          return newPath.length > 0 ? newPath : path;
        }
        return path;
      });
    }
  }

  function handleStopDragEnd(stopId: number, newLocation: [number, number]) {
    if (!newLocation || newLocation.length !== 2) return;
    if (isNaN(newLocation[0]) || isNaN(newLocation[1])) return;

    setFullRoute((prevRoute) => {
      const targetStop = prevRoute.find((s) => s.id === stopId);
      if (!targetStop) return prevRoute;
      const oldLocation = targetStop.stop?.location;

      let snapped: [number, number] = [newLocation[0], newLocation[1]];

      if (polylinePath && polylinePath.length > 1) {
        const snapResult = snapPointToPolyline(newLocation, polylinePath);
        if (snapResult) {
          snapped = snapResult.snapped;
        }
      }

      const withoutOld = (coords: [number, number][]) => {
        if (!oldLocation || oldLocation.length !== 2) return coords;
        let closestIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < coords.length; i++) {
          const d = Math.hypot(coords[i][0] - oldLocation[0], coords[i][1] - oldLocation[1]);
          if (d < minDist) { minDist = d; closestIdx = i; }
        }
        if (minDist < 0.01) {
          const next = [...coords];
          next.splice(closestIdx, 1);
          return next;
        }
        return coords;
      };

      const insertSnapped = (coords: [number, number][]) => {
        if (coords.length < 2) return dedupeCoordinates([...coords, snapped]);
        const reSnap = snapPointToPolyline(snapped, coords);
        if (reSnap) {
          return dedupeCoordinates([
            ...coords.slice(0, reSnap.insertAt),
            snapped,
            ...coords.slice(reSnap.insertAt),
          ]);
        }
        return dedupeCoordinates([...coords, snapped]);
      };

      if (polylinePath && polylinePath.length > 1) {
        setPolylinePath((path) => {
          if (!path) return path;
          return insertSnapped(withoutOld(path));
        });
      }

      setFullGeometry((geom) => {
        if (!geom?.coordinates?.length) return geom;
        const newCoords = insertSnapped(withoutOld(geom.coordinates));
        return { type: 'LineString', coordinates: newCoords };
      });

      return prevRoute.map((s) =>
        s.id === stopId
          ? { ...s, stop: { ...s.stop, location: snapped } }
          : s,
      );
    });
  }

  function renameCustomStop(stopId: number, newName: string) {
    setFullRoute((prev) =>
      prev.map((s) =>
        s.id === stopId ? { ...s, stop: { ...s.stop, name: newName } } : s,
      ),
    );
  }

  function setStartStop(stopId: number) {
    if (stopId === toStopId) return;
    const circular = isRouteCircular(fullRoute);
    let nextTo = toStopId;
    if (toStopId !== null) {
      const fi = fullRoute.findIndex((s) => s.id === stopId);
      const ti = fullRoute.findIndex((s) => s.id === toStopId);
      if (fi !== -1 && ti !== -1 && fi > ti && !circular) nextTo = null;
    }
    setFromStopId(stopId); setToStopId(nextTo); setSelectedStopId(stopId);
    syncFormFromRoute(fullRoute, stopId, nextTo);
  }

  function setEndStop(stopId: number) {
    if (stopId === fromStopId) return;
    const circular = isRouteCircular(fullRoute);
    let nextFrom = fromStopId;
    if (fromStopId !== null) {
      const fi = fullRoute.findIndex((s) => s.id === fromStopId);
      const ti = fullRoute.findIndex((s) => s.id === stopId);
      if (fi !== -1 && ti !== -1 && ti < fi && !circular) nextFrom = null;
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
        coupling_events: couplingEvents.length > 0 ? couplingEvents : undefined,
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
    const circular = isRouteCircular(fullRoute);
    return (
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex gap-2">
          {(!isLast || circular) && (
            <button
              type="button"
              onClick={() => { setStartStop(stop.id); onDone?.(); }}
              disabled={stop.id === toStopId}
              className="flex-1 rounded-2xl border border-ts-border py-3 text-sm font-semibold text-ts-text-1 transition active:scale-95 hover:border-ts-accent hover:text-ts-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start here
            </button>
          )}
          {(!isFirst || circular) && (
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
        {stop.id < 0 && (
          <button
            type="button"
            onClick={() => { removeCustomStop(stop.id); onDone?.(); }}
            className="rounded-2xl border border-red-500/30 py-2.5 text-sm font-semibold text-red-400 transition active:scale-95 hover:bg-red-500/10"
          >
            Remove custom stop
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startAddStop(fullRoute.length > 0 ? fullRoute[fullRoute.length - 1].id : null)}
                  className="shrink-0 rounded-full border border-ts-border px-3 py-1.5 text-xs font-semibold text-ts-text-2 transition hover:border-amber-400 hover:text-amber-400 active:scale-95"
                >
                  + Add stop
                </button>
                <button
                  type="button"
                  onClick={resetToFullRoute}
                  className="shrink-0 rounded-full border border-ts-border px-3 py-1.5 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent hover:text-ts-accent active:scale-95"
                >
                  Full route
                </button>
              </div>
            </div>
            <div className="mt-3">
              <SegmentedControl
                options={ROUTE_MODES}
                value={routeMode}
                onChange={(v) => setRouteMode(v as RouteMode)}
              />
            </div>
            {addStopAfterId !== null && !isCustomTrip && (
              <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-2 text-xs font-semibold text-amber-400">Add custom stop</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    autoFocus
                    value={newStopName}
                    onChange={(e) => setNewStopName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newStopName.trim()) commitCustomStop(); if (e.key === 'Escape') cancelAddStop(); }}
                    placeholder="Stop name"
                    className="col-span-2 h-10 rounded-xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1 outline-none transition focus:border-amber-400 placeholder:text-ts-text-3"
                  />
                  <input
                    type="time"
                    value={newStopArrivalTime}
                    onChange={(e) => setNewStopArrivalTime(e.target.value)}
                    placeholder="Arrival"
                    className="h-10 rounded-xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1 outline-none transition focus:border-amber-400 placeholder:text-ts-text-3"
                  />
                  <input
                    type="time"
                    value={newStopTime}
                    onChange={(e) => setNewStopTime(e.target.value)}
                    placeholder="Departure"
                    className="h-10 rounded-xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1 outline-none transition focus:border-amber-400 placeholder:text-ts-text-3"
                  />
                </div>
                {customStopLocation && (
                  <p className="mt-1.5 text-[10px] text-ts-text-3">
                    Location set from map: {customStopLocation[1].toFixed(5)}, {customStopLocation[0].toFixed(5)}
                  </p>
                )}
                {!customStopLocation && (
                  <p className="mt-1.5 text-[10px] text-ts-text-3">Click on the map to set location (optional)</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={commitCustomStop}
                    disabled={!newStopName.trim()}
                    className="flex-1 rounded-xl bg-amber-500/15 border border-amber-500/30 py-2 text-xs font-bold text-amber-400 transition hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add to route
                  </button>
                  <button
                    type="button"
                    onClick={cancelAddStop}
                    className="flex-1 rounded-xl border border-ts-border py-2 text-xs font-semibold text-ts-text-3 transition hover:text-ts-text-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Map */}
        <div className={`${routeMode === 'Map' ? 'grid' : 'hidden'} relative flex-1 min-h-[450px] overflow-hidden bg-ts-surface sm:rounded-3xl sm:border sm:border-ts-border`}>
          <LogMap
            visible={routeMode === 'Map'}
            fullRoute={fullRoute}
            fullGeometry={fullGeometry}
            highlightedGeometry={riddenRoute?.geometry ?? fullGeometry}
            onStopClick={isCustomTrip ? () => {} : (id) => { setSelectedStopId(id); setStopSheetOpen(true); }}
            fromStopId={fromStopId}
            toStopId={toStopId}
            onMapClick={isCustomTrip || addStopAfterId !== null ? handleMapClick : null}
            onStopDragEnd={isCustomTrip ? null : handleStopDragEnd}
          />

            {/* Mobile Floating Overlay */}
            <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-3 px-3 sm:hidden">
              <div className="pointer-events-auto w-full rounded-2xl border border-ts-border bg-ts-bg/85 p-3 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ts-text-1">
                      {riddenRoute ? `${riddenRoute.origin_name} → ${riddenRoute.destination_name}` : isCustomTrip ? 'Click map to set destination' : 'Select stops'}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-ts-text-3">
                      {riddenRoute ? `${riddenRoute.stops.length} stops` : isCustomTrip ? '' : 'Tap map to start'}
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
            {selectedStop && stopSheetOpen && !isCustomTrip && (
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
                <button
                  type="button"
                  onClick={() => { startAddStop(selectedStop.id); }}
                  className="mt-2 w-full rounded-2xl border border-dashed border-amber-500/30 py-3 text-sm font-semibold text-amber-400 transition active:scale-95 hover:bg-amber-500/10"
                >
                  + Add stop after here
                </button>
              </div>
            )}
          </div>
        {/* List */}
        <div className={`${routeMode === 'Map' ? 'hidden' : 'flex flex-col'} gap-2 px-4 sm:px-0`}>
            {fullRoute.map((stop, index) => {
              const isSelected = selectedStopId === stop.id;
              const isStart = fromStopId === stop.id;
              const isEnd = toStopId === stop.id;
              const inRidden = riddenRoute?.stops.some((s) => s.id === stop.id) ?? false;

              return (
                <div key={stop.id}>
                  <div className="flex gap-0 items-stretch">
                    {/* Timeline */}
                    <div className="flex flex-col items-center w-8 shrink-0 pt-5 pb-0">
                      <div className={`h-3 w-3 rounded-full border-2 shrink-0 z-0 ${
                        stop.id < 0 ? 'border-amber-400 bg-amber-400/40' :
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
                        stop.id < 0
                          ? 'border-amber-500/40 bg-amber-500/5'
                          : isSelected && stopSheetOpen
                          ? 'border-ts-accent bg-ts-accent/10'
                          : inRidden
                          ? 'border-ts-border-soft bg-ts-surface-2'
                          : 'border-ts-border bg-ts-surface'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {stop.id < 0 && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-400">Custom</span>}
                        {isStart && <span className="rounded-full bg-ts-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-ts-accent">Start</span>}
                        {isEnd && <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-sky-400">End</span>}
                        {stop.stop.stop_code && <span className="text-[10px] text-ts-text-3">{stop.stop.stop_code}</span>}
                      </div>
                      {editingStopId === stop.id ? (
                        <input
                          autoFocus
                          defaultValue={stop.stop.name || ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameCustomStop(stop.id, (e.target as HTMLInputElement).value.trim() || stop.stop.name || 'Stop');
                              setEditingStopId(null);
                            }
                            if (e.key === 'Escape') setEditingStopId(null);
                          }}
                          onBlur={(e) => {
                            renameCustomStop(stop.id, e.target.value.trim() || stop.stop.name || 'Stop');
                            setEditingStopId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-sm font-bold text-ts-text-1 outline-none"
                        />
                      ) : (
                        <div className="mt-1 flex items-center gap-1.5">
                          <p className="text-sm font-bold text-ts-text-1">{stop.stop.name || 'Stop'}</p>
                          {stop.id < 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditingStopId(stop.id); }}
                              className="rounded p-0.5 text-ts-text-3 hover:text-amber-400 transition"
                              title="Rename stop"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
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
                      {stop.id < 0 && (
                        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => removeCustomStop(stop.id)}
                            className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold text-red-300 transition hover:bg-red-500/15 active:scale-95"
                          >
                            Remove stop
                          </button>
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Add-stop button */}
                  {!isCustomTrip && (
                    <div className="ml-8 pl-0 mb-2">
                      <button
                        type="button"
                        onClick={() => startAddStop(stop.id)}
                        className="flex items-center gap-1.5 rounded-full border border-dashed border-ts-border px-2.5 py-1 text-[11px] font-semibold text-ts-text-3 transition hover:border-amber-400 hover:text-amber-400 active:scale-95"
                      >
                        <Plus className="h-3 w-3" />
                        Add stop after
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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

  // ─── Coupling tab ──────────────────────────────────────────────────────────

  function addCouplingEvent() {
    const nearestStop = selectedStop ?? fullRoute[0];
    setCouplingEvents((c) => [
      ...c,
      {
        type: 'couple',
        unit: { ...EMPTY_COUPLING_UNIT },
        stop_name: nearestStop?.stop?.name ?? '',
        stop_code: nearestStop?.stop?.stop_code ?? '',
        stop_id: nearestStop?.id ?? null,
      },
    ]);
  }

  function updateCouplingEvent(index: number, patch: Partial<CouplingEvent>) {
    setCouplingEvents((c) => c.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function updateCouplingUnitField(index: number, field: keyof TripUnit, value: string) {
    setCouplingEvents((c) =>
      c.map((e, i) =>
        i === index ? { ...e, unit: { ...e.unit, [field]: value } } : e,
      ),
    );
  }

  function removeCouplingEvent(index: number) {
    setCouplingEvents((c) => c.filter((_, i) => i !== index));
  }

  function fillCouplingUnitFromSearch(index: number, result: SearchResult) {
    setCouplingEvents((c) =>
      c.map((e, i) =>
        i === index
          ? {
              ...e,
              unit: {
                unit_number: result.unit_number,
                unit_reg: result.unit_reg,
                unit_type: result.type.type_name,
                livery: result.livery.livery_name,
                livery_left: result.livery.livery_css,
              },
            }
          : e,
      ),
    );
  }

  function renderCouplingTab() {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-ts-text-1">Mid-route formation changes</p>
              <p className="mt-0.5 text-xs text-ts-text-3">
                Log units that coupled or uncoupled during the journey
              </p>
            </div>
            <button
              type="button"
              onClick={addCouplingEvent}
              disabled={fullRoute.length === 0}
              className="shrink-0 rounded-full border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent hover:text-ts-accent active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="mr-1 inline h-3 w-3" />
              Add event
            </button>
          </div>
        </Card>

        {couplingEvents.length === 0 && (
          <Card className="py-12 text-center text-sm text-ts-text-3">
            No formation changes logged for this trip.
          </Card>
        )}

        {couplingEvents.map((event, index) => {
          const isCouple = event.type === 'couple';

          return (
            <Card key={index}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  {isCouple ? (
                    <Link2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Link2Off className="h-4 w-4 text-red-400" />
                  )}
                  <span className={`text-sm font-bold ${isCouple ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isCouple ? 'Coupled' : 'Uncoupled'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeCouplingEvent(index)}
                  className="rounded-full border border-red-500/30 bg-red-500/10 p-1.5 text-red-300 transition hover:bg-red-500/15 active:scale-95"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Search for unit */}
              <div className="mb-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">Search vehicle</p>
                <div ref={couplingSearchIndex === index ? couplingSearchRef : undefined} className="relative">
                  <div className="relative">
                    <input
                      key={`coupling-search-${index}`}
                      onChange={(e) => {
                        setCouplingSearchIndex(index);
                        const q = e.target.value.trim();
                        if (q.length < 2) {
                          setCouplingSearchResults([]);
                          setCouplingSearchOpen(false);
                          setCouplingSearchLoading(false);
                          if (couplingSearchTimeoutRef.current) clearTimeout(couplingSearchTimeoutRef.current);
                          return;
                        }
                        if (couplingSearchTimeoutRef.current) clearTimeout(couplingSearchTimeoutRef.current);
                        couplingSearchTimeoutRef.current = setTimeout(async () => {
                          setCouplingSearchLoading(true);
                          try {
                            const type = vehicleMode === 'Train' ? 'train' : vehicleMode === 'Bus' ? 'bus' : '';
                            const params = new URLSearchParams({ q });
                            if (type) params.set('type', type);
                            const res = await fetch(`/api/search?${params}`);
                            const data: SearchResult[] = await res.json();
                            setCouplingSearchResults(data);
                            setCouplingSearchOpen(data.length > 0);
                          } catch { setCouplingSearchResults([]); }
                          finally { setCouplingSearchLoading(false); }
                        }, 350);
                      }}
                      onFocus={() => {
                        setCouplingSearchIndex(index);
                        if (couplingSearchResults.length > 0) setCouplingSearchOpen(true);
                      }}
                      placeholder={vehicleMode === 'Bus' ? 'Reg or fleet number…' : 'Unit or reg…'}
                      className={`${inputCls()} pr-10`}
                    />
                    {couplingSearchLoading && couplingSearchIndex === index && <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ts-accent" />}
                  </div>
                  {couplingSearchOpen && couplingSearchIndex === index && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-3xl border border-ts-border bg-ts-surface shadow-xl">
                      {couplingSearchResults.map((r) => (
                        <button
                          key={`coupling-${r.source}-${r.id}`}
                          type="button"
                          onClick={() => {
                            fillCouplingUnitFromSearch(index, r);
                            setCouplingSearchOpen(false);
                            setCouplingSearchResults([]);
                            setCouplingSearchIndex(null);
                          }}
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
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Action">
                  <div className="inline-flex rounded-full border border-ts-border bg-ts-surface-2 p-1 gap-0.5">
                    <button
                      type="button"
                      onClick={() => updateCouplingEvent(index, { type: 'couple' })}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                        isCouple
                          ? 'bg-emerald-500/20 text-emerald-400 shadow-md shadow-emerald-500/10'
                          : 'text-ts-text-3 hover:text-ts-text-1'
                      }`}
                    >
                      Coupled
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCouplingEvent(index, { type: 'uncouple' })}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                        !isCouple
                          ? 'bg-red-500/20 text-red-400 shadow-md shadow-red-500/10'
                          : 'text-ts-text-3 hover:text-ts-text-1'
                      }`}
                    >
                      Uncoupled
                    </button>
                  </div>
                </Field>

                <Field label="At stop">
                  <input
                    type="text"
                    list={`coupling-stops-${index}`}
                    value={event.stop_name ?? ''}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      const matchedStop = fullRoute.find((s) => {
                        const name = s.stop.name || s.stop.stop_code || `Stop ${s.id}`;
                        return name.toLowerCase() === value.toLowerCase();
                      });
                      if (matchedStop) {
                        updateCouplingEvent(index, {
                          stop_id: matchedStop.id,
                          stop_name: matchedStop.stop.name ?? '',
                          stop_code: matchedStop.stop.stop_code ?? '',
                        });
                      } else {
                        updateCouplingEvent(index, {
                          stop_id: null,
                          stop_name: value,
                          stop_code: '',
                        });
                      }
                    }}
                    placeholder="Start typing a stop name..."
                    className={inputCls()}
                  />
                  <datalist id={`coupling-stops-${index}`}>
                    {fullRoute.map((stop) => (
                      <option key={stop.id} value={stop.stop.name || stop.stop.stop_code || `Stop ${stop.id}`} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">
                {isCouple ? 'Unit that coupled' : 'Unit that uncoupled'}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fleet / Unit">
                  <input
                    value={event.unit.unit_number}
                    onChange={(e) => updateCouplingUnitField(index, 'unit_number', e.target.value)}
                    placeholder="e.g. 43055"
                    className={inputCls()}
                  />
                </Field>
                <Field label="Registration">
                  <input
                    value={event.unit.unit_reg}
                    onChange={(e) => updateCouplingUnitField(index, 'unit_reg', e.target.value)}
                    placeholder="e.g. AB12 CDE"
                    className={inputCls()}
                  />
                </Field>
                <Field label="Vehicle type">
                  <input
                    value={event.unit.unit_type}
                    onChange={(e) => updateCouplingUnitField(index, 'unit_type', e.target.value)}
                    className={inputCls()}
                  />
                </Field>
                <Field label="Livery">
                  <input
                    value={event.unit.livery}
                    onChange={(e) => updateCouplingUnitField(index, 'livery', e.target.value)}
                    className={inputCls()}
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Livery CSS">
                  <div className="flex gap-3">
                    <textarea
                      value={event.unit.livery_left}
                      onChange={(e) => updateCouplingUnitField(index, 'livery_left', e.target.value)}
                      className="min-h-[60px] flex-1 rounded-2xl border border-ts-border bg-ts-surface-2 px-3 py-2 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
                    />
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ts-text-3">Preview</div>
                      <div
                        className="aspect-[24/16] w-16 rounded-xl border border-ts-border-soft"
                        style={{ background: event.unit.livery_left || 'linear-gradient(135deg, rgba(52,208,100,0.18), rgba(20,30,23,1))' }}
                      />
                    </div>
                  </div>
                </Field>
              </div>
            </Card>
          );
        })}

        {couplingEvents.length > 0 && (
          <Card>
            <div className="text-xs text-ts-text-3 space-y-1">
              <p className="font-semibold text-ts-text-2 text-sm mb-2">Summary</p>
              {couplingEvents.map((event, i) => {
                const stopName = event.stop_name || (event.stop_id !== null
                  ? fullRoute.find((s) => s.id === event.stop_id)?.stop.name ?? 'Unknown'
                  : 'Unknown');
                const unitLabel = [event.unit.unit_number, event.unit.unit_reg].filter(Boolean).join(' - ') || 'Unknown unit';
                return (
                  <p key={i} className="flex items-center gap-1.5">
                    {event.type === 'couple' ? (
                      <Link2 className="h-3 w-3 text-emerald-400 shrink-0" />
                    ) : (
                      <Link2Off className="h-3 w-3 text-red-400 shrink-0" />
                    )}
                    <span className="font-mono font-semibold">{unitLabel}</span>
                    <span>{event.type === 'couple' ? 'coupled to' : 'uncoupled from'} train at</span>
                    <span className="font-semibold">{stopName}</span>
                  </p>
                );
              })}
            </div>
          </Card>
        )}
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
    Coupling: <Link2 className="h-[18px] w-[18px]" />,
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
              {activeTab === 'Coupling' && renderCouplingTab()}
              {activeTab === 'Service' && renderServiceTab()}
              {activeTab === 'Notes' && renderNotesTab()}
            </>
          )}
        </div>
      </form>
    </div>
  );
}