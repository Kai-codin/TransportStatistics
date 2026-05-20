import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get('code') || 'SOT';
  const type = searchParams.get('type') || 'train';
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const start = Date.now();

  try {
    const res = await fetch(
        `${baseUrl}/api/departures?code=${code}&type=${type}`,
        { cache: 'no-store' }
    );

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
  } catch (err: any) {
    return NextResponse.json(
      {
        status: 'error',
        ok: false,
        message: err.message,
      },
      { status: 500 }
    );
  }
}