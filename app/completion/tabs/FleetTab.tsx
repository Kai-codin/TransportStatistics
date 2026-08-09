"use client";

import { useState, useEffect, useMemo } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { TabProps, Vehicle } from "../types";
import { FleetRow } from "./FleetRow";
import { FleetCard } from "./FleetGrid";

type ViewMode = "row" | "grid";

const VIEW_MODE_STORAGE_KEY = "fleet-view-mode";

function getStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "row";
  const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  return stored === "grid" || stored === "row" ? stored : "row";
}

export function FleetTab({ operatorCode }: Pick<TabProps, "operatorCode">) {
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("row");
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(operatorCode));

  // Load persisted view mode on mount (client only, avoids SSR hydration mismatch)
  useEffect(() => {
    setViewMode(getStoredViewMode());
  }, []);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  };

  useEffect(() => {
    if (!operatorCode || fleet.length > 0) return;
    fetch(`/api/vehicles?code=${operatorCode}`)
      .then((res) => res.json())
      .then((data) => {
        setFleet(Array.isArray(data) ? data : []);
      })
      .finally(() => setIsLoading(false));
  }, [operatorCode, fleet.length]);

  const displayedFleet = useMemo(
    () => fleet.filter((v) => showWithdrawn || !v.withdrawn),
    [fleet, showWithdrawn]
  );

  const groupedByType = useMemo(() => {
    const groups = new Map<string, Vehicle[]>();
    for (const vehicle of displayedFleet) {
      const type = vehicle.vehicle_type?.trim() || "Unknown type";
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push(vehicle);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [displayedFleet]);

  const stats = useMemo(() => {
    const total = displayedFleet.length;
    const ridden = displayedFleet.filter(v => v.ridden).length;
    const unridden = total - ridden;
    const pct = total > 0 ? Math.round((ridden / total) * 100) : 0;
    return { total, ridden, unridden, pct };
  }, [displayedFleet]);

  const withdrawnTotal = fleet.filter((v) => v.withdrawn).length;

  return (
    <div className="space-y-3 sm:space-y-5">

      {/* ── Summary cards ── */}
      {!isLoading && fleet.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {[
            { label: "Showing",   value: stats.total },
            { label: "Ridden",    value: stats.ridden },
            { label: "Unridden",  value: stats.unridden },
            { label: "W/drawn",   value: withdrawnTotal },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-[var(--color-ts-surface)] border border-white/[0.06] rounded-xl sm:rounded-2xl px-3 sm:px-5 py-3 sm:py-4"
            >
              <p className="text-[9px] sm:text-[10px] font-bold text-[var(--color-ts-text-3)] tracking-[0.15em] sm:tracking-[0.18em] mb-1 truncate">
                {label}
              </p>
              <p className="text-xl sm:text-2xl font-black text-[var(--color-ts-text-1)] tabular-nums leading-none">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Completion bar ── */}
      {!isLoading && fleet.length > 0 && (
        <div className="bg-[var(--color-ts-surface)] border border-white/[0.06] rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] sm:text-[10px] font-bold text-[var(--color-ts-text-3)] tracking-[0.15em] sm:tracking-[0.18em]">
              {showWithdrawn ? "Total Completion" : "Active Completion"}
            </p>
            <p className="text-[11px] font-black text-[var(--color-ts-text-2)] tabular-nums">
              {stats.ridden} / {stats.total}
              <span className="text-[var(--color-ts-text-3)] ml-1.5">{stats.pct}%</span>
            </p>
          </div>
          <div className="h-[5px] w-full bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-ts-accent)] rounded-full transition-all duration-700 ease-in-out"
              style={{ width: `${stats.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWithdrawn(!showWithdrawn)}
            className={`px-3 sm:px-4 py-1.5 rounded-full text-[10px] font-bold tracking-widest border transition-all ${
              showWithdrawn
                ? "bg-[var(--color-ts-surface-3)] border-[var(--color-ts-accent-border)] text-[var(--color-ts-accent)]"
                : "bg-[var(--color-ts-surface)] border-[var(--color-ts-border-soft)] text-[var(--color-ts-text-3)] hover:text-[var(--color-ts-text-2)]"
            }`}
          >
            {showWithdrawn ? "Hide withdrawn" : "Show withdrawn"}
          </button>

          {/* View mode toggle */}
          <div className="flex items-center rounded-full border border-[var(--color-ts-border-soft)] bg-[var(--color-ts-surface)] p-0.5">
            <button
              onClick={() => handleSetViewMode("row")}
              aria-label="Row view"
              className={`flex items-center justify-center p-1.5 rounded-full transition-all ${
                viewMode === "row"
                  ? "bg-[var(--color-ts-surface-3)] text-[var(--color-ts-accent)]"
                  : "text-[var(--color-ts-text-3)] hover:text-[var(--color-ts-text-2)]"
              }`}
            >
              <Rows3 size={13} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => handleSetViewMode("grid")}
              aria-label="Grid view"
              className={`flex items-center justify-center p-1.5 rounded-full transition-all ${
                viewMode === "grid"
                  ? "bg-[var(--color-ts-surface-3)] text-[var(--color-ts-accent)]"
                  : "text-[var(--color-ts-text-3)] hover:text-[var(--color-ts-text-2)]"
              }`}
            >
              <LayoutGrid size={13} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <span className="text-[10px] font-bold text-[var(--color-ts-text-3)] tracking-widest">
          {displayedFleet.length} vehicles
        </span>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        viewMode === "row" ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-12 sm:h-14 rounded-2xl bg-[var(--color-ts-surface)] animate-pulse"
                style={{ opacity: 1 - i * 0.08 }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2 px-1">
              <div className="h-3 w-24 rounded bg-[var(--color-ts-surface)] animate-pulse" />
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[210px] rounded-2xl bg-[var(--color-ts-surface)] animate-pulse"
                  style={{ opacity: 1 - i * 0.06 }}
                />
              ))}
            </div>
          </div>
        )
      ) : viewMode === "row" ? (
        <div className="flex flex-col gap-1.5">
          {displayedFleet.map((vehicle) => (
            <FleetRow
              key={vehicle["bt-id"] ?? vehicle.bustimes_id}
              vehicle={vehicle}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groupedByType.map(([type, vehicles]) => (
            <div key={type} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-[11px] font-black tracking-[0.18em] text-[var(--color-ts-text-2)]">
                  {type}
                </h3>
                <span className="text-[10px] font-bold text-[var(--color-ts-text-3)] tabular-nums">
                  {vehicles.length}
                </span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {vehicles.map((vehicle) => (
                  <FleetCard
                    key={vehicle["bt-id"] ?? vehicle.bustimes_id}
                    vehicle={vehicle}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}