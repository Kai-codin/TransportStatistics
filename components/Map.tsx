'use client';
import { useEffect, useRef, useState, createContext, useContext, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Stops } from './Stops';
import { LiveVehicles } from './LiveVehicles';
import { getMapStyleUrl } from './mapStyleUrl';
import { useTheme } from '@/components/ThemeProvider';

const MapContext = createContext<maplibregl.Map | null>(null);
export const useMap = () => useContext(MapContext);

export const C = {
  bg: '#0d1410', surface: '#141e17', surface2: '#1c2920', border: '#2a3d2f',
  text1: '#e8f0e4', text2: '#9ab89a', text3: '#5a7a5e', accent: '#34d064',
};

// Ensure your PANEL_CSS contains necessary styles
const PANEL_CSS = `/* ... Keep your existing PANEL_CSS string here ... */`;

type MapHandle = {
  getMap: () => maplibregl.Map | null;
};

export const Map = forwardRef<MapHandle, {}>((_props, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [bounds, setBounds] = useState({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [tooZoomedOut, setTooZoomedOut] = useState(false);
  const { theme } = useTheme();

  const [showBuses, setShowBuses] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('showBuses') !== 'false' : true);
  const [showTrains, setShowTrains] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('showTrains') !== 'false' : true);

  // Inject styles
  useEffect(() => {
    const styleId = 'ts-panel-css';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Init Map
  useEffect(() => {
    if (!mapContainer.current) return;

    // 1. Get saved location or default
    const savedState = localStorage.getItem('userMapState');
    const { center, zoom } = savedState ? JSON.parse(savedState) : { center: [-1.5, 52.5], zoom: 12 };

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: getMapStyleUrl(theme),
      center: center,
      zoom: zoom,
    });

    // Handle WebGL context loss gracefully to avoid noisy console errors
    map.on('webglcontextlost', (e: any) => {
      console.warn('WebGL context lost', e);
    });
    map.on('webglcontextrestored', () => {
      console.info('WebGL context restored');
    });

    map.on('load', () => {
      mapInstance.current = map;
      setMapLoaded(true);

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false, showZoom: true })
      );
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
        }),
        'top-right'
      );

      // Layers setup
      map.addSource('vehicles-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'vehicles-layer', type: 'circle', source: 'vehicles-source', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'] }, layout: { visibility: 'none' } });
      map.addSource('route-source', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
      map.addLayer({ id: 'route-line-solid', type: 'line', source: 'route-source', paint: { 'line-color': '#22c55e', 'line-width': 4 } });
      map.addLayer({ id: 'route-line-dashed', type: 'line', source: 'route-source', paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-dasharray': [2, 2] }, layout: { visibility: 'none' } });

      const updateBounds = () => {
        const b = map.getBounds();
        setTooZoomedOut(map.getZoom() < 14);
        setBounds({ minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() });
        
        // Save state on move/zoom
        localStorage.setItem('userMapState', JSON.stringify({ 
          center: [map.getCenter().lng, map.getCenter().lat], 
          zoom: map.getZoom() 
        }));
      };

      map.on('moveend', updateBounds);
      updateBounds();
    });

    return () => map.remove();
  }, [theme]);

  useImperativeHandle(ref, () => ({
    getMap: () => mapInstance.current,
  }), []);

  return (
    <MapContext.Provider value={mapInstance.current}>
      <div className="relative w-full h-full overflow-hidden rounded-lg border border-ts-border">
        <div ref={mapContainer} className="w-full h-full" />
        
        {mapLoaded && (
          <>
            <Stops bounds={bounds} tooZoomedOut={tooZoomedOut} />
            <LiveVehicles bounds={bounds} />
          </>
        )}
      </div>
    </MapContext.Provider>
  );
});