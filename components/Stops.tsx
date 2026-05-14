"use client";
import { useEffect, useRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useMap } from "./Map";
import { useDeparturePanel } from "./depature";

export const Stops = ({
  bounds,
  tooZoomedOut,
}: {
  bounds: any;
  tooZoomedOut: boolean;
}) => {
  const map = useMap();
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const counterRef = useRef(0);
  const { openPanel } = useDeparturePanel();

  const stops = useQuery(
    api.functions.stops.getInBBox,
    tooZoomedOut ? "skip" : bounds
  );

  const stopTypes = useQuery(api.functions.stops.list);

  const typeColorMap = useMemo(() => {
    if (!stopTypes) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    stopTypes.forEach((type) => {
      const name = type.name.toLowerCase();
      map[type._id] =
        name.includes("rail") || name.includes("train") ? "#b61653" : "#3b82f6";
    });
    return map;
  }, [stopTypes]);

  // Clear markers when zoomed out or stops become undefined (query skipped)
  useEffect(() => {
    if (tooZoomedOut || !stops) {
      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current = [];
    }
  }, [tooZoomedOut, stops]);

  useEffect(() => {
    if (!map || !stops || !stopTypes || tooZoomedOut) return;

    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];

    stops.forEach((stop: any) => {
      const typeObj = stopTypes.find((t) => t._id === stop.stopTypeId);
      const name = typeObj?.name.toLowerCase() || "";
      const mode = ["train", "rail"].some((kw) => name.includes(kw)) ? "train" : "bus";
      const codes = [stop.crsCode ? `CRS ${stop.crsCode}` : "", stop.atcoCode].filter(Boolean);

      const el = document.createElement("div");
      el.style.cssText = `width:15px;height:15px;border-radius:50%;background-color:${
        typeColorMap[stop.stopTypeId]
      };border:2px solid white;cursor:pointer;`;
      el.onclick = () => {
        const id = String(++counterRef.current);
        openPanel(stop, typeObj, mode, codes, id);
      };

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);
      stopMarkersRef.current.push(marker);
    });
  }, [map, stops, stopTypes, typeColorMap, openPanel, tooZoomedOut]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current = [];
    };
  }, []);

  return null;
};