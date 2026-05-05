import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const importTrips = mutation({
  args: {
    trips: v.array(v.any()),
    userId: v.string(), // Pass the user ID during import
  },
  handler: async (ctx, args) => {
    for (const trip of args.trips) {
      // 1. Convert service_date if necessary
      const timestamp = typeof trip.service_date === 'string' 
        ? Math.floor(new Date(trip.service_date).getTime() / 1000)
        : trip.service_date;

      const clean = (val: any) => (val === null || val === "" ? undefined : val);

      // 2. Map incoming fields to database schema fields
      const newTrip = {
        user: args.userId,
        service_number: trip.headcode || "N/A",
        operator: trip.operator,
        operator_slug: trip.operator.toLowerCase().replace(/\s+/g, '-'),
        service_date: timestamp,
        transport_type: (trip.transport_type.charAt(0).toUpperCase() + trip.transport_type.slice(1)) as "Rail" | "Bus" | "Tram" | "Ferry",
        
        // These fields were missing in your JSON, so we provide defaults
        bustimes_service_id: Number(trip.bustimes_service_id) || 0, 
        bustimes_service_slug: trip.bustimes_service_slug || "N/A",
        
        origin_name: trip.origin_name,
        origin_stop_code: trip.origin_crs || "N/A",
        destination_name: trip.destination_name,
        destination_stop_code: trip.destination_crs || "N/A",
        
        scheduled_departure: trip.scheduled_departure || "00:00:00",
        scheduled_arrival: trip.scheduled_arrival || "00:00:00",
        
        ridden_route_geometry: trip.route_geometry,
        full_route_geometry: trip.full_route_geometry,
        full_locations: trip.full_locations,
        
        unit_number: trip.train_fleet_number || trip.bus_fleet_number || "",
        unit_reg: trip.train_unit_reg || trip.bus_registration || "",
        unit_type: trip.train_type || trip.bus_type || "",
        livery_name: clean(trip.bus_livery_name),
        livery_css: clean(trip.bus_livery),
        on_trip_with: trip.on_trip_usernames || [],
        notes: trip.notes || "",
      };

      await ctx.db.insert("tripLogs", newTrip);
    }
  },
});