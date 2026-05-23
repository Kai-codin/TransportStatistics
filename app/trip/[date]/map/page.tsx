'use client';

import { useEffect, useRef, use } from 'react';
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMapStyleUrl } from '@/components/mapStyleUrl';
import { useTheme } from '@/components/ThemeProvider';

// ─────────────────────────────────────────────────────────────────────────────
// OLD DJANGO COLOUR HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function hashString(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getRouteColor(trip: any, idx: number) {
  // Use livery if set, otherwise use the old hashing logic
  if (trip.livery_css) return trip.livery_css;
  
  const seed = String(trip._id || idx);
  let hue = hashString(seed) % 360;
  hue = (hue + idx * 97) % 360;
  return hslToHex(hue, 62, 48);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function TripDateMapPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const { user } = useUser();
  const { theme } = useTheme();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);

  const trips = useQuery(api.functions.trips.getMyTripsByDate, 
    user?.id ? { user: user.id, date: date, timeZone } : "skip"
  );

  useEffect(() => {
    if (!mapContainer.current || !trips || trips.length === 0) return;

    // Use the Fluffynet style or your local proxy
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: getMapStyleUrl(theme),
      center: [-1.5, 52.5],
      zoom: 6,
    });

    map.on('load', () => {
      mapInstance.current = map;
      const features: any[] = [];
      const bounds = new maplibregl.LngLatBounds();

      trips.forEach((trip, i) => {
        const coords = trip.ridden_route?.geometry?.coordinates;
        if (!coords || coords.length < 2) return;

        const colour = getRouteColor(trip, i);

        // 1. Line Feature
        features.push({
          type: 'Feature',
          geometry: trip.ridden_route.geometry,
          properties: { type: 'route', colour }
        });

        // 2. Origin Point (Solid circle)
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords[0] },
          properties: { type: 'origin', colour }
        });

        // 3. Destination Point (White center, colored ring)
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords[coords.length - 1] },
          properties: { type: 'dest', colour }
        });

        coords.forEach((c: [number, number]) => bounds.extend(c));
      });

      map.addSource('trips', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
      });

      // Layer: Routes (with the old interpolation logic)
      map.addLayer({
        id: 'routes',
        type: 'line',
        source: 'trips',
        filter: ['==', ['get', 'type'], 'route'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'colour'],
          'line-width': 4,
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            5, 0.3,
            10, 0.9
          ]
        }
      });

      // Layer: Origins (Solid color with white stroke)
      map.addLayer({
        id: 'origins',
        type: 'circle',
        source: 'trips',
        filter: ['==', ['get', 'type'], 'origin'],
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'colour'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // Layer: Destinations (White color with colored stroke)
      map.addLayer({
        id: 'destinations',
        type: 'circle',
        source: 'trips',
        filter: ['==', ['get', 'type'], 'dest'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'colour']
        }
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 48, duration: 500 });
      }
    });

    return () => map.remove();
  }, [theme, trips]);

  if (!user) return <div className="p-8 text-ts-text-1 bg-[#0d1410] h-screen">Please sign in...</div>;
  if (trips === undefined) return <div className="p-8 text-ts-text-1 bg-[#0d1410] h-screen">Loading...</div>;

  return (
    <div className="ts-app" style={{ display: 'flex', height: '100vh', background: '#0d1410' }}>
      <main className="ts-main" style={{ flex: 1, position: 'relative' }}>
        <div className="ts-detail-layout" style={{ height: '100%' }}>
          {/* Header overlay to match Django header */}
          <div className="absolute top-4 left-4 z-10 bg-[#141e17]/90 backdrop-blur-md border border-[#2a3d2f] p-4 rounded-lg">
            <h1 className="text-[#e8f0e4] font-bold text-lg">Trips on {date}</h1>
          </div>
          <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
        </div>
      </main>
      
      <style jsx global>{`
        .maplibregl-ctrl-attrib { display: none; }
        .maplibregl-ctrl-group { border: 1px solid #2a3d2f !important; background: #141e17 !important; }
        .maplibregl-ctrl button span { filter: invert(1); }
      `}</style>
    </div>
  );
}