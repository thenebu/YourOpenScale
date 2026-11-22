import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleApp, type AppEnv } from "../app.ts";
import { LocalSqlite } from "../sqlite.ts";

// Routes of WP-13: dashboard/overview wiring, JSON API, CSV export, goal POST and /theme.
async function harness() {
  const dir = mkdtempSync(join(tmpdir(), "yow-analytics-"));
  const db = new LocalSqlite(join(dir, "a.db")).asD1();
  const env: AppEnv = { DB: db };
  let cookie = "";
  let csrf = "";
  const send = async (path: string, init: { form?: Record<string, string>; cookie?: string | null; method?: string } = {}) => {
    const headers: Record<string, string> = { Origin: "http://localhost" };
    const jar = init.cookie === undefined ? cookie : init.cookie;
    if (jar) headers.Cookie = jar;
    let body: string | undefined;
    if (init.form) {
      body = new URLSearchParams(init.form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const r = await handleApp(new Request(`http://localhost${path}`, { method: init.form ? "POST" : (init.method ?? "GET"), headers, body }), env);
    if (init.cookie === undefined && r.headers.has("Set-Cookie")) cookie = r.headers.get("Set-Cookie")!.split(";")[0];
    return r;
  };
  csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await send("/setup")).text())![1];
  await send("/setup", { form: { password: "test-password", confirm: "test-password", _csrf: csrf } });
  csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await send("/")).text())![1];
  await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(5,'Alex Ünï','ALX',180,40,0,80,1700000000)").run();
  await db.prepare("INSERT INTO scales(id,label,model,mac,secret,time_zone) VALUES(1,'Bath','WBS03','020000000003','0123456789abcdef','Europe/Berlin')").run();
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 20; i++) {
    const t = now - (19 - i) * 86400 - 3600;
    await db
      .prepare(
        "INSERT INTO readings(id,scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,weight_value,weight_unit,measures_json,payload_hash,first_received_at,last_received_at) VALUES(?,1,5,'assigned','[]',0,?,'trusted',?,-3,?,?,?,?)",
      )
      .bind(i + 1, t, 80000 - i * 100, JSON.stringify([{ type: 1, value: 80000 - i * 100, unit: -3 }]), `h${i}`, t, t)
      .run();
  }
  return { send, db, csrf: () => csrf, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("dashboard and overview render with entries and the nav data", async () => {
  const h = await harness();
  try {
    const home = await (await h.send("/")).text();
    assert.match(home, /class="user-cards"/);
    assert.doesNotMatch(home, /charts-[\w-]+\.js/);
    const o = await h.send("/users/5/overview?range=bogus&metric=-1");
    assert.equal(o.status, 200);
    const page = await o.text();
    assert.match(page, /<script type="application\/json" id="analysis-data">/);
    assert.match(page, /aria-current="page"[^>]*>90 d</);
    assert.equal((await h.send("/users/404/overview")).status, 404);
    const redirect = await h.send("/users/5/overview?user=5&range=30d");
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get("Location"), "/users/5/overview?range=30d");
  } finally {
    h.cleanup();
  }
});

test("/api/ui: 200, 401 when signed out, 404 for an unknown user", async () => {
  const h = await harness();
  try {
    const ok = await h.send("/api/ui/users/5/analysis?range=30d");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Cache-Control"), "no-store");
    assert.match(ok.headers.get("Content-Type")!, /application\/json/);
    assert.equal(((await ok.json()) as any).range.key, "30d");
    const dash = (await (await h.send("/api/ui/dashboard")).json()) as any;
    assert.equal(dash.users.length, 1);
    assert.equal(typeof dash.generatedAt, "number");
    assert.equal((await h.send("/api/ui/users/999/analysis")).status, 404);
    assert.equal((await h.send("/api/ui/users/5/analysis", { cookie: "yow_session=" + "a".repeat(64) })).status, 401);
  } finally {
    h.cleanup();
  }
});

test("export.csv: headers and first row", async () => {
  const h = await harness();
  try {
    const r = await h.send("/users/5/export.csv?range=all");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("Content-Type")!, /^text\/csv; charset=utf-8/);
    assert.match(r.headers.get("Content-Disposition")!, /^attachment; filename="yow-alex-uni-\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d-raw\.csv"$/);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    const lines = (await r.text()).split("\r\n");
    assert.match(lines[0], /^reading_id,timestamp_utc,local_date,local_time,time_zone,clock_trusted,weight_kg/);
    assert.match(lines[1], /^1,\d{4}-\d\d-\d\dT[\d:]+Z,/);
    assert.equal(lines.length, 22); // header + 20 rows + trailing empty
    const daily = await (await h.send("/users/5/export.csv?range=all&agg=daily&metrics=1")).text();
    assert.match(daily.split("\r\n")[0], /^local_date,n_readings,weight_kg_first/);
  } finally {
    h.cleanup();
  }
});

test("goal POST: CSRF, unit conversion, validation, delete", async () => {
  const h = await harness();
  try {
    const goal = (fields: Record<string, string>, csrf = h.csrf()) => h.send("/users/5/goal", { form: { _csrf: csrf, ...fields } });
    assert.equal((await goal({ goal_weight: "75" }, "bad")).status, 403);
    const saved = await goal({ goal_weight: "75" });
    assert.equal(saved.status, 303);
    assert.match(saved.headers.get("Location")!, /^\/users\/5\/overview\?notice=Goal\+saved#progress$/);
    const stored = async () => (await h.db.prepare("SELECT value FROM settings WHERE key='goal:5'").first<{ value: string }>())?.value;
    assert.equal(JSON.parse((await stored())!).kg, 75);
    assert.ok(JSON.parse((await stored())!).startKg > 70);
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('display_weight_unit','lb') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    await goal({ goal_weight: "165" });
    assert.ok(Math.abs(JSON.parse((await stored())!).kg - 74.842) < 0.01);
    const before = await stored();
    assert.match((await goal({ goal_weight: "5" })).headers.get("Location")!, /notice=The\+goal\+weight/);
    assert.match((await goal({ goal_weight: "170", goal_date: "2001-01-01" })).headers.get("Location")!, /notice=The\+target\+date/);
    assert.equal(await stored(), before);
    assert.match((await goal({ goal_weight: "" })).headers.get("Location")!, /Goal\+removed/);
    assert.equal(await stored(), undefined);
  } finally {
    h.cleanup();
  }
});

test("/theme sets the cookie, guards the redirect and works signed out", async () => {
  const h = await harness();
  try {
    const r = await h.send("/theme?set=dark&back=/users/5/overview%3Frange%3D1y");
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("Location"), "/users/5/overview?range=1y");
    assert.match(r.headers.get("Set-Cookie")!, /yow_theme=dark; Path=\/; Max-Age=31536000; SameSite=Lax/);
    assert.equal((await h.send("/theme?set=light&back=//evil.test")).headers.get("Location"), "/");
    assert.equal((await h.send("/theme?set=system", { cookie: null })).status, 303);
    const signedOut = await h.send("/theme?set=dark", { cookie: null });
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.headers.get("Location"), "/");
    assert.match(signedOut.headers.get("Set-Cookie")!, /yow_theme=dark/);
  } finally {
    h.cleanup();
  }
});

test("legacy dashboard params are ignored", async () => {
  const h = await harness();
  try {
    const a = await (await h.send("/")).text();
    const b = await h.send("/?metric_5=11&range_5=30d");
    assert.equal(b.status, 200);
    assert.equal((await b.text()).replace(/back=[^"]*/g, ""), a.replace(/back=[^"]*/g, ""));
  } finally {
    h.cleanup();
  }
});
