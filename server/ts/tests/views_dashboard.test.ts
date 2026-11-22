import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../analysis/model.ts";
import type { DashboardSummary, Reading } from "../analysis/types.ts";
import { dashboardView } from "../views/dashboard.ts";
import { synth } from "./fixtures/synthetic.ts";

const DAY = 86400;
const alexReadings = synth({ days: 200, slopePerWeek: -0.3, composition: true, seed: 3 });
const NOW = alexReadings[alexReadings.length - 1].t + 7200;
const summary = (id: number, name: string, readings: Reading[], goal: DashboardSummary["goal"] = null, heightCm: number | null = 180, now = NOW) =>
  buildDashboardSummary({ user: { id, name, shortName: name.slice(0, 2), heightCm } as never, readings, unit: "kg", goal, now });
const GOAL = { kg: 60, date: null, startKg: 86, startAt: NOW - 150 * DAY };
const alex = summary(1, "Alex", alexReadings, GOAL);
const render = (s: DashboardSummary[]) => dashboardView(s, { now: NOW, lastWeighIn: NOW - 7200 });

test("card: name link, no readings link inside cards, no table", () => {
  const html = render([alex]);
  assert.match(html, /<a class="card-title-link" href="\/users\/1\/overview">Alex/);
  assert.doesNotMatch(html, /\/users\/1\/readings/);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /href="\/users\/1\/overview">Open analysis/);
  assert.match(html, /<h1 class="page-title">Today<\/h1>/);
  assert.match(html, /last weigh-in 2 hours ago/);
  assert.match(html, /href="\/readings"/);
});

test("hero holds the unrounded trend", () => {
  const html = render([alex]);
  assert.ok(alex.trendKg !== null);
  assert.ok(html.includes(`<data class="stat-value" value="${alex.trendKg}">`));
  assert.match(html, /Trend · last reading \d+\.\d kg/);
});

test("deltas use a true minus and carry goal tone", () => {
  const html = render([alex]);
  assert.match(html, /class="delta" data-direction="down" data-tone="good">[^]*?−\d/);
  assert.doesNotMatch(html, />-\d/);
  assert.match(html, /delta-ref">7 d/);
  assert.match(html, /delta-ref">30 d/);
  assert.match(html, /delta-ref">90 d/);
  const noGoal = render([summary(1, "Alex", alexReadings)]);
  assert.doesNotMatch(noGoal, /data-tone="(good|bad)"/);
});

test("recency badge: today, yesterday, neutral; warn when older than 7 days", () => {
  assert.match(render([alex]), /<span class="badge">Today<\/span>/);
  const yesterday = summary(1, "Alex", alexReadings, null, 180, NOW + DAY);
  assert.match(render([yesterday]), /<span class="badge">Yesterday<\/span>/);
  const stale = summary(1, "Alex", alexReadings, null, 180, NOW + 12 * DAY);
  assert.match(render([stale]), /<span class="badge badge-warn">12 days ago<\/span>/);
  assert.doesNotMatch(render([alex]), /badge-warn/);
});

test("zone shows the weigh-in time on the today badge", () => {
  const html = dashboardView([alex], { now: NOW, lastWeighIn: NOW - 7200, zone: "UTC" });
  assert.match(html, /<span class="badge">Today \d\d:\d\d<\/span>/);
});

test("goal progress only with a goal", () => {
  assert.match(render([alex]), /<progress class="progress"[^>]*>/);
  assert.match(render([alex]), /\d+% of the way from 86\.0 kg to 60\.0 kg/);
  assert.doesNotMatch(render([summary(1, "Alex", alexReadings)]), /<progress|of the way/);
});

test("chips link to the overview composition anchor and keep raw values", () => {
  const html = render([alex]);
  assert.match(html, /href="\/users\/1\/overview\?metric=6#composition"/);
  assert.match(html, /href="\/users\/1\/overview\?metric=8#composition"/);
  assert.match(html, /href="\/users\/1\/overview\?metric=76#composition"/);
  assert.match(html, /href="\/users\/1\/overview\?metric=-1#composition"/);
  const fat = alex.chips.find((c) => c.id === "fatMass")!;
  assert.ok(html.includes(`value="${fat.value}"`));
  assert.ok((html.match(/class="stat stat-sm card-link"/g) ?? []).length <= 4);
  const weightOnly = render([summary(2, "Sam", synth({ days: 60, seed: 5 }), null, null)]);
  assert.doesNotMatch(weightOnly, /#composition/);
});

test("footer shows consistency", () => {
  assert.match(render([alex]), /\d of last 7 days/);
});

test("empty states: user without readings and no users", () => {
  const kim = summary(3, "Kim", []);
  const html = render([alex, kim]);
  assert.match(html, /No weigh-ins yet/);
  assert.match(html, /Step on a scale that knows Kim, or import a Withings export/);
  assert.match(html, /href="\/import\/withings"/);
  assert.equal((html.match(/<section class="card user-card/g) ?? []).length, 2);
  assert.doesNotMatch(html.split("Kim")[1] ?? "", /<progress/);
  const none = dashboardView([], { now: NOW, lastWeighIn: null });
  assert.match(none, /Add your first person/);
  assert.match(none, /href="\/users"/);
  assert.match(none, /href="\/firmware"/);
  assert.match(none, /no weigh-ins yet/);
  assert.doesNotMatch(none, /user-cards/);
});

test("user names are escaped everywhere", () => {
  const evil = `<img src=x onerror=alert(1)>"&`;
  const html = render([summary(1, evil, alexReadings), summary(2, evil, [])]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("no NaN or undefined leaks into the page", () => {
  const html = render([alex, summary(2, "Sam", synth({ days: 3, seed: 2 })), summary(3, "Kim", [])]);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});
