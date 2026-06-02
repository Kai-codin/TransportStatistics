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
    .index("by_crsCode", ["crsCode"])
    .index("by_stopType", ["stopTypeId"])
    .index("by_active", ["active"])
    .index("by_lat_lon", ["lat", "lon"]),

  trainDetails: defineTable({
    rid: v.string(),
    toc_code: v.string(),
    train_operator: v.union(v.string(), v.null()),
    uid: v.string(),
    destination_arrival: v.union(v.string(), v.null()),
    destination_name: v.string(),
    destination_crs: v.string(),
    origin_departure: v.union(v.string(), v.null()),
    origin_name: v.string(),
    origin_crs: v.string(),
    delay: v.number(),
    headcode: v.string(),
    unit_numbers: v.optional(v.array(v.string())),
    stops: v.optional(v.any()),
  })
  .index("by_delay", ["delay"])
  .index("by_rid", ["rid"])
  .index("by_uid", ["uid"]),

  // Compact train details for low-IO live vehicle lookups
  trainDetailsSummary: defineTable({
    rid: v.string(),
    uid: v.optional(v.union(v.string(), v.null())),
    headcode: v.optional(v.union(v.string(), v.null())),
    train_operator: v.optional(v.union(v.string(), v.null())),
    destination_name: v.optional(v.union(v.string(), v.null())),
    origin_departure: v.optional(v.union(v.string(), v.null())),
    unit_numbers: v.optional(v.array(v.string())),
    updated_at: v.number(),
  })
  .index("by_rid", ["rid"])
  .index("by_uid", ["uid"]),

  trainDetailsStats: defineTable({
    key: v.string(),
    count: v.number(),
  })
  .index("by_key", ["key"]),

  trainAllocations: defineTable({
    uid: v.string(),
    date: v.string(),
    unit_numbers: v.array(v.string()),
    unit_allocation: v.any(),
    updated_at: v.number(),
  })
    .index("by_uid_date", ["uid", "date"]),

  units: defineTable({
    unit_number: v.optional(v.string()),
    unit_reg: v.string(),
    type_id: v.string(),
    operator_id: v.string(),
    livery_id: v.string(),  
    search_text: v.optional(v.string()),
  })
  .index("by_operator_id", ["operator_id"])
  .index("type_id", ["type_id"])
  .index("livery_id", ["livery_id"])
  .index("unit_reg", ["unit_reg"])
  .index("unit_number", ["unit_number"])
  .searchIndex("search_units", { searchField: "search_text" }),

  liveries: defineTable({
    livery_name: v.string(),
    css_class: v.string(),  
  })
  .index("by_livery_name", ["livery_name"]),

  types: defineTable({
    type_name: v.string(),
  })
  .index("by_type_name", ["type_name"]),

  operators: defineTable({
    display_name: v.string(),
    operator_names: v.array(v.string()),
    operator_slugs: v.array(v.string()),
    operator_codes: v.array(v.string()),
    bustimes_id: v.optional(v.number()),
  })
  .index("by_bustimes_id", ["bustimes_id"])
  .index("by_operator_names", ["operator_names"])
  .index("by_operator_slugs", ["operator_slugs"])
  .index("by_operator_codes", ["operator_codes"]),

  historicalRoutes: defineTable({
    bustimes_service_id: v.optional(v.number()),
    bustimes_service_slug: v.optional(v.string()),
    service_number: v.string(),
    operator_id: v.string(),
    inbound_destination: v.string(),
    outbound_destination: v.string(),
  })
  .index("by_bustimes_service_id", ["bustimes_service_id"])
  .index("by_operator_id", ["operator_id"])
  .index("by_service_number", ["service_number"]),

  seenUnits: defineTable({
    user: v.string(),
    vehicle_key: v.string(),
  })
  .index("by_user_vehicle", ["user", "vehicle_key"]),

  users: defineTable({
    clerkId: v.string(),
    username: v.string(),
  })
  .index("by_clerkId", ["clerkId"]),

  userSettings: defineTable({
    clerkId: v.string(),
    bustimesBaseUrl: v.string(),
    bustimesEnabledFeatures: v.array(v.string()),
  })
  .index("by_clerkId", ["clerkId"]),

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
        v.literal("Ferry"),
        v.literal("Taxi"),
        v.literal("Other")  
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
    full_route: v.optional(v.any()),
    ridden_route: v.optional(v.any()),
    units: v.optional(v.any()),
    full_locations: v.optional(v.any()),
    unit_number: v.optional(v.string()),
    unit_reg: v.optional(v.string()),
    unit_type: v.optional(v.string()),
    livery_name: v.optional(v.string()),
    livery_css: v.optional(v.string()),
    notes: v.optional(v.string()),
    distance_km: v.optional(v.number()),
    first_time: v.optional(v.boolean()),
    first_units: v.optional(v.array(v.string())),
    vehicle_key: v.optional(v.string()),
    vehicle_keys: v.optional(v.array(v.string())),
  })
    .index("by_user", ["user"])
    .index("by_user_and_operator", ["user", "operator"])
    .index("by_user_service_date", ["user", "service_date"])
    .index("by_user_date_departure", ["user", "service_date", "scheduled_departure"])
    .index("by_user_operator_vehicle", ["user", "operator", "vehicle_key"]),

  tripRouteDetails: defineTable({
    tripId: v.id("tripLogs"),
    user: v.string(),
    full_route: v.optional(v.any()),
    ridden_route: v.optional(v.any()),
    full_locations: v.optional(v.any()),
    updated_at: v.number(),
  })
    .index("by_tripId", ["tripId"])
    .index("by_user", ["user"]),

  editRequests: defineTable({
    userId: v.string(),    
    userEmail: v.string(), 
    table: v.string(),     
    recordId: v.string(),  
    from: v.any(),         
    to: v.any(),           
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined")
    ),
    userReason: v.string(),
    adminReason: v.optional(v.string()),
    reviewedBy: v.optional(v.string()), // Admin Clerk ID
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_table_recordId", ["table", "recordId"])
    .index("by_userId", ["userId"]),
});
