import { NextResponse } from 'next/server';
import { GET as getDepartures } from '../route';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get('code') || 'SOT';
  const type = searchParams.get('type') || 'train';

  const start = Date.now();

  try {
    const internalRequest = new Request(
      `${new URL(request.url).origin}/api/departures?code=${code}&type=${type}`,
      { headers: request.headers }
    );

    const res = await getDepartures(internalRequest);

    const duration = Date.now() - start;

    if (!res.ok) {
      return NextResponse.json(
        {
          status: 'fail',
          ok: false,
          statusCode: res.status,
          responseTimeMs: duration,
        },
        { status: 500 }
      );
    }

    const data = await res.json();

    return NextResponse.json({
      status: 'ok',
      ok: true,
      responseTimeMs: duration,
      hasData: Array.isArray(data.departures),
      departureCount: data.departures?.length ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: 'error',
        ok: false,
        message,
      },
      { status: 500 }
    );
  }
}