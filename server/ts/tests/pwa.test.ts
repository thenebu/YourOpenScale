import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAssetCache } from "../assets.ts";
import { assets } from "../local.ts";
import { LocalSqlite } from "../sqlite.ts";
import { handleApp, type AppEnv } from "../app.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const manifestPath = join(ROOT, "web/public/manifest.webmanifest");

function withDist(fn: (env: AppEnv) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "yow-pwa-"));
    const prev = process.env.YOW_WEB_DIST;
    process.env.YOW_WEB_DIST = dir;
    resetAssetCache();
    mkdirSync(join(dir, ".vite"));
    writeFileSync(
      join(dir, ".vite/manifest.json"),
      JSON.stringify({
        "src/entries/app.ts": { file: "app-abc.js", name: "app", isEntry: true, css: ["app-abc.css"], assets: ["inter-1.woff2"] },
        "src/sw/sw.ts": { file: "sw.js", name: "sw", isEntry: true },
      }),
    );
    writeFileSync(join(dir, "sw.js"), "/* worker body */");
    const store = new LocalSqlite(join(dir, "t.sqlite3"));
    try {
      await fn({ DB: store.asD1(), ASSETS: assets(), YOW_BOOTSTRAP_TOKEN: "dummy-test-bootstrap-token" } as AppEnv);
    } finally {
      if (prev === undefined) delete process.env.YOW_WEB_DIST;
      else process.env.YOW_WEB_DIST = prev;
      resetAssetCache();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const get = (env: AppEnv, path: string) => handleApp(new Request("https://local.test" + path), env);

test("manifest has the required fields and every icon exists with its declared size", () => {
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(m.name, "YourOwnWeigh");
  assert.equal(m.short_name, "YOW");
  assert.equal(m.start_url, "/");
  assert.equal(m.scope, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "en");
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(m.shortcuts.map((s: { url: string }) => s.url), ["/", "/readings"]);
  const purposes = new Set(m.icons.map((i: { purpose: string }) => i.purpose));
  assert.ok(purposes.has("any") && purposes.has("maskable"));
  for (const icon of m.icons) {
    const file = join(ROOT, "web/public", icon.src);
    assert.ok(existsSync(file), icon.src);
    const png = readFileSync(file);
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.equal(png.readUInt32BE(16), w, icon.src);
    assert.equal(png.readUInt32BE(20), h, icon.src);
  }
  assert.equal(readFileSync(join(ROOT, "web/public/icons/apple-touch-icon-180.png")).readUInt32BE(16), 180);
});

test("PWA files are public: right types, headers, nothing private", withDist(async (env) => {
  const sw = await get(env, "/sw.js");
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("content-type")!, /^text\/javascript/);
  assert.equal(sw.headers.get("cache-control"), "no-cache");
  assert.equal(sw.headers.get("service-worker-allowed"), "/");
  const body = await sw.text();
  const config = JSON.parse(/^self\.__YOW_PRECACHE__=(.*);\n/.exec(body)![1]);
  assert.match(config.version, /^[0-9a-f]{12}$/);
  assert.ok(config.urls.includes("/offline") && config.urls.includes("/assets/app-abc.js"));
  assert.ok(config.urls.includes("/assets/inter-1.woff2"));
  assert.ok(!config.urls.includes("/assets/sw.js"));
  for (const u of config.urls) assert.match(u, /^\/(assets\/|icons\/|offline$|manifest\.webmanifest$)/, u);
  assert.ok(body.endsWith("/* worker body */"));

  const man = await get(env, "/manifest.webmanifest");
  assert.equal(man.status, 200);
  assert.equal(man.headers.get("content-type"), "application/manifest+json");

  const icon = await get(env, "/icons/icon-192.png");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  assert.equal((await get(env, "/icons/favicon.svg")).headers.get("content-type"), "image/svg+xml");
  assert.equal((await get(env, "/icons/nope.png")).status, 404);
  assert.equal((await get(env, "/icons/..%2Fmanifest.webmanifest")).status, 404);

  const off = await get(env, "/offline");
  assert.equal(off.status, 200);
  assert.match(off.headers.get("content-type")!, /^text\/html/);
  const page = await off.text();
  assert.match(page, /You are offline/);
  assert.match(page, /Retry/);
  assert.doesNotMatch(page, /csrf|<form|Alex|Sam|Kim/i);

  // everything else is still behind login
  const readings = await get(env, "/readings");
  assert.equal(readings.status, 303);
  assert.match(readings.headers.get("location")!, /^\/(login|setup)/);
}));

test("CSP allows the manifest and worker from self only; head links the manifest", withDist(async (env) => {
  const res = await get(env, "/setup");
  const csp = res.headers.get("content-security-policy")!;
  assert.match(csp, /manifest-src 'self'/);
  assert.match(csp, /worker-src 'self'/);
  const page = await get(env, "/setup");
  const html = await page.text();
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: light/);
  assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: dark/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style/);
  assert.match(html, /viewport-fit=cover/);
}));

test("sw.ts never stores navigation or API responses", () => {
  const raw = readFileSync(join(ROOT, "web/src/sw/sw.ts"), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // The only cache writes are the install-time precache of the known list.
  assert.equal(/\.put\(/.test(src), false, "no cache.put");
  assert.equal(/\.add\(/.test(src), false, "no cache.add");
  const writes = src.match(/\.addAll\(/g) ?? [];
  assert.equal(writes.length, 1);
  const install = /addEventListener\("install"[\s\S]*?\}\) as/.exec(src)![0];
  assert.match(install, /addAll\(urls\.map/);
  // The fetch handler touches no cache write API and never mentions API paths.
  const fetchHandler = /addEventListener\("fetch"[\s\S]*?\}\) as/.exec(src)![0];
  assert.doesNotMatch(fetchHandler, /\.(put|add|addAll)\(/);
  assert.doesNotMatch(src, /\/api\/|\/users\/|\.csv|"POST"/);
  assert.match(fetchHandler, /request\.method !== "GET"\) return/);
  assert.match(fetchHandler, /request\.mode === "navigate"[\s\S]*fetch\(request\)\.catch/);
  // Old caches are deleted on activate and on logout.
  assert.match(src, /addEventListener\("activate"[\s\S]*caches\.delete/);
  assert.match(src, /"LOGOUT"[\s\S]*caches\.delete/);
  assert.match(src, /skipWaiting\(\)/);
  assert.equal((src.match(/skipWaiting\(\)/g) ?? []).length, 2, "declaration + the message handler only");
});
