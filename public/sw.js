// Orbit service worker – offline-håndtering for PWA'en.
// Der bruges kun ét cache-navn, og gamle caches ryddes op ved aktivering.

const CACHE_NAME = 'orbit-v1';

// App-skallen caches ved installation, så "/"-fallback virker offline med det samme.
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest'];

// Installér: forud-cache app-skallen og aktivér med det samme.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Aktivér: slet alle caches, der ikke længere bruges (kun "orbit-v1" må overleve).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// Håndter kun GET-anmodninger til samme oprindelse som service worker'en.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigationsanmodninger (sideindlæsninger): network-first.
  // Offline falder vi tilbage til den cachede app-skal ("/").
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const kopi = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', kopi));
          return response;
        })
        .catch(async () => {
          const cachet = await caches.match('/');
          return (
            cachet ||
            new Response('Orbit er offline, og appen er ikke cachet endnu.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        })
    );
    return;
  }

  // Andre GET-anmodninger (assets, ikoner m.m.): cache-first, mens cachen
  // opdateres fra netværket i baggrunden, hvis der findes et svar.
  event.respondWith(
    caches.match(request).then((cachet) => {
      const fraNet = fetch(request)
        .then((response) => {
          // Kun vellykkede svar fra samme oprindelse gemmes i cachen.
          if (response.ok) {
            const kopi = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, kopi));
          }
          return response;
        })
        .catch(() => cachet || Response.error());
      return cachet || fraNet;
    })
  );
});
