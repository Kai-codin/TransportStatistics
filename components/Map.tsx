'use client';
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

const MIN_ZOOM = 14;
const POLL_INTERVAL_MS = 10000;

export const Map = forwardRef<any, {}>((props, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const boundsRef = useRef({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [bounds, setBounds] = useState({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [tooZoomedOut, setTooZoomedOut] = useState(false);

  const stops = useQuery(api.functions.stops.getInBBox, tooZoomedOut ? 'skip' : bounds);

  // 1. Inject the external CSS
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://bustimes.org/liveries.1777635301.css';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // 2. Helper: Create the custom vehicle marker
  const createMarker = (item: any, type: 'train' | 'bus') => {
    const el = document.createElement('div');
    el.className = 'maplibregl-marker maplibregl-marker-anchor-center';
    el.setAttribute('aria-label', 'Map marker');
    el.setAttribute('role', 'button');
    
    // Apply rotation based on heading data
    el.style.transform = `rotate(${item.rotation || 0}deg)`;

    const liveryClass = `livery-${item.liveryID || 0}`;

    const color = item.colour || (type === 'train' ? '#1669b6' : '#ff0000');
    if (type === 'train') {
      el.style.background = color;
    }
    
    // Injecting your specific template
    el.innerHTML = `
      <svg width="24" height="16" data-vehicle-id="${item.id}" class="vehicle-marker ${liveryClass}">
        <text x="12" y="12">${item.service || 'N/A'}</text>
      </svg>
      <div class="arrow" data-vehicle-id="${item.id}"></div>
    `;

    const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
      <div class="text-xs p-1">
        <strong>${type === 'train' ? 'Train' : 'Bus'}: ${item.service}</strong><br/>
        Destination: ${item.destination || 'Unknown'}<br/>
        ${item.delay !== undefined ? `Delay: ${item.delay}m` : ''}
      </div>
    `);

    return new maplibregl.Marker({ element: el })
      .setLngLat([item.location.lon, item.location.lat])
      .setPopup(popup);
  };

  // 3. Polling Effect
  useEffect(() => {
    if (!mapInstance.current) return;

    const fetchVehicles = async () => {
      try {
        const { minLat, maxLat, minLon, maxLon } = boundsRef.current;
        const res = await fetch(`/api/live-vehicles?xmin=${minLon}&ymin=${minLat}&xmax=${maxLon}&ymax=${maxLat}`);
        if (!res.ok) return;
        const data = await res.json();
        
        // Clean up existing markers before adding new ones
        markersRef.current.forEach(m => m.remove());
        const newMarkers: maplibregl.Marker[] = [];
        
        data.trains.forEach((t: any) => {
            const m = createMarker(t, 'train');
            m.addTo(mapInstance.current!);
            newMarkers.push(m);
        });

        data.buses.forEach((b: any) => {
            const m = createMarker(b, 'bus');
            m.addTo(mapInstance.current!);
            newMarkers.push(m);
        });

        markersRef.current = newMarkers;
      } catch (e) {
        console.error("Failed to update vehicles", e);
      }
    };

    const interval = setInterval(fetchVehicles, POLL_INTERVAL_MS);
    fetchVehicles();
    return () => clearInterval(interval);
  }, [bounds]);

  // 4. Initial Map Setup
  useEffect(() => {
    if (!mapContainer.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://api.maptiler.com/maps/openstreetmap/style.json?key=ghAzCSy39lRpGskkQ68J",
      center: [-1.5, 52.5],
      zoom: 10,
    });
    mapInstance.current = map;

    map.on('load', () => {
      map.addSource('stops-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'stops-layer', type: 'circle', source: 'stops-source', paint: { 'circle-radius': 5, 'circle-color': '#1669b6' } });
      
      const updateBounds = () => {
        const b = map.getBounds();
        setTooZoomedOut(map.getZoom() < MIN_ZOOM);
        boundsRef.current = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() };
        setBounds(boundsRef.current);
      };
      
      map.on('moveend', updateBounds);
      updateBounds();
    });

    return () => map.remove();
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-lg border border-ts-border">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
});