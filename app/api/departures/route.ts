import { NextResponse } from 'next/server';
import { Redis } from 'ioredis';
import { withApiKeyAuth } from '@/lib/api-key-auth';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
const consoleDebug = false; // Set to true to enable debug logging
// Allow disabling Redis via env
const REDIS_DISABLED =
  process.env.DISABLE_REDIS === 'true' || process.env.REDIS_DISABLED === 'true';

let redisClient: Redis | any;
let limiter: any;

if (!REDIS_DISABLED) {
  // 1. Initialize Redis with better error handling
  redisClient = new Redis(process.env.REDIS_URL!, {
    enableAutoPipelining: true,
    maxRetriesPerRequest: 3,
    // Add a generic error handler so it doesn't crash the server
    lazyConnect: true,
  });

  redisClient.on('error', (err: unknown) => console.error('Redis Client Error', err));

  // 2. Setup the rate limiter
  limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'api_limit',
    points: 2, // 2 requests
    duration: 1, // per 1 second
  });
} else {
  redisClient = { get: async (_: string) => null, set: async (_: string, __: string) => null, on: () => null } as unknown as Redis;
  limiter = new RateLimiterMemory({ points: 2, duration: 1 });
}

function log(message: string) {
  if (consoleDebug && consoleDebug === true) {
    console.log(`[API] ${message}`);
  }
}

// --- Types ---
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
  mode: 'bus' | 'train';
  rar: boolean | null;
  vehicle_info?: {
    type: string | null;
  };
  log_link: string;
  debug?: any;
}

function analyzeDepartures(departures: Departure[]) {
  return {
    contains_cancelled_services: departures.some(d => !!d.is_cancelled),
    contains_expected_times: departures.some(d => !!d.expected_departure),
    contains_platform_numbers: departures.some(d => !!d.platform && d.platform.trim() !== ""),
    contains_delays: departures.some(d => d.delay !== null && d.delay !== 0 && d.delay !== "0"),
  };
}

