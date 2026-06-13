'use client';

import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useMutation } from 'convex/react';
import {
  Upload,
  Settings2,
  Eye,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  ArrowLeft,
  Wand2,
  Save,
  Download,
  FolderUp,
  Trash2,
} from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMapStyleUrl } from '@/components/mapStyleUrl';
import { useTheme } from '@/components/ThemeProvider';
import { api } from '@/convex/_generated/api';
import type { InternalTrip, InternalUnit, FieldMapping, MappingPreset, TransformResult } from '@/lib/tt-import/types';
import { parseTTFile, flattenTTKeys, getFieldValue, getCurrentValue, findField, stripPrefix, displayPath } from '@/lib/tt-import/parser';
import { transformTTData } from '@/lib/tt-import/transformer';
import { DEFAULT_PRESETS, autoMapFields, savePreset, loadSavedPresets } from '@/lib/tt-import/presets';

type Step = 'upload' | 'map' | 'preview' | 'confirm';

const INTERNAL_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'service_number', label: 'Service Number', required: true },
  { key: 'operator', label: 'Operator', required: true },
  { key: 'operator_slug', label: 'Operator Slug', required: false },
  { key: 'origin_name', label: 'Origin Name', required: true },
  { key: 'destination_name', label: 'Destination Name', required: true },
  { key: 'scheduled_departure', label: 'Scheduled Departure', required: true },
  { key: 'scheduled_arrival', label: 'Scheduled Arrival', required: true },
  { key: 'actual_departure', label: 'Actual Departure', required: false },
  { key: 'actual_arrival', label: 'Actual Arrival', required: false },
  { key: 'transport_type', label: 'Transport Type', required: false },
  { key: 'service_date', label: 'Service Date', required: true },
  { key: 'origin_stop_code', label: 'Origin Stop Code', required: false },
  { key: 'destination_stop_code', label: 'Destination Stop Code', required: false },
  { key: 'stops', label: 'Stops Array', required: true },
  { key: 'geometry', label: 'Route Geometry', required: false },
  { key: 'units', label: 'Units Array', required: false },
  { key: 'unit_number', label: 'Unit Number', required: false },
  { key: 'unit_type', label: 'Unit Type', required: false },
  { key: 'livery', label: 'Livery Name', required: false },
  { key: 'livery_left', label: 'Livery Colours', required: false },
];

function inputCls() {
  return 'h-11 w-full rounded-xl border border-ts-border bg-ts-surface-2 px-3.5 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20 placeholder:text-ts-text-3';
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-ts-border bg-ts-surface p-4 ${className}`}>{children}</div>;
}

function SectionCard({
  title, icon, children, className = '',
}: {
  title: string; icon?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-ts-border bg-ts-surface ${className}`}>
      <div className="flex items-center gap-2 border-b border-ts-border px-4 py-3 md:px-5">
        {icon ? <div className="text-ts-text-2">{icon}</div> : null}
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ts-text-1">{title}</h2>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ts-border bg-ts-surface-2 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ts-text-3">{label}</div>
      <div className="mt-1 text-sm font-bold text-ts-text-1">{value}</div>
    </div>
  );
}

