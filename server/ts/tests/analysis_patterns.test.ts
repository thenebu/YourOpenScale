import assert from "node:assert/strict";
import test from "node:test";
import { synth, localToEpoch } from "./fixtures/synthetic.ts";
import { dailySeries } from "../analysis/series.ts";
import { specFor } from "../analysis/spec.ts";
import {
  compareSeries, correlation, histogram, periodComparisons, timeOfDayEffect, weekdayEffect, yearOverlay,
} from "../analysis/patterns.ts";
import { dayNoonUtc } from "../analysis/time.ts";
import type { DayPoint } from "../analysis/types.ts";

const WEEKDAY = [0.5, 0, 0, 0, 0, -0.3, 0];
const daily = (rs: ReturnType<typeof synth>) => dailySeries(rs, 1, { morningOnly: false });
const dp = (day: string, v: number): DayPoint =>
  ({ day, t: dayNoonUtc(day), v, min: v, max: v, mean: v, n: 1, readingId: 0 });

test("weekday effect recovers injected Monday and Saturday offsets", () => {
  const eff = weekdayEffect(daily(synth({ days: 210, noiseSd: 0.15, weekdayEffect: WEEKDAY, seed: 3 })))!;
  assert.equal(eff.length, 7);
  const mean7 = WEEKDAY.reduce((a, b) => a + b, 0) / 7;
  assert.ok(Math.abs(eff[0].mean - (0.5 - mean7)) < 0.15, `Mon ${eff[0].mean}`);
  assert.ok(Math.abs(eff[5].mean - (-0.3 - mean7)) < 0.15, `Sat ${eff[5].mean}`);
  assert.equal(eff[0].label, "Mon");
  assert.ok(Math.abs(eff.reduce((s, e) => s + e.mean, 0)) < 1e-9);
  assert.ok(eff.every((e) => e.n >= 4 && e.se > 0));
});

test("weekday effect is null with too little data", () => {
  assert.equal(weekdayEffect(daily(synth({ days: 20 }))), null);
  // enough residuals overall but one weekday short of n >= 4
  const d = daily(synth({ days: 40, noiseSd: 0.1 })).filter((x) => !(x.day >= "2023-01-09" && new Date(x.day).getUTCDay() === 3));
  assert.equal(weekdayEffect(d), null);
});

test("time-of-day effect recovers an evening offset", () => {
  const rs = synth({ days: 160, noiseSd: 0.15, eveningOffset: 0.9, eveningShare: 0.5, seed: 5 });
  const eff = timeOfDayEffect(rs, daily(rs), 1)!;
  const evening = eff.find((e) => e.slot === "evening")!;
  const morning = eff.find((e) => e.slot === "morning")!;
  assert.ok(Math.abs(evening.mean - 0.9) < 0.2, `evening ${evening.mean}`);
  assert.ok(Math.abs(morning.mean) < 0.2);
  assert.deepEqual(evening.hours, [16, 22]);
  assert.ok(evening.n >= 5);
  assert.equal(eff.find((e) => e.slot === "night"), undefined);
});

test("time-of-day effect omits slots with n < 5 and is null when nothing remains", () => {
  const rs = synth({ days: 30 });
  assert.equal(timeOfDayEffect(rs, [], 1), null);
  const few = synth({ days: 30, eveningOffset: 1, eveningShare: 1 }).filter((r) => r.t % 86400 < 8 * 3600 || r.id % 6 === 0);
  const eff = timeOfDayEffect(few, daily(few), 1)!;
  assert.ok(eff.some((e) => e.slot === "morning"));
});

test("histogram bins align to multiples of the width in kg", () => {
  const h = histogram(daily(synth({ days: 100, noiseSd: 0.8 })), specFor(1)!, "kg", 80.2)!;
  for (const b of h.bins) {
    assert.ok(Math.abs(b.from / 0.5 - Math.round(b.from / 0.5)) < 1e-9);
    assert.ok(Math.abs(b.to - b.from - 0.5) < 1e-9);
  }
  assert.equal(h.bins.reduce((s, b) => s + b.count, 0), 100);
  assert.equal(h.current, 80.2);
  assert.ok(h.p10 < h.median && h.median < h.p90);
});

test("histogram uses whole-lb bins for lb and caps at 40 bins", () => {
  const d = daily(synth({ days: 100, noiseSd: 0.8 }));
  const lb = histogram(d, specFor(1)!, "lb", null)!;
  const w = lb.bins[0].to - lb.bins[0].from;
  assert.ok(Math.abs(w - 1 / 2.2046226218487757) < 1e-9);
  assert.ok(Math.abs(lb.bins[0].from * 2.2046226218487757 - Math.round(lb.bins[0].from * 2.2046226218487757)) < 1e-9);
  const wide = histogram(daily(synth({ days: 200, slopePerWeek: -1.5, noiseSd: 0.5 })), specFor(1)!, "kg", null)!;
  assert.ok(wide.bins.length <= 40);
  assert.equal(wide.bins.reduce((s, b) => s + b.count, 0), 200);
  assert.equal(histogram(d.slice(0, 3), specFor(1)!, "kg", null), null);
});

