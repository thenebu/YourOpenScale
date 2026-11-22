import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetTags, assetPath, resetAssetCache } from "../assets.ts";
import { assets } from "../local.ts";
import { LocalSqlite } from "../sqlite.ts";
import { handleApp, type AppEnv } from "../app.ts";

const manifest = {
  "src/entries/app.ts": {
    file: "app-abc.js", name: "app", isEntry: true, css: ["app-abc.css"], imports: ["_vendor.js"],
  },
  "src/entries/charts.ts": {
    file: "charts-def.js", name: "charts", isEntry: true, css: ["app-abc.css", "charts-def.css"], imports: ["_vendor.js"],
  },
  "_vendor.js": { file: "vendor-123.js", name: "vendor" },
};

function withDist(fn: (dir: string) => Promise<void> | void) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "yow-dist-"));
    const prev = process.env.YOW_WEB_DIST;
    process.env.YOW_WEB_DIST = dir;
    resetAssetCache();
    try {
      await fn(dir);
    } finally {
      if (prev === undefined) delete process.env.YOW_WEB_DIST;
      else process.env.YOW_WEB_DIST = prev;
      resetAssetCache();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("manifest produces css, module script and modulepreload tags", withDist((dir) => {
  mkdirSync(join(dir, ".vite"));
  writeFileSync(join(dir, ".vite/manifest.json"), JSON.stringify(manifest));
  assert.equal(
    assetTags(["app"]),
    [
      '<link rel="stylesheet" href="/assets/app-abc.css">',
      '<script type="module" src="/assets/app-abc.js"></script>',
      '<link rel="modulepreload" href="/assets/vendor-123.js">',
    ].join("\n"),
  );
  const both = assetTags(["app", "charts"]);
  assert.equal(both.split("app-abc.css").length, 2, "css deduplicated");
  assert.match(both, /charts-def\.css/);
  assert.match(both, /src="\/assets\/charts-def\.js"/);
}));

test("missing manifest yields empty tags and warns once", withDist(() => {
  const warn = console.warn;
  const calls: unknown[] = [];
  console.warn = (...a: unknown[]) => void calls.push(a);
  try {
    assert.equal(assetTags(["app"]), "");
    assert.equal(assetTags(["app", "charts"]), "");
  } finally {
    console.warn = warn;
  }
  assert.equal(calls.length, 1);
}));

test("/assets serving: immutable headers, mime, traversal rejected", withDist(async (dir) => {
  writeFileSync(join(dir, "app-abc.css"), "a{}");
  writeFileSync(join(dir, "app-abc.js"), "1");
  assert.ok(assetPath("app-abc.css"));
  assert.equal(assetPath("../x"), null);
  assert.equal(assetPath("missing.css"), null);
  const a = assets()!;
  const get = (p: string) => a.fetch(new Request(`https://local.test${p}`));
  const ok = await get("/assets/app-abc.css");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(ok.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await get("/assets/app-abc.js")).headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await get("/assets/../x")).status, 404);
  assert.equal((await get("/assets/%2e%2e%2fx")).status, 404);
  assert.equal((await get("/assets/nope.css")).status, 404);
  assert.equal((await get("/assets/.vite")).status, 404);
}));

test("pages send the CSP and /assets routes through ASSETS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yow-csp-"));
  const store = new LocalSqlite(join(dir, "t.sqlite3"));
  let seen = "";
  const env: AppEnv = {
    DB: store.asD1(),
    YOW_BOOTSTRAP_TOKEN: "dummy-test-bootstrap-token",
    ASSETS: { fetch: async (r) => ((seen = new URL(r.url).pathname), new Response("x")) },
  };
  const res = await handleApp(new Request("https://local.test/setup"), env);
  assert.equal(
    res.headers.get("content-security-policy"),
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'",
  );
  await handleApp(new Request("https://local.test/assets/app-abc.js"), env);
  assert.equal(seen, "/assets/app-abc.js");
  rmSync(dir, { recursive: true, force: true });
});
