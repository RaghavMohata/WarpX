/* WarpX service worker.

   The one rule that matters here: NOTHING under /api/ is ever cached or even
   intercepted. This app's whole job is live state — an owner watching for new
   orders, a driver refreshing an available-orders board, a customer checking
   a delivery code. A stale API response wouldn't be a slightly old page, it
   would be a missed order. So API traffic goes straight to the network as if
   this file didn't exist.

   Everything else is cached so the app opens instantly and survives a dead
   patch of signal. */

/* Bump VERSION whenever the shared JS changes shape. Pages are network-first
   so HTML updates immediately, but scripts and styles are served cache-first
   and only refreshed for the NEXT load — meaning without a bump, a returning
   visitor runs one page-load of yesterday's JavaScript against today's API.
   The activate handler below deletes every cache that isn't the current one,
   so changing this line is the whole mechanism. */
const VERSION = "warpx-v4";
const SHELL_CACHE = `${VERSION}-shell`;

const PRECACHE = [
  "/", "/index.html", "/food.html", "/grocery.html", "/weekly.html", "/medicine.html",
  "/laundry.html", "/anything.html", "/login.html", "/orders.html",
  "/checkout.html", "/careers.html", "/driver.html", "/offline.html",
  "/css/style.css",
  "/js/cart.js", "/js/location.js", "/js/main.js", "/js/menu-data.js",
  "/js/addresses.js", "/js/pwa.js",
  "/lib/fee.js", "/lib/schedule.js", "/lib/weekly.js",
  "/img/icon-192.png", "/img/icon-512.png", "/img/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // Individually, so one missing file can't fail the whole install.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Leave alone: anything that isn't a plain GET of our own origin, and every
  // API call. Returning without calling respondWith hands it to the network.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  /* Pages: network first. The owner pulls changes and restarts often, and a
     cache-first shell would keep serving yesterday's HTML long after that —
     the exact "I pulled but nothing changed" trap. Cache is the fallback for
     when the network is genuinely gone. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only successful pages are worth keeping. Caching a 404 or a 502
          // would poison the shell — that error page would then be served
          // from cache on the next offline visit, long after it stopped
          // being true.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/offline.html")))
    );
    return;
  }

  // Assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});

// Lets the page tell a waiting worker to take over straight away.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
