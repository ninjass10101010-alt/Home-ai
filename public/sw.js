import { routePolicy } from "/sw-policy.js";

const SW_VERSION = "consuela-shell-v1";
const SHELL_CACHE = `${SW_VERSION}-shell`;
const SHELL_ASSETS = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("consuela-shell-") && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const { strategy, cacheable } = routePolicy(req.url, req.mode);
  if (strategy === "network-only") return;

  if (strategy === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await withTimeout(fetch(req), 10000);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/offline.html")) || Response.error();
        }
      })()
    );
    return;
  }

  if (strategy === "cache-first") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const net = await fetch(req);
        if (net && net.ok && cacheable) cache.put(req, net.clone());
        return net;
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(req)) || Response.error();
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Consuela";
  const body = data.body || "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })()
  );
});