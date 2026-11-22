import assert from "node:assert/strict";
import test from "node:test";
import { miniTrend, sparkline } from "../views/spark.ts";

const DAY = 86400;
const base = 1_700_000_000;
const pts = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ t: base + i * DAY, v: f(i) }));
const trendOf = (p: { t: number; v: number }[]) => p.map((q) => ({ ...q, segment: 0 }));

test("miniTrend: no text, no NaN, aria-hidden, viewBox follows the size", () => {
  const daily = pts(90, (i) => 80 - i * 0.05 + Math.sin(i));
  const svg = miniTrend({ daily, trend: trendOf(daily), from: base, to: base + 89 * DAY, goalKg: 78, width: 200, height: 50 });
  assert.match(svg, /viewBox="0 0 200 50"/);
  assert.match(svg, /preserveAspectRatio="none"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /vector-effect="non-scaling-stroke"/);
  assert.match(svg, /mini-goal/);
  assert.doesNotMatch(svg, /<text|NaN|undefined|Infinity/);
  assert.match(miniTrend({ daily, trend: [], from: base, to: base + 89 * DAY, goalKg: null }), /viewBox="0 0 320 72"/);
});

test("miniTrend: downsamples dots to at most 120 and omits a far-away goal", () => {
  const daily = pts(400, (i) => 80 + (i % 3));
  const svg = miniTrend({ daily, trend: trendOf(daily), from: base, to: base + 399 * DAY, goalKg: 40 });
  const dots = /class="mini-dots" d="([^"]*)"/.exec(svg)![1];
  assert.ok(dots.split("M").length - 1 <= 120);
  assert.doesNotMatch(svg, /mini-goal/);
});

test("miniTrend: a single point and a flat series", () => {
  const one = miniTrend({ daily: [{ t: base, v: 80 }], trend: [{ t: base, v: 80, segment: 0 }], from: base, to: base, goalKg: null });
  assert.match(one, /mini-last/);
  assert.doesNotMatch(one, /NaN|Infinity/);
  const flat = pts(30, () => 75);
  const svg = miniTrend({ daily: flat, trend: trendOf(flat), from: base, to: base + 29 * DAY, goalKg: 75 });
  assert.doesNotMatch(svg, /NaN|Infinity/);
  assert.match(svg, /mini-trend-line/);
});

test("miniTrend: empty input and non-finite values give nothing or are skipped", () => {
  assert.equal(miniTrend({ daily: [], trend: [], from: 0, to: 1, goalKg: null }), "");
  const svg = miniTrend({ daily: [{ t: base, v: NaN }, { t: base + DAY, v: 70 }], trend: [], from: base, to: base + DAY, goalKg: null });
  assert.doesNotMatch(svg, /NaN/);
});

test("sparkline keeps the legacy contract", () => {
  assert.equal(sparkline([], 0, 1), "");
  assert.match(sparkline([{ t: 1, v: 1 }], 0, 2), /aria-hidden="true"/);
  const flat = sparkline(pts(10, () => 5), base, base + 9 * DAY);
  assert.doesNotMatch(flat, /NaN|<text/);
});
