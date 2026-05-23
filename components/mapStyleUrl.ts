export function getMapStyleUrl() {
  if (typeof document === 'undefined') {
    return '/api/proxy/map-style';
  }

  const theme = document.documentElement.dataset.tsTheme;
  if (theme && theme !== 'dark') {
    return `/api/proxy/map-style?theme=${encodeURIComponent(theme)}`;
  }

  return '/api/proxy/map-style';
}