test("periodComparisons windows and the n >= 3 rule", () => {
  const d = daily(synth({ days: 450, start: "2023-01-02", base: 80, slopePerWeek: -0.1, noiseSd: 0 }));
  const now = localToEpoch("2024-02-10", 12, 0, "UTC");
  const rows = periodComparisons(d, now, "UTC");
  assert.deepEqual(rows.map((r) => r.id), ["week", "month", "yoy30", "ytd"]);
  const week = rows[0];
  assert.equal(week.a.n, 7);
  assert.equal(week.b.n, 7);
  assert.equal(week.a.from, dayNoonUtc("2024-02-04"));
  assert.equal(week.b.to, dayNoonUtc("2024-02-03"));
  assert.ok(Math.abs(week.delta - -0.1) < 1e-6); // 7 days at -0.1/week
  const month = rows[1];
  assert.equal(month.a.n, 10);
  assert.equal(month.b.n, 31);
  const yoy = rows[2];
  assert.equal(yoy.b.from, dayNoonUtc("2023-01-12"));
  assert.ok(Math.abs(yoy.delta - -0.1 * 365 / 7) < 0.1, String(yoy.delta));
  const ytd = rows[3];
  assert.equal(ytd.a.n, 41);
  assert.equal(ytd.b.to, dayNoonUtc("2023-02-10"));
  // n < 3 on one side drops the row
  const sparse = d.filter((x) => !(x.day >= "2024-02-05" && x.day <= "2024-02-09"));
  assert.ok(!periodComparisons(sparse, now, "UTC").some((r) => r.id === "week"));
  assert.deepEqual(periodComparisons([], now, "UTC"), []);
});

test("compareSeries prev shifts the previous period forward", () => {
  const d = daily(synth({ days: 60, start: "2024-01-01" }));
  const from = d[30].t;
  const to = d[59].t;
  const prev = compareSeries(d, "prev", from, to);
  assert.equal(prev[0].t, d[1].t + (to - from));
  assert.equal(prev[0].v, d[1].v);
  assert.ok(prev.every((p) => p.t <= to + 1 && p.t >= from));
});

test("compareSeries yoy shifts by one calendar year and maps 29 Feb to 28 Feb", () => {
  const d = [dp("2023-06-15", 80), dp("2024-02-28", 81), dp("2024-02-29", 99), dp("2024-03-01", 82), dp("2022-01-01", 70)];
  const from = dayNoonUtc("2025-02-20");
  const to = dayNoonUtc("2025-03-10");
  const s = compareSeries(d, "yoy", from, to);
  assert.deepEqual(s, [{ t: dayNoonUtc("2025-02-28"), v: 81 }, { t: dayNoonUtc("2025-03-01"), v: 82 }]);
  const only29 = compareSeries([dp("2024-02-29", 99)], "yoy", from, to);
  assert.deepEqual(only29, [{ t: dayNoonUtc("2025-02-28"), v: 99 }]);
  const leapTarget = compareSeries([dp("2023-02-28", 80)], "yoy", dayNoonUtc("2024-02-01"), dayNoonUtc("2024-03-01"));
  assert.deepEqual(leapTarget, [{ t: dayNoonUtc("2024-02-28"), v: 80 }]);
});

test("yearOverlay groups by year and day of year", () => {
  assert.equal(yearOverlay(daily(synth({ days: 100 }))), null);
  const y = yearOverlay([dp("2023-01-01", 80), dp("2023-12-31", 79), dp("2024-02-29", 78), dp("2024-03-01", 77)])!;
  assert.deepEqual(y.map((s) => s.year), [2023, 2024]);
  assert.deepEqual(y[0].points, [{ doy: 1, v: 80 }, { doy: 365, v: 79 }]);
  assert.deepEqual(y[1].points, [{ doy: 60, v: 78 }, { doy: 61, v: 77 }]);
});

test("correlation needs n >= 30 and |r| >= 0.3", () => {
  const xs = Array.from({ length: 40 }, (_, i) => i);
  const ys = xs.map((x) => 2 * x + 1);
  const c = correlation(xs, ys)!;
  assert.equal(c.n, 40);
  assert.ok(Math.abs(c.r - 1) < 1e-12);
  assert.ok(correlation(xs, ys.map((y) => -y))!.r < -0.99);
  assert.equal(correlation(xs.slice(0, 20), ys.slice(0, 20)), null);
  assert.equal(correlation(xs, xs.map(() => 5)), null);
  assert.equal(correlation(xs, xs.map((x) => (x % 2 === 0 ? 1 : 0))), null);
});
