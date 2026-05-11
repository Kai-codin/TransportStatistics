"use client";

import type { TabProps } from "../types";

export function OverviewTab({ operatorSlug, stats }: Pick<TabProps, "operatorSlug" | "stats">) {
  const pct =
    stats && stats.totalVehicles > 0
      ? Math.round((stats.uniqueVehiclesRidden / stats.totalVehicles) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="bg-ts-surface border border-ts-border rounded-xl p-6">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-[10px] font-bold text-ts-text-3 uppercase tracking-widest mb-1">
              Fleet Completion
            </p>
            <p className="text-3xl font-black text-ts-text-1 leading-none">
              {pct}
              <span className="text-lg text-ts-text-3 font-bold">%</span>
            </p>
          </div>
          <p className="text-sm text-ts-text-3 font-medium pb-1">
            {stats?.uniqueVehiclesRidden ?? 0} / {stats?.totalVehicles ?? 0} vehicles
          </p>
        </div>
        <div className="h-2 w-full bg-ts-surface-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-ts-accent rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="py-12 text-center text-ts-text-3 text-sm">
        More overview stats coming soon
      </div>
    </div>
  );
}