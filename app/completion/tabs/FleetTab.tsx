"use client";

import { useState, useEffect, useMemo } from "react";
import type { TabProps, Vehicle } from "../types";
import { FleetRow } from "./FleetRow";

export function FleetTab({ operatorCode }: Pick<TabProps, "operatorCode">) {
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!operatorCode || fleet.length > 0) return;
    setIsLoading(true);
    fetch(`/api/vehicles?code=${operatorCode}`)
      .then((res) => res.json())
      .then((data) => {
        const sorted = (Array.isArray(data) ? data : []).sort((a: Vehicle, b: Vehicle) => {
          const aNum = parseInt(a.unit_number, 10);
          const bNum = parseInt(b.unit_number, 10);
          return !isNaN(aNum) && !isNaN(bNum)
            ? aNum - bNum
            : a.unit_number.localeCompare(b.unit_number);
        });
        setFleet(sorted);
      })
      .finally(() => setIsLoading(false));
  }, [operatorCode, fleet.length]);

  // 1. Calculate what is actually visible to the user
  const displayedFleet = useMemo(
    () => fleet.filter((v) => showWithdrawn || !v.withdrawn),
    [fleet, showWithdrawn]
  );

  // 2. Calculate stats based on the DISPLAYED fleet
  const stats = useMemo(() => {
    const total = displayedFleet.length;
    const ridden = displayedFleet.filter(v => v.ridden).length;
    const unridden = total - ridden;
    const withdrawnCount = displayedFleet.filter(v => v.withdrawn).length;
    
    const pct = total > 0 ? Math.round((ridden / total) * 100) : 0;

    return { total, ridden, unridden, withdrawnCount, pct };
  }, [displayedFleet]);

  // Static counts for the summary cards (optional: if you want the cards to stay static, keep these)
  const withdrawnTotal = fleet.filter((v) => v.withdrawn).length;
  const activeTotal = fleet.filter((v) => !v.withdrawn).length;

  return (
    <div className="space-y-5">
      {/* ── Summary cards ── */}
      {!isLoading && fleet.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Showing",   value: stats.total },
            { label: "Ridden",    value: stats.ridden },
            { label: "Unridden",  value: stats.unridden },
            { label: "Withdrawn", value: withdrawnTotal },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-[var(--color-ts-surface)] border border-white/[0.06] rounded-2xl px-5 py-4"
            >
              <p className="text-[10px] font-bold text-[var(--color-ts-text-3)] uppercase tracking-[0.18em] mb-1">
                {label}
              </p>
              <p className="text-2xl font-black text-[var(--color-ts-text-1)] tabular-nums leading-none">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Completion bar ── */}
      {!isLoading && fleet.length > 0 && (
        <div className="bg-[var(--color-ts-surface)] border border-white/[0.06] rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[10px] font-bold text-[var(--color-ts-text-3)] uppercase tracking-[0.18em]">
              {showWithdrawn ? "Total Fleet Completion" : "Active Fleet Completion"}
            </p>
            <p className="text-[11px] font-black text-[var(--color-ts-text-2)] tabular-nums">
              {stats.ridden} / {stats.total}
              <span className="text-[var(--color-ts-text-3)] ml-2">{stats.pct}%</span>
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
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowWithdrawn(!showWithdrawn)}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
            showWithdrawn
              ? "bg-[var(--color-ts-surface-3)] border-[var(--color-ts-accent-border)] text-[var(--color-ts-accent)]"
              : "bg-[var(--color-ts-surface)] border-[var(--color-ts-border-soft)] text-[var(--color-ts-text-3)] hover:text-[var(--color-ts-text-2)]"
          }`}
        >
          {showWithdrawn ? "Hide withdrawn" : "Show withdrawn"}
        </button>

        <span className="text-[10px] font-bold text-[var(--color-ts-text-3)] uppercase tracking-widest">
          {displayedFleet.length} vehicles
        </span>
      </div>

      {/* ── List ── */}
      <div className="flex flex-col gap-1.5">
        {isLoading ? (
          Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-2xl bg-[var(--color-ts-surface)] animate-pulse"
              style={{ opacity: 1 - i * 0.08 }}
            />
          ))
        ) : (
          displayedFleet.map((vehicle) => (
            <FleetRow
              key={vehicle["bt-id"] ?? vehicle.bustimes_id}
              vehicle={vehicle}
            />
          ))
        )}
      </div>
    </div>
  );
}