export type FieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "json"
  | "relation"
  | "textarea";

export type AdminField = {
  label?: string;
  type: FieldType;
  table?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
};

export type AdminFilter = {
  label: string;
  field: string;
  type: FieldType;
  table?: string;
};

export type AdminTableConfig = {
  label: string;
  description?: string;
  fields: Record<string, AdminField>;
  listColumns?: string[];
  search?: { index?: string; field?: string; placeholder?: string };
  filters?: AdminFilter[];
};

export const adminConfig: Record<string, AdminTableConfig> = {
  stops: {
    label: "Stops",
    fields: {
      name: { type: "text" },
      commonName: { type: "text" },
      atcoCode: { type: "text" },
      naptanCode: { type: "text" },
      tiplocCode: { type: "text" },
      crsCode: { type: "text" },
      stopTypeId: { type: "relation", table: "stopTypes" },
      active: { type: "boolean" },
      hidden: { type: "boolean" },
      bearing: { type: "number" },
      lat: { type: "number" },
      lon: { type: "number" },
      lines: { type: "json" },
      indicator: { type: "text" },
      icon: { type: "text" },
    },
    listColumns: ["name", "atcoCode", "crsCode", "stopTypeId", "active"],
    search: { placeholder: "Search stops" },
    filters: [
      { label: "Stop type", field: "stopTypeId", type: "relation", table: "stopTypes" },
      { label: "Active", field: "active", type: "boolean" },
      { label: "Hidden", field: "hidden", type: "boolean" },
    ],
  },
  stopTypes: {
    label: "Stop types",
    fields: {
      name: { type: "text" },
      code: { type: "text" },
      subOf: { type: "relation", table: "stopTypes" },
    },
    listColumns: ["name", "code", "subOf"],
    search: { placeholder: "Search stop types" },
  },
  trainDetails: {
    label: "Train details",
    fields: {
      rid: { type: "text" },
      toc_code: { type: "text" },
      train_operator: { type: "text" },
      uid: { type: "text" },
      destination_arrival: { type: "text" },
      destination_name: { type: "text" },
      destination_crs: { type: "text" },
      origin_departure: { type: "text" },
      origin_name: { type: "text" },
      origin_crs: { type: "text" },
      stops: { type: "json" },
      delay: { type: "number" },
      headcode: { type: "text" },
      unit_id: { type: "text" },
      unit_numbers: { type: "json" },
      unit_allocation: { type: "json" },
    },
    listColumns: ["headcode", "uid", "rid", "destination_name", "delay"],
    search: { placeholder: "Search trains" },
    filters: [
      { label: "Delay", field: "delay", type: "number" },
    ],
  },
  trainAllocations: {
    label: "Train allocations",
    fields: {
      uid: { type: "text" },
      date: { type: "text" },
      unit_numbers: { type: "json" },
      unit_allocation: { type: "json" },
      updated_at: { type: "number" },
    },
    listColumns: ["uid", "date", "unit_numbers", "updated_at"],
    search: { placeholder: "Search allocations" },
  },
  units: {
    label: "Units",
    fields: {
      unit_number: { type: "text" },
      unit_reg: { type: "text" },
      type_id: { type: "relation", table: "types" },
      operator_id: { type: "relation", table: "operators" },
      livery_id: { type: "relation", table: "liveries" },
      search_text: { type: "text", readOnly: true },
    },
    listColumns: ["unit_number", "unit_reg", "type_id", "operator_id", "livery_id"],
    search: { index: "search_units", field: "search_text", placeholder: "Unit number or reg" },
    filters: [
      { label: "Operator", field: "operator_id", type: "relation", table: "operators" },
      { label: "Type", field: "type_id", type: "relation", table: "types" },
      { label: "Livery", field: "livery_id", type: "relation", table: "liveries" },
    ],
  },
  liveries: {
    label: "Liveries",
    fields: {
      livery_name: { type: "text" },
      css_class: { type: "text" },
    },
    listColumns: ["livery_name", "css_class"],
    search: { placeholder: "Search liveries" },
  },
  types: {
    label: "Types",
    fields: {
      type_name: { type: "text" },
    },
    listColumns: ["type_name"],
    search: { placeholder: "Search types" },
  },
  operators: {
    label: "Operators",
    fields: {
      display_name: { type: "text" },
      operator_names: { type: "json" },
      operator_slugs: { type: "json" },
      operator_codes: { type: "json" },
      bustimes_id: { type: "number" },
    },
    listColumns: ["display_name", "bustimes_id"],
    search: { placeholder: "Search operators" },
  },
  historicalRoutes: {
    label: "Historical routes",
    fields: {
      bustimes_service_id: { type: "number" },
      bustimes_service_slug: { type: "text" },
      service_number: { type: "text" },
      operator_id: { type: "text" },
      inbound_destination: { type: "text" },
      outbound_destination: { type: "text" },
    },
    listColumns: ["service_number", "operator_id", "inbound_destination", "outbound_destination"],
    search: { placeholder: "Search routes" },
  },
  tripLogs: {
    label: "Trip logs",
    fields: {
      user: { type: "text" },
      on_trip_with: { type: "json" },
      logged_at: { type: "number" },
      service_number: { type: "text" },
      operator: { type: "text" },
      operator_slug: { type: "text" },
      service_date: { type: "number" },
      transport_type: { type: "text" },
      bustimes_service_id: { type: "number" },
      bustimes_service_slug: { type: "text" },
      origin_name: { type: "text" },
      origin_stop_code: { type: "text" },
      destination_name: { type: "text" },
      destination_stop_code: { type: "text" },
      scheduled_departure: { type: "text" },
      actual_departure: { type: "text" },
      scheduled_arrival: { type: "text" },
      actual_arrival: { type: "text" },
      full_route: { type: "json" },
      ridden_route: { type: "json" },
      units: { type: "json" },
      full_locations: { type: "json" },
      unit_number: { type: "text" },
      unit_reg: { type: "text" },
      unit_type: { type: "text" },
      livery_name: { type: "text" },
      livery_css: { type: "text" },
      notes: { type: "textarea" },
    },
    listColumns: ["service_number", "operator", "service_date", "origin_name", "destination_name"],
    search: { placeholder: "Search trips" },
    filters: [
      { label: "Operator", field: "operator", type: "text" },
      { label: "Transport", field: "transport_type", type: "text" },
    ],
  },
};

export const ADMIN_TABLE_KEYS = Object.keys(adminConfig);
