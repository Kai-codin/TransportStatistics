"use client";
import { useEffect, useRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useMap } from "./Map";

// ─── Design tokens & CSS ──────────────────────────────────────────────────────
const C = {
  bg: "#0d1410",
  surface: "#141e17",
  surface2: "#1c2920",
  surface3: "#243328",
  border: "#2a3d2f",
  borderSoft: "#1e2d22",
  text1: "#e8f0e4",
  text2: "#9ab89a",
  text3: "#5a7a5e",
  accent: "#34d064",
  accentL: "rgba(52,208,100,0.10)",
  accentB: "rgba(52,208,100,0.20)",
  danger: "#f87171",
  warn: "#f59e0b",
};

const PANEL_CSS = `
  #ts-stop-panel-root { position: fixed; bottom: 24px; right: 24px; width: 360px; max-height: calc(100dvh - 48px); overflow-y: auto; z-index: 9999; border-radius: 12px; border: 1px solid ${C.border}; box-shadow: 0 8px 40px rgba(0,0,0,0.85); display: none; scrollbar-width: thin; scrollbar-color: ${C.border} transparent; }
  #ts-stop-panel-root.open { display: block; }
  @media (max-width: 600px) {
    #ts-stop-panel-root { bottom: 0; right: 0; left: 0; width: 100%; max-height: 72dvh; border-radius: 16px 16px 0 0; border: none; }
  }
  .ts-stop-panel { width: 100%; box-sizing: border-box; background: ${C.bg}; color: ${C.text1}; padding: 16px; border-radius: inherit; font-family: system-ui, sans-serif; position: relative; }
  #ts-stop-panel-close { position: absolute; top: 14px; right: 14px; background: transparent; border: none; color: ${C.text3}; font-size: 24px; cursor: pointer; }
  .line-pill { background: ${C.surface3}; border: 1px solid ${C.border}; color: ${C.text2}; font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 500; display: inline-block; margin-right: 4px; margin-bottom: 4px; }
  .warning-box { background: ${C.danger}15; color: ${C.danger}; padding: 8px; border-radius: 6px; font-size: 11px; margin-bottom: 10px; border: 1px solid ${C.danger}30; }
  .ts-stop-table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
  .ts-stop-table th { color: ${C.text3}; font-size: 9px; text-transform: uppercase; text-align: left; padding: 4px; border-bottom: 1px solid ${C.border}; }
  .ts-stop-table td { padding: 8px 4px; border-bottom: 1px solid ${C.borderSoft}; vertical-align: middle; }
  .service-cell { width: 50px; }
  .time-cell { width: 50px; text-align: right; font-size: 12px; }
  .plat-cell { width: 35px; text-align: center; font-size: 12px; }
  .dest-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  
  /* Flip Animation */
  .row-anim { animation: flipIn 0.6s ease-out forwards; backface-visibility: hidden; }
  @keyframes flipIn { from { transform: rotateX(-90deg); opacity: 0; } to { transform: rotateX(0deg); opacity: 1; } }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function offsetISO(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

// ─── HTML builders ────────────────────────────────────────────────────────────
function buildShell(stopName: string,  stopId: string, typeName: string, codes: string[], bodyHTML: string, headerExtraHTML: string = ""): string {
  const codeBadges = codes.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${codes.map((c) => `<span style="background:${C.surface2};color:${C.text2};font-size:10px;padding:3px 10px;border-radius:5px;border:1px solid ${C.border};">${c}</span>`).join("")}</div>` : "";

  return `<div class="ts-stop-panel">
    <div style="font-size:18px;font-weight:700;margin-bottom:3px;padding-right:24px;">${stopName}</div>
    
    <div id="ts-stop-panel-header-extra">${headerExtraHTML}</div>
    ${codeBadges}
    <div id="ts-stop-panel-content">${bodyHTML}</div>
    <div style="font-size:9px;color:${C.text3};">Stop ID: ${stopId} <a style="color:${C.accent};" href="/request/edit/stop/${stopId}">Request Edit</a></div>
  </div>`;
}

function buildEmptyPopup(stopName: string, stopId: string, typeName: string, codes: string[], msg: string) {
  return buildShell(stopName, stopId, typeName, codes, `<div style="padding:28px 0;text-align:center;color:${C.text2};">${msg}</div>`);
}

function buildLoadingPopup(stopName: string, stopId: string, typeName: string, codes: string[]) {
  return buildShell(stopName, stopId, typeName, codes, `<div style="padding:28px 0;text-align:center;color:${C.text3};">Loading departures…</div>`);
}

function buildErrorPopup(stopName: string, stopId: string, typeName: string, codes: string[], msg: string) {
  return buildShell(stopName, stopId, typeName, codes, `<div style="padding:28px 0;text-align:center;color:${C.danger};">${msg}</div>`);
}

