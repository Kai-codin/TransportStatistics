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

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const getOperatorCompletionStats = query({
  args: { user: v.string(), operator_slug: v.string() },
  handler: async (ctx, args) => {
    // Fetch all trips for the user
    const allTrips = await ctx.db
      .query("tripLogs")
      .withIndex("by_user", (q) => q.eq("user", args.user))
      .collect();

    // Filter down to the specific operator
    const operatorTrips = allTrips.filter(t => t.operator_slug === args.operator_slug);

    let totalDistanceKm = 0;
    let totalMinutes = 0;
    let operatorName = args.operator_slug;
    const uniqueRoutes = new Set<string>();
    const uniqueVehicles = new Set<string>();

    if (operatorTrips.length > 0) {
      operatorName = operatorTrips[0].operator; // Grab the readable name from the first trip
    }

    for (const trip of operatorTrips) {
      const serviceId = trip.bustimes_service_id?.toString();
      const serviceNumber = trip.service_number ?? "Unknown";
      const origin = trip.origin_name ?? "Unknown";
      const destination = trip.destination_name ?? "Unknown";
      const routeLabel = [origin, destination].sort().join(" ↔ ");
      uniqueRoutes.add(serviceId ? `sid-${serviceId}` : `fallback-${serviceNumber}-${routeLabel}`);

      const units: any[] = Array.isArray(trip.units) ? trip.units : [];
      for (const unit of units) {
        const unitNumber = unit?.unit_number ?? "";
        const unitReg = unit?.unit_reg ?? "";
        const vehicleKey = `${unitNumber}|${unitReg}`.trim();
        if (vehicleKey !== "|") {
          uniqueVehicles.add(vehicleKey);
        }
      }

      if (units.length === 0) {
        const fallbackVehicleKey = `${trip.unit_number ?? ""}|${trip.unit_reg ?? ""}`.trim();
        if (fallbackVehicleKey !== "|") {
          uniqueVehicles.add(fallbackVehicleKey);
        }
      }

      // 1. Calculate Distance
      const coords: [number, number][] = trip.ridden_route?.geometry?.coordinates
        ?? trip.full_route?.coordinates
        ?? [];
      for (let i = 1; i < coords.length; i++) {
        totalDistanceKm += haversineKm(coords[i - 1], coords[i]);
      }

      // 2. Calculate Time spent
      const dep = trip.actual_departure ?? trip.scheduled_departure;
      const arr = trip.actual_arrival ?? trip.scheduled_arrival;
      if (dep && arr) {
        const depDate = new Date(`${formatDate(trip.service_date)}T${dep}`);
        const arrDate = new Date(`${formatDate(trip.service_date)}T${arr}`);
        const diff = (arrDate.getTime() - depDate.getTime()) / 60000;
        if (diff > 0 && diff < 1440) totalMinutes += diff;
      }
    }

    return {
      operatorName,
      totalTrips: operatorTrips.length,
      totalDistanceKm: Math.round(totalDistanceKm),
      totalMinutes: Math.round(totalMinutes),
      uniqueRoutes: uniqueRoutes.size,
      uniqueVehiclesRidden: uniqueVehicles.size,
    };
  },
});