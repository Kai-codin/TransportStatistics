import { NextResponse } from 'next/server';
import { withApiKeyAuth } from '@/lib/api-key-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { buildBustimesUrl, getBustimesBaseUrl } from '@/lib/bustimes-source';

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
  mode: 'bus';
  rar: boolean | null;
  log_link: string;
  _atcoCode: string;
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
  const type = searchParams.get('type');
  const datetime = searchParams.get('datetime');
  const limit = parseInt(searchParams.get('limit') || '15');

  if (!codesParam || !type) {
    return NextResponse.json({ error: 'Missing codes or type parameter' }, { status: 400 });
  }

  if (type !== 'bus') {
    return NextResponse.json({ error: 'Batch endpoint only supports bus type' }, { status: 400 });
  }

  const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean).slice(0, 6);

  if (codes.length === 0) {
    return NextResponse.json({ error: 'No valid codes provided' }, { status: 400 });
  }

  const dateTimeQuery = datetime ? `&when=${encodeURIComponent(datetime)}` : '';

  const results = await Promise.allSettled(
    codes.map(async (code) => {
      const timesUrl = buildBustimesUrl(bustimesBaseUrl, `/stops/${code}/times.json?limit=${limit}${dateTimeQuery}`);
      const res = await fetch(timesUrl);

      if (!res.ok) {
        return { code, departures: [] };
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
        log_link: `/log?service_id=${item.trip_id}&date=${item.aimed_departure_time?.split('T')[0]}`,
        _atcoCode: code,
      }));

      return { code, departures };
    })
  );

  const allDepartures: Departure[] = [];
  const stopCodes: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allDepartures.push(...result.value.departures);
      stopCodes.push(result.value.code);
    }
  }

  allDepartures.sort((a, b) => {
    const aTime = a.scheduled_departure || '';
    const bTime = b.scheduled_departure || '';
    return aTime.localeCompare(bTime);
  });

  const sliced = allDepartures.slice(0, limit);

  const contains_expected_times = sliced.some(d => !!d.expected_departure);

  return NextResponse.json({
    metadata: {
      stopCodes,
      contains_expected_times,
    },
    attributions: ['Bus departure data is sourced from <a style="color: var(--color-ts-accent);" href="https://bustimes.org" target="_blank" rel="noopener noreferrer">bustimes.org</a>'],
    departures: sliced,
  });
});
