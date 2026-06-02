"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useMap } from "./Map";

const POLL_INTERVAL_MS = 30000;
const DENSITY_THRESHOLD = 1000;

const C = {
  bg: "#0d1410", surface: "#141e17", border: "#2a3d2f",
  text1: "#e8f0e4", text2: "#9ab89a",
};

export const LiveVehicles = ({ bounds }: { bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } }) => {
  const map = useMap();

  const [showBuses, setShowBuses] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showBuses");
      return saved !== null ? JSON.parse(saved) : true;
    }
    return true;
  });

  const [showTrains, setShowTrains] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showTrains");
      return saved !== null ? JSON.parse(saved) : true;
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem("showBuses", JSON.stringify(showBuses));
    localStorage.setItem("showTrains", JSON.stringify(showTrains));
  }, [showBuses, showTrains]);

  // Change: keyed map instead of flat array
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  useEffect(() => {
    return () => {
      const root = document.getElementById("ts-stop-panel-root");
      if (root) root.remove();
    };
  }, []);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://bustimes.org/liveries.1777635301.css";
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource("vehicles-source")) {
      map.addSource("vehicles-source", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "vehicles-layer", type: "circle", source: "vehicles-source",
        paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-width": 0 },
        layout: { visibility: "none" },
      });
      map.addSource("route-source", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: "route-line-solid", type: "line", source: "route-source",
        paint: { "line-color": "#22c55e", "line-width": 4 },
        layout: { visibility: "visible" },
      });
      map.addLayer({
        id: "route-line-dashed", type: "line", source: "route-source",
        paint: { "line-color": "#94a3b8", "line-width": 4, "line-dasharray": [2, 2] },
        layout: { visibility: "none" },
      });
    }
  }, [map]);

  function buildUnitColumnHtml(unitList: Array<string | number>, item: any) {
    const displayUnit = unitList.join(" + ");
    return `
      <div style="font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; color:#9ab89a;">Units</div>
      <div>
        <span class="text-nowrap">${displayUnit}</span>
        ${item.popup_data.link2 ? `<br/><a href="${item.popup_data.link2}" target="_blank" style="color:#60a5fa;font-size:.8rem;">View Vehicle</a>` : ""}
        ${item.popup_data.link1 ? `<br/><a href="${item.popup_data.link1}" target="_blank" style="color:#60a5fa;font-size:.8rem;">View Vehicle</a>` : ""}
      </div>
    `;
  }

  const handleVehicleClick = async (item: any, type: "train" | "bus", popup: maplibregl.Popup) => {
    if (!item.id || !map) return;
    try {
      const queryParam = type === "train" ? `rid=${item.id}` : `trip_id=${item.id}`;
      const res = await fetch(`/api/route-info?${queryParam}`);
      if (!res.ok) throw new Error("Failed to fetch route info");
      const data = await res.json();

      const isSnapped = data.snapped !== false;
      map.setLayoutProperty("route-line-solid", "visibility", isSnapped ? "visible" : "none");
      map.setLayoutProperty("route-line-dashed", "visibility", isSnapped ? "none" : "visible");
      (map.getSource("route-source") as any).setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: data.path || [] },
        properties: {},
      });

      if (type === "train" && data.vehicles) {
        const unitNumber = data.vehicles;
        const unitList = Array.isArray(unitNumber)
          ? unitNumber
          : typeof unitNumber === "object"
          ? Object.values(unitNumber).map((item: any) => item?.unit_number || item?.unit_reg).filter(Boolean)
          : [unitNumber];
        if (unitList.length === 0) return;

        const popupEl = popup.getElement();
        if (popupEl) {
          const unitColumn = popupEl.querySelector("[data-unit-column]");
          if (unitColumn) unitColumn.innerHTML = buildUnitColumnHtml(unitList, item);
        }
      }
    } catch (e) { console.error("Failed to load route data:", e); }
  };

  const createMarker = (item: any, type: "train" | "bus") => {
    const el = document.createElement("div");
    el.className = "maplibregl-marker maplibregl-marker-anchor-center";
    const rotation = item.rotation || 0;
    const isFacingRight = rotation >= 0 && rotation <= 180;
    const liveryClass = `livery-${item.liveryID || 0} ${isFacingRight ? "right" : ""}`;
    const color = item.colour || (type === "train" ? "#1669b6" : "#ff0000");
    const background = (type === "bus" && item.colour && !item.liveryID) || type === "train" ? color : "";

    let markerHTML: string;
    if (type === "train") {
      const border = isFacingRight ? "border-right: 0;" : "border-left: 0;";
      markerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:rotate(${rotation}deg);transform-origin:center;">
          <div class="trainArrow" style="border-bottom: 10px solid ${color};"></div>
          <svg width="40" height="20" style="background:${background}; ${border}" class="vehicle-marker ${liveryClass}">
            <text x="${isFacingRight ? "22" : "18"}" y="13">${item.service || "N/A"}</text>
          </svg>
        </div>`;
    } else {
      markerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:rotate(${rotation}deg);transform-origin:center;">
          <div class="arrow"></div>
          <svg width="30" height="20" style="background:${background}" class="vehicle-marker ${liveryClass}">
            <text x="14" y="13">${item.service || "N/A"}</text>
          </svg>
        </div>`;
    }

    el.innerHTML = markerHTML;

    const unitList = Array.isArray(item.unit_numbers) ? item.unit_numbers : [];
    const unitColumnHtml = unitList.length > 0
      ? buildUnitColumnHtml(unitList, item)
      : '<div style="font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; color:#9ab89a;">Units</div><div>Loading...</div>';

    const content = type === "train"
      ? `
        <a href="${item.popup_data.link1}" target="_blank" class="v-popup-link">${item.popup_data.label1}</a>
        <div class="v-popup-subtitle" style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#9ab89a;">Delay</div>
            <div>${item.popup_data.label2}</div>
          </div>
          <div data-unit-column>${unitColumnHtml}</div>
        </div>
        <a href="${item.popup_data.log_link}" class="v-popup-btn">Log this ${type}</a>`
      : `
        <a href="${item.popup_data.link1}" target="_blank" class="v-popup-link">${item.popup_data.label1}</a>
        <div class="v-popup-subtitle">${item.popup_data.label2}${item.popup_data.link2
          ? `<br/><a href="${item.popup_data.link2}" target="_blank" style="color:#60a5fa;font-size:.8rem;">View Vehicle</a>`
          : ""}</div>
        <a href="${item.popup_data.log_link}" class="v-popup-btn">Log this ${type}</a>`;

    const popup = new maplibregl.Popup({ offset: 25, className: "vehicle-popup" }).setHTML(content);
    el.addEventListener("click", () => handleVehicleClick(item, type, popup));

    return new maplibregl.Marker({ element: el })
      .setLngLat([item.location.lon, item.location.lat])
      .setPopup(popup);
  };

  const updateMarkerElement = (marker: maplibregl.Marker, item: any, type: "train" | "bus") => {
    // Just move it — popup and click handler are untouched
    marker.setLngLat([item.location.lon, item.location.lat]);

    // Optionally update the rotation of the inner div without rebuilding the whole element
    const inner = marker.getElement().querySelector<HTMLElement>("div[style*='transform:rotate']");
    if (inner) {
      inner.style.transform = `rotate(${item.rotation || 0}deg)`;
    }
  };

  // ── Polling Logic ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;

    const fetchVehicles = async () => {
      try {
        if (typeof (map as any).isStyleLoaded === "function" && !(map as any).isStyleLoaded()) return;
        if (!map.getSource || !map.getLayer || !map.getSource("vehicles-source")) return;

        const { minLat, maxLat, minLon, maxLon } = bounds;
        const res = await fetch(
          `/api/live-vehicles?xmin=${minLon}&ymin=${minLat}&xmax=${maxLon}&ymax=${maxLat}&showTrains=${showTrains}&showBuses=${showBuses}&debug=true`
        );
        if (!res.ok) return;

        const data = await res.json();
        const filteredTrains = showTrains ? data.trains || [] : [];
        const filteredBuses = showBuses ? data.buses || [] : [];
        const allVehicles = [...filteredTrains, ...filteredBuses];

        try {
          if (map.getLayer("vehicles-layer")) {
            map.setLayoutProperty("vehicles-layer", "visibility", "none");
          }
        } catch (err) {
          console.warn("Skipped setLayoutProperty", err);
        }

        if (allVehicles.length > DENSITY_THRESHOLD) {
          // High density: use GeoJSON layer, clear individual markers
          markersRef.current.forEach((m) => m.remove());
          markersRef.current.clear();

          const features = allVehicles.map((v: any) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [v.location.lon, v.location.lat] },
            properties: { color: v.colour || "#ff0000" },
          }));
          const src = map.getSource("vehicles-source") as any;
          if (src?.setData) src.setData({ type: "FeatureCollection", features });

          try {
            if (map.getLayer("vehicles-layer")) {
              map.setLayoutProperty("vehicles-layer", "visibility", "visible");
            }
          } catch (err) {
            console.warn("Skipped setLayoutProperty(visible)", err);
          }
        } else {
          // Diff existing markers against new data
          const incomingIds = new Set(allVehicles.map((v: any) => String(v.id)));

          // Remove vehicles no longer in the response
          markersRef.current.forEach((marker, id) => {
            if (!incomingIds.has(id)) {
              marker.remove();
              markersRef.current.delete(id);
            }
          });

          // Update existing or create new
          filteredTrains.forEach((t: any) => {
            const id = String(t.id);
            if (markersRef.current.has(id)) {
              updateMarkerElement(markersRef.current.get(id)!, t, "train");
            } else {
              markersRef.current.set(id, createMarker(t, "train").addTo(map));
            }
          });

          filteredBuses.forEach((b: any) => {
            const id = String(b.id);
            if (markersRef.current.has(id)) {
              updateMarkerElement(markersRef.current.get(id)!, b, "bus");
            } else {
              markersRef.current.set(id, createMarker(b, "bus").addTo(map));
            }
          });
        }
      } catch (e) { console.error("Failed to update vehicles", e); }
    };

    const interval = setInterval(fetchVehicles, POLL_INTERVAL_MS);
    fetchVehicles();
    return () => {
      clearInterval(interval);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
    };
  }, [map, bounds, showBuses, showTrains]);

  return (
    <div className="absolute top-4 left-12 p-2 rounded shadow-md flex flex-col gap-1 text-sm z-10"
         style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text2 }}>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showBuses} onChange={(e) => setShowBuses(e.target.checked)} />
        Live Buses
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showTrains} onChange={(e) => setShowTrains(e.target.checked)} />
        Live Trains
      </label>
    </div>
  );
};