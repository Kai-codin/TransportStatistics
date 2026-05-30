import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

// 1. Your helper function can stay exactly as it is (just remove 'export' if you don't need it elsewhere)
async function getTrainAllocation(uid: string, date: string): Promise<string[]> {
  const url = `https://www.realtimetrains.co.uk/service/gb-nr:${uid}/${date}/detailed`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text(); 
    console.error(`RTT Failed: ${response.status} ${response.statusText}`);
    console.error(`Response Body Preview: ${errorText.substring(0, 200)}`);
    throw new Error(`Failed to fetch data from Realtime Trains: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const allocationText = $('.op').text();
  if (!allocationText) return [];

  const vehicles = allocationText.split('+').map(v => v.trim());
  return vehicles.map(v => v.split(' (')[0].trim());
}

// 2. CRITICAL: Next.js needs this explicit, capitalized named export to recognize the API route
export async function GET(request: NextRequest) {
  try {
    // Extract query parameters from the request URL (e.g., /api/allocation?uid=123&date=2026-05-29)
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get('uid');
    const date = searchParams.get('date');

    if (!uid || !date) {
      return NextResponse.json(
        { error: 'Missing required query parameters: uid and date' },
        { status: 400 }
      );
    }

    const allocation = await getTrainAllocation(uid, date);
    
    return NextResponse.json({ allocation });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}