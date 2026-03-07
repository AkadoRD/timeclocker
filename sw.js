const CACHE_NAME = "timeclocker-v18";

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
        console.log("Archivos cacheados (v18)");
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

// Servir desde cache, o si no, desde la red
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // No cachear las peticiones a la API de Supabase ni a las funciones locales.
  if (url.origin.includes("supabase.co") || url.pathname.startsWith('/supabase/functions/')) {
    // Devolver directamente desde la red, sin pasar por la caché.
    return event.respondWith(fetch(event.request));
  }

  // Para el resto de peticiones, usar la estrategia de "Cache first".
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Devolver desde la caché si existe.
        }

        // Si no está en la caché, ir a la red.
        return fetch(event.request).then(
          res => {
            // Asegurarse de que la respuesta es válida antes de cachearla.
            if(!res || res.status !== 200 || res.type !== 'basic') {
              return res;
            }

            const responseToCache = res.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return res;
          }
        );
      })
  );
});