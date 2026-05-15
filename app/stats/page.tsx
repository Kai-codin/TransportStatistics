"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { LoaderCircle, Info } from "lucide-react";

// --- Sub-components ---

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-ts-text-3">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold text-ts-text-1">{value}</div>
      {sub && <div className="mt-1 text-xs text-ts-text-3">{sub}</div>}
    </div>
  );
}

function ContributionHeatmap({
  dailyCounts,
  year,
  firstTripDate,
}: {
  dailyCounts: Record<string, number>;
  year?: number;
  firstTripDate?: string | null;
}) {
  const { columns, monthLabels } = useMemo(() => {
    let startDate: Date;
    let endDate: Date = new Date();

    if (year) {
      // Start exactly on Jan 1st, End Dec 31st
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    } else {
      startDate = firstTripDate ? parseDateKey(firstTripDate) : new Date();
      const eighteenMonthsAgo = new Date();
      eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
      if (startDate < eighteenMonthsAgo) startDate = eighteenMonthsAgo;
    }

    // Snap to the nearest preceding Monday
    const tempDate = new Date(startDate);
    const day = tempDate.getDay();
    const diff = tempDate.getDate() - day + (day === 0 ? -6 : 1);
    tempDate.setDate(diff);

    const cols: { date: string; count: number }[][] = [];
    const labels: { label: string; colIndex: number }[] = [];

    let lastMonth = -1;
    let colIdx = 0;

    // Process weeks until we pass the end date
    while (tempDate <= endDate) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const currentMonth = tempDate.getMonth();
        const currentYear = tempDate.getFullYear();

        // Register month label exactly when the month changes
        if (currentMonth !== lastMonth) {
          // If filtering by a specific year, NEVER label a month from outside that year
          if (!year || currentYear === year) {
            labels.push({
              label: tempDate.toLocaleString("default", { month: "short" }),
              colIndex: colIdx,
            });
          }
          lastMonth = currentMonth;
        }

        const key = `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, "0")}-${String(tempDate.getDate()).padStart(2, "0")}`;

        // If a specific year is chosen, out-of-bounds days get a count of -1 (hidden)
        const inTargetYear = !year || currentYear === year;

        week.push({
          date: key,
          count: inTargetYear ? dailyCounts[key] || 0 : -1,
        });

        tempDate.setDate(tempDate.getDate() + 1);
      }
      cols.push(week);
      colIdx++;
    }

    return { columns: cols, monthLabels: labels };
  }, [year, dailyCounts, firstTripDate]);

  const getColor = (count: number) => {
    if (count === -1) return "opacity-0 pointer-events-none"; // Fully hide out-of-year ghost days
    if (count === 0) return "bg-white/[0.03] border border-white/[0.05]";
    if (count === 1) return "bg-[#00441b]";
    if (count === 2) return "bg-[#006d2c]";
    if (count <= 4) return "bg-[#238b45]";
    return "bg-[#41ab5d]";
  };

  return (
    <div className="w-full">
      {/* Wrapper to enforce scrolling on small screens but flex fully on desktop */}
      <div className="overflow-x-auto pb-4 scrollbar-hide">
        <div className="min-w-[768px] w-full flex gap-2 sm:gap-3">
          {/* Y-Axis Labels: Forced to 7 equal rows to perfectly match the grid */}
          <div className="flex flex-col text-[9px] font-bold uppercase text-ts-text-3 w-4 shrink-0 text-right pr-1 pt-6">
            {["M", "", "W", "", "F", "", "S"].map((label, i) => (
              <div key={i} className="flex-1 flex items-center justify-end">
                {label}
              </div>
            ))}
          </div>

          {/* Core Grid Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Month Header - positioned relative to the grid itself */}
            <div className="relative h-6 w-full text-[10px] text-ts-text-3">
              {monthLabels.map((m, i) => (
                <div
                  key={i}
                  className="absolute bottom-2 transition-all"
                  style={{ left: `${(m.colIndex / columns.length) * 100}%` }}
                >
                  {m.label}
                </div>
              ))}
            </div>

            {/* Perfect CSS Grid - automatically handles squares and responsiveness */}
            <div
              className="grid w-full gap-[3px] sm:gap-1"
              style={{
                gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(7, minmax(0, 1fr))`,
                gridAutoFlow: "column",
              }}
            >
              {columns.flatMap((week) =>
                week.map((day) => (
                  <div
                    key={day.date}
                    title={
                      day.count >= 0
                        ? `${day.date}: ${day.count} trips`
                        : undefined
                    }
                    className={`w-full aspect-square rounded-[2px] transition-colors ${getColor(day.count)}`}
                  />
                )),
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between pt-2 text-[10px] text-ts-text-3">
        <div className="flex items-center gap-2">
          <span>Less</span>
          <div className="flex gap-1">
            {[0, 1, 2, 5].map((lvl) => (
              <div
                key={lvl}
                className={`h-2.5 w-2.5 rounded-[2px] ${getColor(lvl)}`}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// --- Main Page ---

export default function StatsPage() {
  const { user } = useUser();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const [selectedYear, setSelectedYear] = useState<number | undefined>(
    new Date().getFullYear(),
  );
  const [weekOffset, setWeekOffset] = useState(0);

  // 1. Define stats FIRST so it is available for the hooks below
  const stats = useQuery(
    api.functions.stats.getUserStats,
    user?.id ? { user: user.id, year: selectedYear, timeZone } : "skip",
  );

  // 2. Now you can safely use stats.dailyCounts in useMemo
  const weeklyStats = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const targetDate = new Date();

    const currentDay = targetDate.getDay();
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    targetDate.setDate(targetDate.getDate() + diffToMonday + weekOffset * 7);

    const counts = days.map((day, index) => {
      const d = new Date(targetDate);
      d.setDate(targetDate.getDate() + index);

      // SAFE DATE KEY: Use local parts to avoid UTC shifting
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const date = String(d.getDate()).padStart(2, "0");
      const key = `${year}-${month}-${date}`; // Matches backend formatDate()

      return {
        day,
        count: stats?.dailyCounts?.[key] || 0,
        fullDate: d.toLocaleDateString("default", {
          month: "short",
          day: "numeric",
        }),
      };
    });

    const weekRangeLabel = `${counts[0].fullDate} - ${counts[6].fullDate}`;
    const maxInWeek = Math.max(...counts.map((d) => d.count), 1);

    return { counts, weekRangeLabel, maxInWeek };
  }, [stats?.dailyCounts, weekOffset]);

  if (!user)
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-ts-text-2">
        Sign in to see stats.
      </div>
    );
  if (stats === undefined)
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-3">
        <LoaderCircle className="h-4 w-4 animate-spin text-ts-accent" />
      </div>
    );
  if (stats === null)
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-ts-text-2">
        No trips logged yet.
      </div>
    );

  const totalHours = Math.floor(stats.totalMinutes / 60);
  const remainingMins = stats.totalMinutes % 60;
  const timeLabel =
    totalHours > 0 ? `${totalHours}h ${remainingMins}m` : `${remainingMins}m`;

  const maxOperatorCount = Math.max(
    ...stats.topOperators.map((o) => o.count),
    1,
  );
  const maxLiveryCount = Math.max(...stats.topLiveries.map((l) => l.count), 1);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ts-text-1">Your Stats</h1>
          <p className="mt-1 text-sm text-ts-text-3">
            Activity for {selectedYear || "All Time"}
          </p>
        </div>
        <select
          value={selectedYear ?? ""}
          onChange={(e) =>
            setSelectedYear(e.target.value ? Number(e.target.value) : undefined)
          }
          className="rounded-lg border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm font-medium text-ts-text-1 outline-none ring-ts-accent focus:ring-2"
        >
          <option value="">All Time</option>
          {stats.availableYears?.map((y: number) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {selectedYear && (
        <section className="rounded-[20px] border border-ts-border bg-ts-surface p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ts-text-1">
              Travel Contributions
            </h2>
            <span className="text-xs text-ts-text-3">
              {stats.totalTrips} trips logged
            </span>
          </div>
          <ContributionHeatmap
            dailyCounts={stats.dailyCounts ?? {}}
            year={selectedYear}
            firstTripDate={stats.firstTripDate}
          />
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total trips" value={stats.totalTrips} />
        <StatCard
          label="Distance"
          value={`${Math.round(stats.totalDistanceKm * 0.621)} mi`}
          sub={`≈ ${stats.totalDistanceKm.toLocaleString()} km`}
        />
        <StatCard label="Time travelling" value={timeLabel} />
        <StatCard label="Unique operators" value={stats.uniqueOperators} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard
          label="Punctuality"
          value={`${stats.onTimePercentage}%`}
          sub={`${stats.avgDelay}m avg delay`}
        />
        <StatCard
          label="Top Companion"
          value={stats.topCompanionName ?? "Solo"}
          sub={
            stats.topCompanionCount > 0
              ? `${stats.topCompanionCount} shared trips`
              : "Independent explorer"
          }
        />
        <StatCard
          label="Longest Streak"
          value={`${stats.maxStreak} days`}
          sub="Consecutive days travelling"
        />
      </div>

      {selectedYear && (
        //<section className="rounded-[20px] border border-ts-border bg-ts-surface p-6 shadow-sm">
        //  <div className="mb-8 flex items-center justify-between">
        //    <div>
        //      <h2 className="text-sm font-semibold text-ts-text-1">Weekly Activity</h2>
        //      <p className="text-[10px] font-medium text-ts-text-3 uppercase tracking-wider">{weeklyStats.weekRangeLabel}</p>
        //    </div>
        //
        //    <div className="flex items-center gap-2 bg-ts-surface-2 p-1 rounded-xl border border-ts-border">
        //      <button
        //        onClick={() => setWeekOffset(prev => prev - 1)}
        //        className="rounded-lg p-2 hover:bg-ts-surface-3 text-ts-text-2 transition-colors"
        //      >
        //        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        //      </button>
        //      <button
        //        onClick={() => setWeekOffset(0)}
        //        className="px-3 text-[11px] font-bold uppercase tracking-widest text-ts-text-1 hover:text-ts-accent transition-colors"
        //      >
        //        This Week
        //      </button>
        //      <button
        //        onClick={() => setWeekOffset(prev => prev + 1)}
        //        className="rounded-lg p-2 hover:bg-ts-surface-3 text-ts-text-2 transition-colors"
        //      >
        //        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        //      </button>
        //    </div>
        //  </div>

        //{/* The Container */}
        //  <div className="flex items-end justify-between gap-2 md:gap-4 h-48 px-2 border-b border-ts-border/50 pb-2">
        //    {weeklyStats.counts.map(({ day, count }) => {
        //      const heightPct = count > 0
        //        ? (count / weeklyStats.maxInWeek) * 100
        //        : 2;

        //      return (
        //        <div key={day} className="group relative flex flex-1 flex-col items-center h-full justify-end">
        //          <div className="absolute -top-10 left-1/2 -translate-x-1/2 scale-0 group-hover:scale-100 transition-transform duration-150 rounded bg-ts-text-1 px-2 py-1 text-[10px] font-bold text-ts-surface z-50 whitespace-nowrap pointer-events-none">
        //            {count} {count === 1 ? 'trip' : 'trips'}
        //          </div>
        //
        //          <div
        //            className="w-full max-w-[32px] rounded-t-sm transition-all duration-300"
        //            style={{
        //              height: `${heightPct}%`,
        //              backgroundColor: count > 0 ? 'var(--color-ts-accent)' : 'var(--color-ts-surface-2)',
        //              opacity: count > 0 ? 1 : 0.3
        //            }}
        //          />
        //
        //          <span className="absolute -bottom-7 text-[9px] font-bold text-ts-text-3 uppercase tracking-tighter">
        //            {day}
        //          </span>
        //        </div>
        //      );
        //    })}
        //  </div>
        //  <div className="h-8" />
        //</section>
        <div></div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-ts-text-1">
            Most ridden operators
          </h2>
          <div className="flex flex-col gap-3">
            {stats.topOperators.map(({ name, count }) => (
              <div key={name} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ts-text-1">{name}</span>
                  <span className="text-xs text-ts-text-3">{count} trips</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-ts-text-1">
            Trips by transport type
          </h2>
          <div className="flex flex-wrap gap-3">
            {stats.topTypes.map(({ name, count }) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded-full border border-ts-border bg-ts-surface-2 px-4 py-2 text-sm"
              >
                <span className="font-semibold text-ts-text-1">{name}</span>
                <span className="text-ts-text-3">{count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left: Most Ridden Unit Types */}
        <section className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ts-text-1">
              Most Ridden Unit Types
            </h2>
          </div>
          <div className="flex flex-col gap-4">
            {stats.topUnitTypes.map(({ name, count }) => {
              const maxUnitCount = Math.max(
                ...stats.topUnitTypes.map((u) => u.count),
                1,
              );
              return (
                <div key={name} className="flex flex-col gap-1.5">
                  <div className="h-8 flex items-center justify-between text-sm">
                    <span className="font-medium text-ts-text-1">{name}</span>
                    <span className="text-xs text-ts-text-3">
                      {count} trips
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Most Ridden Liveries */}
        <section className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ts-text-1">
              Most Ridden Liveries
            </h2>
          </div>
          <div className="flex flex-col gap-4">
            {stats.topLiveries.map(({ name, count, css }) => (
              <div key={name} className="flex items-center gap-4">
                <div
                  className="h-8 aspect-[24/16] shrink-0 border border-ts-border-soft shadow-sm"
                  style={{
                    background:
                      css || "linear-gradient(135deg, #34d064, #141e17)",
                  }}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between text-sm">
                    <span
                      className="truncate font-medium text-ts-text-1"
                      title={name}
                    >
                      {name}
                    </span>
                    <span className="text-xs text-ts-text-3">
                      {count} trips
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left: Most Ridden Routes */}
        {stats.topRoutes.length > 0 && (
          <section className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-ts-text-1">
              Most ridden routes
            </h2>
            <div className="flex flex-col gap-2">
              {stats.topRoutes.map(({ route, count }) => (
                <div
                  key={route}
                  className="flex items-center justify-between rounded-xl border border-ts-border bg-ts-surface-2 px-4 py-3 text-sm"
                >
                  <span className="text-ts-text-1 font-medium">{route}</span>
                  <span className="shrink-0 rounded-full bg-ts-accent/15 px-2.5 py-1 text-xs font-semibold text-ts-accent">
                    ×{count}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Right: Most Used Stops */}
        <section className="rounded-[20px] border border-ts-border bg-ts-surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-ts-text-1">
            Most used stops
          </h2>
          <div className="flex flex-col gap-2">
            {stats.topStops?.map(({ name, count }) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-xl border border-ts-border bg-ts-surface-2 px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-ts-text-1 font-medium truncate">{name}</span>
                </div>
                <span className="text-xs font-bold text-ts-text-3 tabular-nums">
                  {count} visits
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
