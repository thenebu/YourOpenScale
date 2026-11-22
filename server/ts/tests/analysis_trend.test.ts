import assert from "node:assert/strict";
import test from "node:test";
import { synth } from "./fixtures/synthetic.ts";
import { dailySeries } from "../analysis/series.ts";
import { specFor } from "../analysis/spec.ts";
import {
  ewmaTrend, goalProgress, linearRate, projectGoal, trendAt, weeklyRateSeries,
} from "../analysis/trend.ts";
import { rateText } from "../analysis/rate_text.ts";
import { dayNoonUtc } from "../analysis/time.ts";
import type { DayPoint, Goal, Rate, TrendPoint } from "../analysis/types.ts";

const spec = specFor(1)!;
const DAY = 86400;
const T0 = dayNoonUtc("2024-01-01");
const dp = (i: number, v: number, offsetDays = 0): DayPoint => {
  const t = T0 + (i + offsetDays) * DAY;
  return { day: new Date(t * 1000).toISOString().slice(0, 10), t, v, min: v, max: v, mean: v, n: 1, readingId: i };
};
const series = (values: number[]) => values.map((v, i) => dp(i, v));

test("EWMA of a constant is constant", () => {
  const tr = ewmaTrend(series(new Array(30).fill(80)), spec);
  assert.ok(tr.every((p) => Math.abs(p.v - 80) < 1e-12 && p.segment === 0));
});

test("EWMA step reaches ~50% after ~6.6 days", () => {
  const values = [...new Array(60).fill(80), ...new Array(30).fill(90)];
  const tr = ewmaTrend(series(values), spec);
  // 6 or 7 daily steps after the step change
  const at6 = (tr[65].v - 80) / 10;
  const at7 = (tr[66].v - 80) / 10;
  assert.ok(at6 < 0.5 && at7 > 0.5, `${at6} ${at7}`);
  assert.ok(Math.abs(tr[60 + 6].v - 80 - 10 * (1 - 0.9 ** 7)) < 1e-9);
});

test("a 3-day step equals three daily steps toward the same value", () => {
  const lead = Array.from({ length: 10 }, (_, i) => dp(i, 80));
  const a = ewmaTrend([...lead, dp(12, 90)], spec);
  const b = ewmaTrend([...lead, dp(10, 90), dp(11, 90), dp(12, 90)], spec);
  assert.ok(Math.abs(a[10].v - b[12].v) < 1e-9);
  assert.ok(Math.abs(a[10].v - (80 + 10 * (1 - 0.9 ** 3))) < 1e-9);
});

test("gap above 30 days starts a new segment initialised from the next points", () => {
  const daily = [dp(0, 80), dp(1, 80), dp(2, 80), dp(40, 70), dp(41, 71), dp(42, 72), dp(60, 90)];
  const tr = ewmaTrend(daily, spec);
  assert.deepEqual(tr.map((p) => p.segment), [0, 0, 0, 1, 1, 1, 1]);
  assert.ok(Math.abs(tr[3].v - 71) < 1e-9); // mean of 70, 71, 72
  assert.ok(Math.abs(tr[4].v - (71 + 0.1 * (71 - 71))) < 1e-9);
  // exactly 30 days is not a break
  assert.deepEqual(ewmaTrend([dp(0, 80), dp(30, 80)], spec).map((p) => p.segment), [0, 0]);
});

test("init uses only points within 7 days, at most 3", () => {
  const tr = ewmaTrend([dp(0, 80), dp(60, 70), dp(70, 100)], spec);
  assert.ok(Math.abs(tr[1].v - 70) < 1e-9);
  const tr2 = ewmaTrend([dp(0, 80), dp(60, 70), dp(61, 71), dp(62, 72), dp(63, 200)], spec);
  assert.ok(Math.abs(tr2[1].v - 71) < 1e-9);
  assert.deepEqual(ewmaTrend([], spec), []);
});

