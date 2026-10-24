// AQUA TV v1.3 — браузерные настройки. Без PHP/Python и без npm-пакетов.
window.AQUA_CONFIG = {
  playlistUrl: './playlist.m3u',
  // Source used by the optional JS updater on localhost and in GitHub Actions.
  // Browser uses it only as a fallback if the same-origin file is absent.
  epgUrl: 'https://iptvx.one/EPG',
  epgFallbackUrl: './epg.xml.gz',
  epgMetaUrl: './epg-meta.json',
  epgPreferLocal: true,
  epgCacheHours: 24,
  epgDaysAhead: 3,
  epgCheckMinutes: 15,
  requestTimeoutMs: 90000
};
