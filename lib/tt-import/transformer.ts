import type {
  InternalTrip,
  InternalStop,
  InternalUnit,
  FieldMapping,
  TransformResult,
  ValidationError,
} from './types';
import {
  getFieldValue,
  getFieldArray,
  getCurrentValue,
  resolvePath,
  resolveArrayItems,
  findField,
} from './parser';

function valueToString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function parseDateToMs(v: unknown): number | undefined {
  const s = valueToString(v);
  if (!s) return undefined;

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parsed;

  const asNumber = Number(s);
  if (!Number.isNaN(asNumber)) return asNumber;

  const cleaned = s
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\b\w+day,\s*/gi, '')
    .replace(/\s*at\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned !== s) {
    const retry = Date.parse(cleaned);
    if (!Number.isNaN(retry)) return retry;
  }

  return undefined;
}

function extractTime(v: unknown): string {
  const s = valueToString(v);
  if (!s) return '';

  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);

  const cleaned = s
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\b\w+day,\s*/gi, '')
    .replace(/\s*at\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
  }

  const match = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    let hours = Number(match[1]);
    const minutes = match[2];
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  return s;
}

function getGeoLat(node: Record<string, unknown>): number | undefined {
  const latKey = findField(node, 'geo') ?? Object.keys(node).find((k) => /_lat$/i.test(k));
  if (latKey) {
    const val = node[latKey];
    if (typeof val === 'number') return val;
  }
  const lat = getCurrentValue(node, 'lat');
  if (typeof lat === 'number') return lat;
  return undefined;
}

function getGeoLng(node: Record<string, unknown>): number | undefined {
  const lngKey = findField(node, 'geo') ?? Object.keys(node).find((k) => /_lng$|_lon$/i.test(k));
  if (lngKey) {
    const val = node[lngKey];
    if (typeof val === 'number') return val;
  }
  const lng = getCurrentValue(node, 'lng') ?? getCurrentValue(node, 'lon');
  if (typeof lng === 'number') return lng;
  return undefined;
}

function getNodeTime(node: Record<string, unknown>): string {
  const raw = getCurrentValue(node, 'embarkTime') ?? getCurrentValue(node, 'time') ?? getCurrentValue(node, 'arrival');
  return extractTime(raw);
}

function getNodeName(node: Record<string, unknown>): string {
  return valueToString(getCurrentValue(node, 'stageName') ?? getCurrentValue(node, 'name') ?? getCurrentValue(node, 'stopName'));
}

function getNodeCode(node: Record<string, unknown>): string {
  return valueToString(getCurrentValue(node, 'stageId') ?? getCurrentValue(node, 'stopCode') ?? getCurrentValue(node, 'id'));
}

function getShapeCoords(node: Record<string, unknown>): [number, number][] {
  const shapeKey = findField(node, 'shapeToStage') ?? findField(node, 'shape');
  if (!shapeKey) return [];
  const raw = node[shapeKey];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is [number, number] =>
      Array.isArray(item) && item.length >= 2 &&
      typeof item[0] === 'number' && typeof item[1] === 'number',
  );
}

