// Minimal offline app-shell cache for Daybreak.
// Live data (weather/air-quality/geocoding) is always fetched fresh from the network;
// only the static shell is cached so the app still opens (with last-saved data
// from localStorage) when there's no connection.

const CACHE_NAME = 'daybreak-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always go to the network for live data.
  const isApi = url.hostname.endsWith('open-meteo.com') || url.hostname.endsWith('bigdatacloud.net');
  if (isApi) return;

  if (event.request.method !== 'GET') return;

  // Network-first: always prefer whatever's actually on disk right now,
  // and only fall back to the last cached copy if there's no connection.
  // (An earlier cache-first version of this file caused edited files to
  // keep showing their old, cached content — this avoids that class of bug.)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
