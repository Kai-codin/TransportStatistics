'use client';
import { useEffect, useRef, useState, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

const MIN_ZOOM = 14;
const POLL_INTERVAL_MS = 5000;
const DENSITY_THRESHOLD = 1000;

export const Map = forwardRef<any, {}>((props, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const boundsRef = useRef({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [bounds, setBounds] = useState({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [tooZoomedOut, setTooZoomedOut] = useState(false);
  
  // Filter States
  const [showBuses, setShowBuses] = useState(true);
  const [showTrains, setShowTrains] = useState(true);

  const stops = useQuery(api.functions.stops.getInBBox, tooZoomedOut ? 'skip' : bounds);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://bustimes.org/liveries.1777635301.css';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  const handleVehicleClick = async (item: any, type: 'train' | 'bus') => {
    const map = mapInstance.current;
    if (!item.id || item.id === 'undefined' || !map) return;
    try {
      const queryParam = type === 'train' ? `rid=${item.id}` : `trip_id=${item.id}`;
      const res = await fetch(`/api/route-info?${queryParam}`);
      if (!res.ok) throw new Error("Failed to fetch route info");
      const data = await res.json();
      const isSnapped = data.snapped !== false;

      map.setLayoutProperty('route-line-solid', 'visibility', isSnapped ? 'visible' : 'none');
      map.setLayoutProperty('route-line-dashed', 'visibility', isSnapped ? 'none' : 'visible');

      (map.getSource('route-source') as any).setData({ 
          type: 'Feature', 
          geometry: { type: 'LineString', coordinates: data.path || [] }, 
          properties: {} 
      });
    } catch (e) { console.error("Failed to load route data:", e); }
  };

  const createMarker = (item: any, type: 'train' | 'bus') => {
    const el = document.createElement('div');
    el.className = 'maplibregl-marker maplibregl-marker-anchor-center';
    const rotation = item.rotation || 0;
    const isFacingRight = rotation >= 0 && rotation <= 180;
    const liveryClass = `livery-${item.liveryID || 0} ${isFacingRight ? 'right' : ''}`;
    const color = item.colour || (type === 'train' ? '#1669b6' : '#ff0000');
    let background = (type === 'bus' && item.colour && !item.liveryID) || (type === 'train') ? color : '';

    el.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; transform: rotate(${rotation}deg); transform-origin: center;">
        <div class="arrow" data-vehicle-id="${item.id}"></div>
        <svg width="30" height="20" data-vehicle-id="${item.id}" style="background: ${background}" class="vehicle-marker ${liveryClass}">
          <text x="14" y="13">${item.service || 'N/A'}</text>
        </svg>
      </div>
    `;
    el.addEventListener('click', () => handleVehicleClick(item, type));
    const content = `
      <a href="${item.popup_data.link1}" target="_blank" class="v-popup-link">${item.popup_data.label1}</a>
      <div class="v-popup-subtitle">${item.popup_data.label2} ${item.popup_data.link2 ? `<br/><a href="${item.popup_data.link2}" target="_blank" style="color: #60a5fa; font-size: 0.8rem;">View Vehicle</a>` : ''}</div>
      <a href="${item.popup_data.log_link}" class="v-popup-btn">Log this ${type}</a>
    `;
    const popup = new maplibregl.Popup({ offset: 25, className: 'vehicle-popup' }).setHTML(content);
    return new maplibregl.Marker({ element: el }).setLngLat([item.location.lon, item.location.lat]).setPopup(popup);
  };

  useEffect(() => {
    if (!mapInstance.current) return;
    const fetchVehicles = async () => {
      try {
        const { minLat, maxLat, minLon, maxLon } = boundsRef.current;
        const res = await fetch(
          `/api/live-vehicles?xmin=${minLon}&ymin=${minLat}&xmax=${maxLon}&ymax=${maxLat}&showTrains=${showTrains}&showBuses=${showBuses}`
        );
        if (!res.ok) return;

        const data = await res.json();
        const map = mapInstance.current!;
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
        
        const filteredTrains = showTrains ? (data.trains || []) : [];
        const filteredBuses = showBuses ? (data.buses || []) : [];
        const allVehicles = [...filteredTrains, ...filteredBuses];

        map.setLayoutProperty('vehicles-layer', 'visibility', 'none');

        if (allVehicles.length > DENSITY_THRESHOLD) {
          const features = allVehicles.map((v: any) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.location.lon, v.location.lat] },
            properties: { color: v.colour || '#ff0000' }
          }));
          (map.getSource('vehicles-source') as any).setData({ type: 'FeatureCollection', features: features });
          map.setLayoutProperty('vehicles-layer', 'visibility', 'visible');
        } else {
          filteredTrains.forEach((t: any) => { markersRef.current.push(createMarker(t, 'train').addTo(map)); });
          filteredBuses.forEach((b: any) => { markersRef.current.push(createMarker(b, 'bus').addTo(map)); });
        }
      } catch (e) { console.error("Failed to update vehicles", e); }
    };

    const interval = setInterval(fetchVehicles, POLL_INTERVAL_MS);
    fetchVehicles();
    return () => clearInterval(interval);
  }, [bounds, showBuses, showTrains]);

  useEffect(() => {
    if (!mapContainer.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "/api/proxy/map-style",
      center: [-1.5, 52.5],
      zoom: 10,
    });

    // Add built-in controls
    map.addControl(new maplibregl.NavigationControl({}));
    map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true
    }));

    mapInstance.current = map;
    map.on('load', () => {
      map.addSource('vehicles-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'vehicles-layer', type: 'circle', source: 'vehicles-source', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-width': 0 }, layout: { 'visibility': 'none' } });
      map.addSource('route-source', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
      map.addLayer({ id: 'route-line-solid', type: 'line', source: 'route-source', paint: { 'line-color': '#22c55e', 'line-width': 4 }, layout: { 'visibility': 'visible' } });
      map.addLayer({ id: 'route-line-dashed', type: 'line', source: 'route-source', paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-dasharray': [2, 2] }, layout: { 'visibility': 'none' } });
      
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
      
      {/* Minimal Filter Overlay */}
      <div className="absolute top-4 left-12 bg-white p-2 rounded shadow-md flex flex-col gap-1 text-sm z-10">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showBuses} onChange={(e) => setShowBuses(e.target.checked)} />
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