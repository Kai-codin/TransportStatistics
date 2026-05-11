"use client";

import type { TabProps } from "../types";

export function OverviewTab({ operatorSlug, stats }: Pick<TabProps, "operatorSlug" | "stats">) {
  const totalMinutes = stats?.totalMinutes ?? 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const cards = [
    {
      label: "Total trips",
      value: stats?.totalTrips ?? 0,
    },
    {
      label: "Distance traveled",
      value: `${(stats?.totalDistanceKm ?? 0).toLocaleString()} km`,
    },
    {
      label: "Time spent",
      value: `${hours}h ${String(minutes).padStart(2, "0")}m`,
    },
    {
      label: "Unique routes",
      value: stats?.uniqueRoutes ?? 0,
    },
    {
      label: "Unique vehicles",
      value: stats?.uniqueVehiclesRidden ?? 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-[var(--color-ts-border-soft)] bg-[var(--color-ts-surface)] p-5 shadow-sm"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ts-text-3)]">
              {card.label}
            </p>
            <p className="mt-3 text-3xl font-black leading-none text-[var(--color-ts-text-1)] tabular-nums">
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}