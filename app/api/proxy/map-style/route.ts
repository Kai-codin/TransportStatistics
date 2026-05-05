// app/api/proxy/map-style/route.ts
import { NextResponse } from 'next/server';

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

export async function GET() {
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