test("trendAt interpolates, tolerates edges and respects segments", () => {
  const tr: TrendPoint[] = [
    { t: 0, v: 80, segment: 0 }, { t: 10 * DAY, v: 90, segment: 0 },
    { t: 50 * DAY, v: 60, segment: 1 }, { t: 51 * DAY, v: 61, segment: 1 },
  ];
  assert.equal(trendAt(tr, 5 * DAY), 85);
  assert.equal(trendAt(tr, 10 * DAY), 90);
  assert.equal(trendAt(tr, 12 * DAY), 90); // within 3 days of the segment end
  assert.equal(trendAt(tr, 20 * DAY), null);
  assert.equal(trendAt(tr, 48.5 * DAY), 60); // before the next segment
  assert.equal(trendAt(tr, 53.9 * DAY), 61);
  assert.equal(trendAt(tr, 55 * DAY), null);
  assert.equal(trendAt(tr, -2 * DAY), 80);
  assert.equal(trendAt(tr, -5 * DAY), null);
  assert.equal(trendAt([], 0), null);
});

test("linearRate recovers -0.5 kg/week from noisy synth", () => {
  const rs = synth({ seed: 3, days: 60, slopePerWeek: -0.5, noiseSd: 0.4 });
  const daily = dailySeries(rs, 1, { morningOnly: false });
  const now = daily[daily.length - 1].t;
  const rate = linearRate(daily, 28, now)!;
  assert.ok(Math.abs(rate.perWeek + 0.5) < 0.05 + 0.2 * 0 || Math.abs(rate.perWeek + 0.5) < rate.seWeek * 3);
  assert.ok(Math.abs(rate.perWeek + 0.5) <= 0.15);
  assert.equal(rate.n, 29);
  assert.ok(rate.days >= 27);
});

test("linearRate is exact on noiseless data and null when too little data", () => {
  const rs = synth({ days: 60, slopePerWeek: -0.5, noiseSd: 0 });
  const daily = dailySeries(rs, 1, { morningOnly: false });
  const rate = linearRate(daily, 28, daily[daily.length - 1].t)!;
  assert.ok(Math.abs(rate.perWeek + 0.5) < 0.005);
  assert.ok(rate.seWeek < 0.01);
  const few = daily.slice(-7);
  assert.equal(linearRate(few, 28, few[6].t), null);
  // 8 points but covering < 14 days
  assert.equal(linearRate(daily.slice(-9, -1), 28, daily[daily.length - 2].t), null);
  // 8 points spread over 21 days is enough
  const sparse = [0, 3, 6, 9, 12, 15, 18, 21].map((i) => dp(i, 80 - i * 0.05));
  assert.notEqual(linearRate(sparse, 28, sparse[7].t), null);
});

test("rate standard error shrinks with n (averaged over seeds)", () => {
  const avgSe = (step: number) => {
    let sum = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rs = synth({ seed, days: 60, slopePerWeek: -0.5, noiseSd: 0.4 });
      const d = dailySeries(rs, 1, { morningOnly: false }).filter((_, i) => i % step === 0);
      sum += linearRate(d, 28, d[d.length - 1].t)!.seWeek;
    }
    return sum / 20;
  };
  assert.ok(avgSe(1) < avgSe(3));
});

test("rateText wording and units", () => {
  const r = (perWeek: number, seWeek = 0.05): Rate => ({ perWeek, seWeek, n: 20, days: 28, from: 0, to: 1 });
  assert.equal(rateText(null, "kg"), "Not enough weigh-ins in the last 4 weeks to estimate a rate");
  assert.equal(rateText(r(-0.04), "kg"), "Stable over the last 4 weeks");
  assert.equal(rateText(r(0.5, 0.4), "kg"), "Stable over the last 4 weeks");
  assert.equal(rateText(r(-0.34), "kg"), "Losing about 0.3 kg per week");
  assert.equal(rateText(r(0.2), "kg"), "Gaining about 0.2 kg per week");
  assert.equal(rateText(r(-0.5), "lb"), "Losing about 1.1 lb per week");
  assert.equal(rateText(r(-0.5), "st"), "Losing about 1.1 lb per week");
});

const NOW = dayNoonUtc("2024-06-01");
const rateOf = (perWeek: number, seWeek: number): Rate => ({ perWeek, seWeek, n: 28, days: 28, from: 0, to: 1 });
const goal = (kg: number, date: string | null = null): Goal => ({ kg, date, startKg: 90, startAt: 0 });

