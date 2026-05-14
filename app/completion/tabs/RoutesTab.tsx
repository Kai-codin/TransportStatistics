"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleDashed, MapPinned } from "lucide-react";
import type { RouteInfo, TabProps } from "../types";
import { RouteRow } from "./RouteRow";

export function RoutesTab({ operatorCode }: Pick<TabProps, "operatorCode">) {
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!operatorCode || routes.length > 0) return;

    setIsLoading(true);
    fetch(`/api/routes?code=${encodeURIComponent(operatorCode)}`)
      .then((res) => res.json())
      .then((data) => {
        setRoutes(Array.isArray(data) ? data : []);
      })
      .finally(() => setIsLoading(false));
  }, [operatorCode, routes.length]);

  useEffect(() => {
    setRoutes([]);
    setShowWithdrawn(false);
  }, [operatorCode]);

  const displayedRoutes = useMemo(
    () => routes.filter((route) => showWithdrawn || !route.withdrawn),
    [routes, showWithdrawn]
  );

  const stats = useMemo(() => {
    const total = displayedRoutes.length;
    const ridden = displayedRoutes.filter((route) => route.ridden).length;
    const unridden = total - ridden;
    const withdrawnCount = displayedRoutes.filter((route) => route.withdrawn).length;
    const pct = total > 0 ? Math.round((ridden / total) * 100) : 0;

    return { total, ridden, unridden, withdrawnCount, pct };
  }, [displayedRoutes]);

  const withdrawnTotal = routes.filter((route) => route.withdrawn).length;

  return (
    <div className="space-y-5">
      {!isLoading && routes.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Showing", value: stats.total },
            { label: "Ridden", value: stats.ridden },
            { label: "Unridden", value: stats.unridden },
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

      {!isLoading && routes.length > 0 && (
        <div className="bg-[var(--color-ts-surface)] border border-white/[0.06] rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[10px] font-bold text-[var(--color-ts-text-3)] uppercase tracking-[0.18em]">
              {showWithdrawn ? "All Routes Completion" : "Active Routes Completion"}
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

      <div className="flex items-center justify-between gap-3">
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

        <span className="text-[10px] font-bold text-[var(--color-ts-text-3)] uppercase tracking-widest flex items-center gap-2">
          <MapPinned size={12} />
          {displayedRoutes.length} routes
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {isLoading ? (
          Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-2xl bg-[var(--color-ts-surface)] animate-pulse"
              style={{ opacity: 1 - i * 0.08 }}
            />
          ))
        ) : displayedRoutes.length === 0 ? (
          <div className="py-24 text-center">
            <CircleDashed size={22} className="mx-auto text-[var(--color-ts-text-3)] opacity-60 mb-3" />
            <p className="text-[var(--color-ts-text-3)] text-sm font-medium">No routes found</p>
          </div>
        ) : (
          displayedRoutes.map((route) => (
            <RouteRow key={route["bt-id"] ?? route.bustimes_id ?? route.service_number} route={route} />
          ))
        )}
      </div>
    </div>
  );
}