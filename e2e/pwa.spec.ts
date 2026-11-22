import { test, expect, type Page } from "@playwright/test";

async function activeWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // clients.claim() makes the page controlled once activation finishes.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test("manifest is linked, fetched and valid", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const res = await page.request.get(href!);
  expect(res.headers()["content-type"]).toContain("application/manifest+json");
  const m = await res.json();
  expect(m).toMatchObject({ name: "YourOwnWeigh", short_name: "YOW", display: "standalone", start_url: "/", scope: "/" });
  for (const icon of m.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
});

test("worker registers and activates with scope /", async ({ page }) => {
  await activeWorker(page);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toBe(new URL("/", page.url()).href);
});

test("offline: only /offline and assets come from the cache, navigation fails gracefully", async ({ page, context }) => {
  await activeWorker(page);
  const css = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
  await context.setOffline(true);
  try {
    // a normal navigation shows the branded offline page, never stale data
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retry" })).toBeVisible();
    expect(await page.content()).not.toMatch(/Alex|Sam|Kim/);
    // hashed assets are served from the precache
    expect(await page.evaluate((u) => fetch(u!).then((r) => r.status), css)).toBe(200);
    // data requests are not cached
    const api = await page.evaluate(() => fetch("/api/ui/anything").then(() => "ok", () => "failed"));
    expect(api).toBe("failed");
    const readings = await page.evaluate(() => fetch("/readings").then((r) => r.ok, () => "failed"));
    expect(readings === "failed" || readings === false).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});

test("caches hold no HTML except /offline, and logout flushes runtime caches", async ({ page }) => {
  await activeWorker(page);
  await page.goto("/readings"); // authenticated HTML, must not be cached
  const snapshot = () =>
    page.evaluate(async () => {
      const out: { cache: string; url: string; type: string }[] = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys()) {
          const res = await (await caches.open(name)).match(req);
          out.push({ cache: name, url: new URL(req.url).pathname, type: res?.headers.get("content-type") ?? "" });
        }
      return out;
    });
  const entries = await snapshot();
  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) expect(e.cache).toMatch(/^yow-precache-/);
  const html = entries.filter((e) => e.type.includes("text/html"));
  expect(html.map((e) => e.url)).toEqual(["/offline"]);
  expect(entries.some((e) => e.url.startsWith("/api/") || e.url.includes("analysis") || e.url.endsWith(".csv"))).toBe(false);

  // a stray runtime cache is removed on the logout message; the precache stays
  await page.evaluate(() => caches.open("runtime-test").then((c) => c.put("/x", new Response("x"))));
  await page.evaluate(() => navigator.serviceWorker.controller!.postMessage({ type: "LOGOUT" }));
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([expect.stringMatching(/^yow-precache-/)]);
});

for (const path of ["/", "/offline"]) {
  test(`no console or CSP errors on ${path}`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
}
