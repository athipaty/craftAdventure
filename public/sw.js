"use strict";

// Lets Gear Fight! open with a weak connection or none. The network comes first
// so that updates arrive straight away, and the saved copy is used when the
// network fails or takes too long.
const CACHE = "gearfight-v1";
const FILES = ["./", "index.html", "game.js", "style.css", "manifest.json", "icons/icon-192.png", "icons/icon-512.png"];
const NETWORK_WAIT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function fromNetworkOrCache(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS));
  // A slow answer still updates the saved copy for next time.
  network.catch(() => {});
  const fast = await Promise.race([network.catch(() => null), timeout]);
  if (fast) return fast;
  const saved = await cache.match(request, { ignoreSearch: true });
  if (saved) return saved;
  return network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fromNetworkOrCache(request));
});
