import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleApp, type AppEnv } from "../app.ts";
import { formatDate, formatDateTime } from "../analysis/format.ts";
import { withDatePrefs, withLocale, type DatePrefs, type Locale } from "../i18n/index.ts";
import { dateFormatFromCookie, datePrefsFromCookie, timeFormatFromCookie } from "../routes/util.ts";
import { LocalSqlite } from "../sqlite.ts";

const at = (y: number, m: number, d: number, h = 14, min = 35) => Date.UTC(y, m - 1, d, h, min) / 1000;
const fmt = (locale: Locale, prefs: DatePrefs, t: number, style: Parameters<typeof formatDate>[2]) =>
  withLocale(locale, () => withDatePrefs(prefs, () => formatDate(t, "UTC", style)));

test("formatDate: every date format, short and medium, including 1 Jan and 31 Dec", () => {
  const cases: [DatePrefs["date"], number, string, string][] = [
    ["dmy-dot", at(2026, 11, 22), "22.11.2026", "22.11."],
    ["dmy-dot", at(2026, 1, 1), "01.01.2026", "01.01."],
    ["dmy-dot", at(2026, 12, 31), "31.12.2026", "31.12."],
    ["ymd", at(2026, 11, 22), "2026-11-22", "11-22"],
    ["ymd", at(2026, 1, 1), "2026-01-01", "01-01"],
    ["mdy", at(2026, 11, 22), "11/22/2026", "11/22"],
    ["mdy", at(2026, 12, 31), "12/31/2026", "12/31"],
    ["dmy-slash", at(2026, 11, 22), "22/11/2026", "22/11"],
    ["dmy-slash", at(2026, 1, 1), "01/01/2026", "01/01"],
  ];
  for (const locale of ["en", "de"] as const)
    for (const [date, t, medium, short] of cases) {
      assert.equal(fmt(locale, { date, time: "auto" }, t, "medium"), medium, `${locale} ${date} medium`);
      assert.equal(fmt(locale, { date, time: "auto" }, t, "short"), short, `${locale} ${date} short`);
    }
});

test("formatDate: auto follows the language, month names stay locale based", () => {
  const auto: DatePrefs = { date: "auto", time: "auto" };
  assert.equal(fmt("en", auto, at(2026, 11, 22), "medium"), "22 Nov 2026");
  assert.equal(fmt("en", auto, at(2026, 1, 1), "short"), "1 Jan");
  assert.equal(fmt("en", auto, at(2026, 12, 31), "medium"), "31 Dec 2026");
  assert.equal(fmt("de", auto, at(2026, 11, 22), "medium"), "22.11.2026");
  assert.equal(fmt("de", auto, at(2026, 12, 31), "short"), "31.12.");
  assert.equal(fmt("en", auto, at(2026, 11, 22), "long"), "Sunday 22 November 2026");
  assert.equal(fmt("de", auto, at(2026, 11, 22), "long"), "Sonntag, 22. November 2026");
  assert.equal(fmt("en", { date: "ymd", time: "auto" }, at(2026, 11, 22), "month"), "Nov 2026");
  assert.match(fmt("de", { date: "ymd", time: "auto" }, at(2026, 3, 5), "month"), /^März 2026$/);
  assert.equal(fmt("en", { date: "dmy-dot", time: "auto" }, at(2026, 11, 22), "long"), "Sunday 22.11.2026");
  assert.equal(fmt("de", { date: "ymd", time: "auto" }, at(2026, 11, 22), "long"), "Sonntag, 2026-11-22");
  assert.equal(fmt("en", auto, at(2026, 11, 22), "day"), "Sun, 22 Nov 2026");
  assert.equal(fmt("en", { date: "mdy", time: "auto" }, at(2026, 11, 22), "day"), "Sun, 11/22/2026");
  assert.equal(fmt("de", auto, at(2026, 11, 22), "day"), "So, 22.11.2026");
});