function buildHeaderExtra(metadata: any): string {
  const linePills = metadata?.line_names?.map((name: string) => `<span class="line-pill">${name}</span>`).join("") || "";
  const cancellationAlert = metadata?.contains_cancelled_services ? `<div class="warning-box">Some services are reported as canceled</div>` : "";
  return linePills || cancellationAlert ? `<div style="margin-bottom: 10px;">${linePills}${cancellationAlert}</div>` : "";
}

function buildDeparturesContent(data: any, offsetMin: number, popupId: string, stopId: string): string {
  const { departures, metadata } = data;
  const showExpected = !!metadata?.contains_expected_times;
  const showPlatform = !!metadata?.contains_platform_numbers;

  const rows =
    departures.length === 0
      ? `<tr><td colspan="5" style="text-align:center; color:${C.text3}; padding: 20px;">No departures found.</td></tr>`
      : departures
          .map((d: any) => {
            const sched = fmt(d.scheduled_departure);
            const exp = fmt(d.expected_departure);
            const isCancelled = d.is_cancelled;
            const schedStyle = isCancelled ? `style="text-decoration:line-through; color:${C.danger};"` : `style="color:${C.text1};"`;
            const expStyle = d.expected_departure && d.expected_departure !== d.scheduled_departure ? `style="color:${C.warn}; font-weight:600;"` : `style="color:${C.text2};"`;

            return `
          <tr class="data-row">
            <td class="service-cell"><span style="background:${C.accentL};color:${C.accent};font-weight:700;font-size:11px;padding:3px 6px;border-radius:4px;border:1px solid ${C.accentB}; display:inline-block;"><a href="${d.service_link}" target="_blank" rel="noopener noreferrer">${d.service || "?"}</a></span></td>
            <td class="dest-cell" style="color:${C.text1}; font-size:12px;">${d.destination || "Unknown"}</td>
            <td class="time-cell" ${schedStyle}>${sched}</td>
            ${showExpected ? `<td class="time-cell" ${expStyle}>${isCancelled ? "–" : d.expected_departure ? exp : sched}</td>` : ""}
            ${showPlatform ? `<td class="plat-cell"><span style="background:${C.surface3};padding:2px 7px;border-radius:4px;border:1px solid ${C.border}; font-size:11px;">${d.platform || "–"}</span></td>` : ""}
          </tr>
        `;
          })
          .join("");

  const offsetBtns = [-60, -30, -15, 0, 15, 30, 60]
    .map((o) => {
      const active = o === offsetMin;
      return `<button data-offset="${o}" data-popup="${popupId}" style="flex:1;padding:5px 0;border-radius:6px;font-size:11px;cursor:pointer;border:1px solid ${active ? C.accent : C.border};background:${active ? C.accent : C.surface2};color:${active ? C.bg : C.text2};">${o === 0 ? "LIVE" : o > 0 ? `+${o}m` : `${o}m`}</button>`;
    })
    .join("");

  const attributions = data.attributions;

  return `
    <div style="margin-bottom:14px;"><div style="font-size:9px;color:${C.text3};text-transform:uppercase;margin-bottom:6px;">Time offset</div><div style="display:flex;gap:4px;">${offsetBtns}</div></div>
    <div style="">
      <table class="ts-stop-table">
        <thead>
          <tr><th class="service-cell">Service</th><th class="dest-cell">Dest.</th><th class="time-cell">Sched.</th>${showExpected ? `<th class="time-cell">Exp.</th>` : ""}${showPlatform ? `<th class="plat-cell">Plat.</th>` : ""}</tr>
        </thead>
        <tbody id="ts-tbody">${rows}</tbody>
      </table>
      <div style="margin-top: 8px;">
        <small style="color:${C.text3}; display:block;">${attributions.map((a: string) => `<div>${a}</div>`).join("")}</small>
        <small id="ts-refresh-indicator" style="color:${C.text3}; display:block; margin-top:4px;">Refreshed 0 seconds ago</small>
      </div>
    </div>
  `;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export const Stops = ({
  bounds,
  tooZoomedOut,
}: {
  bounds: any;
  tooZoomedOut: boolean;
}) => {
  const map = useMap();
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const activeState = useRef<{ id: string; error?: boolean; [key: string]: any } | null>(null);
  const counterRef = useRef(0);
  const lastUpdatedRef = useRef<number>(0);
  const lastDataRef = useRef<string | null>(null);

  const stops = useQuery(
    api.functions.stops.getInBBox,
    tooZoomedOut ? "skip" : bounds,
  );
  const stopTypes = useQuery(api.functions.stops.list);

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

  function setPanelHTML(html: string) {
    let root = document.getElementById("ts-stop-panel-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "ts-stop-panel-root";
      document.body.appendChild(root);
    }
    root.innerHTML = html;
    root.classList.add("open");
    const closeBtn = document.createElement("button");
    closeBtn.id = "ts-stop-panel-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.onclick = () => {
      root.classList.remove("open");
      activeState.current = null;
      lastDataRef.current = null;
    };
    root.querySelector(".ts-stop-panel")?.appendChild(closeBtn);
  }

  // Timer Effect
  useEffect(() => {
    const timer = setInterval(() => {
      if (!activeState.current || activeState.current.error) return; 

      const panel = document.getElementById("ts-stop-panel-root");
      if (!panel?.classList.contains("open")) return;      
      
      const seconds = Math.floor((Date.now() - lastUpdatedRef.current) / 1000);
      const indicator = document.getElementById("ts-refresh-indicator");
      
      if (activeState.current.offset === 0) {
        if (indicator) {
            indicator.style.display = "block";
            indicator.innerText = `Refreshed ${seconds} seconds ago`;
        }
        if (seconds >= 10) {
            fetchAndRender(activeState.current, 0, true);
        }
      } else {
        if (indicator) indicator.style.display = "none";
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function fetchAndRender(state: any, offsetMin: number, isSilentRefresh: boolean = false) {
    const { stop, typeName, codes, mode, id } = state;
    // Set error to false on start of new fetch
    activeState.current = { ...state, offset: offsetMin, error: false }; 

    if (!isSilentRefresh) {
      setPanelHTML(buildLoadingPopup(stop.commonName, stop._id, typeName, codes));
      lastDataRef.current = null;
    }

    try {
      const targetISO = offsetMin !== 0 ? offsetISO(new Date(), offsetMin) : undefined;
      const code = mode === "train" ? stop.crsCode || stop.tiploc : stop.atcoCode;
      const url = targetISO ? `/api/departures?code=${code}&type=${mode}&datetime=${encodeURIComponent(targetISO)}` : `/api/departures?code=${code}&type=${mode}`;

      const res = await fetch(url);
      if (res.status === 482) {
        const data = await res.json();
        if (activeState.current) {
          activeState.current = { ...activeState.current, error: true };
        } else {
          activeState.current = { id: id, stop, typeName, codes, mode, error: true } as any;
        }
        setPanelHTML(buildEmptyPopup(stop.commonName, stop._id, typeName, codes, data.error || "No departures found."));
        return;
      }

      if (activeState.current?.id !== id) return;
      
      if (!res.ok) throw new Error("API Error"); 

      const data = await res.json();
      const dataString = JSON.stringify(data);
      
      // Data change check
      if (isSilentRefresh && lastDataRef.current === dataString) {
          lastUpdatedRef.current = Date.now();
          return;
      }

      lastDataRef.current = dataString;
      lastUpdatedRef.current = Date.now();

      const contentHTML = buildDeparturesContent(data, offsetMin, id, stop._id);
      const headerExtraHTML = buildHeaderExtra(data.metadata);

      const contentDiv = document.getElementById("ts-stop-panel-content");
      const extraDiv = document.getElementById("ts-stop-panel-header-extra");

      if (isSilentRefresh && contentDiv && extraDiv) {
        contentDiv.innerHTML = contentHTML;
        extraDiv.innerHTML = headerExtraHTML;

        const rows = document.querySelectorAll('#ts-tbody .data-row');
        rows.forEach((row, index) => {
            (row as HTMLElement).classList.add('row-anim');
            (row as HTMLElement).style.animationDelay = `${index * 0.05}s`;
        });
      } else {
        const displayName = data.metadata?.long_name || data.metadata?.name || stop.commonName;
        setPanelHTML(buildShell(displayName, stop._id, typeName, codes, contentHTML, headerExtraHTML));
      }

      document.querySelectorAll("button[data-offset]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          fetchAndRender(state, parseInt(btn.getAttribute("data-offset") || "0"), true);
        });
      });
    } catch {
      const _curr = activeState.current as any;
      if (_curr?.id === id) {
        _curr.error = true;
        setPanelHTML(buildErrorPopup(stop.commonName, stop._id, typeName, codes, "Failed to load departures."));
      }
    }
  }

  useEffect(() => {
    const styleId = "ts-stop-panel-css";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }, []);

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
        activeState.current = {
          stop,
          typeName: typeObj?.name || "",
          codes,
          mode,
          id,
          error: false
        };
        fetchAndRender(activeState.current, 0, false);
      };

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);
      stopMarkersRef.current.push(marker);
    });
  }, [map, stops, stopTypes, typeColorMap]);

  return null;
};