function StepIndicator({ steps, current }: { steps: Step[]; current: Step }) {
  const labels: Record<Step, string> = {
    upload: 'Upload',
    map: 'Map Fields',
    preview: 'Preview',
    confirm: 'Confirm',
  };
  const icons: Record<Step, ReactNode> = {
    upload: <Upload className="h-3.5 w-3.5" />,
    map: <Settings2 className="h-3.5 w-3.5" />,
    preview: <Eye className="h-3.5 w-3.5" />,
    confirm: <CheckCircle2 className="h-3.5 w-3.5" />,
  };
  const currentIdx = steps.indexOf(current);

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {steps.map((step, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition sm:px-3 sm:text-xs ${
                isActive
                  ? 'bg-ts-accent text-ts-text-inv'
                  : isDone
                    ? 'bg-ts-accent/15 text-ts-accent'
                    : 'border border-ts-border text-ts-text-3'
              }`}
            >
              {icons[step]}
              <span className="hidden sm:inline">{labels[step]}</span>
            </div>
            {i < steps.length - 1 ? (
              <div className={`h-px w-3 sm:w-6 ${i < currentIdx ? 'bg-ts-accent/50' : 'bg-ts-border'}`} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RoutePreview({ trip }: { trip: InternalTrip | null }) {
  const { theme } = useTheme();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const coordinates = useMemo(() => {
    return trip?.full_route?.geometry?.coordinates ?? [];
  }, [trip]);

  const originCoord = useMemo(() => {
    if (coordinates.length > 0) return coordinates[0];
    if (trip?.full_route?.stops?.[0]?.location) return trip.full_route.stops[0].location;
    return null;
  }, [coordinates, trip]);

  const destinationCoord = useMemo(() => {
    if (coordinates.length > 1) return coordinates[coordinates.length - 1];
    if (trip?.full_route?.stops && trip.full_route.stops.length > 1) {
      return trip.full_route.stops[trip.full_route.stops.length - 1].location;
    }
    return null;
  }, [coordinates, trip]);

  const stops = useMemo(() => trip?.full_route?.stops ?? [], [trip]);
  const units = useMemo(() => trip?.units ?? [], [trip]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (coordinates.length < 2 && !originCoord) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getMapStyleUrl(theme),
      center: originCoord ?? [-1.5, 52.5],
      zoom: 11,
    });
    mapRef.current = map;

    map.on('load', () => {
      const features: any[] = [];
      const bounds = new maplibregl.LngLatBounds();

      if (coordinates.length > 1) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { kind: 'route' },
        });
        coordinates.forEach((c: [number, number]) => bounds.extend(c));
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

      if (!map.getSource('preview-route')) {
        map.addSource('preview-route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });
      }

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'preview-route',
        filter: ['==', ['get', 'kind'], 'route'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#34d064', 'line-width': 4, 'line-opacity': 0.8 },
      });

      map.addLayer({
        id: 'origin-point',
        type: 'circle',
        source: 'preview-route',
        filter: ['==', ['get', 'kind'], 'origin'],
        paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#34d064' },
      });

      map.addLayer({
        id: 'destination-point',
        type: 'circle',
        source: 'preview-route',
        filter: ['==', ['get', 'kind'], 'destination'],
        paint: { 'circle-radius': 6, 'circle-color': '#34d064', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 44, duration: 500, maxZoom: 14 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [coordinates, originCoord, destinationCoord, theme]);

  if (!trip) {
    return (
      <div className="rounded-2xl border border-dashed border-ts-border p-6 text-center text-sm text-ts-text-3">
        Map fields to see a live preview
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ts-border bg-ts-surface-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-ts-border bg-ts-surface-3 px-2.5 py-1 text-xs font-semibold text-ts-text-1">
            {trip.service_number || '—'}
          </span>
          <span className="text-xs text-ts-text-3">{trip.operator || '—'}</span>
          <span className="rounded-full border border-ts-border bg-ts-surface-3 px-2 py-0.5 text-[10px] text-ts-text-3">
            {trip.transport_type || 'Bus'}
          </span>
        </div>
        <div className="mt-3 text-xs uppercase tracking-wider text-ts-text-3">
          {trip.scheduled_departure || '??:??'} → {trip.scheduled_arrival || '??:??'}
        </div>
        <div className="mt-1 text-base font-bold text-ts-text-1">
          {trip.origin_name || '?'} → {trip.destination_name || '?'}
        </div>
      </div>

      {coordinates.length > 1 || originCoord ? (
        <div className="h-[250px] overflow-hidden rounded-2xl border border-ts-border">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>
      ) : null}

      {stops.length > 0 ? (
        <div className="space-y-2">
          {stops.map((stop, i) => {
            const isEdge = i === 0 || i === stops.length - 1;
            return (
              <div key={i} className="flex gap-2.5 rounded-xl border border-ts-border bg-ts-surface-2 px-3 py-2">
                <div className="flex flex-col items-center pt-1">
                  <div className={`h-2.5 w-2.5 rounded-full ${isEdge ? 'bg-ts-accent' : 'bg-white/30'}`} />
                  {i < stops.length - 1 ? <div className="mt-1 h-full min-h-4 w-px bg-white/10" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-ts-text-1">{stop.name || `Stop ${i + 1}`}</div>
                  <div className="text-[10px] text-ts-text-3">
                    {stop.scheduled_departure || stop.scheduled_arrival || '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {units.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {units.map((unit, i) => (
            <div key={i} className="rounded-xl border border-ts-border bg-ts-surface-2 px-3 py-2">
              <div className="text-xs font-bold text-ts-text-1">{unit.unit_number || 'Unit'}</div>
              {unit.unit_type ? <div className="text-[10px] text-ts-text-3">{unit.unit_type}</div> : null}
              {unit.livery ? (
                <div className="mt-1 h-3 w-12 rounded border border-ts-border-soft" style={{ background: unit.livery_left || undefined }} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function TTImportPage() {
  const { theme } = useTheme();
  const logTrip = useMutation(api.functions.trips.logTrip);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [allTrips, setAllTrips] = useState<Record<string, unknown>[]>([]);
  const [tripIndex, setTripIndex] = useState(0);
  const [parseError, setParseError] = useState('');
  const [mappings, setMappings] = useState<FieldMapping>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [rawPreview, setRawPreview] = useState<string | null>(null);
  const [pathSearch, setPathSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rawData = allTrips[tripIndex] ?? null;

  const ttFlattened = useMemo(() => {
    if (!rawData) return [];
    return flattenTTKeys(rawData).filter(Boolean);
  }, [rawData]);

  const filteredPaths = useMemo(() => {
    const mapped = new Set(Object.values(mappings).filter(Boolean));
    if (!pathSearch.trim()) {
      return ttFlattened.filter((p) => mapped.has(p)).length > 0
        ? ttFlattened.filter((p) => mapped.has(p))
        : ttFlattened.slice(0, 30);
    }
    const q = pathSearch.toLowerCase();
    return ttFlattened.filter(
      (p) => mapped.has(p) || displayPath(p).toLowerCase().includes(q),
    );
  }, [ttFlattened, pathSearch, mappings]);

  const ttSummary = useMemo(() => {
    if (!rawData) return null;
    const nodesKey = findField(rawData, 'nodes');
    const consistKey = findField(rawData, 'consist');
    const nodes: unknown[] = nodesKey ? (Array.isArray(rawData[nodesKey]) ? rawData[nodesKey] : []) : [];
    const consist: unknown[] = consistKey ? (Array.isArray(rawData[consistKey]) ? rawData[consistKey] : []) : [];
    return {
      rideName: String(getFieldValue(rawData, 'rideName', 'ride_name', 'tripName') ?? ''),
      organisation: String(getFieldValue(rawData, 'organisation', 'organization', 'org') ?? ''),
      nodeCount: nodes.length,
      consistCount: consist.length,
    };
  }, [rawData]);

  const transformResult: TransformResult = useMemo(() => {
    if (!rawData) return { data: null, errors: [] };
    return transformTTData(rawData, mappings);
  }, [rawData, mappings]);

  const allPresets = useMemo(() => {
    return [...DEFAULT_PRESETS, ...loadSavedPresets()];
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setParseError('');
    setFileName(file.name);
    setLoading(true);
    try {
      const text = await file.text();
      const { trips } = parseTTFile(text);
      setAllTrips(trips);
      setTripIndex(0);
      setMappings({});
      setRawPreview(null);
      setStep('map');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
      setAllTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAutoMap = useCallback(() => {
    if (!rawData) return;
    const auto = autoMapFields(rawData, ttFlattened);
    setMappings(auto);
  }, [rawData, ttFlattened]);

  const updateMapping = useCallback((internalField: string, ttPath: string) => {
    setMappings((prev) => {
      const next = { ...prev };
      if (ttPath) {
        next[internalField] = ttPath;
      } else {
        delete next[internalField];
      }
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: MappingPreset) => {
    setMappings({ ...preset.fieldMappings });
  }, []);

  const handleSavePreset = useCallback(() => {
    const name = prompt('Preset name:');
    if (!name) return;

    const stripped: FieldMapping = {};
    for (const [key, path] of Object.entries(mappings)) {
      const parts = path.split('.');
      const strippedParts = parts.map((p) => {
        const base = p.replace(/\[(first|last|item)\]$/, '');
        const suffix = p.includes('[') ? p.slice(base.length) : '';
        return stripPrefix(base) + suffix;
      });
      stripped[key] = strippedParts.join('.');
    }

    savePreset({ name, fieldMappings: stripped });
  }, [mappings]);

  const handleLoadPresetFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const preset: MappingPreset = JSON.parse(text);
        if (preset.fieldMappings) applyPreset(preset);
      } catch { alert('Invalid preset file'); }
    };
    input.click();
  }, [applyPreset]);

  const handleExportPreset = useCallback(() => {
    if (Object.keys(mappings).length === 0) return;
    const preset: MappingPreset = {
      name: fileName || 'custom-mapping',
      fieldMappings: mappings,
    };
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/[^a-z0-9]/gi, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [mappings, fileName]);

  const handleSaveToTrips = useCallback(async () => {
    if (!transformResult.data || transformResult.errors.length > 0) return;
    setSaving(true);
    setSaveResult('');
    try {
      const trip = transformResult.data;
      const cleanedUnits = (trip.units || []).map((u: InternalUnit) => ({
        unit_number: u.unit_number?.trim() || undefined,
        unit_reg: u.unit_reg?.trim() || undefined,
        unit_type: u.unit_type?.trim() || undefined,
        livery: u.livery?.trim() || undefined,
        livery_left: u.livery_left?.trim() || undefined,
      })).filter((u) => Boolean(u.unit_number || u.unit_reg || u.unit_type || u.livery || u.livery_left));

      const transportType = (['Rail', 'Bus', 'Tram', 'Ferry', 'Taxi', 'Other'] as const).includes(
        trip.transport_type as any,
      )
        ? (trip.transport_type as 'Rail' | 'Bus' | 'Tram' | 'Ferry' | 'Taxi' | 'Other')
        : 'Other';

      await logTrip({
        service_number: trip.service_number || 'Unknown',
        operator: trip.operator || 'Unknown',
        operator_slug: trip.operator_slug || 'unknown',
        service_date: trip.service_date || Date.now(),
        transport_type: transportType,
        origin_name: trip.origin_name || 'Unknown',
        origin_stop_code: trip.origin_stop_code || '',
        destination_name: trip.destination_name || 'Unknown',
        destination_stop_code: trip.destination_stop_code || '',
        scheduled_departure: trip.scheduled_departure || '',
        actual_departure: trip.actual_departure || undefined,
        scheduled_arrival: trip.scheduled_arrival || '',
        actual_arrival: trip.actual_arrival || undefined,
        full_route: trip.full_route ?? null,
        ridden_route: trip.full_route ?? null,
        units: cleanedUnits,
      });
      setSaveResult('Trip saved successfully!');
      setTimeout(() => setSaveResult(''), 3000);
    } catch (err) {
      setSaveResult(err instanceof Error ? err.message : 'Failed to save trip');
    } finally { setSaving(false); }
  }, [transformResult, logTrip]);

  if (!rawData) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-black tracking-tight text-ts-text-1">Import TT Export</h1>
          <p className="mt-1 text-sm text-ts-text-3">Upload a Transit Tracker export file to convert it into a structured trip</p>
        </div>

        <Card>
          {loading ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl p-12 text-center">
              <LoaderCircle className="h-8 w-8 animate-spin text-ts-accent" />
              <p className="text-sm font-semibold text-ts-text-1">Processing file...</p>
              <p className="text-xs text-ts-text-3">Parsing {fileName}</p>
            </div>
          ) : (
            <div
              className="flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-ts-border p-12 text-center transition hover:border-ts-accent/50 hover:bg-ts-accent/5"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="rounded-full bg-ts-accent/10 p-4 text-ts-accent">
                <Upload className="h-8 w-8" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ts-text-1">Click to upload TT export JSON</p>
                <p className="mt-1 text-xs text-ts-text-3">.json files from Transit Tracker data exports</p>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
          />
          {parseError ? (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {parseError}
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setAllTrips([]); setStep('upload'); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-ts-border bg-ts-surface px-3 py-1.5 text-xs text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <div>
            <h1 className="text-lg font-bold text-ts-text-1">Import TT Export</h1>
            <p className="text-xs text-ts-text-3">{fileName}</p>
          </div>
        </div>
        <StepIndicator steps={['upload', 'map', 'preview', 'confirm']} current={step} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6 min-w-0">
          {/* Upload summary */}
          <SectionCard title="Raw Data Summary" icon={<FolderUp className="h-4 w-4" />}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-ts-text-3">
                Trip {tripIndex + 1} of {allTrips.length}
              </div>
              {allTrips.length > 1 ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => setTripIndex((i) => Math.max(0, i - 1))}
                    disabled={tripIndex === 0}
                    className="rounded-lg border border-ts-border bg-ts-surface-2 px-2.5 py-1 text-xs text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setTripIndex((i) => Math.min(allTrips.length - 1, i + 1))}
                    disabled={tripIndex === allTrips.length - 1}
                    className="rounded-lg border border-ts-border bg-ts-surface-2 px-2.5 py-1 text-xs text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatBadge label="Trip Name" value={ttSummary?.rideName || '—'} />
              <StatBadge label="Organisation" value={ttSummary?.organisation || '—'} />
              <StatBadge label="Nodes (Stops)" value={String(ttSummary?.nodeCount ?? 0)} />
              <StatBadge label="Consist (Units)" value={String(ttSummary?.consistCount ?? 0)} />
            </div>
            <details
              className="mt-3"
              onToggle={(e) => {
                if ((e.target as HTMLDetailsElement).open && !rawPreview) {
                  setTimeout(() => setRawPreview(JSON.stringify(rawData, null, 2).slice(0, 50000)), 0);
                }
              }}
            >
              <summary className="cursor-pointer text-xs font-semibold text-ts-text-3 hover:text-ts-text-2">
                Preview raw data
              </summary>
              {rawPreview ? (
                <pre className="mt-2 max-h-[300px] overflow-auto rounded-2xl border border-ts-border bg-ts-bg p-3 text-[10px] leading-relaxed text-ts-text-2">
                  {rawPreview}
                  {rawPreview.length >= 50000 ? '\n\n... (truncated)' : ''}
                </pre>
              ) : (
                <div className="mt-2 text-xs text-ts-text-3">Generating preview...</div>
              )}
            </details>
          </SectionCard>

          {/* Mapping Interface */}
          <SectionCard title="Field Mapping" icon={<Settings2 className="h-4 w-4" />}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                onClick={handleAutoMap}
                className="inline-flex items-center gap-1.5 rounded-full bg-ts-accent px-3.5 py-2 text-xs font-bold text-ts-text-inv transition hover:bg-ts-accent-h active:scale-95"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Auto Map
              </button>
              <span className="text-[10px] text-ts-text-3">|</span>
              <button
                onClick={handleSavePreset}
                className="inline-flex items-center gap-1.5 rounded-full border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent active:scale-95"
              >
                <Save className="h-3.5 w-3.5" />
                Save Preset
              </button>
              <button
                onClick={handleExportPreset}
                className="inline-flex items-center gap-1.5 rounded-full border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent active:scale-95"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              <button
                onClick={handleLoadPresetFile}
                className="inline-flex items-center gap-1.5 rounded-full border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent active:scale-95"
              >
                <FolderUp className="h-3.5 w-3.5" />
                Load File
              </button>
            </div>

            {allPresets.length > 0 ? (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {allPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className="rounded-full border border-ts-accent/20 bg-ts-accent/5 px-2.5 py-1 text-[10px] font-semibold text-ts-accent transition hover:bg-ts-accent/15 active:scale-95"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mb-3">
              <input
                value={pathSearch}
                onChange={(e) => setPathSearch(e.target.value)}
                placeholder="Search fields... (leave empty to show mapped only)"
                className={inputCls()}
              />
              <div className="mt-1 text-[10px] text-ts-text-3">
                {pathSearch
                  ? `${filteredPaths.length} of ${ttFlattened.length} paths match`
                  : `${ttFlattened.length} available — type to search`}
              </div>
            </div>

            <div className="space-y-2">
              {INTERNAL_FIELDS.map((field) => {
                const currentValue = mappings[field.key] || '';
                const isArrayField = field.key === 'stops' || field.key === 'geometry' || field.key === 'units';
                return (
                  <div key={field.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <div className="flex items-center gap-2 sm:w-48 shrink-0">
                      <span className={`text-xs font-semibold ${field.required ? 'text-ts-text-1' : 'text-ts-text-3'}`}>
                        {field.label}
                        {field.required ? <span className="ml-0.5 text-ts-danger">*</span> : null}
                      </span>
                      {isArrayField ? (
                        <span className="rounded-full border border-ts-accent/20 bg-ts-accent/5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-ts-accent">
                          array
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-1 items-center gap-2">
                      <select
                        value={currentValue}
                        onChange={(e) => updateMapping(field.key, e.target.value)}
                        className={`flex-1 ${inputCls()} text-xs`}
                      >
                        <option value="">— Not mapped —</option>
                        {currentValue && !filteredPaths.includes(currentValue) ? (
                          <option value={currentValue}>{displayPath(currentValue)}</option>
                        ) : null}
                        {filteredPaths.map((path) => (
                          <option key={path} value={path}>{displayPath(path)}</option>
                        ))}
                      </select>
                      {currentValue ? (
                        <button
                          onClick={() => updateMapping(field.key, '')}
                          className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300 transition hover:bg-red-500/20"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Errors */}
          {transformResult.errors.length > 0 ? (
            <SectionCard title="Validation" icon={<AlertCircle className="h-4 w-4" />}>
              <div className="space-y-2">
                {transformResult.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold">{err.field}:</span> {err.message}
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>

        {/* Sidebar: Live Preview */}
        <div className="space-y-4">
          <SectionCard title="Live Preview" icon={<Eye className="h-4 w-4" />}>
            {transformResult.data ? (
              <RoutePreview trip={transformResult.data} />
            ) : (
              <div className="rounded-2xl border border-dashed border-ts-border p-6 text-center text-sm text-ts-text-3">
                {transformResult.errors.length > 0
                  ? 'Fix validation errors to see preview'
                  : 'Map fields to see a live preview of your trip'}
              </div>
            )}

            {transformResult.data && step !== 'confirm' ? (
              <button
                onClick={() => setStep('confirm')}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ts-accent px-5 py-2.5 text-sm font-bold text-ts-text-inv transition hover:bg-ts-accent-h active:scale-[0.98]"
              >
                <CheckCircle2 className="h-4 w-4" />
                Continue to Confirm
              </button>
            ) : null}
          </SectionCard>
        </div>
      </div>

      {/* Confirm step */}
      {(() => {
        const trip = transformResult.data;
        if (step !== 'confirm' || !trip) return null;
        return (
        <div className="mt-6">
          <SectionCard title="Confirm & Save" icon={<CheckCircle2 className="h-4 w-4" />}>
            <div className="space-y-4">
              <div className="rounded-2xl border border-ts-border bg-ts-surface-2 p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ts-text-3">Transformed Output</h3>
                <pre className="max-h-[400px] overflow-auto rounded-xl bg-ts-bg p-3 text-[10px] leading-relaxed text-ts-text-2">
                  {JSON.stringify(trip, null, 2)}
                </pre>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSaveToTrips}
                  disabled={saving || transformResult.errors.length > 0}
                  className="inline-flex items-center gap-2 rounded-full bg-ts-accent px-6 py-2.5 text-sm font-bold text-ts-text-inv transition hover:bg-ts-accent-h active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving...' : 'Save Current Trip'}
                </button>
                {allTrips.length > 1 ? (
                  <button
                    onClick={async () => {
                      setSaving(true);
                      setSaveResult('');
                      let count = 0;
                      let failCount = 0;
                      for (const trip of allTrips) {
                        try {
                          const result = transformTTData(trip, mappings);
                          if (!result.data || result.errors.length > 0) { failCount++; continue; }
                          const d = result.data;
                          const cleanedUnits = (d.units || []).map((u: InternalUnit) => ({
                            unit_number: u.unit_number?.trim() || undefined,
                            unit_reg: u.unit_reg?.trim() || undefined,
                            unit_type: u.unit_type?.trim() || undefined,
                            livery: u.livery?.trim() || undefined,
                            livery_left: u.livery_left?.trim() || undefined,
                          })).filter((u) => Boolean(u.unit_number || u.unit_reg || u.unit_type || u.livery || u.livery_left));
                          const transportType = (['Rail', 'Bus', 'Tram', 'Ferry', 'Taxi', 'Other'] as const).includes(d.transport_type as any)
                            ? (d.transport_type as any) : 'Other';
                          await logTrip({
                            service_number: d.service_number || 'Unknown',
                            operator: d.operator || 'Unknown',
                            operator_slug: d.operator_slug || 'unknown',
                            service_date: d.service_date || Date.now(),
                            transport_type: transportType,
                            origin_name: d.origin_name || 'Unknown',
                            origin_stop_code: d.origin_stop_code || '',
                            destination_name: d.destination_name || 'Unknown',
                            destination_stop_code: d.destination_stop_code || '',
                            scheduled_departure: d.scheduled_departure || '',
                            actual_departure: d.actual_departure || undefined,
                            scheduled_arrival: d.scheduled_arrival || '',
                            actual_arrival: d.actual_arrival || undefined,
                            full_route: d.full_route ?? null,
                            ridden_route: d.full_route ?? null,
                            units: cleanedUnits,
                          });
                          count++;
                        } catch { failCount++; }
                      }
                      setSaving(false);
                      setSaveResult(`Imported ${count} trip${count !== 1 ? 's' : ''}${failCount > 0 ? ` (${failCount} failed)` : ''}`);
                      setTimeout(() => setSaveResult(''), 5000);
                    }}
                    disabled={saving || transformResult.errors.length > 0}
                    className="inline-flex items-center gap-2 rounded-full bg-ts-accent/15 px-6 py-2.5 text-sm font-bold text-ts-accent transition hover:bg-ts-accent/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FolderUp className="h-4 w-4" />
                    Import All ({allTrips.length})
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${trip.service_number || 'trip'}-transformed.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-5 py-2.5 text-sm font-semibold text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent active:scale-95"
                >
                  <Download className="h-4 w-4" />
                  Export JSON
                </button>
                <button
                  onClick={() => setStep('map')}
                  className="inline-flex items-center gap-2 rounded-full border border-ts-border px-5 py-2.5 text-sm font-semibold text-ts-text-2 transition hover:border-ts-accent/50 hover:text-ts-accent active:scale-95"
                >
                  Back to Mapping
                </button>
              </div>

              {saveResult ? (
                <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
                  saveResult.includes('success')
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-500/30 bg-red-500/10 text-red-300'
                }`}>
                  {saveResult.includes('success')
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {saveResult}
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>
        );
      })()}

      <div className="mt-6 text-center">
        <button
          onClick={() => { setAllTrips([]); setStep('upload'); }}
          className="text-xs text-ts-text-3 underline transition hover:text-ts-accent"
        >
          Upload a different file
        </button>
      </div>
    </div>
  );
}