test("formatDate: time formats and zones", () => {
  for (const locale of ["en", "de"] as const) {
    assert.equal(fmt(locale, { date: "auto", time: "auto" }, at(2026, 11, 22, 14, 35), "time"), "14:35");
    assert.equal(fmt(locale, { date: "auto", time: "24h" }, at(2026, 11, 22, 4, 5), "time"), "04:05");
    assert.equal(fmt(locale, { date: "auto", time: "12h" }, at(2026, 11, 22, 14, 35), "time"), "2:35 PM");
    assert.equal(fmt(locale, { date: "auto", time: "12h" }, at(2026, 11, 22, 0, 5), "time"), "12:05 AM");
    assert.equal(fmt(locale, { date: "auto", time: "12h" }, at(2026, 11, 22, 12, 0), "time"), "12:00 PM");
  }
  const t = at(2026, 12, 31, 23, 30);
  assert.equal(withDatePrefs({ date: "dmy-dot", time: "24h" }, () => formatDate(t, "Europe/Berlin", "medium")), "01.01.2027");
  assert.equal(withDatePrefs({ date: "ymd", time: "12h" }, () => formatDateTime(t, "UTC")), "2026-12-31 11:30 PM");
  assert.equal(withDatePrefs({ date: "dmy-dot", time: "auto" }, () => formatDate(t, "Not/AZone", "medium")), "31.12.2026");
});

