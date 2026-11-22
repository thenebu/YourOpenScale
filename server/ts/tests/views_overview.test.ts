import assert from "node:assert/strict";
import test from "node:test";
import { buildUserAnalysis } from "../analysis/model.ts";
import { serializeAnalysis } from "../analysis/serialize.ts";
import type { Reading, UserAnalysis } from "../analysis/types.ts";
import { overviewView } from "../views/overview.ts";
import { synth } from "./fixtures/synthetic.ts";

const DAY = 86400;
const now = Math.floor(Date.UTC(2026, 10, 22, 12) / 1000);
const user = { id: 7, name: "Alex <b>", shortName: "Alex", heightCm: 180, ageYears: 40, sex: 1 as const };

function build(readings: Reading[], opts: { morning?: boolean; key?: "90d" | "custom"; goal?: boolean } = {}): UserAnalysis {
  return buildUserAnalysis({
    user, readings, unit: "kg", now,
    range: { key: opts.key ?? "90d", from: now - 90 * DAY, to: now, morningOnly: !!opts.morning, compare: "none" },
    goal: opts.goal === false ? null : { kg: 78, date: null, startKg: 88, startAt: now - 300 * DAY },
  });
}
const full = synth({ seed: 3, days: 400, start: "2025-10-20", base: 88, slopePerWeek: -0.06, composition: true, zone: "Europe/Berlin" })
  .map((r) => ({ ...r, values: { ...r.values, 11: 62 } }));
const weightOnly = synth({ seed: 4, days: 120, start: "2026-07-20", base: 80, zone: "Europe/Berlin" });
const users = [{ id: 7, name: "Alex <b>" }, { id: 8, name: "Sam" }];
function render(a: UserAnalysis, q = "range=90d&morning=1") {
  return overviewView(a, { users, query: new URLSearchParams(q), csrf: "tok<>", wireJson: JSON.stringify(serializeAnalysis(a)) });
}

test("range links: aria-current and they keep morning=1", () => {
  const html = render(build(full, { morning: true }));
  assert.match(html, /<a href="[^"]*range=90d[^"]*"[^>]*aria-current="page"[^>]*>90 d<\/a>/);
  const hrefs = [...html.matchAll(/<a href="([^"]*)"[^>]*>(30 d|1 y|All)<\/a>/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 3);
  for (const h of hrefs) assert.match(h, /morning=1/);
  assert.match(html, /<a class="chip"[^>]*aria-current="true"/);
});

test("custom range form is GET with from/to inputs", () => {
  const html = render(build(full));
  const form = /<form class="range-custom-form[^>]*method="get"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
  assert.match(form, /name="from"/);
  assert.match(form, /name="to"/);
  assert.match(form, /name="morning" value="1"/);
});

test("JSON block exists and escapes closing script tags", () => {
  const a = build(full);
  a.user = { ...a.user, name: "x</script><script>alert(1)" };
  const html = overviewView(a, { users, query: new URLSearchParams(), csrf: "t", wireJson: JSON.stringify(serializeAnalysis(a)) });
  const m = /<script type="application\/json" id="analysis-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m);
  assert.doesNotMatch(m[1], /<\/script/i);
  assert.equal(JSON.parse(m[1]).version, 1);
  assert.match(html, /data-payload="analysis-data"/);
});

test("sections: all present for full data, composition omitted for weight-only", () => {
  const html = render(build(full));
  for (const id of ["summary", "trend", "progress", "composition", "habits", "patterns", "records", "quality", "metrics"])
    assert.match(html, new RegExp(`<section id="${id}" class="overview-section"`), id);
  const w = render(build(weightOnly));
  assert.doesNotMatch(w, /id="composition"/);
  assert.doesNotMatch(w, /href="#composition"/);
  assert.match(w, /id="progress"/);
});

test("heart-rate small multiple has id metric-11", () => {
  const html = render(build(full));
  assert.match(html, /<figure class="chart-card" id="metric-11"/);
  assert.match(html, /data-metric="11"/);
});

