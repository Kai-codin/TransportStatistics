export type TTNode = {
  [key: string]: unknown;
};

export type TTConsistEntry = {
  [key: string]: unknown;
};

export type InternalTrip = {
  service_number: string;
  operator: string;
  operator_slug: string;
  service_date: number;
  transport_type: string;
  origin_name: string;
  origin_stop_code: string;
  destination_name: string;
  destination_stop_code: string;
  scheduled_departure: string;
  actual_departure?: string;
  scheduled_arrival: string;
  actual_arrival?: string;
  origin_stop?: { name?: string; lat?: number; lon?: number };
  destination_stop?: { name?: string; lat?: number; lon?: number };
  full_route: {
    geometry?: { type: 'LineString'; coordinates: [number, number][] } | null;
    stops?: InternalStop[];
  } | null;
  units?: InternalUnit[];
};

export type InternalStop = {
  name?: string;
  stop_code?: string;
  location?: [number, number];
  lat?: number;
  lon?: number;
  scheduled_arrival?: string;
  scheduled_departure?: string;
  actual_arrival?: string;
  actual_departure?: string;
};

export type InternalUnit = {
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery?: string;
  livery_left?: string;
};

export type FieldMapping = Record<string, string>;

export type MappingPreset = {
  name: string;
  description?: string;
  fieldMappings: FieldMapping;
};

export type ValidationError = {
  field: string;
  message: string;
};

export type TransformResult = {
  data: InternalTrip | null;
  errors: ValidationError[];
};
