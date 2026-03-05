const CACHE_NAME = "timeclocker-v17";

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
        console.log("Archivos cacheados (v17)");
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
  // No cachear las peticiones a la API de Supabase
  if (event.request.url.includes("supabase.co")) {
    return event.respondWith(fetch(event.request));
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si el recurso está en caché, lo devolvemos
        if (response) {
          return response;
        }
        // Si no, lo pedimos a la red
        return fetch(event.request).then(
          res => {
            // Verificamos que la respuesta sea válida
            if(!res || res.status !== 200 || res.type !== 'basic') {
              return res;
            }

            // Clonamos la respuesta. Una respuesta es un 'Stream' y solo se puede consumir una vez.
            // Necesitamos una copia para el navegador y otra para la caché.
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