test("goal form posts with CSRF, unit-aware", () => {
  const html = render(build(full));
  const form = /<form class="goal-form"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
  assert.match(form, /method="post" action="\/users\/7\/goal"/);
  assert.match(form, /name="_csrf" value="tok&lt;&gt;"/);
  assert.match(form, /name="goal_weight"[^>]*value="78.0"/);
  assert.match(form, /name="goal_date"/);
});

test("footer and header links: raw readings and CSV params", () => {
  const html = render(build(full, { morning: true }));
  assert.match(html, /href="\/users\/7\/readings"/);
  const csv = /href="(\/users\/7\/export\.csv\?[^"]*)"/.exec(html)?.[1] ?? "";
  assert.match(csv, /range=90d/);
  assert.match(csv, /morning=1/);
  assert.match(csv, /agg=raw/);
});

test("every chart card has a data table and a describedby target; islands match the contract", () => {
  const html = render(build(full, {}), "range=all");
  const figs = html.match(/<figure class="chart-card"[\s\S]*?<\/figure>/g) ?? [];
  assert.ok(figs.length >= 12, `figures: ${figs.length}`);
  for (const f of figs) {
    assert.match(f, /<details class="chart-data"><summary>Show data table<\/summary><div class="table-wrap"><table/);
    const target = /aria-describedby="([^"]+)"/.exec(f)?.[1];
    assert.ok(target && f.includes(`id="${target}"`));
    assert.match(f, /data-payload="analysis-data"/);
    assert.match(f, /<div class="chart" data-island="[a-z-]+"/);
  }
  for (const island of ["timeseries", "composition", "composition-bars", "diverging-bars", "effect-bars", "count-bars", "histogram", "calendar"])
    assert.match(html, new RegExp(`data-island="${island}"`), island);
  assert.match(html, /data-metric="weight" data-slider/);
  assert.match(html, /<div class="chart-fallback"><svg class="spark-fallback"/);
});

test("user switcher keeps the query; escapes names; select above four users", () => {
  const html = render(build(full), "range=1y&morning=1&compare=yoy&metric=11");
  assert.match(html, /<a href="\/users\/8\/overview\?range=1y&amp;morning=1&amp;compare=yoy">Sam<\/a>/);
  assert.match(html, /<h1 class="page-title">Alex &lt;b&gt;<\/h1>/);
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/, ""), /Alex <b>/);
  const many = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `U${i}` }));
  const sel = overviewView(build(full), { users: many, query: new URLSearchParams("range=1y"), csrf: "t", wireJson: "{}" });
  assert.match(sel, /<select id="user-switch" name="user" data-submit-on-change>/);
});

test("empty analysis renders without throwing", () => {
  const html = render(build([], { goal: false }));
  assert.match(html, /No weigh-ins in this range/);
  assert.match(html, /id="analysis-data"/);
});

test("goal form: start date and start weight fields with hint, manual prefill", () => {
  const a = build(full);
  const html = overviewView(a, {
    users, query: new URLSearchParams(), csrf: "t", wireJson: "{}", zone: "Europe/Berlin",
    goalStart: { day: "2025-11-01", zone: "Europe/Berlin", autoKg: { kg: 91.2, source: "trend" } },
  });
  const form = /<form class="goal-form"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
  assert.match(form, /name="goal_start"[^>]*value="2025-11-01"/);
  assert.match(form, /name="goal_start_kg"[^>]*step="any"[^>]*value=""/);
  assert.match(form, /Start weight from your trend on [^:]+: 91\.2 kg/);
  assert.match(html, /of the way from 88\.0 kg to 78\.0 kg, since /);
  a.goal = { ...a.goal!, startManual: true, startKg: 90 };
  assert.match(overviewView(a, { users, query: new URLSearchParams(), csrf: "t", wireJson: "{}" }), /name="goal_start_kg"[^>]*value="90\.0"/);
});
