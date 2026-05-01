'use client';
import { useEffect, useRef, useState, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

const MIN_ZOOM = 14;
const POLL_INTERVAL_MS = 10000;
const DENSITY_THRESHOLD = 1000;

export const Map = forwardRef<any, {}>((props, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const boundsRef = useRef({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [bounds, setBounds] = useState({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [tooZoomedOut, setTooZoomedOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stops = useQuery(api.functions.stops.getInBBox, tooZoomedOut ? 'skip' : bounds);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://bustimes.org/liveries.1777635301.css';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // Helper: Create custom marker
  const createMarker = (item: any, type: 'train' | 'bus') => {
    const el = document.createElement('div');
    let background = '';
    el.className = 'maplibregl-marker maplibregl-marker-anchor-center';
    el.style.transform = `rotate(${item.rotation || 0}deg)`;
    const liveryClass = `livery-${item.liveryID || 0}`;
    const color = item.colour || (type === 'train' ? '#1669b6' : '#ff0000');
    //if (type === 'train') el.style.background = color;

    if (type === 'bus' && item.colour && !item.liveryID) {
      background = color;
    } else if (type === 'train') {
      background = color;
    }

    el.innerHTML = `
      <svg width="30" height="20" data-vehicle-id="${item.id}" style="background: ${background}" class="vehicle-marker ${liveryClass}">
        <text x="14" y="13">${item.service || 'N/A'}</text>
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

  useEffect(() => {
    if (!mapInstance.current) return;

    const fetchVehicles = async () => {
      try {
        const { minLat, maxLat, minLon, maxLon } = boundsRef.current;
        const res = await fetch(`/api/live-vehicles?xmin=${minLon}&ymin=${minLat}&xmax=${maxLon}&ymax=${maxLat}`);
        if (!res.ok) return;

        const data = await res.json();
        const allVehicles = [...(data.trains || []), ...(data.buses || [])];
        const map = mapInstance.current!;

        // 1. Clear existing markers and hide high-density layer by default
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
        map.setLayoutProperty('vehicles-layer', 'visibility', 'none');

        // 2. Decide Strategy
        if (allVehicles.length > DENSITY_THRESHOLD) {
          // SIMPLE MODE: Use GeoJSON source for performance
          const features = allVehicles.map((v: any) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.location.lon, v.location.lat] },
            properties: { color: v.colour || '#ff0000' }
          }));

          (map.getSource('vehicles-source') as any).setData({
            type: 'FeatureCollection',
            features: features
          });
          map.setLayoutProperty('vehicles-layer', 'visibility', 'visible');

        } else {
          // RICH MODE: Use DOM Markers
          data.trains?.forEach((t: any) => { markersRef.current.push(createMarker(t, 'train').addTo(map)); });
          data.buses?.forEach((b: any) => { markersRef.current.push(createMarker(b, 'bus').addTo(map)); });
        }
      } catch (e) { console.error("Failed to update vehicles", e); }
    };

    const interval = setInterval(fetchVehicles, POLL_INTERVAL_MS);
    fetchVehicles();
    return () => clearInterval(interval);
  }, [bounds]);

  useEffect(() => {
    if (!mapContainer.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "/api/proxy/map-style",
      center: [-1.5, 52.5],
      zoom: 10,
    });
    mapInstance.current = map;

    map.on('load', () => {
      // Setup High-Density Source/Layer
      map.addSource('vehicles-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'vehicles-layer',
        type: 'circle',
        source: 'vehicles-source',
        paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-width': 0 },
        layout: { 'visibility': 'none' } // Hidden by default
      });

      // Existing stops layer
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