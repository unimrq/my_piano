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
      const request =
        event.request.mode === "navigate"
          ? new Request(new URL("index.html", self.registration.scope))
          : event.request;
      const score = /\/catalogue\/.*\.(mid|midi|xml|musicxml|mxl)$/i.test(
        new URL(request.url).pathname,
      );
      let cache, cached;
      try {
        cache = await caches.open(CACHE);
      } catch {}
      try {
        cached =
          (cache && (await cache.match(request, { ignoreSearch: true }))) ||
          (await caches.match(request, { ignoreSearch: true }));
      } catch {}
      const network = async () => {
        const response = await fetch(event.request);
        if (score && response.ok && cache) {
          try {
            await cache.put(request, response.clone());
          } catch {}
        }
        return response;
      };
      if (
        event.request.mode === "navigate" ||
        (score && event.request.cache === "reload")
      ) {
        try {
          const response = await network();
          return response.ok ? response : cached || response;
        } catch {
          return cached || Response.error();
        }
      }
      return cached || network();
    })(),
  );
});
