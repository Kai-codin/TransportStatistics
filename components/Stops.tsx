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

  // Initialize the departure panel hook
  const { openPanel } = useDeparturePanel();

  console.log("Rendering Stops component with bounds:", bounds, "tooZoomedOut:", tooZoomedOut);
  const stops = useQuery(
    api.functions.stops.getInBBox,
    tooZoomedOut ? "skip" : bounds,
  );
  console.log("Fetched stops:", stops);
  console.log("Fetching stop types...");
  const stopTypes = useQuery(api.functions.stops.list);
  console.log("Fetched stop types:", stopTypes);

  const typeColorMap = useMemo(() => {
    if (!stopTypes) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    stopTypes.forEach((type) => {
      const name = type.name.toLowerCase();
      if (name.includes("rail") || name.includes("train"))
        map[type._id] = "#b61653";
      else if (name.includes("bus")) map[type._id] = "#3b82f6";
      else map[type._id] = "#3b82f6";
    });
    return map;
  }, [stopTypes]);

  useEffect(() => {
    if (!map || !stops || !stopTypes) return;
    
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];

    stops.forEach((stop: any) => {
      const typeObj = stopTypes.find((t) => t._id === stop.stopTypeId);
      const name = typeObj?.name.toLowerCase() || "";
      const mode = ["train", "rail"].some((keyword) => name.includes(keyword)) ? "train" : "bus";
      const codes = [stop.crsCode ? `CRS ${stop.crsCode}` : "", stop.atcoCode].filter(Boolean);

      const el = document.createElement("div");
      el.style.cssText = `width:15px;height:15px;border-radius:50%;background-color:${typeColorMap[stop.stopTypeId]};border:2px solid white;cursor:pointer;`;

      el.onclick = () => {
        const id = String(++counterRef.current);
        // Delegate panel logic to the hook
        openPanel(stop, typeObj, mode, codes, id);
      };

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);
        
      stopMarkersRef.current.push(marker);
    });
  }, [map, stops, stopTypes, typeColorMap, openPanel]);

  return null;
};