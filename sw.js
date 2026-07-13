// Ελάχιστο service worker — απλά "περνάει" τα requests, χωρίς caching.
// Υπάρχει μόνο για να πληροί τις τυπικές προϋποθέσεις ενός PWA.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
