import type { MappingPreset } from './types';
import { stripPrefix } from './parser';

export const DEFAULT_PRESETS: MappingPreset[] = [
  {
    name: 'Default TT Export',
    description: 'Maps common Transit Tracker export fields to internal format',
    fieldMappings: {
      service_number: 'rideName',
      operator: 'organisation',
      operator_slug: 'organisation',
      origin_name: 'nodes[first].stageName',
      destination_name: 'nodes[last].stageName',
      scheduled_departure: 'nodes[first].embarkTime',
      scheduled_arrival: 'nodes[last].embarkTime',
      service_date: 'embarkDate',
      stops: 'nodes',
      geometry: 'nodes[item].shapeToStage',
      units: 'consist',
    },
  },
  {
    name: 'Minimal TT Export',
    description: 'Basic mapping with only essential fields',
    fieldMappings: {
      service_number: 'rideName',
      operator: 'organisation',
      origin_name: 'nodes[first].stageName',
      destination_name: 'nodes[last].stageName',
      scheduled_departure: 'nodes[first].embarkTime',
      scheduled_arrival: 'nodes[last].embarkTime',
      stops: 'nodes',
      geometry: 'nodes[item].shapeToStage',
    },
  },
];

const SIMILARITY_MAP: Record<string, string[]> = {
  service_number: ['ridename', 'servicename', 'name', 'routename', 'service', 'headcode', 'trainnumber', 'busnumber', 'linename'],
  operator: ['organisation', 'organization', 'company', 'operatorname', 'operatingcompany', 'brand', 'agency'],
  operator_slug: ['organisationslug', 'orgslug', 'operatorslug', 'companyslug'],
  origin_name: ['origin', 'from', 'startname', 'firststop', 'departurestop', 'originstation'],
  destination_name: ['destination', 'to', 'endname', 'laststop', 'arrivalstop', 'destinationstation', 'terminus'],
  origin_stop_code: ['origincode', 'fromcode', 'originstopcode', 'departurecode', 'originstationcode', 'origincrs'],
  destination_stop_code: ['destinationcode', 'tocode', 'deststopcode', 'arrivalcode', 'deststationcode', 'destinationcrs'],
  scheduled_departure: ['departuretime', 'departtime', 'depart', 'starttime', 'scheduledd departure', 'planneddeparture', 'embarktime'],
  scheduled_arrival: ['arrivaltime', 'arrivetime', 'arrival', 'endtime', 'scheduledarrival', 'plannedarrival'],
  actual_departure: ['actualdeparture', 'realdeparture', 'actualdep'],
  actual_arrival: ['actualarrival', 'realarrival', 'actualarr'],
  transport_type: ['type', 'mode', 'transporttype', 'vehiclemode', 'servicetype', 'category'],
  service_date: ['date', 'servicedate', 'tripdate', 'rundate', 'embarkdate', 'startdate'],
  stops: ['nodes', 'stops', 'routestops', 'stoplist', 'locations', 'waypoints'],
  geometry: ['shapetostage', 'geometry', 'routegeometry', 'path', 'track', 'shape', 'routeshape', 'linestring'],
  units: ['consist', 'units', 'vehicles', 'formation', 'traction', 'rollingstock', 'fleet'],
  unit_number: ['fleet_number', 'fleetnumber', 'unitnumber', 'unit', 'vehiclenumber', 'fleetno', 'fleetname'],
  unit_type: ['vehicletype', 'unittype', 'type', 'class', 'vehicleclass', 'subtype', 'vehicle_type'],
  livery: ['livername', 'livery', 'colourscheme', 'paint', 'branding'],
  livery_left: ['liverycolours', 'liverycolors', 'colours', 'colors', 'liverycss', 'css', 'left', 'right'],
};

export function autoMapFields(
  ttData: Record<string, unknown>,
  ttFlattened: string[],
): Record<string, string> {
  const mappings: Record<string, string> = {};
  const usedTtPaths = new Set<string>();

  const strippedKeys = ttFlattened.map((path) => ({
    path,
    stripped: stripKey(path),
    parts: path.replace(/\[(first|last|item)\]/g, '').split('.'),
  }));

  for (const [internalField, possibleTtNames] of Object.entries(SIMILARITY_MAP)) {
    let bestMatch: string | undefined;

    for (const { path, stripped, parts } of strippedKeys) {
      if (usedTtPaths.has(path)) continue;

      const strippedLower = stripped.toLowerCase();

      for (const candidate of possibleTtNames) {
        if (strippedLower === candidate || parts.some((p) => stripPrefix(p).toLowerCase() === candidate)) {
          bestMatch = path;
          break;
        }
      }

      if (bestMatch) break;
    }

    if (bestMatch) {
      mappings[internalField] = bestMatch;
      usedTtPaths.add(bestMatch);
    }
  }

  return mappings;
}

function stripKey(path: string): string {
  return path
    .split('.')
    .map((part) => {
      const trimmed = part.replace(/\[(first|last|item)\]$/, '');
      return stripPrefix(trimmed);
    })
    .join('.');
}

export function savePreset(preset: MappingPreset) {
  try {
    const stored = localStorage.getItem('tt-import-presets');
    const presets: MappingPreset[] = stored ? JSON.parse(stored) : [];
    const existing = presets.findIndex((p) => p.name === preset.name);
    if (existing >= 0) {
      presets[existing] = preset;
    } else {
      presets.push(preset);
    }
    localStorage.setItem('tt-import-presets', JSON.stringify(presets));
  } catch {
    /* localStorage not available */
  }
}

export function loadSavedPresets(): MappingPreset[] {
  try {
    const stored = localStorage.getItem('tt-import-presets');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function deleteSavedPreset(name: string) {
  try {
    const stored = localStorage.getItem('tt-import-presets');
    const presets: MappingPreset[] = stored ? JSON.parse(stored) : [];
    const filtered = presets.filter((p) => p.name !== name);
    localStorage.setItem('tt-import-presets', JSON.stringify(filtered));
  } catch {
    /* localStorage not available */
  }
}
