// convex/functions/completion.ts
import { query } from "../_generated/server";
import { v } from "convex/values";

// Helper functions (copied from your stats.ts logic)
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

function formatDate(timestamp: number, timeZone: string): string {
  const { year, month, day } = getDateParts(timestamp, timeZone);
  return `${year}-${month}-${day}`;
}

export const getOperatorByAnyCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const searchCode = args.code.toLowerCase();
    const allOperators = await ctx.db.query("operators").collect();

    // MUST return the result of the find
    return allOperators.find((op) => 
      (op.operator_codes ?? []).some(c => c.toLowerCase() === searchCode) ||
      (op.operator_slugs ?? []).some(s => s.toLowerCase() === searchCode)
    );
  },
});

export const getOperatorCompletionStats = query({
  args: { user: v.string(), operator_name: v.string(), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const timeZone = args.timeZone ?? "UTC";
    const operatorTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user_and_operator", (q) =>
        q.eq("user", args.user).eq("operator", args.operator_name)
      )
      .collect();

    let totalDistanceKm = 0;
    let totalMinutes = 0;
    const uniqueRoutes = new Set<string>();
    const uniqueVehicles = new Set<string>();

    for (const trip of operatorTrips) {
      // Routes
      const serviceId = trip.bustimes_service_id?.toString();
      const serviceNumber = trip.service_number ?? "Unknown";
      const origin = trip.origin_name ?? "Unknown";
      const destination = trip.destination_name ?? "Unknown";
      const routeLabel = [origin, destination].sort().join(" ↔ ");
      uniqueRoutes.add(
        serviceId
          ? `sid-${serviceId}`
          : `fallback-${serviceNumber}-${routeLabel}`
      );

      // Vehicles
      const units: any[] = Array.isArray(trip.units) ? trip.units : [];
      if (units.length > 0) {
        for (const unit of units) {
          const vehicleKey = `${unit?.unit_number ?? ""}|${unit?.unit_reg ?? ""}`.trim();
          if (vehicleKey !== "|") uniqueVehicles.add(vehicleKey);
        }
      } else {
        const fallbackKey = `${trip.unit_number ?? ""}|${trip.unit_reg ?? ""}`.trim();
        if (fallbackKey !== "|") uniqueVehicles.add(fallbackKey);
      }

      // Distance
      const coords: [number, number][] =
        trip.ridden_route?.geometry?.coordinates ??
        trip.full_route?.coordinates ??
        [];
      for (let i = 1; i < coords.length; i++) {
        totalDistanceKm += haversineKm(coords[i - 1], coords[i]);
      }

      // Time
      const dep = trip.actual_departure ?? trip.scheduled_departure;
      const arr = trip.actual_arrival ?? trip.scheduled_arrival;
      if (dep && arr) {
        const depDate = new Date(`${formatDate(trip.service_date, timeZone)}T${dep}`);
        const arrDate = new Date(`${formatDate(trip.service_date, timeZone)}T${arr}`);
        const diff = (arrDate.getTime() - depDate.getTime()) / 60000;
        if (diff > 0 && diff < 1440) totalMinutes += diff;
      }
    }

    return {
      operatorName: args.operator_name,
      totalTrips: operatorTrips.length,
      totalDistanceKm: Math.round(totalDistanceKm),
      totalMinutes: Math.round(totalMinutes),
      uniqueRoutes: uniqueRoutes.size,
      uniqueVehiclesRidden: uniqueVehicles.size,
    };
  },
});