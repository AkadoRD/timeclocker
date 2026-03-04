// Kamikaze Service Worker
// This script's only purpose is to unregister itself and force a page reload.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  console.log('Kamikaze SW activating. Unregistering and reloading...');
  // Unregister self
  self.registration.unregister()
    .then(() => {
      // Force all connected clients to reload
      return self.clients.matchAll();
    })
    .then(clients => {
      clients.forEach(client => client.navigate(client.url));
    });
});
