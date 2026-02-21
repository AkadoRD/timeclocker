const CACHE_NAME = "timeclocker-v4";

const urlsToCache = [
  "./",
  "index.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

// Instalar Service Worker y guardar archivos en cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("Archivos cacheados");
        return cache.addAll(urlsToCache);
      })
  );
});

// Activar y limpiar caches viejos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Estrategia: Cache first, luego red
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
      .catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("index.html");
        }
      })
  );
});