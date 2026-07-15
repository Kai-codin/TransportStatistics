import { NextResponse } from 'next/server';
import { withApiKeyAuth } from '@/lib/api-key-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { buildBustimesUrl, getBustimesBaseUrl } from '@/lib/bustimes-source';
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Departure {
  id: string | null;
  service: string | null;
  service_link: string;
  origin: string | null;
  destination: string | null;
  operator: string | null;
  operator_code: string | null;
  scheduled_departure: string | null;
  expected_departure: string | null;
  platform: string | null;
  displayAs: string | null;
  status: string | null;
  is_cancelled: boolean | null;
  cancellation_reason: string | null;
  delay: string | number | null;
  mode: 'bus' | 'tube';
  rar: boolean | null;
  log_link: string;
  _atcoCode: string;
  tfl_current_location?: string | null;
  tfl_expected_arrival?: string | null;
  tfl_platform_name?: string | null;
  tfl_mode_name?: string | null;
  tfl_time_to_station?: number | null;
  tfl_vehicle_id?: string | null;
  tfl_destination_name?: string | null;
}

interface TflPrediction {
  id: string;
  vehicleId: string;
  naptanId: string;
  stationName: string;
  lineId: string;
  lineName: string;
  platformName: string;
  direction: string;
  destinationName: string;
  timestamp: string;
  timeToStation: number;
  currentLocation: string;
  towards: string;
  expectedArrival: string;
  timeToLive: string;
  modeName: string;
}

function cleanTflDestinationName(name: string | null): string | null {
  if (!name) return null;
  return name
    .replace(/ Underground Station/g, "")
    .replace(/\s*\((?:north|south|east|west)bound\)\s*/g, "")
    .trim();
}

function cleanTflPlatform(platform: string | null): string | null {
  if (!platform) return null;
  const match = platform.match(/Platform\s+(\d+)/i);
  if (match) return match[1];
  if (/^\d+$/.test(platform.trim())) return platform.trim();
  return platform;
}

// Converts a NaPTAN-style "9400ZZ..." acto code into the TFL-style "940G..." code.
// TFL's StopPoint API generally expects the "940G" prefix rather than "9400ZZ".
// This applies to all TFL modes (tube, DLR, overground, etc.), not just underground ("LU").
function convertToTflStopCode(actoCode: string): string | null {
  if (!actoCode.startsWith("9400ZZ")) return null;
  const converted = "940G" + actoCode.slice(4);
  return converted !== actoCode ? converted : null;
}

function matchTFLtoBustimes(
  tflPredictions: TflPrediction[],
  bustimesDepartures: Departure[]
): { matched: Map<number, TflPrediction>; unmatched: TflPrediction[] } {
  const matched = new Map<number, TflPrediction>();
  const usedTFL = new Set<number>();

  for (let tflIdx = 0; tflIdx < tflPredictions.length; tflIdx++) {
    const tfl = tflPredictions[tflIdx];
    const tflLine = tfl.lineName?.toLowerCase();

    let bestMatchIdx = -1;
    let bestScore = -1;

    for (let busIdx = 0; busIdx < bustimesDepartures.length; busIdx++) {
      const bus = bustimesDepartures[busIdx];
      const busLine = bus.service?.toLowerCase();

      if (busLine !== tflLine) continue;

      const tflDest = (tfl.destinationName || '').toLowerCase();
      const busDest = (bus.destination || '').toLowerCase();

      let score = 0;
      if (busDest && tflDest) {
        if (busDest === tflDest) {
          score += 2;
        } else if (tflDest.includes(busDest) || busDest.includes(tflDest)) {
          score += 1;
        }
      }
      score += 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestMatchIdx = busIdx;
      }
    }

    if (bestMatchIdx >= 0) {
      matched.set(bestMatchIdx, tfl);
      usedTFL.add(tflIdx);
    }
  }

  const unmatched = tflPredictions.filter((_, idx) => !usedTFL.has(idx));
  return { matched, unmatched };
}