// --- Auth Cache ---
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getValidAccessToken(): Promise<string> {
  log(`Checking token validity. Cached exists: ${!!cachedToken}`);
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    log('Returning cached token.');
    return cachedToken;
  }

  const refreshToken = process.env.RTT_REFRESH_TOKEN;
  if (!refreshToken) {
    log('ERROR: RTT_REFRESH_TOKEN not configured in environment.');
    throw new Error('RTT_REFRESH_TOKEN not configured');
  }

  log('Fetching new access token...');
  const url = 'https://data.rtt.io/api/get_access_token';
  
  const response = await fetch(url, {
    method: 'GET', 
    headers: { 
      'Authorization': `Bearer ${refreshToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log(`Auth request failed with status: ${response.status}`);
    log(`Response body: ${errorBody}`);
    throw new Error(`Failed to refresh RTT access token: ${response.statusText}`);
  }

  const data = await response.json();
  log('Auth successful. Token received.');
  
  cachedToken = data.token; 
  tokenExpiry = new Date(data.validUntil).getTime(); 

  return cachedToken!;
}

// --- API Handler ---
export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  // Identify user by IP
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  try {
    // 3. Consume points. This will throw an error if rate limited
    await limiter.consume(ip);
  } catch (rejRes: any) {
    // This runs if the user is rate limited
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }
  
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "false";
  const type = searchParams.get('type');
  const code = searchParams.get('code');
  const date = searchParams.get('date');
  const time = searchParams.get('time');
  const pass = searchParams.get('pass') === 'show';
  const datetime = searchParams.get('datetime');
  const limit = searchParams.get('limit') || '15';

  log(`Incoming request: type=${type}, code=${code}`);

  if (!type || !code) {
    log('Missing parameters in request.');
    return NextResponse.json({ error: 'Missing type or code parameter' }, { status: 400 });
  }

  try {
    // --- Train Logic ---
    if (type === 'train') {
      log('Processing train request.');
      const token = await getValidAccessToken();
      let dateTimeQuery = '';
      if (date && time) {
        dateTimeQuery = date && time ? `&timeFrom=${encodeURIComponent(`${date}T${time}:00`)}` : '';
      } else if (datetime) {
        dateTimeQuery = `&timeFrom=${encodeURIComponent(datetime)}`;
      }
      // Fetch with detailed=true to ensure we get the full metadata
      // const fetchUrl = `https://data.rtt.io/rtt/location?code=gb-nr%3A${encodeURIComponent(code)}&detailed=true`;
      const fetchUrl = `https://data.rtt.io/gb-nr/location?code=${encodeURIComponent(code)}&detailed=true${dateTimeQuery}`;
      log(`Calling RTT API: ${fetchUrl}`);

      const response = await fetch(fetchUrl, {
        headers: { 
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); // Parse JSON safely
        
        // Handle the specific "outside permitted history" error gracefully
        if (errorData.errcode === 400 && errorData.error?.includes("outside your permitted history")) {
          log('RTT API error: Requesting date outside permitted history. Returning empty departures.');
          return NextResponse.json({ error: 'Requesting date outside permitted history.' }, { status: 481 });
        }

        // Handle other actual errors
        log(`RTT Data fetch failed: ${response.status} ${response.statusText}`);
        throw new Error(`RTT Fetch failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      log(`RTT Data received. Found ${data.services?.length || 0} services.`);

      // Enhanced Normalization
      const departures: Departure[] = (data.services || [])
        .map((item: any) => {
          const date = item.scheduleMetadata?.departureDate;
          const uid = item.scheduleMetadata?.identity;

          return {
            id: uid || null,
            service: item.scheduleMetadata?.trainReportingIdentity || null,
            service_link: uid && date ? `https://www.realtimetrains.co.uk/service/gb-nr:${uid}/${date}/detailed` : `#`,
            origin: item.origin?.[0]?.location?.description || null,
            destination: item.destination?.[0]?.location?.description || null,
            operator: item.scheduleMetadata?.operator?.name || null,
            operator_code: item.scheduleMetadata?.operator?.code || null,
            scheduled_departure: item.temporalData?.departure?.scheduleInternal || item.temporalData?.arrival?.scheduleInternal  || item.temporalData?.pass?.scheduleInternal || null,
            expected_departure: item.temporalData?.departure?.realtimeForecast || item.temporalData?.arrival?.realtimeForecast  || item.temporalData?.pass?.realtimeForecast || null,
            platform: item.locationMetadata?.platform?.actual || item.locationMetadata?.platform?.planned || null,
            displayAs: item.temporalData?.displayAs || null,
            status: item.temporalData?.status || null,
            is_cancelled: item.temporalData?.departure?.isCancelled ?? null,
            cancellation_reason: item.reasons?.[0]?.longText || null,
            delay: item.temporalData?.departure?.realtimeInternalLateness ?? null,
            mode: 'train',
            rar: item.scheduleMetadata?.runsAsRequired ?? null,
            vehicle_info: { 
              type: item.locationMetadata?.stockBranding || null,
              carrages: item.locationMetadata?.numberOfVehicles || null,
            },
            log_link: `/log?service_uid=${item.scheduleMetadata?.uniqueIdentity}`,
            debug: debug ? item : undefined,
          };
        })
        .filter((d: Departure) => {
          const displayAs = d.displayAs ? d.displayAs : '';

          if (displayAs && !pass) {
            return displayAs !== 'PASS';
          }
          return true;
        })
        .slice(0, limit);

      const attributions = ['Train departure data is sourced from <a style="color: var(--color-ts-accent);" href="https://www.realtimetrains.co.uk" target="_blank" rel="noopener noreferrer">realtimetrains.co.uk</a>'];

      const metadata = analyzeDepartures(departures);
      const debugRes = data;

      return NextResponse.json({ metadata, attributions, departures, debugRes });
    } 

    // --- Bus Logic ---
    else if (type === 'bus') {
      let dateTimeQuery = '';
      if (date && time) {
        dateTimeQuery = date && time ? `&when=${encodeURIComponent(`${date}T${time}:00`)}` : '';
      } else if (datetime) {
        dateTimeQuery = `&when=${encodeURIComponent(datetime)}`;
      }
      
      log('Processing bus request with metadata.');

      // Perform both calls concurrently
      const [timesRes, metaRes] = await Promise.all([
        fetch(`https://bustimes.org/stops/${code}/times.json?${dateTimeQuery}&limit=${limit}`),
        fetch(`https://bustimes.org/api/stops/${code}?format=json`)
      ]);
      
      if (!timesRes.ok) {
        log(`Bus times fetch failed: ${timesRes.status}`);
        throw new Error(`'Failed to fetch bus departure data (${timesRes.statusText}) - possibly invalid stop code or external API issue. | URL: https://bustimes.org/stops/${code}/times.json?${dateTimeQuery}&limit=${limit}`);
      }
      
      const timesData = await timesRes.json();
      
      // Handle metadata safely (if meta call fails, return empty metadata rather than crashing)
      let baseMetadata = { line_names: [], common_name: null, name: null, long_name: null };
      if (metaRes.ok) {
        const metaDataRaw = await metaRes.json();
        baseMetadata = {
            line_names: metaDataRaw.line_names || [],
            common_name: metaDataRaw.common_name || null,
            name: metaDataRaw.name || null,
            long_name: metaDataRaw.long_name || null,
        };

        if (!metaDataRaw.line_names) {
          return NextResponse.json({ error: 'No departures found.', baseMetadata }, { status: 482 });
        }
      } else {
        log(`Bus metadata fetch failed: ${metaRes.status}`);
      }

      if (!timesData.times || timesData.times.length === 0) {
        return NextResponse.json({ error: 'No bus times found.', baseMetadata }, { status: 480 });
      }

      const departures: Departure[] = (timesData.times || [])
        .map((item: any) => ({
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
          log_link: `/log?trip_id=${item.trip_id}`,
          debug: debug ? item : undefined,
        }))
        .slice(0, limit);

      const metadata = { ...baseMetadata, ...analyzeDepartures(departures) };
      const attributions = ['Bus departure data is sourced from <a style="color: var(--color-ts-accent);" href="https://bustimes.org" target="_blank" rel="noopener noreferrer">bustimes.org</a>'];
      const debugRes = timesData;

      // Return object with metadata at the top
      return NextResponse.json({ metadata, attributions, departures, debugRes });
    }

    log(`Invalid type requested: ${type}`);
    return NextResponse.json({ error: 'Invalid type. Use "bus" or "train".' }, { status: 400 });

  } catch (error: any) {
    log(`Caught error: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});