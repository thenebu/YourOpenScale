import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleApp, type AppEnv } from "../app.ts";
import { LocalSqlite } from "../sqlite.ts";
import { pageHref, withingsImportPage } from "../ui.ts";

// WP-14: readings pagination (keyset), conditional Health Sync column, links, dropzone, users cards.
async function harness(count = 130) {
  const dir = mkdtempSync(join(tmpdir(), "yow-admin-"));
  const db = new LocalSqlite(join(dir, "a.db")).asD1();
  const env: AppEnv = { DB: db };
  let cookie = "";
  const send = async (path: string, form?: Record<string, string>) => {
    const headers: Record<string, string> = { Origin: "http://localhost" };
    if (cookie) headers.Cookie = cookie;
    let body: string | undefined;
    if (form) {
      body = new URLSearchParams(form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const r = await handleApp(new Request(`http://localhost${path}`, { method: form ? "POST" : "GET", headers, body }), env);
    if (r.headers.has("Set-Cookie")) cookie = r.headers.get("Set-Cookie")!.split(";")[0];
    return r;
  };
  const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await send("/setup")).text())![1];
  await send("/setup", { password: "test-password", confirm: "test-password", _csrf: csrf });
  await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(5,'Alex','ALX',180,40,0,80,1700000000)").run();
  await db.prepare("INSERT INTO scales(id,label,model,mac,secret,time_zone) VALUES(1,'Bath','WBS03','020000000003','0123456789abcdef','Europe/Berlin')").run();
  const now = Math.floor(Date.now() / 1000) - 3600;
  const ins = db.prepare(
    "INSERT INTO readings(id,scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,weight_value,weight_unit,measures_json,payload_hash,first_received_at,last_received_at) VALUES(?,1,?,?,'[]',0,?,'trusted',?,-3,?,?,?,?)",
  );
  const add = async (id: number, userId: number | null, t: number, grams: number) =>
    ins.bind(id, userId, userId ? "assigned" : "unassigned", t, grams, JSON.stringify([{ type: 1, value: grams, unit: -3 }]), `h${id}`, t, t).run();
  // Groups of three readings share one timestamp, so page edges fall inside a tie.
  for (let i = 0; i < count; i++) await add(i + 1, 5, now - Math.floor((count - 1 - i) / 3) * 86400, 80000 - (i % 7) * 100);
  return { send, db, add, now, csrf, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const ids = (html: string): number[] => [...html.matchAll(/data-reading-id="(\d+)"/g)].map((m) => Number(m[1]));
const href = (html: string, rel: string): string | null => {
  const m = new RegExp(`<a class="btn btn-secondary btn-sm" rel="${rel}" href="([^"]+)"`).exec(html);
  return m ? m[1].replaceAll("&amp;", "&") : null;
};

test("/readings: keyset pages never skip or repeat rows, even inside a timestamp tie", async () => {
  const h = await harness(130);
  try {
    const seen: number[] = [];
    let url: string | null = "/readings";
    let pages = 0;
    let firstPageIds: number[] = [];
    while (url) {
      const html: string = await (await h.send(url)).text();
      const got = ids(html);
      assert.ok(got.length <= 50);
      if (pages === 0) {
        firstPageIds = got;
        assert.equal(href(html, "prev"), null, "first page has no Newer link");
      } else assert.ok(href(html, "prev"), "later pages have a Newer link");
      seen.push(...got);
      pages++;
      url = href(html, "next");
    }
    assert.equal(pages, 3);
    assert.equal(seen.length, 130);
    assert.equal(new Set(seen).size, 130);
    // Newer from page two returns exactly page one.
    const second = await (await h.send(href(await (await h.send("/readings")).text(), "next")!)).text();
    const back = await (await h.send(href(second, "prev")!)).text();
    assert.deepEqual(ids(back), firstPageIds);
    assert.equal(href(back, "prev"), null);
  } finally {
    h.cleanup();
  }
});

test("/users/:id/readings: 100 rows per page, preserved filters, names link to the overview", async () => {
  const h = await harness(130);
  try {
    const html = await (await h.send("/users/5/readings")).text();
    assert.equal(ids(html).length, 100);
    assert.match(html, /<h1 class="page-title">Raw readings<\/h1>/);
    assert.match(html, /class="link link-back" href="\/users\/5\/overview"/);
    assert.match(href(html, "next")!, /^\/users\/5\/readings\?before=\d+$/);
    const rest = await (await h.send(href(html, "next")!)).text();
    assert.equal(ids(rest).length, 30);
    assert.equal(href(rest, "next"), null);
    const filtered = await (await h.send("/users/5/readings?outliers=1")).text();
    assert.match(filtered, /aria-current="true"[^>]*>.*Outliers only/);
  } finally {
    h.cleanup();
  }
});

test("outliers are flagged with a badge and the outliers=1 filter keeps only them", async () => {
  const h = await harness(40);
  try {
    await h.add(900, 5, h.now - 3600, 140000);
    const all = await (await h.send("/users/5/readings")).text();
    assert.equal((all.match(/>Outlier</g) ?? []).length, 1);
    const only = await (await h.send("/users/5/readings?outliers=1")).text();
    assert.deepEqual(ids(only), [900]);
  } finally {
    h.cleanup();
  }
});

test("/readings: user filter, unassigned rows with actions, and name links", async () => {
  const h = await harness(10);
  try {
    await h.add(901, null, h.now + 10, 70000);
    const html = await (await h.send("/readings")).text();
    assert.match(html, /<a class="link" href="\/users\/5\/overview">Alex<\/a>/);
    assert.match(html, /class="row-unassigned"/);
    assert.match(html, /action="\/readings\/901\/assign"/);
    assert.match(html, /action="\/readings\/901\/delete"/);
    assert.match(html, /Unassigned \(1\)/);
    const un = await (await h.send("/readings?user=unassigned")).text();
    assert.deepEqual(ids(un), [901]);
    const mine = await (await h.send("/readings?user=5")).text();
    assert.equal(ids(mine).length, 10);
    assert.doesNotMatch(mine, /row-unassigned/);
    assert.doesNotMatch(mine, /<th scope="col">Actions<\/th>/);
  } finally {
    h.cleanup();
  }
});

test("the Health Sync column appears only when a row on the page has an acknowledgement", async () => {
  const h = await harness(5);
  try {
    assert.doesNotMatch(await (await h.send("/readings")).text(), /Health Sync/);
    await h.db.prepare("INSERT INTO health_sync_receipts(reading_id,user_id,synced_at) VALUES(5,5,1700000000)").run();
    const html = await (await h.send("/readings")).text();
    assert.match(html, /<th scope="col">Health Sync<\/th>/);
    assert.match(html, /<span class="badge">Acknowledged<\/span>/);
    assert.match(html, /<time class="hint" datetime="2023-11-14T/);
    assert.match(html, /Not Acknowledged/);
  } finally {
    h.cleanup();
  }
});

test("import page has a dropzone around the file input; users page has the Import menu and card cells", async () => {
  const page = withingsImportPage("tok");
  assert.match(page, /<label class="dropzone">.*Choose the ZIP from Withings or drop it here.*<input type="file" name="export" accept="\.zip,application\/zip" required><\/label>/s);
  assert.match(page, /class="link link-back" href="\/users"/);
  const h = await harness(1);
  try {
    const users = await (await h.send("/users")).text();
    assert.match(users, /<details class="menu"><summary class="btn btn-secondary">Import/);
    assert.match(users, /From a Withings data export \(ZIP\)/);
    assert.match(users, /data-open-dialog="import-users-dialog"/);
    assert.match(users, /data-label="Short name"/);
    assert.match(users, /<a class="link" href="\/users\/5\/overview">Alex<\/a>/);
    assert.match(users, /class="btn btn-primary" data-open-dialog="add-user-dialog">Add person</);
  } finally {
    h.cleanup();
  }
});

test("pageHref skips empty values and encodes the rest", () => {
  assert.equal(pageHref("/readings", { metric: null, user: "5", x: "a b" }), "/readings?user=5&x=a%20b");
  assert.equal(pageHref("/readings", {}), "/readings");
});
