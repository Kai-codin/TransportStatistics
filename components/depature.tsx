"use client";
import { useEffect, useRef } from "react";

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
  #ts-stop-panel-root { position: fixed; bottom: 24px; right: 24px; width: 425px; max-height: calc(100dvh - 48px); overflow-y: auto; z-index: 9999; border-radius: 12px; border: 1px solid ${C.border}; box-shadow: 0 8px 40px rgba(0,0,0,0.85); display: none; scrollbar-width: thin; scrollbar-color: ${C.border} transparent; }
  #ts-stop-panel-root.open { display: block; }
  @media (max-width: 600px) {
    #ts-stop-panel-root { background: ${C.bg}; bottom: 0; right: 0; left: 0; top: 0; height: 100%; max-height: 100%; width: 100%; border-radius: 0; border: none; }
    .ts-stop-panel { height: 100%; bottom: 0; top: 0; position: fixed; }
  }
  .ts-stop-panel { width: 100%; box-sizing: border-box; background: ${C.bg}; color: ${C.text1}; padding: 16px; border-radius: inherit; font-family: system-ui, sans-serif; position: relative; }
  #ts-stop-panel-close { position: absolute; top: 14px; right: 14px; background: transparent; border: none; color: ${C.text3}; font-size: 24px; cursor: pointer; line-height: 1; }
  .line-pill { background: ${C.surface3}; border: 1px solid ${C.border}; color: ${C.text2}; font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 500; display: inline-block; margin-right: 4px; margin-bottom: 4px; }
  .warning-box { background: ${C.danger}15; color: ${C.danger}; padding: 8px; border-radius: 6px; font-size: 11px; margin-bottom: 10px; border: 1px solid ${C.danger}30; }

  /* Departure rows */
  .dep-list { display: flex; flex-direction: column; gap: 0; margin-top: 8px; }
  .dep-header { display: grid; grid-template-columns: 52px 1fr repeat(var(--ncols, 1), 48px); gap: 0 6px; padding: 4px 8px; margin-bottom: 2px; }
  .dep-header span { font-size: 9px; color: ${C.text3}; text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em; }
  .dep-header span.right { text-align: right; }
  .dep-row { cursor:pointer; display: grid; grid-template-columns: 52px 1fr repeat(var(--ncols, 1), 48px); gap: 0 6px; align-items: center; padding: 9px 8px; border-top: 1px solid ${C.borderSoft}; }
  .dep-row:last-child { border-bottom: 1px solid ${C.borderSoft}; }
  .dep-service a { display: inline-block; background: ${C.accentL}; color: ${C.accent}; font-weight: 700; font-size: 11px; padding: 3px 6px; border-radius: 4px; border: 1px solid ${C.accentB}; text-decoration: none; white-space: nowrap; }
  .dep-dest { font-size: 12px; color: ${C.text1}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .dep-time { font-size: 12px; text-align: right; white-space: nowrap; }
  .dep-plat { text-align: right; }
  .dep-plat span { background: ${C.surface3}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${C.border}; font-size: 11px; color: ${C.text2}; display: inline-block; }
  .dep-status-row { padding: 2px 8px 7px; border-top: none; }
  .dep-status-badge { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 10px; font-weight: 500; }
  .dep-pass .dep-service a, .dep-pass .dep-dest, .dep-pass .dep-time, .dep-pass .dep-plat { opacity: 0.45; }
  .dep-rar .dep-service a, .dep-rar .dep-dest, .dep-rar .dep-time, .dep-rar .dep-plat { opacity: 0.45; }

  .dep-time-controls {
    margin-bottom: 14px;
  }
    .dep-datetime-input-native {
    background: ${C.surface};
    color: ${C.text1};
    border: 1px solid ${C.border};
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    font-family: inherit;
    outline: none;
    width: 100%;
  }
  .dep-datetime-input-native:focus {
    border-color: ${C.accent};
    box-shadow: 0 0 0 2px ${C.accentB};
  }
  .dep-time-control-label { font-size: 9px; color: ${C.text3}; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.04em; }
  .dep-datetime-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.62fr) auto; gap: 6px; align-items: center; }
  .dep-datetime-input {
    min-width: 0;
    background: ${C.surface};
    color: ${C.text1};
    border: 1px solid ${C.border};
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.15;
    font-family: inherit;
    outline: none;
    letter-spacing: 0.02em;
  }
  .dep-datetime-input:focus {
    border-color: ${C.accent};
    box-shadow: 0 0 0 2px ${C.accentB};
  }
  .dep-datetime-input::placeholder { color: ${C.text3}; opacity: 1; }
  .dep-datetime-button {
    min-width: 78px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid ${C.border};
    background: ${C.surface};
    color: ${C.text2};
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .dep-datetime-button.active {
    background: ${C.accent};
    color: ${C.bg};
    border-color: ${C.accent};
  }

  /* Flip Animation */
  .row-anim { animation: flipIn 0.5s ease-out forwards; }
  @keyframes flipIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
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

function formatLocalDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatLocalDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatLocalTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDisplayDate(dateValue: string): string | null {
  const match = dateValue.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function buildCustomDateTimeISO(dateValue: string, timeValue: string): string {
  const parsedDate = parseDisplayDate(dateValue) || dateValue.trim();
  const parsed = new Date(`${parsedDate}T${timeValue}:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// ─── HTML builders ────────────────────────────────────────────────────────────
function buildShell(stopName: string, stopId: string, typeName: string, codes: string[], bodyHTML: string, headerExtraHTML: string = ""): string {
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

function buildDeparturesContent(data: any, state: { offset: number; timeMode?: string; customDateTime?: string; customDate?: string; customTime?: string }, popupId: string, stopId: string): string {
  const { departures, metadata } = data;
  const showExpected = !!metadata?.contains_expected_times;
  const showPlatform = !!metadata?.contains_platform_numbers;
  const offsetMin = state.offset;
  const customDateTimeBase = state.customDateTime ? new Date(state.customDateTime) : new Date();
  const customDate = state.customDate || formatLocalDateInput(customDateTimeBase);
  const customTime = state.customTime || formatLocalTimeInput(customDateTimeBase);
  const isCustomTimeMode = state.timeMode === "datetime";

  const ncols = (showExpected ? 2 : 1) + (showPlatform ? 1 : 0);

  let retryIn = null;

  const fmtStatus = (raw: string): { label: string; color: string; bg: string; border: string } => {
    const label = raw.split(/[_\s]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    const key = raw.toUpperCase();
    if (key === "AT_PLATFORM" || key === "AT PLATFORM")
      return { label, color: C.text2, bg: C.surface2, border: C.borderSoft };
    if (key === "APPROACHING")
      return { label, color: C.text3, bg: C.surface2, border: C.borderSoft };
    return { label, color: C.text3, bg: C.surface2, border: C.borderSoft };
  };

  const headerCols = [
    `<span>Service</span>`,
    `<span>Destination</span>`,
    `<span class="right">Sched.</span>`,
    ...(showExpected ? [`<span class="right">Exp.</span>`] : []),
    ...(showPlatform ? [`<span class="right">Plat.</span>`] : []),
  ].join("");

  const rows = departures.length === 0
    ? `<div style="padding:24px 8px;text-align:center;color:${C.text3};font-size:12px;">No departures found.</div>`
    : departures.map((d: any) => {
        const sched = fmt(d.scheduled_departure);
        const exp = fmt(d.expected_departure);
        const isCancelled = d.is_cancelled;
        const isPass = d.displayAs === "PASS";

        const schedStyle = isCancelled
          ? `text-decoration:line-through; color:${C.danger};`
          : `color:${C.text1};`;
        const expStyle = d.expected_departure && d.expected_departure !== d.scheduled_departure
          ? `color:${C.warn}; font-weight:600;`
          : `color:${C.text2};`;

        const isRar = d.rar === true && !d.scheduled_departure && !d.expected_departure;

        const mainRow = `<div class="dep-row${isPass || isRar ? " dep-pass" : ""}" style="--ncols:${ncols};">
          <div class="dep-service"><a href="${d.service_link}" target="_blank" rel="noopener noreferrer">${d.service || "?"}</a></div>
          <div onclick="window.location.href='${d.log_link}'" class="dep-dest" title="${d.destination || ""}">${d.destination || "Unknown"}</div>
          <div onclick="window.location.href='${d.log_link}'" class="dep-time" style="${schedStyle}">${sched}</div>
          ${showExpected ? `<div onclick="window.location.href='${d.log_link}'" class="dep-time" style="${expStyle}">${isCancelled ? "–" : d.expected_departure ? exp : sched}</div>` : ""}
          ${showPlatform ? `<div onclick="window.location.href='${d.log_link}'"   class="dep-plat"><span>${d.platform || "–"}</span></div>` : ""}
        </div>`;

        const badges: string[] = [];
        if (isRar) {
          badges.push(`<span class="dep-status-badge" style="background:${C.surface2};color:${C.text3};border:1px solid ${C.borderSoft};">Runs as Required</span>`);
        }
        if (d.displayAs && d.displayAs !== "CALL") {
          const displayMap: Record<string, { label: string; color: string; bg: string; border: string }> = {
            PASS:      { label: "Passing",   color: C.text3,   bg: C.surface2,       border: C.borderSoft      },
            CANCELLED: { label: "Cancelled", color: C.danger,  bg: `${C.danger}15`,  border: `${C.danger}30`   },
            DIVERTED:  { label: "Diverted",  color: C.warn,    bg: `${C.warn}15`,    border: `${C.warn}30`     },
          };
          const b = displayMap[d.displayAs] ?? { label: d.displayAs.charAt(0) + d.displayAs.slice(1).toLowerCase(), color: C.text3, bg: C.surface2, border: C.borderSoft };
          badges.push(`<span class="dep-status-badge" style="background:${b.bg};color:${b.color};border:1px solid ${b.border};">${b.label}</span>`);
        }
        if (d.status) {
          const s = fmtStatus(d.status);
          badges.push(`<span class="dep-status-badge" style="background:${s.bg};color:${s.color};border:1px solid ${s.border};">${s.label}</span>`);
        }

        if (d.vehicle_info.type && d.vehicle_info.carrages) {
          badges.push(`<span class="dep-status-badge" style="background:${C.surface2};color:${C.text2};border:1px solid ${C.borderSoft};">${d.vehicle_info.type}</span>`);
          badges.push(`<span class="dep-status-badge" style="background:${C.surface2};color:${C.text2};border:1px solid ${C.borderSoft};">${d.vehicle_info.carrages} carriages</span>`);
        } else if (d.vehicle_info.carrages) {
          badges.push(`<span class="dep-status-badge" style="background:${C.surface2};color:${C.text2};border:1px solid ${C.borderSoft};">${d.vehicle_info.carrages} carriages</span>`);
        }

        const statusRow = badges.length
          ? `<div class="dep-status-row" style="display:flex;gap:4px;flex-wrap:wrap;">${badges.join("")}</div>`
          : "";

        return mainRow + statusRow;
      }).join("");

  const offsetBtns = [-60, -30, -15, 0, 15, 30, 60].map((o) => {
    const active = !isCustomTimeMode && o === offsetMin;
    return `<button data-offset="${o}" data-popup="${popupId}" style="flex:1;padding:5px 0;border-radius:6px;font-size:11px;cursor:pointer;border:1px solid ${active ? C.accent : C.border};background:${active ? C.accent : C.surface2};color:${active ? C.bg : C.text2};">${o === 0 ? "LIVE" : o > 0 ? `+${o}m` : `${o}m`}</button>`;
  }).join("");

  const dateInputStyle = `min-width:0;flex:1;background:${C.surface2};color:${C.text1};border:1px solid ${C.border};border-radius:6px;padding:5px 8px;font-size:11px;line-height:1.4;font-family:inherit;outline:none;text-align:center;letter-spacing:0.02em;`;
  const timeInputStyle = `min-width:0;flex:0.55;background:${C.surface2};color:${C.text1};border:1px solid ${C.border};border-radius:6px;padding:5px 8px;font-size:11px;line-height:1.4;font-family:inherit;outline:none;text-align:center;letter-spacing:0.02em;`;
  const applyButtonStyle = `min-width:72px;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${isCustomTimeMode ? C.accent : C.border};background:${isCustomTimeMode ? C.accent : C.surface2};color:${isCustomTimeMode ? C.bg : C.text2};transition:background 0.15s ease,border-color 0.15s ease;`;

  const showPass = !!data.metadata?._showPass;

  return `
    <div class="dep-time-controls">
      <div style="font-size:9px;color:${C.text3};text-transform:uppercase;margin-bottom:6px;">Time offset</div>
      <div style="display:flex;gap:4px;">${offsetBtns}</div>
    </div>
    <div style="margin-bottom:14px;">
      <div style="margin-bottom:14px;">
        <div style="font-size:9px;color:${C.text3};text-transform:uppercase;margin-bottom:6px;letter-spacing:0.04em;">Custom date & time</div>
        <div style="display:grid;grid-template-columns: 1fr auto;gap:6px;align-items:center;">
          <input type="datetime-local" id="ts-dt-picker" value="${state.customDateTime}" class="dep-datetime-input-native" />
          <button id="ts-dt-apply" class="dep-datetime-button">Apply</button>
        </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:8px;gap:6px;">
      <span style="font-size:10px;color:${C.text3};">Show passing</span>
      <button data-pass-toggle="1" style="position:relative;width:32px;height:18px;border-radius:9px;border:1px solid ${showPass ? C.accent : C.border};background:${showPass ? C.accentB : C.surface2};cursor:pointer;padding:0;transition:background 0.2s;">
        <span style="position:absolute;top:2px;left:${showPass ? "14px" : "2px"};width:12px;height:12px;border-radius:50%;background:${showPass ? C.accent : C.text3};transition:left 0.2s;display:block;"></span>
      </button>
    </div>
    <div class="dep-header" style="--ncols:${ncols};">${headerCols}</div>
    <div class="dep-list" id="ts-dep-list">${rows}</div>
    <div style="margin-top:10px;">
      <small style="color:${C.text3};display:block;">${data.attributions.map((a: string) => `<div>${a}</div>`).join("")}</small>
      <small id="ts-refresh-indicator" style="color:${C.text3};display:block;margin-top:4px;">Refreshed 0 seconds ago</small>
    </div>
  `;
}

// ─── Departure Panel Hook ────────────────────────────────────────────────────────
export function useDeparturePanel() {
  const activeState = useRef<{ id: string; error?: boolean; [key: string]: any } | null>(null);
  const lastUpdatedRef = useRef<number>(0);
  const lastDataRef = useRef<string | null>(null);

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

  async function fetchAndRender(state: any, offsetMin: number, isSilentRefresh: boolean = false) {
    const { stop, typeName, codes, mode, id } = state;
    // Set error to false on start of new fetch
    activeState.current = { ...state, offset: offsetMin, timeMode: state.timeMode ?? "offset", error: false }; 

    if (!isSilentRefresh) {
      setPanelHTML(buildLoadingPopup(stop.commonName, stop._id, typeName, codes));
      lastDataRef.current = null;
    }

    try {
      const targetISO = state.timeMode === "datetime"
        ? (() => {
            const customDate = state.customDate || formatLocalDateInput(new Date());
            const customTime = state.customTime || formatLocalTimeInput(new Date());
            return buildCustomDateTimeISO(customDate, customTime);
          })()
        : offsetMin !== 0 ? offsetISO(new Date(), offsetMin) : undefined;
      const code = mode === "train" ? stop.crsCode || stop.tiplocCode : stop.atcoCode;

      const showPass = activeState.current?.showPass ?? false;
      const params = new URLSearchParams({ code, type: mode });
      if (targetISO) params.set("datetime", targetISO);
      if (showPass) params.set("pass", "show");
      const url = `/api/departures?${params.toString()}`;

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

      if (data.metadata) data.metadata._showPass = activeState.current?.showPass ?? false;
        const contentHTML = buildDeparturesContent(data, activeState.current as any, id, stop._id);
        const headerExtraHTML = buildHeaderExtra(data.metadata);

        const contentDiv = document.getElementById("ts-stop-panel-content");
        const extraDiv = document.getElementById("ts-stop-panel-header-extra");

        if (isSilentRefresh && contentDiv && extraDiv) {
          contentDiv.innerHTML = contentHTML;
          extraDiv.innerHTML = headerExtraHTML;

          const rows = document.querySelectorAll('#ts-dep-list .dep-row');
          rows.forEach((row, index) => {
              (row as HTMLElement).classList.add('row-anim');
              (row as HTMLElement).style.animationDelay = `${index * 0.05}s`;
          });
        } else {
          const displayName = data.metadata?.long_name || data.metadata?.name || stop.commonName;
          setPanelHTML(buildShell(displayName, stop._id, typeName, codes, contentHTML, headerExtraHTML));
        }

        const attachOffsetListeners = () => {
          document.querySelectorAll("button[data-offset]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (!activeState.current) return;
              const nextOffset = parseInt(btn.getAttribute("data-offset") || "0");
              activeState.current = {
                ...activeState.current,
                offset: nextOffset,
                timeMode: "offset",
              };
              fetchAndRender(activeState.current, nextOffset, false);
            });
          });
        };

        const attachDateTimeListeners = () => {
          const applyBtn = document.getElementById("ts-dt-apply");

          if (applyBtn) {
            applyBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              
              // Get the input element by ID
              const dtPicker = document.getElementById("ts-dt-picker") as HTMLInputElement | null;
              
              if (dtPicker && activeState.current) {
                const val = dtPicker.value; // Format is YYYY-MM-DDThh:mm
                
                // Split the native datetime-local value back into date/time for your parser
                const [datePart, timePart] = val.split("T");
                
                // Convert YYYY-MM-DD to DD/MM/YYYY for your parseDisplayDate helper
                const [yyyy, mm, dd] = datePart.split("-");
                const formattedDate = `${dd}/${mm}/${yyyy}`;

                activeState.current = {
                  ...activeState.current,
                  customDate: formattedDate,
                  customTime: timePart,
                  customDateTime: val,
                  timeMode: "datetime",
                };
                
                fetchAndRender(activeState.current, activeState.current.offset ?? 0, false);
              }
            });
          }
        };

      attachOffsetListeners();
      attachDateTimeListeners();

      document.querySelector("button[data-pass-toggle]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = !(activeState.current?.showPass ?? false);
        activeState.current = { ...activeState.current!, showPass: next };
        lastDataRef.current = null; // force re-render even if data is same
        fetchAndRender(activeState.current, activeState.current.offset ?? 0, true);
      });
    } catch {
      const _curr = activeState.current as any;
      if (_curr?.id === id) {
        _curr.error = true;
        setPanelHTML(buildErrorPopup(stop.commonName, stop._id, typeName, codes, "Failed to load departures. Retrying in 5 seconds..."));
        setTimeout(() => {
          if (activeState.current?.id === id) {
            fetchAndRender(activeState.current, _curr.offset ?? 0, false);
          }
        }, 5 * 1000); 
      }
      
    }
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

  // Panel CSS injection
  useEffect(() => {
    const styleId = "ts-stop-panel-css";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }, []);

  const openPanel = (stop: any, typeObj: any, mode: string, codes: string[], id: string) => {
    activeState.current = {
      stop,
      typeName: typeObj?.name || "",
      codes,
      mode,
      id,
      offset: 0,
      timeMode: "offset",
      customDate: formatLocalDateInput(new Date()),
      customTime: formatLocalTimeInput(new Date()),
      customDateTime: formatLocalDateTimeInput(new Date()),
      error: false
    };
    fetchAndRender(activeState.current, 0, false);
  };

  return { openPanel };
}