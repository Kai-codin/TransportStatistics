import type { ThemeKey } from "@/components/ThemeProvider";

export function getMapStyleUrl(theme?: ThemeKey) {
  if (!theme) {
    return '/api/proxy/map-style';
  }

  if (theme && theme !== 'dark') {
    return `/api/proxy/map-style?theme=${encodeURIComponent(theme)}`;
  }

  return '/api/proxy/map-style';
}