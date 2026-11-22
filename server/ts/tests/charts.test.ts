import assert from "node:assert/strict";
import test from "node:test";
import {
  downsample,
  lineChart,
  movingAverage,
  niceTicks,
  sparkline,
  stats,
  type Point,
} from "../charts.ts";

const DAY = 86400;
const T0 = 1_700_000_000;
const opts = (from: number, to: number) => ({
  from,
  to,
  label: "Weight",
  text: (v: number) => `${v.toFixed(1)} kg`,
  axis: (v: number) => String(v),
});

test("niceTicks picks round steps inside the range", () => {
  assert.deepEqual(niceTicks(70.2, 74.9, 4), [71, 72, 73, 74]);
  assert.deepEqual(niceTicks(0, 100, 4), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test("downsample averages into bounded buckets and keeps small series intact", () => {
  const small: Point[] = [{ t: 1, v: 1 }];
  assert.equal(downsample(small, 10), small);
  const big = Array.from({ length: 1000 }, (_, i) => ({
    t: T0 + i * 60,
    v: i,
  }));
  const out = downsample(big, 100);
  assert.ok(out.length <= 100 && out.length > 50);
  assert.ok(out.every((p, i) => i === 0 || p.t > out[i - 1].t));
  assert.ok(Math.abs(stats(out)!.avg - stats(big)!.avg) < 5);
});

test("movingAverage and stats", () => {
  const pts = [1, 2, 3, 4].map((v, i) => ({ t: i, v }));
  assert.deepEqual(
    movingAverage(pts, 2).map((p) => p.v),
    [1, 1.5, 2.5, 3.5],
  );
  assert.deepEqual(stats(pts), { min: 1, max: 4, avg: 2.5, first: 1, last: 4 });
  assert.equal(stats([]), null);
});

test("lineChart renders a labelled svg with one point per reading", () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({
    t: T0 + i * DAY,
    v: 80 - i * 0.1,
  }));
  const svg = lineChart(pts, opts(T0, T0 + 9 * DAY));
  assert.match(svg, /<svg [^>]*role="img" aria-label="Weight"/);
  assert.equal((svg.match(/<circle /g) ?? []).length, 10);
  assert.match(svg, /<path class="line"/);
  assert.match(svg, /<path class="trend"/);
  assert.match(svg, /data-default="Latest: [^"]*79\.1 kg"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("lineChart handles a single point and a flat series without NaN", () => {
  const one = lineChart([{ t: T0, v: 80 }], opts(T0 - DAY, T0));
  assert.match(one, /<circle /);
  assert.doesNotMatch(one, /<path class="line"|NaN|Infinity/);
  const flat = lineChart(
    [0, 1, 2].map((i) => ({ t: T0 + i * DAY, v: 72 })),
    opts(T0, T0 + 2 * DAY),
  );
  assert.doesNotMatch(flat, /NaN|Infinity/);
});

test("lineChart breaks the line across long gaps instead of interpolating", () => {
  const pts = [
    { t: T0, v: 80 },
    { t: T0 + DAY, v: 80.5 },
    { t: T0 + 60 * DAY, v: 79 },
    { t: T0 + 61 * DAY, v: 78.8 },
  ];
  const svg = lineChart(pts, { ...opts(T0, T0 + 61 * DAY), trend: false });
  const d = svg.match(/<path class="line" d="([^"]+)"/)![1];
  assert.equal((d.match(/M/g) ?? []).length, 2);
});

test("lineChart escapes labels", () => {
  const svg = lineChart([{ t: T0, v: 1 }], {
    ...opts(T0 - DAY, T0),
    label: '"><script>',
    text: () => "<b>",
  });
  assert.doesNotMatch(svg, /<script>|<b>/);
});

test("sparkline is empty without data and aria-hidden otherwise", () => {
  assert.equal(sparkline([], 0, 1), "");
  assert.match(sparkline([{ t: 1, v: 1 }], 0, 2), /aria-hidden="true"/);
});