export function transformTTData(
  rawData: Record<string, unknown>,
  mappings: FieldMapping,
): TransformResult {
  const errors: ValidationError[] = [];
  const result: Partial<InternalTrip> = {
    transport_type: 'Bus',
    origin_stop_code: '',
    destination_stop_code: '',
  };

  const internalFields: Record<string, (v: unknown) => void> = {
    service_number(v) { result.service_number = valueToString(v); },
    operator(v) { result.operator = valueToString(v); },
    operator_slug(v) { result.operator_slug = valueToString(v); },
    origin_name(v) { result.origin_name = valueToString(v); },
    origin_stop_code(v) { result.origin_stop_code = valueToString(v); },
    destination_name(v) { result.destination_name = valueToString(v); },
    destination_stop_code(v) { result.destination_stop_code = valueToString(v); },
    scheduled_departure(v) { result.scheduled_departure = extractTime(v); },
    actual_departure(v) { result.actual_departure = extractTime(v); },
    scheduled_arrival(v) { result.scheduled_arrival = extractTime(v); },
    actual_arrival(v) { result.actual_arrival = extractTime(v); },
    transport_type(v) {
      const s = valueToString(v);
      if (s) result.transport_type = s;
    },
    service_date(v) {
      const ms = parseDateToMs(v);
      if (ms !== undefined) result.service_date = ms;
    },
  };

  for (const [internalField, ttPath] of Object.entries(mappings)) {
    if (internalField.startsWith('_')) continue;
    const handler = internalFields[internalField];
    if (!handler) continue;

    if (internalField === 'stops' || internalField === 'geometry' || internalField === 'units') {
      continue;
    }

    const value = resolvePath(rawData, ttPath);
    handler(value);
  }

  const stopsMapping = mappings.stops || mappings.full_locations;
  const geometryMapping = mappings.geometry;
  const unitsMapping = mappings.units;

  const stops: InternalStop[] = [];

  if (stopsMapping) {
    const nodeItems = resolveArrayItems(rawData, stopsMapping);
    for (const item of nodeItems) {
      if (typeof item !== 'object' || item === null) continue;
      const node = item as Record<string, unknown>;
      const stop: InternalStop = {};
      const name = getNodeName(node);
      if (name) stop.name = name;
      const code = getNodeCode(node);
      if (code) stop.stop_code = code;
      const lat = getGeoLat(node);
      const lng = getGeoLng(node);
      if (lat !== undefined && lng !== undefined) {
        stop.location = [lng, lat];
        stop.lat = lat;
        stop.lon = lng;
      }
      const time = getNodeTime(node);
      if (time) {
        stop.scheduled_departure = time;
        stop.scheduled_arrival = time;
      }
      stops.push(stop);
    }
  }

  if (stops.length > 0) {
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    result.origin_name = result.origin_name || firstStop.name || '';
    result.destination_name = result.destination_name || lastStop.name || '';
    result.origin_stop_code = result.origin_stop_code || firstStop.stop_code || '';
    result.destination_stop_code = result.destination_stop_code || lastStop.stop_code || '';

    if (!result.scheduled_departure && firstStop.scheduled_departure) {
      result.scheduled_departure = firstStop.scheduled_departure;
    }
    if (!result.scheduled_arrival && lastStop.scheduled_arrival) {
      result.scheduled_arrival = lastStop.scheduled_arrival;
    }
  }

  let coordinates: [number, number][] = [];

  if (geometryMapping && stopsMapping) {
    const nodeItems = resolveArrayItems(rawData, stopsMapping);
    for (const item of nodeItems) {
      if (typeof item !== 'object' || item === null) continue;
      const node = item as Record<string, unknown>;
      const shapeCoords = getShapeCoords(node);
      coordinates.push(...shapeCoords);
      const lat = getGeoLat(node);
      const lng = getGeoLng(node);
      if (lat !== undefined && lng !== undefined) {
        coordinates.push([lng, lat]);
      }
    }
  } else if (stops.length > 0) {
    for (const stop of stops) {
      if (stop.location) coordinates.push(stop.location);
    }
  }

  const deduped = coordinates.filter((coord, index) => {
    if (index === 0) return true;
    const prev = coordinates[index - 1];
    return prev[0] !== coord[0] || prev[1] !== coord[1];
  });

  result.full_route = {
    geometry: deduped.length > 1
      ? { type: 'LineString' as const, coordinates: deduped }
      : null,
    stops: stops.length > 0 ? stops : undefined,
  };

  if (unitsMapping) {
    const unitItems = resolveArrayItems(rawData, unitsMapping);
    const units: InternalUnit[] = [];

    for (const item of unitItems) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      const unit: InternalUnit = {};

      const fleetNumber = valueToString(
        getCurrentValue(entry, 'fleet_number') ??
        getCurrentValue(entry, 'fleetNumber') ??
        getCurrentValue(entry, 'fleetName'),
      );
      if (fleetNumber) unit.unit_number = fleetNumber;

      const reg = valueToString(getCurrentValue(entry, 'fleetReg') ?? getCurrentValue(entry, 'reg'));
      if (reg) unit.unit_reg = reg;

      const consistData = entry[findField(entry, 'consistData') ?? ''];
      if (typeof consistData === 'object' && consistData !== null) {
        const cd = consistData as Record<string, unknown>;

        const vehicleType = cd[findField(cd, 'vehicle_type') ?? ''];
        if (typeof vehicleType === 'object' && vehicleType !== null) {
          const vt = vehicleType as Record<string, unknown>;
          const typeName = valueToString(getCurrentValue(vt, 'name'));
          if (typeName) unit.unit_type = typeName;
        }

        const livery = cd[findField(cd, 'livery') ?? ''];
        if (typeof livery === 'object' && livery !== null) {
          const lv = livery as Record<string, unknown>;
          const liveryName = valueToString(getCurrentValue(lv, 'name'));
          if (liveryName) unit.livery = liveryName;
          const left = valueToString(getCurrentValue(lv, 'left') ?? getCurrentValue(lv, 'colour') ?? getCurrentValue(lv, 'color'));
          if (left) unit.livery_left = left;
          if (!left) {
            const right = valueToString(getCurrentValue(lv, 'right'));
            if (right) unit.livery_left = right;
          }
        }
      }

      if (!unit.unit_number) {
        const fn = valueToString(getCurrentValue(entry, 'fleetName'));
        if (fn) unit.unit_number = fn;
      }

      if (unit.unit_number || unit.unit_type || unit.livery) {
        units.push(unit);
      }
    }

    result.units = units;
  }

  validateResult(result as InternalTrip, errors);

  return {
    data: errors.length > 0 && !result.service_number && !result.origin_name ? null : (result as InternalTrip),
    errors,
  };
}

export function validateResult(trip: InternalTrip, errors: ValidationError[]) {
  if (!trip.origin_name) {
    errors.push({ field: 'origin_name', message: 'Missing origin name' });
  }
  if (!trip.destination_name) {
    errors.push({ field: 'destination_name', message: 'Missing destination name' });
  }
  if (!trip.service_number) {
    errors.push({ field: 'service_number', message: 'Missing service number' });
  }
  if (!trip.scheduled_departure) {
    errors.push({ field: 'scheduled_departure', message: 'Missing scheduled departure' });
  }
  if (!trip.scheduled_arrival) {
    errors.push({ field: 'scheduled_arrival', message: 'Missing scheduled arrival' });
  }
  if (!trip.operator) {
    errors.push({ field: 'operator', message: 'Missing operator' });
  }
  if (!trip.service_date) {
    errors.push({ field: 'service_date', message: 'Missing service date' });
  }

  if (trip.full_route?.stops) {
    for (const stop of trip.full_route.stops) {
      if (stop.location && (typeof stop.location[0] !== 'number' || typeof stop.location[1] !== 'number')) {
        errors.push({ field: 'stops', message: `Invalid coordinates for stop "${stop.name}"` });
      }
    }
  }
}
