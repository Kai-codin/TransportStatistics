'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { MapPin, AlertTriangle } from 'lucide-react';

export const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const [bounds, setBounds] = useState({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const stops = useQuery(api.functions.stops.getInBBox, bounds);

  useEffect(() => {
    if (!mapContainer.current) return;
    
    setHasError(false);

    const mainMapStyle = "https://maps.fluffynet.dev/styles/dark/style.json";
    const backupMapStyle = "https://api.maptiler.com/maps/openstreetmap/style.json?key=ghAzCSy39lRpGskkQ68J";
    
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: mainMapStyle,
      center: [-1.5, 52.5],
      zoom: 10,
    });

    mapInstance.current = map;

    map.on('error', () => {
      map.setStyle(backupMapStyle);
      map.on('error', () => setHasError(true));
    });

    const updateBounds = () => {
      if (!mapInstance.current) return;
      const b = mapInstance.current.getBounds();
      setBounds({
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLon: b.getWest(),
        maxLon: b.getEast(),
      });
    };

    map.on('load', () => {
      map.addSource('stops-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'stops-layer',
        type: 'circle',
        source: 'stops-source',
        paint: { 'circle-radius': 5, 'circle-color': '#000000' }
      });
      updateBounds();
    });

    map.on('moveend', updateBounds);
    
    return () => mapInstance.current?.remove();
  }, [retryKey]);

  useEffect(() => {
    if (!mapInstance.current || !stops || hasError) return;

    const source = mapInstance.current.getSource('stops-source') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features = stops.map(stop => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
      properties: { name: stop.name }
    }));

    source.setData({ type: 'FeatureCollection', features });
  }, [stops, hasError]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-lg border border-ts-border">
      {hasError && (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] text-center px-4">
          <div className="relative mb-8">
            <MapPin className="w-20 h-20 text-gray-600" />
            <AlertTriangle className="w-8 h-8 text-ts-accent absolute -top-2 -right-2" />
          </div>

          <div className="max-w-sm">
            <h2 className="text-4xl font-bold text-white mb-2 whitespace-nowrap">Something Went Wrong</h2>
            <p className="text-gray-400 max-w-md mb-8">
              The map server is currently unreachable. Our team is likely performing updates. Please try again in a few moments.
            </p>
            <button
              onClick={() => setRetryKey(prev => prev + 1)}
              className="px-6 py-2.5 bg-ts-accent hover:bg-ts-accent text-ts-text-inv rounded-lg font-bold transition-all shadow-lg hover:shadow-ts-accent/20"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
};