// Service Worker - Ascolto la Musica (versione autonoma)
// Strategia: cache-first per gli asset statici della stessa origine.
// I dati dell'app NON passano di qui (localStorage + IndexedDB).
const CACHE_NAME = 'ascolto_la_musica_standalone_v1.0';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/storage.js',
  './js/app.js',
  './js/switch2.js',
  './js/lib/lame.min.js',
  './manifest.json',
  './assets/fonts/bootstrap-icons/bootstrap-icons.css',
  './assets/fonts/bootstrap-icons/bootstrap-icons.woff',
  './assets/fonts/bootstrap-icons/bootstrap-icons.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// Install: precache degli asset statici
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(URLS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: pulizia delle cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((name) => (name !== CACHE_NAME ? caches.delete(name) : null))
    )).then(() => self.clients.claim())
  );
});

// Fetch: cache-first SOLO per la stessa origine; il resto (YouTube, thumbnail)
// passa direttamente alla rete senza intercettazione.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (!request.url.startsWith(self.location.origin)) {
    return; // Cross-origin: gestione predefinita del browser
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (response && response.status === 200 && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      });
    })
  );
});
