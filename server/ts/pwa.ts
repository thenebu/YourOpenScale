/** PWA files served without login (nothing private): /sw.js, /manifest.webmanifest, /offline, /icons/*.
 * Node-only (used by local.ts assets()); the service worker source is web/src/sw/sw.ts. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath, assetTags, precacheFiles } from "./assets.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../../web/public", import.meta.url));
const ICON_TYPES: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
};

export function isPwaPath(path: string): boolean {
  return (
    path === "/sw.js" ||
    path === "/manifest.webmanifest" ||
    path === "/offline" ||
    /^\/icons\/[A-Za-z0-9._-]+$/.test(path)
  );
}

const SECURITY = { "X-Content-Type-Options": "nosniff" };

/** Static branded fallback page: no user data, works offline, no JS needed. */
export function offlinePage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Offline · YourOwnWeigh</title><meta name="robots" content="noindex"><link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">${assetTags(["app"])}</head><body>
<main class="offline"><img src="/icons/icon-192.png" width="96" height="96" alt=""><h1>You are offline</h1><p>YourOwnWeigh needs a connection to show your readings. Nothing is stored on this device while you are signed in.</p><p><a class="btn btn-primary" href="/">Retry</a></p></main></body></html>`;
}

/** Everything the worker may precache. Hashed build files, icons, manifest and the offline page only. */
export function precacheUrls(): string[] {
  const icons = readdirSync(join(PUBLIC_DIR, "icons"))
    .filter((f) => /\.(png|svg)$/.test(f))
    .sort()
    .map((f) => `/icons/${f}`);
  return [
    "/offline",
    "/manifest.webmanifest",
    ...icons,
    ...precacheFiles().map((f) => `/assets/${f}`),
  ];
}

/** Cache name suffix: changes whenever any precached resource may have changed. */
export function buildVersion(): string {
  const h = createHash("sha256");
  const urls = precacheUrls();
  for (const u of urls) {
    h.update(u);
    if (u.startsWith("/icons/")) h.update(readFileSync(join(PUBLIC_DIR, u.slice(1))));
  }
  h.update(offlinePage());
  h.update(readFileSync(join(PUBLIC_DIR, "manifest.webmanifest")));
  return h.digest("hex").slice(0, 12);
}

function serviceWorker(): Response {
  const file = assetPath("sw.js");
  if (!file) return new Response("Not Found", { status: 404 });
  const config = JSON.stringify({ version: buildVersion(), urls: precacheUrls() });
  return new Response(`self.__YOW_PRECACHE__=${config};\n${readFileSync(file, "utf8")}`, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
      ...SECURITY,
    },
  });
}

export function pwaResponse(path: string): Response {
  try {
    if (path === "/sw.js") return serviceWorker();
    if (path === "/offline")
      return new Response(offlinePage(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...SECURITY },
      });
    if (path === "/manifest.webmanifest")
      return new Response(readFileSync(join(PUBLIC_DIR, "manifest.webmanifest")), {
        headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache", ...SECURITY },
      });
    const type = ICON_TYPES[path.slice(path.lastIndexOf(".") + 1)];
    if (type && /^\/icons\/[A-Za-z0-9._-]+$/.test(path))
      return new Response(readFileSync(join(PUBLIC_DIR, path.slice(1))), {
        headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", ...SECURITY },
      });
  } catch {
    // fall through
  }
  return new Response("Not Found", { status: 404 });
}
