const CACHE = "qinxi-web-__BUILD_ID__";
const FILES = ["__PRECACHE_FILES__"];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter(
        (name) => name.startsWith("qinxi-web-") && name !== CACHE,
      );
      await Promise.all(old.slice(0, -1).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const request =
        event.request.mode === "navigate"
          ? new Request(new URL("index.html", self.registration.scope))
          : event.request;
      const cached =
        (await cache.match(request, { ignoreSearch: true })) ||
        (await caches.match(request));
      if (event.request.mode === "navigate") {
        try {
          const response = await fetch(event.request);
          return response.ok ? response : cached || response;
        } catch {
          return cached || Response.error();
        }
      }
      return cached || fetch(event.request);
    })(),
  );
});
