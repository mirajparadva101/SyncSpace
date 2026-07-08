/* ============================================
   SYNCSPACE — SERVICE WORKER
   ============================================ */

const CACHE_NAME = "syncspace-v3.1";
const STATIC_ASSETS = ["/", "/style.css", "/app.js", "/manifest.json"];

// Install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// Activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch — Stale-While-Revalidate for API, Cache-First for static
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests — Network first, fallback to cache (ONLY for GET requests)
  if (url.pathname.startsWith("/api/")) {
    // ONLY cache GET requests, not POST/PUT/DELETE
    if (request.method === "GET") {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match(request)),
      );
    } else {
      // For POST, PUT, DELETE - just fetch, don't cache
      event.respondWith(fetch(request));
    }
    return;
  }

  // Static assets — Cache first, fallback to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && request.method === "GET") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") {
            return caches.match("/");
          }
          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
          });
        });
    }),
  );
});

// Background sync placeholder
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-text") {
    event.waitUntil(syncPendingChanges());
  }
});

async function syncPendingChanges() {
  // Could implement offline queue sync here
  console.log("Sync triggered");
}