test("projectGoal statuses", () => {
  assert.equal(projectGoal(80.2, rateOf(-0.5, 0.05), goal(80), NOW).status, "reached");
  assert.equal(projectGoal(null, rateOf(-0.5, 0.05), goal(80), NOW).status, "insufficient");
  assert.equal(projectGoal(85, null, goal(80), NOW).status, "insufficient");
  assert.equal(projectGoal(85, rateOf(0.02, 0.05), goal(80), NOW).status, "stable");
  assert.equal(projectGoal(85, rateOf(0.5, 0.05), goal(80), NOW).status, "moving-away");
  assert.equal(projectGoal(75, rateOf(-0.5, 0.05), goal(80), NOW).status, "moving-away");
  const slow = projectGoal(85, rateOf(-0.1, 0.01), goal(60), NOW);
  assert.equal(slow.status, "too-slow");
  assert.equal(slow.date, null);
});

test("projectGoal on-track: earliest <= date <= latest", () => {
  const p = projectGoal(85, rateOf(-0.7, 0.1), goal(80, "2024-08-01"), NOW);
  assert.equal(p.status, "on-track");
  assert.ok(Math.abs(p.etaDays! - 50) < 1e-9);
  assert.equal(p.date, "2024-07-21");
  assert.ok(p.earliest! <= p.date! && p.date! <= p.latest!);
  assert.ok(p.requiredPerWeek !== null && Math.abs(p.requiredPerWeek + (7 * 5) / 61) < 1e-9);
  // slope not distinguishable from zero at the slow end: no latest date
  const wide = projectGoal(85, rateOf(-0.5, 0.24), goal(80), NOW);
  assert.equal(wide.status, "on-track");
  assert.equal(wide.latest, null);
  assert.ok(wide.earliest !== null);
});

test("goalProgress clamps and handles gaining goals", () => {
  assert.equal(goalProgress(85, goal(80))!.fraction, 0.5);
  assert.equal(goalProgress(95, goal(80))!.fraction, 0);
  assert.equal(goalProgress(70, goal(80))!.fraction, 1);
  assert.equal(goalProgress(null, goal(80)), null);
  const gain = { kg: 70, date: null, startKg: 60, startAt: 0 };
  assert.equal(goalProgress(65, gain)!.fraction, 0.5);
  assert.deepEqual(goalProgress(85, goal(80)), { fraction: 0.5, startKg: 90, currentKg: 85, goalKg: 80 });
});

test("weeklyRateSeries: end-of-week deltas, consecutive weeks, same segment", () => {
  // 2024-01-01 is a Monday; one trend point per day, falling 0.1/day
  const tr: TrendPoint[] = Array.from({ length: 21 }, (_, i) => ({ t: T0 + i * DAY, v: 80 - 0.1 * i, segment: 0 }));
  const w = weeklyRateSeries(tr);
  assert.equal(w.length, 2);
  assert.ok(w.every((p) => Math.abs(p.v + 0.7) < 1e-9));
  assert.equal(w[0].t, dayNoonUtc("2024-01-11"));
  const broken = tr.map((p, i) => ({ ...p, segment: i < 7 ? 0 : 1 }));
  assert.equal(weeklyRateSeries(broken).length, 1);
  assert.deepEqual(weeklyRateSeries([]), []);
  // a missing week yields no point for it
  const missing = tr.filter((_, i) => i < 7 || i >= 14);
  assert.equal(weeklyRateSeries(missing).length, 0);
});

test("goalProgress works for loss and gain goals and clamps", () => {
  const loss: Goal = { kg: 80, date: null, startKg: 90, startAt: 0 };
  assert.equal(goalProgress(85, loss)!.fraction, 0.5);
  assert.equal(goalProgress(95, loss)!.fraction, 0);
  assert.equal(goalProgress(78, loss)!.fraction, 1);
  const gain: Goal = { kg: 80, date: null, startKg: 70, startAt: 0 };
  assert.equal(goalProgress(75, gain)!.fraction, 0.5);
  assert.equal(goalProgress(65, gain)!.fraction, 0);
  assert.equal(goalProgress(83, gain)!.fraction, 1);
  assert.equal(goalProgress(null, gain), null);
});
