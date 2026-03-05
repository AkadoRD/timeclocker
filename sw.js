const CACHE_NAME = "timeclocker-v13";

const urlsToCache = [
  "./",
  "index.html",
  "admin.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

// Instalar Service Worker y guardar archivos en cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("Archivos cacheados (v13)");
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activar y limpiar caches viejos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log("Borrando caché antigua:", cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia de Fetch (sin cambios)
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isIndex = event.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
  if (isIndex) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
      .catch(() => event.request.mode === "navigate" ? caches.match("index.html") : null)
  );
});
