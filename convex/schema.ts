import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Table for categories/types of stops (e.g., Bus, Train, Metro)
  stopTypes: defineTable({
    name: v.string(),
    code: v.string(), // e.g., 'BUS', 'RAIL'
    subOf: v.optional(v.id("stopTypes")), // Recursive link for hierarchy
  })
    .index("by_code", ["code"]),

  // Main stops data
  stops: defineTable({
    name: v.string(),
    commonName: v.string(),
    atcoCode: v.string(), // Primary identifier for NaPTAN
    naptanCode: v.optional(v.string()),
    tiplocCode: v.optional(v.string()),
    crsCode: v.optional(v.string()),
    stopTypeId: v.id("stopTypes"), // Link to stopTypes table
    active: v.boolean(),
    hidden: v.boolean(),
    bearing: v.optional(v.number()),
    lat: v.number(),
    lon: v.number(),
    lines: v.optional(v.array(v.string())), // Store line/route names
    indicator: v.optional(v.string()), // e.g., "Stop A"
    icon: v.optional(v.string()), // URL or name for icon
  })
    // Indices for performance
    .index("by_atcoCode", ["atcoCode"])
    .index("by_stopType", ["stopTypeId"])
    .index("by_active", ["active"])
    .index("by_lon", ["lon"])
    .index("by_lat", ["lat"])
    .index("by_lat_lon", ["lat", "lon"]),

  trainDetails: defineTable({
    rid: v.string(),
    toc_code: v.string(),
    train_operator: v.string(),
    uid: v.string(),
    destination_arrival: v.string(),
    destination_name: v.string(),
    destination_crs: v.string(),
    origin_departure: v.string(),
    origin_name: v.string(),
    origin_crs: v.string(),
    stops: v.array(v.any()), 
    delay: v.number(),
    headcode: v.string(),
  })
  .index("by_rid", ["rid"]),

  tripLogs: defineTable({
    user: v.string(),
    on_trip_with: v.array(v.string()),
    logged_at: v.optional(v.number()), // Made optional
    service_number: v.string(),
    operator: v.string(),
    operator_slug: v.string(),
    service_date: v.number(),
    transport_type: v.union(
        v.literal("Rail"),
        v.literal("Bus"),
        v.literal("Tram"),
        v.literal("Ferry")
    ),
    // Wrapped in v.optional()
    bustimes_service_id: v.optional(v.number()), 
    bustimes_service_slug: v.optional(v.string()),
    
    origin_name: v.string(),
    origin_stop_code: v.string(),
    destination_name: v.string(),
    destination_stop_code: v.string(),
    scheduled_departure: v.string(),
    actual_departure: v.optional(v.string()),
    scheduled_arrival: v.string(),
    actual_arrival: v.optional(v.string()),
    ridden_route_geometry: v.any(),
    full_route_geometry: v.any(),
    full_locations: v.any(),
    unit_number: v.optional(v.string()),
    unit_reg: v.optional(v.string()),
    unit_type: v.optional(v.string()),
    livery_name: v.optional(v.string()),
    livery_css: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_user", ["user"])
    .index("by_service_date", ["user", "service_date"]),
});