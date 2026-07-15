"use client";
import { useEffect, useRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useMap } from "./Map";
import { useDeparturePanel } from "./depature";
import { getGroupForType } from "../lib/stopTypeGroups";

function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const metersPerDegLat = 111320;
  const metersPerDegLon = Math.cos(lat1 * Math.PI / 180) * 111320;
  const dLat = (lat2 - lat1) * metersPerDegLat;
  const dLon = (lon2 - lon1) * metersPerDegLon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export const Stops = ({
  bounds,
  tooZoomedOut,
}: {
  bounds: any;
  tooZoomedOut: boolean;
}) => {
  const map = useMap();
  const stopMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const counterRef = useRef(0);
  const { openPanel } = useDeparturePanel();

  const stops = useQuery(
    api.functions.stops.getInBBox,
    tooZoomedOut ? "skip" : bounds
  );
  const stopTypes = useQuery(api.functions.stops.list);

  // Hold onto the last resolved stops so markers don't flash during re-fetch
  const lastStopsRef = useRef<any[]>([]);
  if (stops !== undefined) {
    lastStopsRef.current = stops;
  }

  const typeColorMap = useMemo(() => {
    if (!stopTypes) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    stopTypes.forEach((type) => {
      const group = getGroupForType(type.name);
      map[type._id] = group?.color ?? "#3b82f6";
    });
    return map;
  }, [stopTypes]);

  // Only clear all when explicitly zoomed out
  useEffect(() => {
    if (tooZoomedOut) {
      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current.clear();
      lastStopsRef.current = [];
    }
  }, [tooZoomedOut]);

  useEffect(() => {
    if (!map || !stopTypes || tooZoomedOut) return;
    // Use last known stops while new query is loading
    const activeStops = lastStopsRef.current;
    if (!activeStops.length) return;

    const incomingIds = new Set(activeStops.map((s: any) => String(s._id)));

    // Remove markers no longer in the response
    stopMarkersRef.current.forEach((marker, id) => {
      if (!incomingIds.has(id)) {
        marker.remove();
        stopMarkersRef.current.delete(id);
      }
    });

    // Add only new markers
    activeStops.forEach((stop: any) => {
      const stopId = String(stop._id);
      if (stopMarkersRef.current.has(stopId)) return;

      const typeObj = stopTypes.find((t) => t._id === stop.stopTypeId);
      const name = typeObj?.name.toLowerCase() || "";
      const group = getGroupForType(name);
      const mode = group?.name === "rail" ? "train" : "bus";
      const codes = [stop.crsCode ? `CRS ${stop.crsCode}` : "", stop.atcoCode].filter(Boolean);

      const el = document.createElement("div");
      el.style.cssText = `width:20px;height:20px;border-radius:50%;background-color:${
        typeColorMap[stop.stopTypeId]
      };border:2px solid white;cursor:pointer;`;
      el.onclick = () => {
        const id = String(++counterRef.current);
        const isMetro = group?.name === "metro";
        let clusterStops;
        if (isMetro) {
          clusterStops = lastStopsRef.current
            .filter((s: any) => {
              if (s._id === stop._id) return false;
              const t = stopTypes.find((st: any) => st._id === s.stopTypeId);
              return getGroupForType(t?.name || "")?.name === "metro";
            })
            .filter((s: any) => getDistanceInMeters(stop.lat, stop.lon, s.lat, s.lon) <= 1000)
            .slice(0, 5);
        }
        openPanel(stop, typeObj, mode, codes, id, clusterStops);
      };

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);

      stopMarkersRef.current.set(stopId, marker);
    });
  }, [map, stops, stopTypes, typeColorMap, openPanel, tooZoomedOut]);

  useEffect(() => {
    return () => {
      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current.clear();
    };
  }, []);

  return null;
};