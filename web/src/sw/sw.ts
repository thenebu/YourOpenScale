/** YourOpenScale service worker (built to /sw.js; the server prepends self.__YOW_PRECACHE__).
 *
 * Privacy first: this app shows health data behind a login. The worker therefore
 *   - precaches ONLY hashed /assets/* build files, icons, the manifest and /offline;
 *   - never handles POSTs, /api/*, analysis JSON, CSV or cross-origin requests;
 *   - treats navigations as network-only and falls back to the static /offline page;
 *   - writes to a cache only in the install step (the precache list), nowhere else.
 */
interface Precache {
  version: string;
  urls: string[];
}
interface WorkerEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvt extends WorkerEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface MessageEvt extends WorkerEvent {
  data: unknown;
}
interface WorkerScope {
  __YOW_PRECACHE__: Precache;
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: string, listener: (event: never) => void): void;
}

const sw = self as unknown as WorkerScope;
const { version, urls } = sw.__YOW_PRECACHE__;
const PREFIX = "yow-precache-";
const CACHE = PREFIX + version;
const OFFLINE = "/offline";
const precached = new Set(urls);

sw.addEventListener("install", ((event: WorkerEvent) => {
  // No skipWaiting here: a new worker waits until the user taps "Reload".
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(urls.map((u) => new Request(u, { cache: "reload", credentials: "omit" }))),
    ),
  );
}) as (event: never) => void);

sw.addEventListener("activate", ((event: WorkerEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
}) as (event: never) => void);

sw.addEventListener("fetch", ((event: FetchEvt) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (request.mode === "navigate") {
    // Network-only. Authenticated HTML is never read from or written to a cache.
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match(OFFLINE, { cacheName: CACHE })) ??
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }),
      ),
    );
    return;
  }

  // Cache-first for precached static files only (hashed assets, icons, manifest).
  if (precached.has(url.pathname) && url.pathname !== OFFLINE) {
    event.respondWith(
      caches
        .match(url.pathname, { cacheName: CACHE })
        .then((hit) => hit ?? fetch(request)),
    );
  }
  // Everything else (API, CSV, analysis JSON, ...) goes straight to the network.
}) as (event: never) => void);

sw.addEventListener("message", ((event: MessageEvt) => {
  const type = (event.data as { type?: string } | null)?.type;
  if (type === "SKIP_WAITING") void sw.skipWaiting();
  if (type === "LOGOUT") {
    // Drop everything except the precache (there should be no runtime caches).
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
    );
  }
}) as (event: never) => void);
