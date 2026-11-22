import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../ui.ts";
import { handleShellRoute, safeBack } from "../routes/shell.ts";
import type { ForkCtx } from "../routes/index.ts";

const page = (opts = {}, notice = "", active = "/", loggedIn = true) => layout("T", "<p>x</p>", "tok", loggedIn, notice, active, opts);

test("layout: nav items, active link, no app.css", () => {
  const h = page({}, "", "/readings");
  assert.doesNotMatch(h, /app\.css/);
  assert.match(h, /<nav class="app-nav"/);
  for (const l of ["Dashboard", "Readings", "Manage", "Users", "Import from Withings", "Scales", "Firmware", "Health Sync", "Settings"]) assert.match(h, new RegExp(`>${l}`));
  for (const g of ["People &amp; data", "Devices", "System"]) assert.match(h, new RegExp(`nav-group-title">${g}<`));
  assert.match(h, /<details class="nav-dropdown nav-manage"><summary class="nav-link">Manage/);
  assert.match(h, /href="\/readings" aria-current="page"/);
  assert.match(h, /<details class="nav-menu">/);
  assert.match(h, /action="\/logout" method="post"[^>]*><input[^>]*value="tok"[\s\S]*?Sign out/);
  assert.match(h, /\/app\.js/);
});

test("layout: Manage is active when a child is current", () => {
  const h = page({}, "", "/scales");
  assert.match(h, /<summary class="nav-link" aria-current="page">Manage/);
  assert.match(h, /<a href="\/scales" aria-current="page">Scales/);
  assert.match(h, /<a class="nav-link" href="\/scales" aria-current="page">Scales/);
  assert.doesNotMatch(page({}, "", "/readings"), /<summary class="nav-link" aria-current="page">Manage/);
});

test("layout: branding and footer", () => {
  const h = page();
  assert.match(h, /<title>T · YourOpenScale<\/title>/);
  assert.match(h, /YourOpenScale · v\d+\.\d+\.\d+/);
  assert.match(h, />Based on YourOwnWeigh</);
  assert.doesNotMatch(h, /Web App v/);
});

test("layout: logged out has no links or sign out", () => {
  const h = page({}, "", "", false);
  assert.doesNotMatch(h, /logout|nav-link/);
  assert.match(h, /site-footer/);
});

test("layout: readings badge only when unassigned > 0", () => {
  assert.doesNotMatch(page({}), /badge-warn/);
  assert.doesNotMatch(page({ unassigned: 0 }), /badge-warn/);
  assert.match(page({ unassigned: 3 }), /badge badge-warn"[^>]*>3</);
});

test("layout: People dropdown needs two users", () => {
  const two = page({ users: [{ id: 1, name: "Al<ex>" }, { id: 2, name: "Sam" }] });
  assert.match(two, /<details class="nav-dropdown">/);
  assert.match(two, /href="\/users\/1\/overview">Al&lt;ex&gt;</);
  assert.match(two, /nav-sheet-heading">Overviews/);
  const one = page({ users: [{ id: 7, name: "Solo" }] });
  assert.doesNotMatch(one, /nav-dropdown">/);
  assert.match(one, /href="\/users\/7\/overview"[^>]*>Overview/);
  assert.doesNotMatch(page({}), /Overview|nav-dropdown">/);
});

test("layout: theme attribute and footer links", () => {
  assert.match(page({ theme: "dark" }), /<html lang="en" data-theme="dark">/);
  assert.doesNotMatch(page({ theme: null }), /data-theme="(light|dark)"/);
  const h = page({ theme: "light", back: "/users/1/overview?range=1y" });
  assert.match(h, /href="\/theme\?set=system&amp;back=%2Fusers%2F1%2Foverview%3Frange%3D1y"/);
  assert.match(h, /data-theme-set="light" aria-current="page">Light/);
  assert.match(h, /data-theme-set="dark">Dark/);
  assert.match(page({ back: "//evil.test" }), /back=%2F"/);
  assert.match(h, /link-quiet" href="https:\/\/github\.com/);
});

test("layout: flash has icon, dismiss hook and escapes text", () => {
  assert.doesNotMatch(page(), /class="flash/);
  const h = page({}, "<b>Saved</b>");
  assert.match(h, /class="flash callout callout-info" role="status"><svg[\s\S]*&lt;b&gt;Saved&lt;\/b&gt;[\s\S]*data-dismiss/);
  assert.doesNotMatch(h, /<b>Saved/);
});

const ctx = (path: string, headers: Record<string, string> = {}, method = "GET"): ForkCtx => {
  const url = new URL(`https://local.test${path}`);
  return { request: new Request(url, { method, headers }), url, path: url.pathname, method } as unknown as ForkCtx;
};

test("/theme sets and clears the cookie with 303", async () => {
  const set = (await handleShellRoute(ctx("/theme?set=dark&back=/readings%3Fmetric%3D1")))!;
  assert.equal(set.status, 303);
  assert.equal(set.headers.get("Location"), "/readings?metric=1");
  const c = set.headers.get("Set-Cookie")!;
  assert.match(c, /^yow_theme=dark; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
  const clear = (await handleShellRoute(ctx("/theme?set=system&back=/")))!;
  assert.match(clear.headers.get("Set-Cookie")!, /^yow_theme=; Path=\/; Max-Age=0/);
  assert.equal((await handleShellRoute(ctx("/theme?set=pink")))!.status, 400);
  assert.equal(await handleShellRoute(ctx("/other")), null);
  assert.equal(await handleShellRoute(ctx("/theme?set=dark", {}, "POST")), null);
});

test("/theme open-redirect guard and referer fallback", async () => {
  for (const back of ["//evil.test", "//evil.com", "https://evil.test/", "/\\evil.test", "/\\evil.com", "evil", "/a\r\nX", "/.//evil.com", "/..//evil.com", "/a/..//evil.com", "javascript:alert(1)"]) {
    const r = (await handleShellRoute(ctx(`/theme?set=light&back=${encodeURIComponent(back)}`)))!;
    assert.equal(r.headers.get("Location"), "/", back);
  }
  const ref = (await handleShellRoute(ctx("/theme?set=light", { Referer: "https://local.test/sync?x=1&notice=hi" })))!;
  assert.equal(ref.headers.get("Location"), "/sync?x=1");
  const foreign = (await handleShellRoute(ctx("/theme?set=light", { Referer: "https://evil.test/a" })))!;
  assert.equal(foreign.headers.get("Location"), "/");
  assert.equal(safeBack("/a?notice=x", "https://local.test"), "/a");
});
