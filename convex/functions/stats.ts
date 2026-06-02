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
    const allTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .collect();

    if (allTrips.length === 0) return null;

    const availableYears = [...new Set(allTrips.map((t) => getYearFromTimestamp(t.service_date, timeZone)))]
      .sort((a, b) => b - a);

    const trips = args.year 
      ? allTrips.filter((t) => getYearFromTimestamp(t.service_date, timeZone) === args.year)
      : allTrips;
    
    if (trips.length === 0) return null;

    // --- Most ridden livery ---
    const liveryCounts: Record<string, { count: number; css: string; name: string }> = {};
    for (const trip of trips) {
      const units: any[] = Array.isArray(trip.units) ? trip.units : [];
      for (const unit of units) {
        const name = unit.livery ?? trip.livery_name ?? '';
        const css = unit.livery_left ?? trip.livery_css ?? '';
        if (!name) continue;
        if (!liveryCounts[name]) liveryCounts[name] = { count: 0, css, name };
        liveryCounts[name].count++;
      }
      if (units.length === 0 && trip.livery_name) {
        const name = trip.livery_name;
        if (!liveryCounts[name]) liveryCounts[name] = { count: 0, css: trip.livery_css ?? '', name };
        liveryCounts[name].count++;
      }
    }
    const topLiveries = Object.values(liveryCounts).sort((a, b) => b.count - a.count).slice(0, 10);

    // --- Most ridden type ---
    const typeCounts: Record<string, number> = {};
    for (const trip of trips) {
      const type = trip.transport_type ?? 'Other';
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    }
    const topTypes = Object.entries(typeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // --- Most ridden operator ---
    const operatorCounts: Record<string, { count: number; slug: string }> = {};
    for (const trip of trips) {
      const name = trip.operator ?? 'Unknown';
      if (!operatorCounts[name]) operatorCounts[name] = { count: 0, slug: trip.operator_slug ?? '' };
      operatorCounts[name].count++;
    }
    const topOperators = Object.entries(operatorCounts)
      .map(([name, { count, slug }]) => ({ name, count, slug }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // --- Distance travelled ---
    let totalDistanceKm = 0;
    for (const trip of trips) {
      if (typeof trip.distance_km === "number") {
        totalDistanceKm += trip.distance_km;
        continue;
      }

      const routes = await getTripRoutes(ctx, trip);
      const coords: [number, number][] = routes.ridden_route?.geometry?.coordinates
        ?? routes.full_route?.coordinates
        ?? [];
      for (let i = 1; i < coords.length; i++) {
        totalDistanceKm += haversineKm(coords[i - 1], coords[i]);
      }
    }

    // --- Time spent travelling ---
    let totalMinutes = 0;
    for (const trip of trips) {
      const dep = trip.actual_departure ?? trip.scheduled_departure;
      const arr = trip.actual_arrival ?? trip.scheduled_arrival;
      if (dep && arr) {
        const depDate = new Date(`${formatDate(trip.service_date, timeZone)}T${dep}`);
        const arrDate = new Date(`${formatDate(trip.service_date, timeZone)}T${arr}`);
        const diff = (arrDate.getTime() - depDate.getTime()) / 60000;
        if (diff > 0 && diff < 1440) totalMinutes += diff;
      }
    }

    // --- Trips per month ---
    const tripsByMonth: Record<string, number> = {};
    for (const trip of trips) {
      const { year, month } = getDateParts(trip.service_date, timeZone);
      const key = `${year}-${month}`;
      tripsByMonth[key] = (tripsByMonth[key] ?? 0) + 1;
    }
    const tripsPerMonth = Object.entries(tripsByMonth)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // --- Most visited routes (Merged by Service ID) ---
    const routeGroups: Record<string, { 
      count: number; 
      serviceNum: string; 
      stationPairs: Record<string, number> 
    }> = {};

    for (const trip of trips) {
      const origin = trip.origin_name ?? "Unknown";
      const destination = trip.destination_name ?? "Unknown";
      const serviceId = trip.bustimes_service_id?.toString();
      const serviceNum = trip.service_number ?? "Unknown";
      
      const sortedStations = [origin, destination].sort();
      const stationsLabel = `${sortedStations[0]} ↔ ${sortedStations[1]}`;
      
      // Use Service ID as group key if available, otherwise Service Number + Stations
      const groupKey = serviceId 
        ? `sid-${serviceId}` 
        : `fallback-${serviceNum}-${stationsLabel}`;

      if (!routeGroups[groupKey]) {
        routeGroups[groupKey] = { 
          count: 0, 
          serviceNum, 
          stationPairs: {} 
        };
      }

      routeGroups[groupKey].count++;
      routeGroups[groupKey].stationPairs[stationsLabel] = (routeGroups[groupKey].stationPairs[stationsLabel] ?? 0) + 1;
    }

    // Convert groups into final display format
    const topRoutes = Object.values(routeGroups)
      .map((group) => {
        // Find the most frequent station pair for this group
        const mostFrequentStations = Object.entries(group.stationPairs)
          .sort((a, b) => b[1] - a[1])[0][0];

        return {
          route: `${group.serviceNum}: ${mostFrequentStations}`,
          count: group.count
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const uniqueOperators = new Set(trips.map((t) => t.operator)).size;
    const uniqueRoutes = Object.keys(routeGroups).length;

    const tripDates = [...new Set(trips.map((t) => {
      const { year, month, day } = getDateParts(t.service_date, timeZone);
      return `${year}-${month}-${day}`;
    }))].sort();

    let totalDelayMins = 0;
    let punctualityCount = 0; // "On time" = <= 1 min late
    let tripWithTimes = 0;

    // --- Social & Companions (3) ---
    const companionCounts: Record<string, number> = {};

    // --- Time & Heatmap (4) ---
    const dayOfWeekCounts: Record<string, number> = { 
      'Sun': 0, 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0 
    };
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (const trip of trips) {
      // 1. Delays
      const schArr = trip.scheduled_arrival;
      const actArr = trip.actual_arrival;
      if (schArr && actArr) {
        const schDate = new Date(`1970-01-01T${schArr}`);
        const actDate = new Date(`1970-01-01T${actArr}`);
        const delay = (actDate.getTime() - schDate.getTime()) / 60000;
        if (delay >= 0) {
          totalDelayMins += delay;
          if (delay <= 1) punctualityCount++;
          tripWithTimes++;
        }
      }

      // 3. Social
      const companions = trip.on_trip_with ?? [];
      for (const person of companions) {
        companionCounts[person] = (companionCounts[person] ?? 0) + 1;
      }

      // 4. Time Heatmap
      const date = new Date(`${formatDate(trip.service_date, timeZone)}T00:00:00`);
      dayOfWeekCounts[days[date.getDay()]]++;
    }

    // --- Most ridden unit types ---
    const unitTypeCounts: Record<string, number> = {};
    for (const trip of trips) {
    const units: any[] = Array.isArray(trip.units) ? trip.units : [];
    for (const unit of units) {
        const type = unit.unit_type ?? trip.unit_type;
        if (type) {
        unitTypeCounts[type] = (unitTypeCounts[type] ?? 0) + 1;
        }
    }
    // Fallback for trips without a units array
    if (units.length === 0 && trip.unit_type) {
        unitTypeCounts[trip.unit_type] = (unitTypeCounts[trip.unit_type] ?? 0) + 1;
    }
    }

    const topUnitTypes = Object.entries(unitTypeCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

    // --- Streaks (4) ---
    const sortedDates = [...new Set(trips.map((t) => formatDate(t.service_date, timeZone)))].sort();
    let maxStreak = 0;
    let currentStreak = 0;
    for (let i = 0; i < sortedDates.length; i++) {
        if (i > 0) {
          const prev = new Date(`${sortedDates[i - 1]}T00:00:00`);
          const curr = new Date(`${sortedDates[i]}T00:00:00`);
            const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 3600 * 24);
            if (diffDays === 1) {
                currentStreak++;
            } else {
                currentStreak = 1;
            }
        } else {
            currentStreak = 1;
        }
        maxStreak = Math.max(maxStreak, currentStreak);
    }

    const topCompanion = Object.entries(companionCounts)
      .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

    const dailyCounts: Record<string, number> = {};
    for (const trip of trips) {
      const dateKey = formatDate(trip.service_date, timeZone);
        dailyCounts[dateKey] = (dailyCounts[dateKey] ?? 0) + 1;
    }

    const stopCounts: Record<string, number> = {};
    for (const trip of trips) {
    const origin = trip.origin_name ?? "Unknown";
    const destination = trip.destination_name ?? "Unknown";
    stopCounts[origin] = (stopCounts[origin] ?? 0) + 1;
    stopCounts[destination] = (stopCounts[destination] ?? 0) + 1;
    }

    const topStops = Object.entries(stopCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

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
      uniqueOperators,
      uniqueRoutes,
      availableYears,
      firstTripDate: tripDates[0] ?? null,
      latestTripDate: tripDates[tripDates.length - 1] ?? null,
      onTimePercentage: tripWithTimes > 0 ? Math.round((punctualityCount / tripWithTimes) * 100) : 100,
      avgDelay: tripWithTimes > 0 ? (totalDelayMins / tripWithTimes).toFixed(1) : 0,
      topCompanionName: topCompanion[0],
      topCompanionCount: topCompanion[1],
      maxStreak,
      dayOfWeekCounts: Object.entries(dayOfWeekCounts).map(([day, count]) => ({ day, count })),
      dailyCounts,
      topUnitTypes,
      topStops,
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
