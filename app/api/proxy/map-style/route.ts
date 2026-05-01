// app/api/proxy/map-style/route.ts
import { NextResponse } from 'next/server';

const PRIMARY_STYLE_URL = "https://disabled.maps.fluffynet.dev/styles/dark/style.json";
const FALLBACK_STYLE_URL = "https://api.maptiler.com/maps/openstreetmap/style.json?key=ghAzCSy39lRpGskkQ68J";

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // Fail fast

  try {
    const response = await fetch(PRIMARY_STYLE_URL, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) throw new Error('Primary style returned non-200 status');

    const styleData = await response.json();
    
    // Safety check: Does the style contain obviously broken references?
    // If you see specific errors for 'planet.json', you might want to switch 
    // to fallback here if you detect that specific string in the response.
    return NextResponse.json(styleData);

  } catch (error) {
    console.warn("Primary style unreachable, switching to fallback.");
    
    // Fetch and return the fallback instead
    const fallbackResponse = await fetch(FALLBACK_STYLE_URL);
    const fallbackData = await fallbackResponse.json();
    
    return NextResponse.json(fallbackData);
  } finally {
    clearTimeout(timeoutId);
  }
}