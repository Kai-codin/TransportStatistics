import { NextResponse } from 'next/server';

const debug = true;
const log = (msg: string, ...args: any[]) => {
  if (debug) console.log(`[RTT DEBUG] ${msg}`, ...args);
};

// --- Types ---
interface Departure {
  id: string;
  service: string | null;
  origin: string | null;
  destination: string | null;
  operator: string | null;
  operator_code: string | null;
  scheduled_departure: string | null;
  expected_departure: string | null;
  platform: string | null;
  status: string | null;
  is_cancelled: boolean | null;
  cancellation_reason: string | null;
  delay: string | number | null;
  mode: 'bus' | 'train';
  vehicle_info?: {
    type: string | null;
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
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "true";
  const type = searchParams.get('type');
  const code = searchParams.get('code');
  const date = searchParams.get('date');
  const time = searchParams.get('time');

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
      const dateTimeQuery = date && time ? `&timeFrom=${encodeURIComponent(`${date}T${time}:00`)}` : '';

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

      console.log('Sample RTT service item:', data.services?.[1]);

      // Enhanced Normalization
      const departures: Departure[] = (data.services || []).map((item: any) => ({
        id: item.scheduleMetadata?.identity || null,
        //service: "Train",
        service: item.scheduleMetadata?.trainReportingIdentity || null,
        origin: item.origin?.[0]?.location?.description || null,
        destination: item.destination?.[0]?.location?.description || null,
        operator: item.scheduleMetadata?.operator?.name || null,
        operator_code: item.scheduleMetadata?.operator?.code || null,
        scheduled_departure: item.temporalData?.departure?.scheduleInternal || null,
        expected_departure: item.temporalData?.departure?.realtimeForecast || item.temporalData?.departure?.realtimeActual || null,
        platform: item.locationMetadata?.platform?.actual || item.locationMetadata?.platform?.planned || null,
        status: item.temporalData?.displayAs || null,
        is_cancelled: item.temporalData?.departure?.isCancelled ?? null,
        cancellation_reason: item.reasons?.[0]?.longText || null,
        delay: item.temporalData?.departure?.realtimeInternalLateness ?? null,
        mode: 'train',
        vehicle_info: {
          type: item.locationMetadata?.stockBranding || null,
        },
        debug: debug ? item : undefined,
        log_link: `/log?service_uid=${item.scheduleMetadata?.uniqueIdentity}`,
      }));

      return NextResponse.json(departures);
    } 

    // --- Bus Logic ---
    else if (type === 'bus') {
      const dateTimeQuery = date && time ? `&when=${date}T${time}:00` : '';
      log('Processing bus request.');
      const response = await fetch(`https://bustimes.org/stops/${code}/times.json?${dateTimeQuery}`);
      
      if (!response.ok) {
        log(`Bus fetch failed: ${response.status}`);
        throw new Error('Failed to fetch bus data');
      }
      
      const data = await response.json();
      log(`Bus data received. Found ${data.times?.length || 0} times.`);

      if (!data.times || data.times.length === 0) {
        return NextResponse.json({ error: 'No bus times found for the given stop and time.' }, { status: 480 });
      }

      const departures: Departure[] = (data.times || []).map((item: any) => ({
        id: item.trip_id || null,
        service: item.service?.line_name || null,
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
        debug: debug ? item : undefined,
        log_link: `/log?trip_id=${item.trip_id}`,
      }));

      return NextResponse.json(departures);
    }

    log(`Invalid type requested: ${type}`);
    return NextResponse.json({ error: 'Invalid type. Use "bus" or "train".' }, { status: 400 });

  } catch (error: any) {
    log(`Caught error: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}