test("cookies: parsed and validated, invalid means auto", () => {
  const req = (cookie: string) => new Request("http://localhost/", { headers: { Cookie: cookie } });
  assert.equal(dateFormatFromCookie(req("a=b; yos_datefmt=dmy-dot; c=d")), "dmy-dot");
  for (const v of ["ymd", "mdy", "dmy-slash", "auto"]) assert.equal(dateFormatFromCookie(req(`yos_datefmt=${v}`)), v);
  assert.equal(dateFormatFromCookie(req("yos_datefmt=iso")), "auto");
  assert.equal(dateFormatFromCookie(req("yos_datefmt=")), "auto");
  assert.equal(dateFormatFromCookie(new Request("http://localhost/")), "auto");
  assert.equal(timeFormatFromCookie(req("yos_timefmt=12h")), "12h");
  assert.equal(timeFormatFromCookie(req("yos_timefmt=24h")), "24h");
  assert.equal(timeFormatFromCookie(req("yos_timefmt=36h")), "auto");
  assert.deepEqual(datePrefsFromCookie(req("yos_datefmt=ymd; yos_timefmt=12h")), { date: "ymd", time: "12h" });
});

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), "yow-datefmt-"));
  const db = new LocalSqlite(join(dir, "a.db")).asD1();
  const env: AppEnv = { DB: db };
  let session = "";
  const send = async (path: string, init: { cookie?: string; headers?: Record<string, string>; auth?: boolean; form?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { Origin: "http://localhost", ...init.headers };
    const cookies = [init.auth === false ? "" : session, init.cookie ?? ""].filter(Boolean).join("; ");
    if (cookies) headers.Cookie = cookies;
    let body: string | undefined;
    if (init.form) {
      body = new URLSearchParams(init.form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const r = await handleApp(new Request(`http://localhost${path}`, { method: init.form ? "POST" : "GET", headers, body, redirect: "manual" }), env);
    const set = r.headers.get("Set-Cookie");
    if (set && /^yow_session|^__Host-/.test(set)) session = set.split(";")[0];
    return r;
  };
  const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await send("/setup", { auth: false })).text())![1];
  await send("/setup", { form: { password: "test-password", confirm: "test-password", _csrf: csrf } });
  await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(5,'Alex','ALX',180,40,0,80,1700000000)").run();
  await db.prepare("INSERT INTO scales(id,label,model,mac,secret,time_zone) VALUES(1,'Bath','WBS03','020000000003','0123456789abcdef','UTC')").run();
  await db
    .prepare("INSERT INTO readings(id,scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,weight_value,weight_unit,measures_json,payload_hash,first_received_at,last_received_at) VALUES(1,1,5,'assigned','[]',0,?,'trusted',80000,-3,?,'h1',?,?)")
    .bind(at(2026, 11, 22, 12, 0), JSON.stringify([{ type: 1, value: 80000, unit: -3 }]), at(2026, 11, 22, 12, 0), at(2026, 11, 22, 12, 0))
    .run();
  return { send, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("/prefs sets the cookies, works logged out, accepts any subset, rejects bad values", async () => {
  const h = await harness();
  try {
    const r = await h.send("/prefs?datefmt=dmy-dot&timefmt=12h&back=%2Fsettings", { auth: false });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("Location"), "/settings");
    const cookies = r.headers.getSetCookie();
    assert.deepEqual(cookies, [
      "yos_datefmt=dmy-dot; Path=/; Max-Age=31536000; SameSite=Lax",
      "yos_timefmt=12h; Path=/; Max-Age=31536000; SameSite=Lax",
    ]);
    const only = await h.send("/prefs?timefmt=24h", { auth: false });
    assert.deepEqual(only.headers.getSetCookie(), ["yos_timefmt=24h; Path=/; Max-Age=31536000; SameSite=Lax"]);
    assert.equal(only.headers.get("Location"), "/");
    assert.equal(only.headers.get("Cache-Control"), "no-store");
    const secure = await handleApp(new Request("https://localhost/prefs?datefmt=ymd", { headers: { Origin: "https://localhost" } }), { DB: new LocalSqlite(":memory:").asD1() });
    assert.match(secure.headers.getSetCookie()[0], /; Secure$/);
    assert.equal((await h.send("/prefs?datefmt=iso", { auth: false })).status, 400);
    assert.equal((await h.send("/prefs?timefmt=36h", { auth: false })).status, 400);
    for (const payload of ["/.//evil.com", "//evil.com", "/\\evil.com", "https://evil.com"]) {
      const bad = await h.send(`/prefs?datefmt=ymd&back=${encodeURIComponent(payload)}`, { auth: false });
      assert.equal(bad.headers.get("Location"), "/", payload);
    }
  } finally {
    h.cleanup();
  }
});

test("readings table follows the date format; <time datetime> and CSV stay ISO", async () => {
  const h = await harness();
  try {
    const dot = await (await h.send("/users/5/readings", { cookie: "yos_datefmt=dmy-dot" })).text();
    assert.match(dot, /<time class="when" datetime="2026-11-22T12:00:00\.000Z"><span class="when-date">22\.11\.2026<\/span>/);
    assert.match(dot, /data-datefmt="dmy-dot"/);
    const ymd = await (await h.send("/users/5/readings", { cookie: "yos_datefmt=ymd; yos_timefmt=12h" })).text();
    assert.match(ymd, /datetime="2026-11-22T12:00:00\.000Z"><span class="when-date">2026-11-22<\/span> <span class="when-time">\d{1,2}:00 [AP]M</);
    const auto = await (await h.send("/users/5/readings", { headers: { "Accept-Language": "de" } })).text();
    assert.match(auto, /<span class="when-date">22\.11\.2026<\/span>/);
    const csv = await (await h.send("/users/5/export.csv")).text();
    if (csv.includes("2026")) assert.match(csv, /2026-11-22/);
  } finally {
    h.cleanup();
  }
});

test("settings: date and time format form submits via GET /prefs", async () => {
  const h = await harness();
  try {
    const html = await (await h.send("/settings", { cookie: "yos_datefmt=dmy-dot; yos_timefmt=24h" })).text();
    assert.match(html, /<form action="\/prefs" method="get"[^>]*><input type="hidden" name="back" value="\/settings">/);
    assert.match(html, /<select name="datefmt" data-submit-on-change>/);
    assert.match(html, /<select name="timefmt" data-submit-on-change>/);
    assert.match(html, /<option value="dmy-dot" selected>\d\d\.\d\d\.\d{4}<\/option>/);
    assert.match(html, /<option value="24h" selected>/);
    assert.match(html, /Example: \d\d\.\d\d\.\d{4} \d\d:\d\d/);
    assert.match(html, /Native date pickers follow your browser language/);
  } finally {
    h.cleanup();
  }
});
