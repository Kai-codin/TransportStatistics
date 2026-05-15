// app/api/proxy/map-style/route.ts
import { NextResponse } from 'next/server';

const PRIMARY_STYLE_URL = "https://tiles.fluffynet.dev/styles/dark/style.json";
const FALLBACK_STYLE_URL = process.env.MAPTILER_KEY 
  ? `https://api.maptiler.com/maps/openstreetmap/style.json?key=${process.env.MAPTILER_KEY}` 
  : null;

const LOCAL_FALLBACK_STYLE = {
  version: 8,
  name: 'TransportStatistics fallback',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    },
  },
  layers: [
    {
      id: 'osm-base',
      type: 'raster',
      source: 'osm',
    },
  ],
};

// Helper function to sanitize attribution (Deep clones to prevent object mutation)
const sanitizeStyle = (styleData: any, isFallback: boolean = false) => {
  const clonedStyle = JSON.parse(JSON.stringify(styleData));

  if (clonedStyle.sources) {
    for (const key in clonedStyle.sources) {
      if (isFallback) {
        clonedStyle.sources[key].attribution = `<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>`;
      } else {
        clonedStyle.sources[key].attribution = `Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> | Hosted by <a href="https://tiles.fluffynet.dev/" target="_blank" rel="noopener noreferrer">FluffyNet</a>`;
      }
    }
  }
  return clonedStyle;
};

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(PRIMARY_STYLE_URL, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Origin': 'https://dev.transportstatistics.com',
        'Referer': 'https://dev.transportstatistics.com/',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!response.ok) throw new Error(`Primary style returned non-200 status: ${response.status}`);

    const styleData = await response.json();
    return NextResponse.json(sanitizeStyle(styleData, false));

  } catch (error) {
    // Safely extract the error message from 'unknown' type
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Primary style unreachable, switching to fallback. Error: ${errorMessage}`);

    if (FALLBACK_STYLE_URL) {
      try {
        const fallbackResponse = await fetch(FALLBACK_STYLE_URL, { cache: 'no-store' });

        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          fallbackData.metadata = {
            ...fallbackData.metadata,
            note: `Primary style unreachable, switching to fallback. Error: ${errorMessage}`
          };
          return NextResponse.json(sanitizeStyle(fallbackData, true));
        }
      } catch (fallbackError) {
        // Safely handle the nested catch block error as well
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.warn(`Hosted fallback style unavailable, using local fallback style. Error: ${fallbackErrorMessage}`);
      }
    }

    // Pass true here so it formats the local fallback properly and safely returns a copy
    return NextResponse.json(sanitizeStyle(LOCAL_FALLBACK_STYLE, true));
  } finally {
    clearTimeout(timeoutId);
  }
}