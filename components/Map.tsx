'use client';
import { useEffect, useRef, useState, forwardRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

const MIN_ZOOM = 14;
const POLL_INTERVAL_MS = 5000;
const DENSITY_THRESHOLD = 1000;

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:         '#0d1410',
  surface:    '#141e17',
  surface2:   '#1c2920',
  surface3:   '#243328',
  border:     '#2a3d2f',
  borderSoft: '#1e2d22',
  text1:      '#e8f0e4',
  text2:      '#9ab89a',
  text3:      '#5a7a5e',
  accent:     '#34d064',
  accentL:    'rgba(52,208,100,0.10)',
  accentB:    'rgba(52,208,100,0.20)',
  danger:     '#f87171',
  warn:       '#f59e0b',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function offsetISO(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

// ─── Panel CSS (injected once) ────────────────────────────────────────────────
const PANEL_CSS = `
  #ts-stop-panel-root {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 360px;
    max-height: calc(100dvh - 48px);
    overflow-y: auto;
    z-index: 9999;
    border-radius: 12px;
    border: 1px solid ${C.border};
    box-shadow: 0 8px 40px rgba(0,0,0,0.85);
    display: none;
    scrollbar-width: thin;
    scrollbar-color: ${C.border} transparent;
  }
  #ts-stop-panel-root.open { display: block; }

  @media (max-width: 600px) {
    #ts-stop-panel-root {
      bottom: 0;
      right: 0;
      left: 0;
      width: 100%;
      max-height: 72dvh;
      border-radius: 16px 16px 0 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
    }
  }

  .ts-stop-panel {
    width: 100%;
    box-sizing: border-box;
    background: ${C.bg};
    color: ${C.text1};
    padding: 16px;
    border-radius: inherit;
    font-family: system-ui, -apple-system, sans-serif;
    position: relative;
  }

  #ts-stop-panel-close {
    position: absolute;
    top: 14px;
    right: 14px;
    background: transparent;
    border: none;
    color: ${C.text3};
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    z-index: 1;
  }
  #ts-stop-panel-close:hover { color: ${C.text1}; }

  /* mobile drag handle hint */
  @media (max-width: 600px) {
    .ts-stop-panel::before {
      content: '';
      display: block;
      width: 40px;
      height: 4px;
      background: ${C.border};
      border-radius: 2px;
      margin: 0 auto 14px;
    }
  }
`;

// ─── HTML builders ────────────────────────────────────────────────────────────

function buildShell(stopName: string, typeName: string, codes: string[], bodyHTML: string): string {
  const typeLabel = typeName
    ? `<div style="font-size:10px;color:${C.accent};font-weight:600;letter-spacing:.09em;text-transform:uppercase;margin-bottom:10px;">${typeName}</div>`
    : '';

  const codeBadges = codes.length
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
        ${codes.map(c => `<span style="
          background:${C.surface2};color:${C.text2};font-size:10px;
          padding:3px 10px;border-radius:5px;border:1px solid ${C.border};
          font-family:monospace;letter-spacing:.04em;">${c}</span>`).join('')}
       </div>`
    : '';

  return `
    <div class="ts-stop-panel">
      <div style="font-size:18px;font-weight:700;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:24px;">${stopName}</div>
      ${typeLabel}
      ${codeBadges}
      ${bodyHTML}
    </div>`;
}

function buildLoadingPopup(stopName: string, typeName: string, codes: string[]): string {
  return buildShell(stopName, typeName, codes,
    `<div style="padding:28px 0;text-align:center;color:${C.text3};font-size:13px;">Loading departures…</div>`
  );
}

function buildErrorPopup(stopName: string, typeName: string, codes: string[], msg: string): string {
  return buildShell(stopName, typeName, codes,
    `<div style="padding:28px 0;text-align:center;color:${C.danger};font-size:13px;">${msg}</div>`
  );
}

function buildDeparturesPopup(
  stopName: string,
  typeName: string,
  codes: string[],
  departures: any[],
  offsetMin: number,
  popupId: string,
): string {
  // Updated: Removed fixed width, added flex: 1
  const offsetBtns = [-60, -30, -15, 0, 15, 30, 60].map((o) => {
    const active = o === offsetMin;
    const label  = o === 0 ? 'NOW' : o > 0 ? `+${o}m` : `${o}m`;
    return `<button data-offset="${o}" data-popup="${popupId}" style="
      flex: 1;
      padding: 5px 0;
      border-radius: 6px;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      border: 1px solid ${active ? C.accent : C.border};
      background: ${active ? C.accent : C.surface2};
      color: ${active ? C.bg : C.text2};
      font-weight: ${active ? '700' : '400'};
    ">${label}</button>`;
  }).join('');

  let rows = '';
  if (!departures || departures.length === 0) {
    rows = `<div style="padding:20px 0;text-align:center;color:${C.text3};font-size:13px;">No departures found.</div>`;
  } else {
    rows = departures.map((d) => {
      const sched     = fmt(d.scheduled_departure);
      const exp       = d.expected_departure ? fmt(d.expected_departure) : null;
      const late      = typeof d.delay === 'number' && d.delay > 0;
      const cancelled = !!d.is_cancelled;

      let timeHTML: string;
      if (cancelled) {
        timeHTML = `<span style="color:${C.danger};font-size:11px;text-decoration:line-through;">${sched}</span>`;
      } else if (exp && exp !== sched) {
        timeHTML = `<span style="color:${C.text3};font-size:10px;text-decoration:line-through;">${sched}</span><br/><span style="color:${C.warn};font-size:12px;font-weight:600;">${exp}</span>`;
      } else {
        timeHTML = `<span style="color:${C.text1};font-size:12px;">${sched}</span>`;
      }

      const delayTag = late && !cancelled
        ? `<span style="display:block;color:${C.warn};font-size:9px;margin-top:1px;">+${d.delay}m</span>`
        : cancelled
          ? `<span style="display:block;color:${C.danger};font-size:9px;margin-top:1px;">Cancelled</span>`
          : '';

      const platform = d.platform
        ? `<span style="background:${C.surface3};color:${C.text1};font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid ${C.border};font-family:monospace;">${d.platform}</span>`
        : `<span style="color:${C.text3};font-size:12px;">–</span>`;

      const dest    = d.destination || 'Unknown';
      const subLine = d.origin
        ? `<div style="color:${C.text3};font-size:10px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">from ${d.origin}</div>`
        : '';

      return `
        <div style="display:grid;grid-template-columns:46px 1fr auto 32px 38px;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid ${C.borderSoft};">
          <span style="background:${C.accentL};color:${C.accent};font-weight:700;font-size:11px;padding:3px 4px;border-radius:4px;text-align:center;border:1px solid ${C.accentB};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.service || '?'}</span>
          <div style="min-width:0;">
            <div style="font-size:12px;color:${C.text1};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${dest}">${dest}</div>
            ${subLine}
          </div>
          <div style="text-align:right;white-space:nowrap;min-width:42px;">${timeHTML}${delayTag}</div>
          <div style="text-align:center;">${platform}</div>
          <button style="background:${C.surface3};color:${C.text2};border:1px solid ${C.border};border-radius:5px;font-size:10px;padding:4px 6px;cursor:pointer;font-family:inherit;">Log</button>
        </div>`;
    }).join('');
  }

  // Updated: Changed container to flex-wrap: nowrap to force one row
  const body = `
    <div style="margin-bottom:14px;">
      <div style="font-size:9px;color:${C.text3};text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Time offset</div>
      <div style="display:flex;gap:4px;flex-wrap:nowrap;width:100%;">${offsetBtns}</div>
    </div>
    <div style="display:grid;grid-template-columns:46px 1fr auto 32px 38px;gap:8px;padding-bottom:6px;border-bottom:1px solid ${C.border};margin-bottom:2px;">
      <span style="font-size:9px;color:${C.text3};letter-spacing:.06em;text-transform:uppercase;">Service</span>
      <span style="font-size:9px;color:${C.text3};letter-spacing:.06em;text-transform:uppercase;">To</span>
      <span style="font-size:9px;color:${C.text3};letter-spacing:.06em;text-transform:uppercase;text-align:right;">Sched</span>
      <span style="font-size:9px;color:${C.text3};letter-spacing:.06em;text-transform:uppercase;text-align:center;">Plat</span>
      <span></span>
    </div>
    <div style="max-height:320px;overflow-y:auto;margin-right:-4px;padding-right:4px;">${rows}</div>
    <button style="width:100%;margin-top:14px;background:${C.accent};color:${C.bg};font-weight:700;font-size:13px;padding:11px;border-radius:8px;border:none;cursor:pointer;font-family:inherit;">
      Log custom trip
    </button>`;

  return buildShell(stopName, typeName, codes, body);
}

