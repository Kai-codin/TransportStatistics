import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

async function getTripRoutes(ctx: QueryCtx, trip: Doc<"tripLogs">) {
  if (trip.full_route !== undefined || trip.ridden_route !== undefined) {
    return {
      full_route: trip.full_route,
      ridden_route: trip.ridden_route,
    };
  }

  const details = await ctx.db
    .query("tripRouteDetails")
    .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
    .first();

  return {
    full_route: details?.full_route ?? trip.full_route,
    ridden_route: details?.ridden_route ?? trip.ridden_route,
  };
}

export const getUserStats = query({
  args: { user: v.string(), year: v.optional(v.number()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const timeZone = args.timeZone ?? "UTC";

    // When year is specified, filter at DB level — avoids reading all trips
    let trips: Doc<"tripLogs">[];
    if (args.year) {
      const yearStart = Date.UTC(args.year, 0, 1);
      const yearEnd = Date.UTC(args.year + 1, 0, 1);
      trips = await ctx.db
        .query("tripLogs")
        .withIndex("by_user_service_date", (q) =>
          q.eq("user", args.user).gte("service_date", yearStart).lt("service_date", yearEnd)
        )
        .collect();
    } else {
      trips = await ctx.db
        .query("tripLogs")
        .withIndex("by_user", (q) => q.eq("user", args.user))
        .collect();
    }

    if (trips.length === 0) return null;

    // ── Single pass through trips for all stats ──
    let totalDistanceKm = 0;
    let totalMinutes = 0;
    let totalDelayMins = 0;
    let punctualityCount = 0;
    let tripWithTimes = 0;
    const liveryCounts: Record<string, { count: number; css: string; name: string }> = {};
    const typeCounts: Record<string, number> = {};
    const operatorCounts: Record<string, { count: number; slug: string }> = {};
    const tripsByMonth: Record<string, number> = {};
    const routeGroups: Record<string, { count: number; serviceNum: string; stationPairs: Record<string, number> }> = {};
    const companionCounts: Record<string, number> = {};
    const dayOfWeekCounts: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const unitTypeCounts: Record<string, number> = {};
    const stopCounts: Record<string, number> = {};
    const dailyCounts: Record<string, number> = {};
    const allDates = new Set<string>();

    for (const trip of trips) {
      // Distance
      if (typeof trip.distance_km === "number") {
        totalDistanceKm += trip.distance_km;
      } else {
        const routes = await getTripRoutes(ctx, trip);
        const coords: [number, number][] =
          routes.ridden_route?.geometry?.coordinates ?? routes.full_route?.coordinates ?? [];
        for (let i = 1; i < coords.length; i++) {
          totalDistanceKm += haversineKm(coords[i - 1], coords[i]);
        }
      }

      // Time & Delay
      const dep = trip.actual_departure ?? trip.scheduled_departure;
      const arr = trip.actual_arrival ?? trip.scheduled_arrival;
      if (dep && arr) {
        const depDate = new Date(`${formatDate(trip.service_date, timeZone)}T${dep}`);
        const arrDate = new Date(`${formatDate(trip.service_date, timeZone)}T${arr}`);
        const diff = (arrDate.getTime() - depDate.getTime()) / 60000;
        if (diff > 0 && diff < 1440) totalMinutes += diff;

        const schDate = new Date(`1970-01-01T${trip.scheduled_arrival}`);
        const actDate = new Date(`1970-01-01T${trip.actual_arrival}`);
        const delay = (actDate.getTime() - schDate.getTime()) / 60000;
        if (delay >= 0) {
          totalDelayMins += delay;
          if (delay <= 1) punctualityCount++;
          tripWithTimes++;
        }
      }

      // Liveries & Unit types
      const units: any[] = Array.isArray(trip.units) ? trip.units : [];
      for (const unit of units) {
        const name = unit.livery ?? trip.livery_name ?? "";
        if (name) {
          const css = unit.livery_left ?? trip.livery_css ?? "";
          if (!liveryCounts[name]) liveryCounts[name] = { count: 0, css, name };
          liveryCounts[name].count++;
        }
        const utype = unit.unit_type ?? trip.unit_type;
        if (utype) unitTypeCounts[utype] = (unitTypeCounts[utype] ?? 0) + 1;
      }
      if (units.length === 0) {
        if (trip.livery_name) {
          const { livery_name: name, livery_css: css } = trip;
          if (!liveryCounts[name]) liveryCounts[name] = { count: 0, css: css ?? "", name };
          liveryCounts[name].count++;
        }
        if (trip.unit_type) unitTypeCounts[trip.unit_type] = (unitTypeCounts[trip.unit_type] ?? 0) + 1;
      }

      // Transport type
      const ttype = trip.transport_type ?? "Other";
      typeCounts[ttype] = (typeCounts[ttype] ?? 0) + 1;

      // Operator
      const opName = trip.operator ?? "Unknown";
      if (!operatorCounts[opName]) operatorCounts[opName] = { count: 0, slug: trip.operator_slug ?? "" };
      operatorCounts[opName].count++;

      // Month
      const { year, month } = getDateParts(trip.service_date, timeZone);
      const monthKey = `${year}-${month}`;
      tripsByMonth[monthKey] = (tripsByMonth[monthKey] ?? 0) + 1;

      // Routes
      const origin = trip.origin_name ?? "Unknown";
      const destination = trip.destination_name ?? "Unknown";
      const serviceId = trip.bustimes_service_id?.toString();
      const serviceNum = trip.service_number ?? "Unknown";
      const stationsLabel = [origin, destination].sort().join(" ↔ ");
      const groupKey = serviceId ? `sid-${serviceId}` : `fallback-${serviceNum}-${stationsLabel}`;
      if (!routeGroups[groupKey]) routeGroups[groupKey] = { count: 0, serviceNum, stationPairs: {} };
      routeGroups[groupKey].count++;
      routeGroups[groupKey].stationPairs[stationsLabel] = (routeGroups[groupKey].stationPairs[stationsLabel] ?? 0) + 1;

      // Social
      for (const person of trip.on_trip_with ?? []) {
        companionCounts[person] = (companionCounts[person] ?? 0) + 1;
      }

      // Day of week
      const dateStr = formatDate(trip.service_date, timeZone);
      const dateObj = new Date(`${dateStr}T00:00:00`);
      dayOfWeekCounts[days[dateObj.getDay()]]++;

      // Stops
      stopCounts[origin] = (stopCounts[origin] ?? 0) + 1;
      stopCounts[destination] = (stopCounts[destination] ?? 0) + 1;

      allDates.add(dateStr);
      dailyCounts[dateStr] = (dailyCounts[dateStr] ?? 0) + 1;
    }

    // ── Derive final shapes ──
    const availableYears = [
      ...new Set(trips.map((t) => getYearFromTimestamp(t.service_date, timeZone))),
    ].sort((a, b) => b - a);

    const topLiveries = Object.values(liveryCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topTypes = Object.entries(typeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const topOperators = Object.entries(operatorCounts)
      .map(([name, { count, slug }]) => ({ name, count, slug }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const tripsPerMonth = Object.entries(tripsByMonth)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const topRoutes = Object.values(routeGroups)
      .map((g) => ({
        route: `${g.serviceNum}: ${
          Object.entries(g.stationPairs).sort((a, b) => b[1] - a[1])[0][0]
        }`,
        count: g.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const sortedDates = [...allDates].sort();
    let maxStreak = 0;
    let currentStreak = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      if (i > 0) {
        const prev = new Date(`${sortedDates[i - 1]}T00:00:00`);
        const curr = new Date(`${sortedDates[i]}T00:00:00`);
        currentStreak =
          (curr.getTime() - prev.getTime()) / (1000 * 3600 * 24) === 1
            ? currentStreak + 1
            : 1;
      } else {
        currentStreak = 1;
      }
      maxStreak = Math.max(maxStreak, currentStreak);
    }

    const topCompanion = Object.entries(companionCounts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

    return {
      totalTrips: trips.length,
      totalDistanceKm: Math.round(totalDistanceKm),
      totalMinutes: Math.round(totalMinutes),
      topLiveries,
      topTypes,
      topOperators,
      tripsPerMonth,
      tripsByType: topTypes,
      topRoutes,
      uniqueOperators: Object.keys(operatorCounts).length,
      uniqueRoutes: Object.keys(routeGroups).length,
      availableYears,
      firstTripDate: sortedDates[0] ?? null,
      latestTripDate: sortedDates[sortedDates.length - 1] ?? null,
      onTimePercentage: tripWithTimes > 0 ? Math.round((punctualityCount / tripWithTimes) * 100) : 100,
      avgDelay: tripWithTimes > 0 ? (totalDelayMins / tripWithTimes).toFixed(1) : 0,
      topCompanionName: topCompanion[0],
      topCompanionCount: topCompanion[1],
      maxStreak,
      dayOfWeekCounts: Object.entries(dayOfWeekCounts).map(([day, count]) => ({ day, count })),
      dailyCounts,
      topUnitTypes: Object.entries(unitTypeCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topStops: Object.entries(stopCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  },
});

function haversineKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDateParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "0000",
    month: parts.find((part) => part.type === "month")?.value ?? "00",
    day: parts.find((part) => part.type === "day")?.value ?? "00",
  };
}

function getYearFromTimestamp(timestamp: number, timeZone: string) {
  return Number(getDateParts(timestamp, timeZone).year);
}

function formatDate(timestamp: number, timeZone: string): string {
  const { year, month, day } = getDateParts(timestamp, timeZone);
  return `${year}-${month}-${day}`;
}
