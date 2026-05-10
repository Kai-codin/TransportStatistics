'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type Geometry = {
  type: 'LineString';
  coordinates: [number, number][];
} | null;

type RouteStop = {
  id: number;
  stop: {
    stop_code?: string | null;
    name?: string | null;
    location?: [number, number] | null;
  };
  scheduled_arrival?: string | null;
  scheduled_departure?: string | null;
};

type LogMapProps = {
  fullRoute: RouteStop[];
  fullGeometry: Geometry;
  highlightedGeometry: Geometry;
  onStopClick: (id: number) => void;
  fromStopId: number | null;
  toStopId: number | null;
};

export type LogMapHandle = {
  getMap: () => maplibregl.Map | null;
};

const emptyFeatureCollection = {
  type: 'FeatureCollection' as const,
  features: [],
};

const emptyLineFeature = {
  type: 'Feature' as const,
  geometry: {
    type: 'LineString' as const,
    coordinates: [],
  },
  properties: {},
};

export const LogMap = forwardRef<LogMapHandle, LogMapProps>(function LogMap(
  { fullRoute, fullGeometry, highlightedGeometry, onStopClick, fromStopId, toStopId },
  ref,
) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: '/api/proxy/map-style',
      center: [-1.5, 52.5],
      zoom: 6,
    });

    map.on('load', () => {
      mapInstance.current = map;

      map.addSource('full-route', {
        type: 'geojson',
        data: emptyLineFeature,
      });
      map.addLayer({
        id: 'full-route-line',
        type: 'line',
        source: 'full-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#22c55e',
          'line-width': 4,
          'line-opacity': 0.55,
        },
      });

      map.addSource('highlight-route', {
        type: 'geojson',
        data: emptyLineFeature,
      });
      map.addLayer({
        id: 'highlight-route-line',
        type: 'line',
        source: 'highlight-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#2563eb',
          'line-width': 5,
        },
      });

      map.addSource('stops-source', {
        type: 'geojson',
        data: emptyFeatureCollection,
      });
      map.addLayer({
        id: 'stops-layer',
        type: 'circle',
        source: 'stops-source',
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'selectionRole'], 'from'], 8,
            ['==', ['get', 'selectionRole'], 'to'], 8,
            5,
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'selectionRole'], 'from'], '#22c55e',
            ['==', ['get', 'selectionRole'], 'to'], '#2563eb',
            '#ffffff',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'case',
            ['boolean', ['get', 'isPass'], false], '#22c55e',
            '#0d1410',
          ],
        },
      });

      map.on('click', 'stops-layer', (event) => {
        const feature = event.features?.[0];
        const value = feature?.properties?.id;
        if (typeof value === 'number') {
          onStopClick(value);
          return;
        }
        if (typeof value === 'string') {
          const parsed = Number(value);
          if (!Number.isNaN(parsed)) onStopClick(parsed);
        }
      });

      map.on('mouseenter', 'stops-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'stops-layer', () => {
        map.getCanvas().style.cursor = '';
      });

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [onStopClick]);

  // Effect 1: update data only (no fitBounds)
  useEffect(() => {
    if (!mapLoaded || !mapInstance.current) return;

    const map = mapInstance.current;
    const fullRouteSource = map.getSource('full-route') as maplibregl.GeoJSONSource | undefined;
    const highlightRouteSource = map.getSource('highlight-route') as maplibregl.GeoJSONSource | undefined;
    const stopsSource = map.getSource('stops-source') as maplibregl.GeoJSONSource | undefined;

    if (fullRouteSource) {
      fullRouteSource.setData(
        fullGeometry
          ? { type: 'Feature', geometry: fullGeometry, properties: {} }
          : emptyLineFeature,
      );
    }

    if (highlightRouteSource) {
      highlightRouteSource.setData(
        highlightedGeometry
          ? { type: 'Feature', geometry: highlightedGeometry, properties: {} }
          : emptyLineFeature,
      );
    }

    if (stopsSource) {
      const features = fullRoute
        .filter((entry) => Array.isArray(entry.stop?.location) && entry.stop.location.length === 2)
        .map((entry) => ({
          type: 'Feature' as const,
          properties: {
            id: entry.id,
            name: entry.stop?.name ?? '',
            selectionRole: entry.id === fromStopId ? 'from' : entry.id === toStopId ? 'to' : '',
            isPass: !entry.scheduled_arrival && !entry.scheduled_departure,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: entry.stop.location as [number, number],
          },
        }));

      stopsSource.setData({ type: 'FeatureCollection', features });
    }
  }, [mapLoaded, fullGeometry, highlightedGeometry, fullRoute, fromStopId, toStopId]);

  // Effect 2: fit bounds only when the route first loads
  const hasFitted = useRef(false);

  useEffect(() => {
    if (!mapLoaded || !mapInstance.current || hasFitted.current) return;

    const boundsCoords = fullGeometry?.coordinates?.length
      ? fullGeometry.coordinates
      : fullRoute
          .map((entry) => entry.stop?.location)
          .filter((entry): entry is [number, number] => Array.isArray(entry) && entry.length === 2);

    if (boundsCoords.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    boundsCoords.forEach((coord) => bounds.extend(coord));

    if (!bounds.isEmpty()) {
      mapInstance.current.fitBounds(bounds, { padding: 54, duration: 500, maxZoom: 14 });
      hasFitted.current = true;
    }
  }, [mapLoaded, fullGeometry, fullRoute]);

  useImperativeHandle(ref, () => ({
    getMap: () => mapInstance.current,
  }), []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[20px] border border-ts-border-soft bg-ts-surface">
      <div ref={mapContainer} className="h-full w-full" />
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-ts-surface text-sm text-ts-text-2">
          Initializing map...
        </div>
      )}
    </div>
  );
});
