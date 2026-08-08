'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMapStyleUrl } from './mapStyleUrl';
import { useTheme } from '@/components/ThemeProvider';

const NAV_STYLES = `
.maplibregl-ctrl-top-right { top: 10px; right: 10px; }
.maplibregl-ctrl-group button { width: 32px; height: 32px; }
`;

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

type MapClickCoords = { lng: number; lat: number };

type LogMapProps = {
  visible?: boolean;
  fullRoute: RouteStop[];
  fullGeometry: Geometry;
  highlightedGeometry: Geometry;
  onStopClick: (id: number) => void;
  fromStopId: number | null;
  toStopId: number | null;
  onMapClick?: ((coords: MapClickCoords) => void) | null;
  onStopDragEnd?: ((stopId: number, location: [number, number]) => void) | null;
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

const DRAG_PX_THRESHOLD = 4;

export const LogMap = forwardRef<LogMapHandle, LogMapProps>(function LogMap(
  { visible = true, fullRoute, fullGeometry, highlightedGeometry, onStopClick, fromStopId, toStopId, onMapClick, onStopDragEnd },
  ref,
) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const onStopClickRef = useRef(onStopClick);
  const onMapClickRef = useRef(onMapClick);
  const onStopDragEndRef = useRef(onStopDragEnd);
  const [mapLoaded, setMapLoaded] = useState(false);
  const { theme } = useTheme();

  const dragState = useRef<{
    stopId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);

  const dragSourceAdded = useRef(false);

  useEffect(() => {
    onStopClickRef.current = onStopClick;
  }, [onStopClick]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onStopDragEndRef.current = onStopDragEnd;
  }, [onStopDragEnd]);

  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: getMapStyleUrl(theme),
      center: [-1.47, 53.38],
      zoom: 12,
      attributionControl: false,
    });

    map.on('load', () => {
      mapInstance.current = map;

      map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'top-right');
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
        }),
        'top-right',
      );

      const styleEl = document.createElement('style');
      styleEl.textContent = NAV_STYLES;
      mapContainer.current?.appendChild(styleEl);

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
          onStopClickRef.current(value);
          return;
        }
        if (typeof value === 'string') {
          const parsed = Number(value);
          if (!Number.isNaN(parsed)) onStopClickRef.current(parsed);
        }
      });

      map.on('mouseenter', 'stops-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'stops-layer', () => {
        if (!dragState.current?.isDragging) {
          map.getCanvas().style.cursor = '';
        }
      });

      map.on('click', (event) => {
        if (onMapClickRef.current) {
          onMapClickRef.current({ lng: event.lngLat.lng, lat: event.lngLat.lat });
        }
      });

      // ---- Drag support for custom stops ----

      map.on('mousedown', 'stops-layer', (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id !== 'number' || id >= 0) return; // only custom stops
        if (!onStopDragEndRef.current) return;

        event.preventDefault();
        map.dragPan.disable();

        dragState.current = {
          stopId: id,
          startX: event.point.x,
          startY: event.point.y,
          isDragging: false,
        };
        map.getCanvas().style.cursor = 'grabbing';
      });

      map.on('mousemove', (event) => {
        const ds = dragState.current;
        if (!ds) return;

        const dx = event.point.x - ds.startX;
        const dy = event.point.y - ds.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!ds.isDragging && dist < DRAG_PX_THRESHOLD) return;

        if (!ds.isDragging) {
          ds.isDragging = true;
        }

        if (!dragSourceAdded.current) {
          map.addSource('drag-indicator', {
            type: 'geojson',
            data: emptyLineFeature,
          });
          map.addLayer({
            id: 'drag-indicator-layer',
            type: 'circle',
            source: 'drag-indicator',
            paint: {
              'circle-radius': 10,
              'circle-color': '#f59e0b',
              'circle-opacity': 0.6,
              'circle-stroke-width': 3,
              'circle-stroke-color': '#f59e0b',
            },
          });
          dragSourceAdded.current = true;
        }

        const lngLat = map.unproject(event.point);
        const dragSource = map.getSource('drag-indicator') as maplibregl.GeoJSONSource | undefined;
        if (dragSource) {
          dragSource.setData({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] },
            properties: {},
          });
        }
      });

      const cleanupDrag = () => {
        const ds = dragState.current;
        if (!ds) return;

        map.dragPan.enable();

        if (ds.isDragging) {
          map.getCanvas().style.cursor = '';
        }

        if (dragSourceAdded.current) {
          const dragLayer = map.getLayer('drag-indicator-layer');
          if (dragLayer) map.removeLayer('drag-indicator-layer');
          const dragSrc = map.getSource('drag-indicator');
          if (dragSrc) map.removeSource('drag-indicator');
          dragSourceAdded.current = false;
        }

        dragState.current = null;
      };

      map.on('mouseup', (event) => {
        const ds = dragState.current;
        if (!ds) return;

        if (ds.isDragging) {
          const lngLat = map.unproject(event.point);
          onStopDragEndRef.current?.(ds.stopId, [lngLat.lng, lngLat.lat]);
        }

        cleanupDrag();
      });

      map.on('mouseleave', () => {
        if (dragState.current?.isDragging) {
          cleanupDrag();
        }
      });

      // ----

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (visible && mapInstance.current) {
      requestAnimationFrame(() => mapInstance.current?.resize());
    }
  }, [visible]);

  // Effect 1: update data only (no fitBounds)
  useEffect(() => {
    if (!mapLoaded || !mapInstance.current) return;

    const map = mapInstance.current;
    const fullRouteSource = map.getSource('full-route') as maplibregl.GeoJSONSource | undefined;
    const highlightRouteSource = map.getSource('highlight-route') as maplibregl.GeoJSONSource | undefined;
    const stopsSource = map.getSource('stops-source') as maplibregl.GeoJSONSource | undefined;

    if (fullRouteSource) {
      // Ensure we only pass a valid geometry object to the feature
      const validGeometry = fullGeometry?.type === 'LineString' ? fullGeometry : null;
      
      fullRouteSource.setData(
        validGeometry
          ? { type: 'Feature', geometry: validGeometry, properties: {} }
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

    const stopCoords = fullRoute
      .map((entry) => entry.stop?.location)
      .filter((entry): entry is [number, number] => Array.isArray(entry) && entry.length === 2);

    const boundsCoords = (fullGeometry && 'coordinates' in fullGeometry && fullGeometry.coordinates.length > 0)
      ? fullGeometry.coordinates
      : stopCoords;

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
  <div className={`rounded-lg relative h-full w-full overflow-hidden bg-ts-surface ${onMapClick ? '[&_.maplibregl-canvas]:cursor-crosshair' : ''}`}>
    <div ref={mapContainer} className="h-full w-full" />
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-ts-surface text-sm text-ts-text-2">
          Initializing map...
        </div>
      )}
    </div>
  );
});