async function fetchTflArrivals(
  stopId: string,
  appId: string,
  appKey: string,
  signal: AbortSignal,
): Promise<TflPrediction[]> {
  const url = `https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stopId)}/Arrivals?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  try {
    await checkRateLimit(ip);
  } catch {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  const bustimesBaseUrl = await getBustimesBaseUrl("departures", _auth?.userId);

  const { searchParams } = new URL(request.url);
  const codesParam = searchParams.get('codes');
  const namesParam = searchParams.get('names');
  const type = searchParams.get('type');
  const datetime = searchParams.get('datetime');
  const region = searchParams.get('region');
  const limit = parseInt(searchParams.get('limit') || '15');

  if ((!codesParam && !namesParam) || !type) {
    return NextResponse.json({ error: 'Missing codes, names, or type parameter' }, { status: 400 });
  }

  if (type !== 'bus' && region !== 'london') {
    return NextResponse.json({ error: 'Batch endpoint only supports bus type' }, { status: 400 });
  }

  const codes = (codesParam || '').split(',').map(c => c.trim()).filter(Boolean).slice(0, 12);

  // Resolve stop names to TFL actoCodes via tflStops table
  const namesToActoCodes = new Map<string, string>();
  if (namesParam) {
    const names = namesParam.split(',').map(n => n.trim()).filter(Boolean);
    for (const name of names) {
      try {
        const results = await fetchQuery(api.functions.tflStops.searchStopsByName, { name, limit: 1 });
        if (results.length > 0) {
          namesToActoCodes.set(name, results[0].actoCode);
        }
      } catch {
        // tflStops not available; skip name resolution
      }
    }
  }

  const isLondon = region === 'london';
  const dateTimeQuery = datetime ? `&when=${encodeURIComponent(datetime)}` : '';

  const bustimesResults = await Promise.allSettled(
    codes.map(async (code) => {
      const timesUrl = buildBustimesUrl(bustimesBaseUrl, `/stops/${code}/times.json?limit=${limit}${dateTimeQuery}`);
      const res = await fetch(timesUrl);

      if (!res.ok) {
        return { code, departures: [] as Departure[] };
      }

      const data = await res.json();
      const departures: Departure[] = (data.times || []).map((item: any) => ({
        id: item.trip_id || null,
        service: item.service?.line_name || null,
        service_link: item.trip_id ? `https://bustimes.org/trips/${item.trip_id}` : '#',
        origin: null,
        destination: item.destination?.name || null,
        operator: item.service?.operators?.[0]?.name || null,
        operator_code: item.service?.operators?.[0]?.id || null,
        scheduled_departure: item.aimed_departure_time || null,
        expected_departure: item.expected_departure_time || null,
        platform: null,
        status: null,
        is_cancelled: null,
        cancellation_reason: null,
        delay: item.delay || null,
        mode: 'bus',
        rar: null,
        log_link: `/log?service_id=${item.trip_id}&date=${item.aimed_departure_time?.split('T')[0]}&stop_code=${code}`,
        _atcoCode: code,
      }));

      return { code, departures };
    })
  );

  const tflResults = new Map<string, TflPrediction[]>();
  if (isLondon) {
    // Combine original codes with name-resolved actoCodes for TFL lookups
    const tflCodes = [
      ...codes,
      ...Array.from(namesToActoCodes.values()).filter(c => !codes.includes(c)),
    ];

    const tflFetches = await Promise.allSettled(
      tflCodes.map(async (tflCode) => {
        const tflAppId = process.env.TFL_APP_ID || '';
        const tflAppKey = process.env.TFL_APP_KEY || '';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          let actoCode = tflCode;

          // Try the Convex lookup first with the raw code, then also with the
          // "940G"-converted form, since tflStops may store either format.
          try {
            let tflStop = await fetchQuery(api.functions.tflStops.getStopByActoCode, { actoCode: tflCode });
            if (!tflStop) {
              const converted = convertToTflStopCode(tflCode);
              if (converted) {
                tflStop = await fetchQuery(api.functions.tflStops.getStopByActoCode, { actoCode: converted });
              }
            }
            if (tflStop?.actoCode) actoCode = tflStop.actoCode;
          } catch {
            // tflStops table may not exist yet; fall back to original code
          }

          let predictions = await fetchTflArrivals(actoCode, tflAppId, tflAppKey, controller.signal);

          // If the arrivals API returned no results and the code uses the
          // "9400ZZ..." NaPTAN format, retry with the "940G..." TFL format.
          // (Previously this only matched underground codes via
          // startsWith("9400ZZLU"), missing stops like Battersea Power
          // Station whose acto code is "9400ZZBPSUST".)
          if (predictions.length === 0) {
            const convertedCode = convertToTflStopCode(actoCode);
            if (convertedCode) {
              predictions = await fetchTflArrivals(convertedCode, tflAppId, tflAppKey, controller.signal);
            }
          }

          return { code: tflCode, predictions };
        } finally {
          clearTimeout(timeoutId);
        }
      })
    );

    for (const result of tflFetches) {
      if (result.status === 'fulfilled') {
        tflResults.set(result.value.code, result.value.predictions);
      }
    }
  }

  const allBustimesDepartures: { departures: Departure[]; code: string }[] = [];
  const stopCodes: string[] = [];
  const allTflPredictions: { prediction: TflPrediction; code: string }[] = [];

  for (const result of bustimesResults) {
    if (result.status === 'fulfilled') {
      const { code, departures } = result.value;
      allBustimesDepartures.push({ departures, code });
      stopCodes.push(code);

      const codePredictions = tflResults.get(code) || [];
      for (const p of codePredictions) {
        allTflPredictions.push({ prediction: p, code });
      }
    }
  }

  // Also include TFL predictions for codes resolved from names that have no bustimes result
  for (const [code, predictions] of tflResults) {
    if (!stopCodes.includes(code)) {
      for (const p of predictions) {
        allTflPredictions.push({ prediction: p, code });
      }
      stopCodes.push(code);
    }
  }

  const flatBustimes = allBustimesDepartures.flatMap(b => b.departures);
  const flatTfl = allTflPredictions.map(t => t.prediction);

  let allDepartures: Departure[];

  if (flatTfl.length > 0) {
    const { matched, unmatched } = matchTFLtoBustimes(flatTfl, flatBustimes);

    allDepartures = flatBustimes.map((dep, idx) => {
      const tfl = matched.get(idx);
      if (tfl) {
        return {
          ...dep,
          tfl_current_location: tfl.currentLocation || null,
          tfl_expected_arrival: tfl.expectedArrival || null,
          tfl_platform_name: cleanTflPlatform(tfl.platformName),
          tfl_mode_name: tfl.modeName || null,
          tfl_time_to_station: tfl.timeToStation || null,
          tfl_vehicle_id: tfl.vehicleId || null,
          tfl_destination_name: cleanTflDestinationName(tfl.destinationName),
        };
      }
      return dep;
    });

    const tflCodeMap = new Map<TflPrediction, string>();
    for (const { prediction, code } of allTflPredictions) {
      tflCodeMap.set(prediction, code);
    }

    for (const tfl of unmatched) {
      const code = tflCodeMap.get(tfl) || stopCodes[0] || '';
      allDepartures.push({
        id: tfl.id || null,
        service: tfl.lineName || null,
        service_link: `https://tfl.gov.uk/tube/route/${tfl.lineId || ''}/`,
        origin: null,
        destination: cleanTflDestinationName(tfl.destinationName),
        operator: tfl.modeName === 'tube' ? 'London Underground' : 'Transport for London',
        operator_code: 'TFL',
        scheduled_departure: tfl.expectedArrival || null,
        expected_departure: tfl.expectedArrival || null,
        platform: cleanTflPlatform(tfl.platformName),
        displayAs: null,
        status: null,
        is_cancelled: null,
        cancellation_reason: null,
        delay: null,
        mode: 'tube',
        rar: null,
        log_link: '#',
        _atcoCode: code,
        tfl_current_location: tfl.currentLocation || null,
        tfl_expected_arrival: tfl.expectedArrival || null,
        tfl_platform_name: cleanTflPlatform(tfl.platformName),
        tfl_mode_name: tfl.modeName || null,
        tfl_time_to_station: tfl.timeToStation || null,
        tfl_vehicle_id: tfl.vehicleId || null,
        tfl_destination_name: cleanTflDestinationName(tfl.destinationName),
      });
    }
  } else {
    allDepartures = flatBustimes;
  }

  allDepartures.sort((a, b) => {
    const aTime = a.tfl_expected_arrival || a.scheduled_departure || '';
    const bTime = b.tfl_expected_arrival || b.scheduled_departure || '';
    return aTime.localeCompare(bTime);
  });

  const sliced = allDepartures.slice(0, limit);

  const contains_expected_times = sliced.some(d => !!d.expected_departure || !!d.tfl_expected_arrival);
  const contains_platform_numbers = sliced.some(d => !!d.platform || !!d.tfl_platform_name);

  return NextResponse.json({
    metadata: {
      stopCodes,
      contains_expected_times,
      contains_platform_numbers,
      is_london_area: isLondon,
    },
    attributions: [
      'Bus departure data is sourced from <a style="color: var(--color-ts-accent);" href="https://bustimes.org" target="_blank" rel="noopener noreferrer">bustimes.org</a>',
      ...(isLondon ? ['Tube & rail data is sourced from <a style="color: var(--color-ts-accent);" href="https://api.tfl.gov.uk" target="_blank" rel="noopener noreferrer">TFL API</a>'] : []),
    ],
    departures: sliced,
  });
});