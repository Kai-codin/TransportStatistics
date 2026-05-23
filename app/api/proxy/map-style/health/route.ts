import { NextResponse } from 'next/server';
import { GET as getMapStyle } from '../route';
import { withApiKeyAuth } from '@/lib/api-key-auth';

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const start = Date.now();

  try {
    const res = await getMapStyle();

    const duration = Date.now() - start;

    if (!res.ok) {
      return NextResponse.json({
        status: 'fail',
        ok: false,
        statusCode: res.status,
        responseTimeMs: duration,
      }, { status: 500 });
    }

    const data = await res.json();

    // ✅ Validate map style instead of departures
    const isValidStyle =
      typeof data === 'object' &&
      data !== null &&
      data.version === 8 &&
      typeof data.sources === 'object' &&
      typeof data.layers === 'object';

    return NextResponse.json({
      status: isValidStyle ? 'ok' : 'invalid',
      ok: isValidStyle,
      responseTimeMs: duration,
      hasSources: !!data.sources,
      layerCount: Array.isArray(data.layers) ? data.layers.length : 0,
      timestamp: new Date().toISOString(),
    }, {
      status: isValidStyle ? 200 : 500
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      status: 'error',
      ok: false,
      message,
    }, { status: 500 });
  }
});