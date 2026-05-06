// app/api/proxy/map-style/route.ts
import { NextResponse } from 'next/server';
import { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

// 1. Initialize Redis with better error handling
const redisClient = new Redis(process.env.REDIS_URL!, {
  enableAutoPipelining: true,
  maxRetriesPerRequest: 3,
  // Add a generic error handler so it doesn't crash the server
  lazyConnect: true,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

// 2. Setup the rate limiter
const limiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'api_limit',
  points: 5, // 5 requests
  duration: 1, // per 1 second
});

const PRIMARY_STYLE_URL = "https://tiles.fluffynet.dev/styles/dark/style.json";
const FALLBACK_STYLE_URL = "https://api.maptiler.com/maps/openstreetmap/style.json?key=" + process.env.MAPTILER_KEY;

// Helper function to sanitize attribution
const sanitizeStyle = (styleData: any, isFallback: boolean = false) => {
  if (isFallback) {
        if (styleData.sources) {
      for (const key in styleData.sources) {
        // Overwrite the attribution for every source
        styleData.sources[key].attribution = `<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>`;
      }
    }
    return styleData;
  } else {
    if (styleData.sources) {
      for (const key in styleData.sources) {
        // Overwrite the attribution for every source
        styleData.sources[key].attribution = "<a href='https://www.openstreetmap.org/copyright'>Map data © OpenStreetMap contributors</a> | Hosted by <a href='https://tiles.fluffynet.dev/'>FluffyNet</a>";styleData.sources[key].attribution = `Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> | Hosted by <a href="https://tiles.fluffynet.dev/" target="_blank" rel="noopener noreferrer">FluffyNet</a>`;
      }
    }
    return styleData;
  }
};

export async function GET(request: Request) {
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
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(PRIMARY_STYLE_URL, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) throw new Error('Primary style returned non-200 status');

    const styleData = await response.json();
    return NextResponse.json(sanitizeStyle(styleData, false));

  } catch (error) {
    console.warn("Primary style unreachable, switching to fallback.");
    
    const fallbackResponse = await fetch(FALLBACK_STYLE_URL);
    const fallbackData = await fallbackResponse.json();
    
    return NextResponse.json(sanitizeStyle(fallbackData, true));
  } finally {
    clearTimeout(timeoutId);
  }
}