import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleApp, type AppEnv } from "../app.ts";
import { de as webDe } from "../../../web/src/i18n/de.ts";
import { en as webEn } from "../../../web/src/i18n/en.ts";
import { de } from "../i18n/de.ts";
import { en } from "../i18n/en.ts";
import {
  interpolate, langFromAcceptLanguage, langFromCookie, negotiateLocale, plural, t, withLocale,
} from "../i18n/index.ts";
import { formatDate, formatDelta, formatMass, formatRate } from "../analysis/format.ts";
import { offlinePage } from "../pwa.ts";
import { LocalSqlite } from "../sqlite.ts";

// ---------------------------------------------------------------------------------------------
// (a) Catalogue completeness
// ---------------------------------------------------------------------------------------------

const params = (text: string): string[] =>
  [...text.matchAll(/(?<!\b(?:one|other)\s*)\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).filter((name, i, all) => all.indexOf(name) === i).sort();
const pluralBlocks = (text: string): { name: string; forms: string[] }[] =>
  [...text.matchAll(/\{\s*(\w+)\s*,\s*plural\s*,((?:[^{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\}/g)].map((m) => ({
    name: m[1],
    forms: [...m[2].matchAll(/(\w+)\s*\{/g)].map((f) => f[1]),
  }));

function checkCatalogues(name: string, a: Record<string, string>, b: Record<string, string>): void {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  assert.deepEqual(kb.filter((k) => !(k in a)), [], `${name}: keys only in de`);
  assert.deepEqual(ka.filter((k) => !(k in b)), [], `${name}: keys only in en`);
  for (const key of ka) {
    assert.ok(a[key].trim().length > 0, `${name}: empty en ${key}`);
    assert.ok(b[key].trim().length > 0, `${name}: empty de ${key}`);
    assert.deepEqual(params(b[key]), params(a[key]), `${name}: placeholders differ for ${key}`);
    const pa = pluralBlocks(a[key]);
    const pb = pluralBlocks(b[key]);
    assert.equal(pb.length, pa.length, `${name}: plural blocks differ for ${key}`);
    for (const block of [...pa, ...pb]) {
      assert.ok(block.forms.includes("one") && block.forms.includes("other"), `${name}: plural forms missing in ${key}`);
    }
    assert.doesNotMatch(b[key], /\b(TODO|FIXME)\b/, key);
    // Balanced braces, so a typo cannot swallow the rest of a sentence.
    for (const text of [a[key], b[key]]) assert.equal(text.split("{").length, text.split("}").length, `${name}: unbalanced braces in ${key}`);
  }
}

test("server catalogue: de matches en (keys, placeholders, plural forms, no empty strings)", () => {
  checkCatalogues("server", en, de);
  assert.ok(Object.keys(en).length > 500);
});

test("web catalogue: de matches en (keys, placeholders, plural forms, no empty strings)", () => {
  checkCatalogues("web", webEn, webDe);
});

test("de is really translated: most strings differ from en", () => {
  const same = Object.keys(en).filter((k) => (en as Record<string, string>)[k] === (de as Record<string, string>)[k]);
  assert.ok(same.length / Object.keys(en).length < 0.12, `too many untranslated keys: ${same.slice(0, 20).join(", ")}`);
});

test("interpolate and plural", () => {
  assert.equal(interpolate("Hello {name}!", { name: "Ada" }), "Hello Ada!");
  assert.equal(interpolate("Missing {x}", {}), "Missing {x}");
  const p = "{n, plural, one {# day} other {# days}}";
  assert.equal(interpolate(p, { n: 1 }, "en"), "1 day");
  assert.equal(interpolate(p, { n: 0 }, "en"), "0 days");
  assert.equal(interpolate("vor {n, plural, one {# Tag} other {# Tagen}} ({who})", { n: 2, who: "x" }, "de"), "vor 2 Tagen (x)");
  assert.equal(interpolate("{n, plural, one {{n} item of {kind}} other {{n} items of {kind}}}", { n: 3, kind: "k" }, "en"), "3 items of k");
  assert.equal(plural(1, { one: "a", other: "b" }, "en"), "a");
  assert.equal(plural(2, { one: "a", other: "b" }, "de"), "b");
});

test("t() uses the request locale and falls back to English outside withLocale", () => {
  assert.equal(t("nav.signOut"), "Sign out");
  assert.equal(withLocale("de", () => t("nav.signOut")), "Abmelden");
  assert.equal(withLocale("de", () => t("ov.subWeighIns", { n: 1 })), "1 Messung");
  assert.equal(withLocale("de", () => t("ov.subWeighIns", { n: 3 })), "3 Messungen");
  assert.equal(t("ov.subWeighIns", { n: 1 }), "1 weigh-in");
});

test("locale-aware number and date formatting", () => {
  const sample = Date.UTC(2026, 10, 5, 12) / 1000;
  assert.equal(formatMass(81.4, "kg"), "81.40 kg");
  assert.equal(withLocale("de", () => formatMass(81.4, "kg")), "81,40 kg");
  assert.equal(withLocale("de", () => formatDelta(-0.35, 1, "kg")), "−0,35 kg");
  assert.equal(withLocale("de", () => formatRate(-0.3, "kg")), "−0,3 kg/Woche");
  assert.equal(formatRate(-0.3, "kg"), "−0.3 kg/week");
  assert.match(withLocale("de", () => formatDate(sample, "UTC", "long")), /^Donnerstag, 5\. November 2026$/);
  assert.match(withLocale("de", () => formatDate(sample, "UTC", "short")), /^5\. Nov\.?$/);
  assert.equal(formatDate(sample, "UTC", "short"), "5 Nov");
});

test("language negotiation: cookie, Accept-Language, fallback", () => {
  assert.equal(langFromCookie("a=b; yos_lang=de; c=d"), "de");
  assert.equal(langFromCookie("yos_lang=fr"), null);
  assert.equal(langFromAcceptLanguage("de-DE,de;q=0.9,en;q=0.8"), "de");
  assert.equal(langFromAcceptLanguage("de"), "de");
  assert.equal(langFromAcceptLanguage("fr-FR, de;q=0.7"), "de");
  assert.equal(langFromAcceptLanguage("en-US,en;q=0.9,de;q=0.5"), "en");
  assert.equal(langFromAcceptLanguage("fr-FR,es"), null);
  assert.equal(langFromAcceptLanguage("de;q=0, en"), "en");
  assert.equal(langFromAcceptLanguage("deu"), null);
  assert.equal(langFromAcceptLanguage(null), null);
  const req = (headers: Record<string, string>) => new Request("http://x/", { headers });
  assert.equal(negotiateLocale(req({})), "en");
  assert.equal(negotiateLocale(req({ "Accept-Language": "de-CH" })), "de");
  assert.equal(negotiateLocale(req({ "Accept-Language": "de", Cookie: "yos_lang=en" })), "en");
  assert.equal(negotiateLocale(req({ "Accept-Language": "fr", Cookie: "yos_lang=de" })), "de");
  assert.equal(negotiateLocale(req({ "Accept-Language": "fr", Cookie: "yos_lang=xx" })), "en");
});

// ---------------------------------------------------------------------------------------------
// Harness: a household with enough history for every overview section
// ---------------------------------------------------------------------------------------------

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), "yow-i18n-"));
  const db = new LocalSqlite(join(dir, "a.db")).asD1();
  const env: AppEnv = { DB: db };
  let jar = "";
  let csrf = "";
  const send = async (
    path: string,
    init: { form?: Record<string, string>; headers?: Record<string, string>; https?: boolean; cookies?: boolean } = {},
  ) => {
    const headers: Record<string, string> = { Origin: "http://localhost", ...init.headers };
    if (init.cookies !== false && jar) headers.Cookie = [jar, headers.Cookie].filter(Boolean).join("; ");
    let body: string | undefined;
    if (init.form) {
      body = new URLSearchParams(init.form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const origin = init.https ? "https://localhost" : "http://localhost";
    const response = await handleApp(new Request(`${origin}${path}`, { method: init.form ? "POST" : "GET", headers, body, redirect: "manual" }), env);
    const cookie = response.headers.get("Set-Cookie");
    if (cookie && /^yow_session|^__Host-|SameSite=Strict/.test(cookie) && init.cookies !== false) jar = cookie.split(";")[0];
    return response;
  };
  return { send, db, env, csrf: () => csrf, setCsrf: (v: string) => (csrf = v), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function populated() {
  const h = await harness();
  const grab = async (path: string) => /name="_csrf" value="([a-f0-9]+)"/.exec(await (await h.send(path)).text())![1];
  let csrf = await grab("/setup");
  await h.send("/setup", { form: { password: "test-password", confirm: "test-password", _csrf: csrf } });
  csrf = await grab("/");
  h.setCsrf(csrf);
  const { db } = h;
  await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(5,'Alex Ünï','ALX',180,40,0,80,1700000000)").run();
  await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(6,'Sam','SAM',170,35,1,65,1700000000)").run();
  await db.prepare("INSERT INTO scales(id,label,model,mac,secret,time_zone) VALUES(1,'Bath','WBS03','020000000003','0123456789abcdef','Europe/Berlin')").run();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    "INSERT INTO readings(id,scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,weight_value,weight_unit,measures_json,payload_hash,first_received_at,last_received_at) VALUES(?,1,?,?,'[]',0,?,?,?,-3,?,?,?,?)",
  );
  for (let i = 0; i < 160; i++) {
    const t = now - (159 - i) * 86400 - 3600 * (i % 4 === 0 ? 14 : 6 + (i % 3));
    let grams = Math.round(86000 - i * 45 + ((i * 7) % 11) * 120);
    if (i === 80) grams = 120000; // a sudden jump that the trend leaves out
    const fat = 2400 - i * 2;
    const measures = [{ type: 1, value: grams, unit: -3 }, { type: 6, value: fat, unit: -2 }];
    await insert.bind(i + 1, 5, "assigned", t, i % 25 === 3 ? "untrusted" : "trusted", grams, JSON.stringify(measures), `a${i}`, t, t).run();
  }
  for (let i = 0; i < 5; i++) {
    const t = now - (i + 1) * 86400;
    await insert.bind(200 + i, 6, "assigned", t, "trusted", 62000 + i * 100, JSON.stringify([{ type: 1, value: 62000 + i * 100, unit: -3 }]), `b${i}`, t, t).run();
  }
  // Unassigned readings (assign/delete actions) and a Withings-style row for the health sync column.
  await insert.bind(300, null, "unassigned", now - 7200, "trusted", 71000, JSON.stringify([{ type: 1, value: 71000, unit: -3 }]), "u1", now - 7200, now - 7200).run();
  await h.send("/users/5/goal", { form: { _csrf: csrf, goal_weight: "75", goal_date: "2099-01-01" } });
  return h;
}

const DE = { "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" };
const EN = { "Accept-Language": "en-US,en;q=0.9" };

/** Visible markup: the embedded analysis JSON is data, not UI text. */
const visible = (html: string): string => html.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, "");
/** Same, minus the data-i18n JSON of the firmware page, whose `{model}`-style templates are filled in by firmware.js. */
const withoutTemplates = (html: string): string => html.replace(/ data-i18n="[^"]*"/g, "");

// (c) /lang route ------------------------------------------------------------------------------

test("/lang sets the cookie like /theme, works logged out and never redirects off-site", async () => {
  const h = await harness();
  try {
    const r = await h.send("/lang?set=de&back=%2Freadings%3Fuser%3D1");
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("Location"), "/readings?user=1");
    const cookie = r.headers.get("Set-Cookie")!;
    assert.match(cookie, /^yos_lang=de; Path=\/; Max-Age=31536000; SameSite=Lax$/);
    const https = await h.send("/lang?set=en", { https: true });
    assert.equal(https.headers.get("Set-Cookie"), "yos_lang=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    assert.equal(https.headers.get("Location"), "/");
    assert.equal(https.headers.get("Cache-Control"), "no-store");
    assert.equal((await h.send("/lang?set=fr")).status, 400);
    assert.equal((await h.send("/lang")).status, 400);
    assert.equal((await h.send("/lang?set=de", { headers: { Referer: "http://localhost/users?x=1" } })).headers.get("Location"), "/users?x=1");
    assert.equal((await h.send("/lang?set=de", { headers: { Referer: "http://evil.test/a" } })).headers.get("Location"), "/");
    for (const payload of ["/.//evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "\\\\evil.com"]) {
      const bad = await h.send(`/lang?set=de&back=${encodeURIComponent(payload)}`);
      assert.equal(bad.headers.get("Location"), "/", payload);
    }
  } finally {
    h.cleanup();
  }
});

// (d) Accept-Language fallback -----------------------------------------------------------------

test("html lang follows cookie, then Accept-Language, then English", async () => {
  const h = await harness();
  try {
    const lang = async (headers: Record<string, string>) => /<html lang="(\w+)"/.exec(await (await h.send("/setup", { headers, cookies: false })).text())![1];
    assert.equal(await lang({}), "en");
    assert.equal(await lang({ "Accept-Language": "fr-FR,fr;q=0.9" }), "en");
    assert.equal(await lang({ "Accept-Language": "de-AT,de;q=0.9,en;q=0.5" }), "de");
    assert.equal(await lang({ "Accept-Language": "en-GB,en;q=0.9,de;q=0.4" }), "en");
    assert.equal(await lang({ "Accept-Language": "de", Cookie: "yos_lang=en" }), "en");
    assert.equal(await lang({ "Accept-Language": "en", Cookie: "yos_lang=de" }), "de");
    assert.equal(await lang({ Cookie: "yos_lang=klingon", "Accept-Language": "de" }), "de");
  } finally {
    h.cleanup();
  }
});

test("setup, sign-in and footer: German strings and the EN | DE switch", async () => {
  const h = await harness();
  try {
    const setup = visible(await (await h.send("/setup", { headers: DE, cookies: false })).text());
    assert.match(setup, /Willkommen bei YourOpenScale|Passwort festlegen/);
    assert.match(setup, /<nav class="segmented" aria-label="Sprache"><a href="\/lang\?set=en&amp;back=%2Fsetup" data-lang-set="en" lang="en" hreflang="en" aria-label="English">EN<\/a><a href="\/lang\?set=de&amp;back=%2Fsetup" data-lang-set="de" lang="de" hreflang="de" aria-label="Deutsch" aria-current="page">DE<\/a><\/nav>/);
    assert.match(setup, /aria-label="Darstellung"/);
    assert.match(setup, /Basiert auf YourOwnWeigh/);
    const english = visible(await (await h.send("/setup", { headers: EN, cookies: false })).text());
    assert.match(english, /Set your password/);
    assert.match(english, /data-lang-set="en" lang="en" hreflang="en" aria-label="English" aria-current="page">EN</);
  } finally {
    h.cleanup();
  }
});

// (b) Per-locale rendering ---------------------------------------------------------------------

/** English UI words that must not survive in German pages (names, ids and product terms excluded). */
const DENYLIST = [
  "Settings", "Readings", "Show data table", "Raw readings", "Download CSV", "Not enough data", "Sign out", "Weigh-ins",
  "Weigh-in", "Manage", "Overview", "Summary", "Habits", "Patterns", "Records", "Data quality", "More metrics", "Progress",
  "Save goal", "Edit goal", "Set a goal", "Cancel", "Import from", "Add person", "Short name", "Date of birth", "Previous period",
  "Year over year", "Time range", "Morning only", "Comparable", "Left out of the trend", "No weigh-ins", "Unassigned",
  "Sign in", "Welcome", "Display", "Backup and restore", "Export database", "Language", "Theme", "Choose", "Scales", "Users",
  "People", "Newer", "Older", "Time of day", "Weekday", "Current streak", "Longest", "Fat mass", "Lean mass", "Body fat",
];

function assertGerman(page: string, html: string, expected: RegExp[]): void {
  const text = visible(html);
  assert.match(text, /<html lang="de"/, page);
  for (const re of expected) assert.match(text, re, `${page}: expected ${re}`);
  for (const word of DENYLIST) {
    const re = new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u");
    const hit = re.exec(text.replace(/<[^>]+>/g, "|"));
    assert.equal(hit, null, `${page}: leftover English "${word}" near ${hit ? text.replace(/<[^>]+>/g, "|").slice(Math.max(0, hit.index - 60), hit.index + 80) : ""}`);
  }
  assert.doesNotMatch(withoutTemplates(text).replace(/<style[\s\S]*?<\/style>/g, ""), /\$\{|\{[a-z][A-Za-z]*\}|\bundefined\b|\[object /, `${page}: unresolved placeholder`);
}

test("pages render in German with no leftover English UI words", async () => {
  const h = await populated();
  try {
    const get = async (path: string) => {
      const r = await h.send(path, { headers: DE });
      assert.equal(r.status, 200, path);
      return r.text();
    };
    assertGerman("dashboard", await get("/"), [/<title>Dashboard · YourOpenScale/, />Heute</, /Analyse öffnen/, /letzte Messung/, /Nutzer<\/a>/, />Messungen<\/a>/, /Abmelden/, /Verwalten/, /Personen/, />Hell<\/a>/, /82,\d kg|[0-9],\d kg/]);
    const overview = await get("/users/5/overview?range=all");
    assertGerman("overview", overview, [
      /<title>Alex Ünï · YourOpenScale/, /Zusammenfassung/, /Fortschritt/, /Körperzusammensetzung/, /Gewohnheiten/, /Muster/, /Rekorde/, /Datenqualität/, /Weitere Messwerte/,
      /Datentabelle anzeigen/, /CSV herunterladen/, /Rohmessungen/, /Trendgewicht/, /Ziel/, /Nicht im Trend berücksichtigt/, /Zeitraumvergleich/, /kg\/Woche/, /Wochentagseffekt/, /Tageszeit/,
      /So werden die Zahlen berechnet/, /Gesamter Zeitraum/, /Messkalender/, /Nov\.? 20\d\d|Dez\.? 20\d\d|\d\. \w+\.? 20\d\d/,
    ]);
    assert.doesNotMatch(visible(overview), /Fat mass|Weight<|Mon<|Tue<|Wed</);
    assertGerman("overview 90d with compare", await get("/users/5/overview?range=90d&compare=yoy&morning=1"), [/Vorjahr/, /Nur morgens/, /Zeitraum/]);
    assertGerman("readings", await get("/readings"), [/<title>Messungen · YourOpenScale/, />Alle Wägungen im Haushalt</, />Zeitpunkt</, />Nutzer</, />Waage</, />Zuordnen</, />Löschen</, /Nicht zugeordnet/, /data-confirm="Diese nicht zugeordnete Messung endgültig löschen\?"/]);
    assertGerman("raw readings", await get("/users/5/readings"), [/<title>Rohmessungen von Alex Ünï/, />Rohmessungen</, /Nur Ausreißer/, /Zuordnung/, /Ausreißer/, />Älter</]);
    assertGerman("users", await get("/users"), [/>Nutzer</, />Person hinzufügen</, />Kürzel</, />Größe</, /Männlich|Weiblich/, /Nutzer speichern/, /Nutzer deaktivieren/, /Nutzer löschen/, /Aktiv/]);
    assertGerman("settings", await get("/settings"), [/>Einstellungen</, /Gewichtseinheit/, /Kilogramm/, />Sprache</, /Sichern und wiederherstellen/, /Datenbank exportieren/, /Admin-Passwort/, /Passwort der Sync-API/]);
    assertGerman("scales", await get("/scales"), [/>Waagen</, /Einstellungen bearbeiten/, /Gerätedatei importieren/, /Noch nicht bestätigt|Noch keine Firmware/]);
    assertGerman("sync", await get("/sync"), [/Per HTTP abrufen/, /Kurzbefehl/, /Kürzel/]);
    assertGerman("import", await get("/import/withings"), [/Withings-Datenexport importieren/, /Import ansehen/]);
    const firmware = await get("/firmware");
    assertGerman("firmware", firmware, [/Firmware-Bridge/, /Python-Bridge verbinden/, /Verbindungseinladung erzeugen/, /Zielmodell/, /WLAN speichern und verbinden/]);
    // Hooks that firmware.js depends on survive translation.
    for (const id of ["scan-ble", "generate-firmware", "connection-state", "flash-confirmation", "enroll-dialog", "bridge-status-text"]) assert.match(firmware, new RegExp(`id="${id}"`));
  } finally {
    h.cleanup();
  }
});

test("the same pages stay English with an English browser", async () => {
  const h = await populated();
  try {
    const page = await (await h.send("/users/5/overview?range=all", { headers: EN })).text();
    assert.match(page, /<html lang="en"/);
    for (const text of ["Summary", "Show data table", "Download CSV", "Weigh-in calendar", "Left out of the trend", "kg/week"]) assert.ok(page.includes(text), text);
    const readings = await (await h.send("/readings", { headers: EN })).text();
    assert.match(readings, /<title>Readings · YourOpenScale/);
  } finally {
    h.cleanup();
  }
});

test("the cookie switches a live session and flash messages follow it", async () => {
  const h = await populated();
  try {
    const cookie = (await h.send("/lang?set=de")).headers.get("Set-Cookie")!.split(";")[0];
    const page = await (await h.send("/readings", { headers: { Cookie: cookie, ...EN } })).text();
    assert.match(page, /<html lang="de"/);
    const goal = await h.send("/users/5/goal", { form: { _csrf: h.csrf(), goal_weight: "abc" }, headers: { Cookie: cookie } });
    assert.match(decodeURIComponent(goal.headers.get("Location")!.replace(/\+/g, " ")), /notice=Gib das Zielgewicht als Zahl ein/);
    const deleted = await h.send("/users/5/goal", { form: { _csrf: h.csrf(), goal_weight: "" }, headers: { Cookie: cookie } });
    assert.match(decodeURIComponent(deleted.headers.get("Location")!.replace(/\+/g, " ")), /notice=Ziel entfernt/);
    const flash = await (await h.send(deleted.headers.get("Location")!, { headers: { Cookie: cookie } })).text();
    assert.match(flash, /class="flash callout callout-info"[^>]*>[\s\S]*Ziel entfernt/);
    const english = await h.send("/users/5/goal", { form: { _csrf: h.csrf(), goal_weight: "abc" }, headers: EN });
    assert.match(decodeURIComponent(english.headers.get("Location")!.replace(/\+/g, " ")), /notice=Enter the goal weight as a number/);
  } finally {
    h.cleanup();
  }
});

test("CSV export is data: English header, ISO dates and a dot decimal in every language", async () => {
  const h = await populated();
  try {
    const de1 = await h.send("/users/5/export.csv?range=30d&agg=raw", { headers: DE });
    const en1 = await h.send("/users/5/export.csv?range=30d&agg=raw", { headers: EN });
    assert.equal(de1.status, 200);
    const a = await de1.text();
    const b = await en1.text();
    assert.equal(a, b);
    const [header, first] = a.split("\n");
    assert.match(header, /^[A-Za-z_,]+/);
    assert.match(first, /\d{4}-\d{2}-\d{2}/);
    assert.match(first, /\d+\.\d+/);
  } finally {
    h.cleanup();
  }
});

test("JSON of the analysis island carries translated labels, and the API stays machine-readable", async () => {
  const h = await populated();
  try {
    const html = await (await h.send("/users/5/overview?range=all", { headers: DE })).text();
    const json = /<script type="application\/json" id="analysis-data">([\s\S]*?)<\/script>/.exec(html)![1];
    const wire = JSON.parse(json.replaceAll("<\\/", "</"));
    assert.equal(wire.weight.label, "Gewicht");
    assert.match(wire.weight.summary, /Gewicht, gesamter Zeitraum/);
    assert.deepEqual(wire.patterns.weekday.map((w: { label: string }) => w.label), ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
  } finally {
    h.cleanup();
  }
});

// Offline page ---------------------------------------------------------------------------------

test("offline page is bilingual and leads with the negotiated language", () => {
  const en1 = offlinePage("en");
  const de1 = offlinePage("de");
  assert.match(en1, /<html lang="en">[\s\S]*<h1>You are offline<\/h1>/);
  assert.match(de1, /<html lang="de">[\s\S]*<h1>Du bist offline<\/h1>/);
  for (const page of [en1, de1]) {
    assert.ok(page.includes("You are offline") && page.includes("Du bist offline"));
    assert.ok(page.includes('lang="en"') && page.includes('lang="de"'));
    assert.doesNotMatch(page, /<script(?![^>]*\ssrc=)|onclick=/);
  }
  assert.ok(de1.indexOf("Du bist offline") < de1.indexOf("You are offline"));
  assert.match(de1, /Erneut versuchen/);
});
