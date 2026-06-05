export function parseTTFile(text: string): { trips: Record<string, unknown>[] } {
  const parsed = JSON.parse(text);

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error('TT export array is empty');
    return { trips: parsed as Record<string, unknown>[] };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('TT export must be a JSON object or array');
  }

  return { trips: [parsed as Record<string, unknown>] };
}

export function findField(data: Record<string, unknown>, prefix: string): string | undefined {
  const regex = new RegExp(`^${escapeRegex(prefix)}[a-f0-9]*$`, 'i');
  return Object.keys(data).find((key) => regex.test(key));
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getFieldValue(data: Record<string, unknown>, ...prefixes: string[]): unknown {
  for (const prefix of prefixes) {
    const key = findField(data, prefix);
    if (key !== undefined) return data[key];
  }
  return undefined;
}

export function getFieldArray(data: Record<string, unknown>, prefix: string): unknown[] {
  const key = findField(data, prefix);
  if (!key) return [];
  const val = data[key];
  return Array.isArray(val) ? val : [];
}

export function resolvePath(data: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;

  const parts = path.split('.');
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    const match = part.match(/^(\w+)\[(first|last|item|(\d+))\]$/);
    if (match) {
      const [, arrayName, selector, indexStr] = match;
      const arr = getCurrentArray(current, arrayName);
      if (!Array.isArray(arr)) return undefined;

      if (selector === 'first') current = arr[0] ?? undefined;
      else if (selector === 'last') current = arr[arr.length - 1] ?? undefined;
      else if (selector === 'item') current = arr;
      else current = arr[Number(indexStr)] ?? undefined;
    } else {
      current = getCurrentValue(current, part);
    }
  }

  return current;
}

export function getCurrentArray(data: unknown, arrayName: string): unknown[] {
  if (typeof data !== 'object' || data === null) return [];
  const obj = data as Record<string, unknown>;
  const key = findField(obj, arrayName);
  if (!key) return [];
  const val = obj[key];
  return Array.isArray(val) ? val : [];
}

export function getCurrentValue(data: unknown, fieldName: string): unknown {
  if (typeof data !== 'object' || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  const key = findField(obj, fieldName);
  return key !== undefined ? obj[key] : undefined;
}

export function resolveArrayItems(data: Record<string, unknown>, path: string): unknown[] {
  const parts = path.split('.');
  let current: unknown = data;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || current === undefined) return [];

    const match = part.match(/^(\w+)\[(first|last|item|(\d+))\]$/);
    if (match) {
      const [, arrayName, selector] = match;
      const arr = getCurrentArray(current, arrayName);
      if (!Array.isArray(arr)) return [];

      if (selector === 'item') {
        const remainingPath = parts.slice(i + 1).join('.');
        if (!remainingPath) return arr;

        return arr
          .map((item) => {
            if (typeof item !== 'object' || item === null) return undefined;
            return resolvePath(item as Record<string, unknown>, remainingPath);
          })
          .filter((v): v is unknown => v !== undefined);
      }

      if (selector === 'first') current = arr[0] ?? undefined;
      else if (selector === 'last') current = arr[arr.length - 1] ?? undefined;
      else current = arr[Number(selector)] ?? undefined;
    } else {
      current = getCurrentValue(current, part);
    }
  }

  return [];
}

export function flattenTTKeys(data: Record<string, unknown>, prefix = ''): string[] {
  if (data === null || data === undefined) return [];
  const keys: string[] = [];
  const entries = Object.entries(data);

  if (!prefix) {
    for (const [key, value] of entries) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys.push(...flattenTTKeys(value as Record<string, unknown>, key));
      } else if (Array.isArray(value) && value.length > 0) {
        const sample = value[0];
        keys.push(`${key}[item]`);
        keys.push(`${key}[first]`);
        keys.push(`${key}[last]`);
        if (typeof sample === 'object' && sample !== null) {
          keys.push(...flattenTTKeys(sample as Record<string, unknown>, `${key}[item]`));
        }
      } else {
        keys.push(key);
      }
    }
  } else {
    for (const [key, value] of entries) {
      const path = `${prefix}.${key}`;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys.push(path);
        keys.push(...flattenTTKeys(value as Record<string, unknown>, path));
      } else if (Array.isArray(value) && value.length > 0) {
        const sample = value[0];
        keys.push(`${path}[item]`);
        keys.push(`${path}[first]`);
        keys.push(`${path}[last]`);
        if (typeof sample === 'object' && sample !== null) {
          keys.push(...flattenTTKeys(sample as Record<string, unknown>, `${path}[item]`));
        }
      } else {
        keys.push(path);
      }
    }
  }

  return keys;
}

export function stripPrefix(name: string): string {
  return name.replace(/[a-f0-9]{6,}$/i, '');
}

export function displayPath(path: string): string {
  return path
    .split('.')
    .map((part) => {
      const bracketMatch = part.match(/^(\w+)(\[.*\])$/);
      if (bracketMatch) {
        return stripPrefix(bracketMatch[1]) + bracketMatch[2];
      }
      return stripPrefix(part);
    })
    .join('.');
}

export function sampleTTData(data: Record<string, unknown>) {
  const nodesKey = findField(data, 'nodes');
  const consistKey = findField(data, 'consist');
  const nodes: unknown[] = nodesKey ? (Array.isArray(data[nodesKey]) ? data[nodesKey] : []) : [];
  const consist: unknown[] = consistKey ? (Array.isArray(data[consistKey]) ? data[consistKey] : []) : [];

  const rideName = getFieldValue(data, 'rideName', 'ride_name', 'tripName');
  const organisation = getFieldValue(data, 'organisation', 'organization', 'org');

  return {
    rideName: String(rideName ?? ''),
    organisation: String(organisation ?? ''),
    nodeCount: nodes.length,
    consistCount: consist.length,
    firstNode: nodes.length > 0 ? (nodes[0] as Record<string, unknown>) : null,
    lastNode: nodes.length > 0 ? (nodes[nodes.length - 1] as Record<string, unknown>) : null,
    firstConsist: consist.length > 0 ? (consist[0] as Record<string, unknown>) : null,
  };
}