// ─── PopupState ───────────────────────────────────────────────────────────────
interface PopupState {
  stop:     any;
  typeName: string;
  codes:    string[];
  mode:     'train' | 'bus';
  id:       string;
}

let _counter = 0;

// ─── Component ────────────────────────────────────────────────────────────────
export const Map = forwardRef<any, {}>((props, ref) => {
  const mapContainer   = useRef<HTMLDivElement>(null);
  const mapInstance    = useRef<maplibregl.Map | null>(null);
  const markersRef     = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const activeState    = useRef<PopupState | null>(null);
  const boundsRef      = useRef({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });

  const [bounds, setBounds]             = useState({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [tooZoomedOut, setTooZoomedOut] = useState(false);

  const [showBuses, setShowBuses] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('showBuses') !== 'false' : true
  );
  const [showTrains, setShowTrains] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('showTrains') !== 'false' : true
  );

  useEffect(() => {
    localStorage.setItem('showBuses', String(showBuses));
    localStorage.setItem('showTrains', String(showTrains));
  }, [showBuses, showTrains]);

  const stops     = useQuery(api.functions.stops.getInBBox, tooZoomedOut ? 'skip' : bounds);
  const stopTypes = useQuery(api.functions.stops.list);

  const typeColorMap = useMemo(() => {
    if (!stopTypes) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    stopTypes.forEach((type) => {
      const name = type.name.toLowerCase();
      if (name.includes('rail') || name.includes('train')) map[type._id] = '#1669b6';
      else if (name.includes('bus') || name.includes('coach'))  map[type._id] = '#ef4444';
      else if (name.includes('metro'))  map[type._id] = '#8b5cf6';
      else if (name.includes('ferry'))  map[type._id] = '#0ea5e9';
      else map[type._id] = '#3b82f6';
    });
    return map;
  }, [stopTypes]);

  // ── Fixed panel helpers ────────────────────────────────────────────────────
  function getPanelRoot(): HTMLElement {
    let el = document.getElementById('ts-stop-panel-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ts-stop-panel-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function closePanel() {
    const root = document.getElementById('ts-stop-panel-root');
    if (root) { root.classList.remove('open'); root.innerHTML = ''; }
    activeState.current = null;
  }

  function setPanelHTML(html: string) {
    const root = getPanelRoot();
    root.innerHTML = html;
    root.classList.add('open');

    // Wire close button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'ts-stop-panel-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', closePanel);
    root.querySelector('.ts-stop-panel')?.appendChild(closeBtn);
  }

  // ── Fetch & render ─────────────────────────────────────────────────────────
  async function fetchAndRender(state: PopupState, offsetMin: number) {
    const { stop, typeName, codes, mode, id } = state;

    setPanelHTML(buildLoadingPopup(stop.commonName, typeName, codes));

    try {
      const baseDate  = new Date();
      const targetISO = offsetMin !== 0 ? offsetISO(baseDate, offsetMin) : undefined;
      console.log(stop);
      const code = mode === 'train' ? stop.crsCode || stop.tiploc : stop.atcoCode;

      const url = targetISO
        ? `/api/departures?code=${code}&type=${mode}&datetime=${encodeURIComponent(targetISO)}`
        : `/api/departures?code=${code}&type=${mode}`;

      const res = await fetch(url);

      // Guard: another stop was clicked while this fetch was in flight
      if (activeState.current?.id !== id) return;

      if (res.status === 480) {
        setPanelHTML(buildErrorPopup(stop.commonName, typeName, codes, 'No times found for this stop.'));
        return;
      }
      if (res.status === 481) {
        setPanelHTML(buildErrorPopup(stop.commonName, typeName, codes, 'Date is outside permitted history.'));
        return;
      }
      if (!res.ok) {
        setPanelHTML(buildErrorPopup(stop.commonName, typeName, codes, `Error loading departures (${res.status}).`));
        return;
      }

      const data = await res.json();
      if (activeState.current?.id !== id) return;

      setPanelHTML(buildDeparturesPopup(stop.commonName, typeName, codes, data, offsetMin, id));
      attachOffsetListeners(state, offsetMin);

    } catch (err) {
      console.error('Departures fetch failed:', err);
      if (activeState.current?.id === id) {
        setPanelHTML(buildErrorPopup(stop.commonName, typeName, codes, 'Failed to load departures.'));
      }
    }
  }

  function attachOffsetListeners(state: PopupState, currentOffset: number) {
    const root = document.getElementById('ts-stop-panel-root');
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>('button[data-offset]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const offset = parseInt(btn.getAttribute('data-offset') || '0', 10);
        if (offset === currentOffset) return;
        fetchAndRender(state, offset);
      });
    });
  }

  // ── Inject panel CSS once ──────────────────────────────────────────────────
  useEffect(() => {
    const styleId = 'ts-stop-panel-css';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    return () => {
      document.getElementById(styleId)?.remove();
      closePanel();
      document.getElementById('ts-stop-panel-root')?.remove();
    };
  }, []);

  // ── Livery CSS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://bustimes.org/liveries.1777635301.css';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // ── Render stop markers ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !stops || !stopTypes) return;

    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];

    stops.forEach((stop: any) => {
      const color    = typeColorMap[stop.stopTypeId] || '#3b82f6';
      const typeObj  = stopTypes.find((t) => t._id === stop.stopTypeId);
      const typeName = typeObj?.name || '';
      const typeLC   = typeName.toLowerCase();
      const mode: 'train' | 'bus' =
        typeLC.includes('rail') || typeLC.includes('train') ? 'train' : 'bus';

      const codes: string[] = [];
      if (stop.crsCode)                              codes.push(`CRS ${stop.crsCode}`);
      if (stop.tiploc)                               codes.push(`TPL ${stop.tiploc}`);
      if (!stop.crsCode && !stop.tiploc && stop.atcoCode) codes.push(stop.atcoCode);

      const el = document.createElement('div');
      el.style.cssText = `
        width:15px;height:15px;border-radius:50%;
        background-color:${color};border:2px solid white;
        cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.5);
      `;

      el.addEventListener('click', async (e) => {
        e.stopPropagation();

        const stateId = String(++_counter);
        const state: PopupState = { stop, typeName, codes, mode, id: stateId };
        activeState.current = state;

        await fetchAndRender(state, 0);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lon, stop.lat])
        .addTo(mapInstance.current!);

      stopMarkersRef.current.push(marker);
    });
  }, [stops, stopTypes, typeColorMap]);

  // ── Vehicle helpers ────────────────────────────────────────────────────────
  const handleVehicleClick = async (item: any, type: 'train' | 'bus') => {
    const map = mapInstance.current;
    if (!item.id || item.id === 'undefined' || !map) return;
    try {
      const queryParam = type === 'train' ? `rid=${item.id}` : `trip_id=${item.id}`;
      const res = await fetch(`/api/route-info?${queryParam}`);
      if (!res.ok) throw new Error('Failed to fetch route info');
      const data = await res.json();
      const isSnapped = data.snapped !== false;
      map.setLayoutProperty('route-line-solid', 'visibility', isSnapped ? 'visible' : 'none');
      map.setLayoutProperty('route-line-dashed', 'visibility', isSnapped ? 'none' : 'visible');
      (map.getSource('route-source') as any).setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: data.path || [] },
        properties: {},
      });
    } catch (e) { console.error('Failed to load route data:', e); }
  };

  const createMarker = (item: any, type: 'train' | 'bus') => {
    const el = document.createElement('div');
    el.className = 'maplibregl-marker maplibregl-marker-anchor-center';
    const rotation = item.rotation || 0;
    const isFacingRight = rotation >= 0 && rotation <= 180;
    const liveryClass = `livery-${item.liveryID || 0} ${isFacingRight ? 'right' : ''}`;
    const color = item.colour || (type === 'train' ? '#1669b6' : '#ff0000');
    const background =
      (type === 'bus' && item.colour && !item.liveryID) || type === 'train' ? color : '';

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;transform:rotate(${rotation}deg);transform-origin:center;">
        <div class="arrow" data-vehicle-id="${item.id}"></div>
        <svg width="30" height="20" data-vehicle-id="${item.id}" style="background:${background}" class="vehicle-marker ${liveryClass}">
          <text x="14" y="13">${item.service || 'N/A'}</text>
        </svg>
      </div>`;

    el.addEventListener('click', () => handleVehicleClick(item, type));

    const content = `
      <a href="${item.popup_data.link1}" target="_blank" class="v-popup-link">${item.popup_data.label1}</a>
      <div class="v-popup-subtitle">${item.popup_data.label2}${item.popup_data.link2
        ? `<br/><a href="${item.popup_data.link2}" target="_blank" style="color:#60a5fa;font-size:.8rem;">View Vehicle</a>`
        : ''}</div>
      <a href="${item.popup_data.log_link}" class="v-popup-btn">Log this ${type}</a>`;

    const popup = new maplibregl.Popup({ offset: 25, className: 'vehicle-popup' }).setHTML(content);
    return new maplibregl.Marker({ element: el })
      .setLngLat([item.location.lon, item.location.lat])
      .setPopup(popup);
  };

  // ── Vehicle polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return;

    const fetchVehicles = async () => {
      try {
        const { minLat, maxLat, minLon, maxLon } = boundsRef.current;
        const res = await fetch(
          `/api/live-vehicles?xmin=${minLon}&ymin=${minLat}&xmax=${maxLon}&ymax=${maxLat}&showTrains=${showTrains}&showBuses=${showBuses}&debug=true`
        );
        if (!res.ok) return;

        const data  = await res.json();
        const map   = mapInstance.current!;
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        const filteredTrains = showTrains ? data.trains || [] : [];
        const filteredBuses  = showBuses  ? data.buses  || [] : [];
        const allVehicles    = [...filteredTrains, ...filteredBuses];

        map.setLayoutProperty('vehicles-layer', 'visibility', 'none');

        if (allVehicles.length > DENSITY_THRESHOLD) {
          const features = allVehicles.map((v: any) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.location.lon, v.location.lat] },
            properties: { color: v.colour || '#ff0000' },
          }));
          (map.getSource('vehicles-source') as any).setData({ type: 'FeatureCollection', features });
          map.setLayoutProperty('vehicles-layer', 'visibility', 'visible');
        } else {
          filteredTrains.forEach((t: any) => markersRef.current.push(createMarker(t, 'train').addTo(map)));
          filteredBuses.forEach((b: any)  => markersRef.current.push(createMarker(b, 'bus').addTo(map)));
        }
      } catch (e) { console.error('Failed to update vehicles', e); }
    };

    const interval = setInterval(fetchVehicles, POLL_INTERVAL_MS);
    fetchVehicles();
    return () => clearInterval(interval);
  }, [bounds, showBuses, showTrains]);

  // ── Map init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: '/api/proxy/map-style',
      center: [-1.5, 52.5],
      zoom: 10,
    });

    map.addControl(new maplibregl.NavigationControl({}));
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    }));

    mapInstance.current = map;

    map.on('load', () => {
      map.addSource('vehicles-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'vehicles-layer', type: 'circle', source: 'vehicles-source',
        paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-width': 0 },
        layout: { visibility: 'none' },
      });
      map.addSource('route-source', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: 'route-line-solid', type: 'line', source: 'route-source',
        paint: { 'line-color': '#22c55e', 'line-width': 4 },
        layout: { visibility: 'visible' },
      });
      map.addLayer({
        id: 'route-line-dashed', type: 'line', source: 'route-source',
        paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-dasharray': [2, 2] },
        layout: { visibility: 'none' },
      });

      const updateBounds = () => {
        const b = map.getBounds();
        setTooZoomedOut(map.getZoom() < MIN_ZOOM);
        boundsRef.current = {
          minLat: b.getSouth(), maxLat: b.getNorth(),
          minLon: b.getWest(),  maxLon: b.getEast(),
        };
        setBounds({ ...boundsRef.current });
      };
      map.on('moveend', updateBounds);
      updateBounds();
    });

    return () => map.remove();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full overflow-hidden rounded-lg border border-ts-border">
      <div ref={mapContainer} className="w-full h-full" />

      <div
        className="absolute top-4 left-12 p-2 rounded shadow-md flex flex-col gap-1 text-sm z-10"
        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text2 }}
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showBuses}  onChange={(e) => setShowBuses(e.target.checked)} />
          Live Buses
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showTrains} onChange={(e) => setShowTrains(e.target.checked)} />
          Live Trains
        </label>
      </div>
    </div>
  );
});