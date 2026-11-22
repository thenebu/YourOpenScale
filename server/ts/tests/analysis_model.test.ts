import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSummary, buildUserAnalysis, type AnalysisInput } from "../analysis/model.ts";
import { serializeAnalysis, serializeDashboard, type WireMetric } from "../analysis/serialize.ts";
import { summarize } from "../analysis/summary.ts";
import type { Bucket, DayPoint, MetricAnalysis, Reading, TrendPoint } from "../analysis/types.ts";
import { localToEpoch, synth } from "./fixtures/synthetic.ts";

const DAY = 86400;
const USER = { id: 1, name: "Alex", shortName: "ALX", heightCm: 180, ageYears: 40, sex: 0 as const };

function input(readings: Reading[], over: Partial<AnalysisInput> & { key?: AnalysisInput["range"]["key"] } = {}): AnalysisInput {
  const last = readings.length ? readings[readings.length - 1].t : 1_700_000_000;
  const now = over.now ?? last + 3600;
  const first = readings.length ? readings[0].t : now - 90 * DAY;
  return {
    user: USER, readings, unit: "kg", goal: null, now,
    range: { key: "all", from: first, to: now, morningOnly: false, compare: "none" },
    ...over,
  };
}

// Decoder copy of web/src/charts/data.ts (the browser side of the wire contract).
function decodeMetric(w: WireMetric): MetricAnalysis {
  return {
    ...w,
    lod: {
      raw: w.lod.raw ? w.lod.raw.map((r) => ({ t: r[0], v: r[1], id: r[2] ?? 0 })) : null,
      daily: w.lod.daily.map((d): DayPoint => ({ day: d[0], t: d[1], v: d[2], min: d[3], max: d[4], mean: d[2], n: d[5], readingId: d[6] ?? 0 })),
      weekly: w.lod.weekly.map((b): Bucket => ({ key: b[0], start: b[1], end: b[2], t: b[3], mean: b[4], min: b[5], max: b[6], p25: b[7], p75: b[8], n: b[9], days: b[10] })),
      monthly: w.lod.monthly.map((b): Bucket => ({ key: b[0], start: b[1], end: b[2], t: b[3], mean: b[4], min: b[5], max: b[6], p25: b[7], p75: b[8], n: b[9], days: b[10] })),
    },
    trend: w.trend.map((p): TrendPoint => ({ t: p[0], v: p[1], segment: p[2] ?? 0 })),
    compare: w.compare ? { ...w.compare, series: w.compare.series.map((p) => ({ t: p[0], v: p[1] })) } : null,
  };
}

const noBadText = (value: unknown) => {
  const text = JSON.stringify(value);
  assert.ok(!/NaN|undefined|Infinity/.test(text), "no NaN/undefined/Infinity in " + text.slice(0, 200));
};

test("no readings builds an empty but valid analysis", () => {
  const a = buildUserAnalysis(input([]));
  assert.equal(a.version, 1);
  assert.equal(a.weight, null);
  assert.equal(a.bmi, null);
  assert.equal(a.composition, null);
  assert.deepEqual(a.metrics, []);
  assert.equal(a.readingCount, 0);
  assert.equal(a.firstReadingAt, null);
  assert.deepEqual(a.summary, []);
  assert.deepEqual(a.habits.calendar, []);
  const wire = serializeAnalysis(a);
  noBadText(wire);
  const d = buildDashboardSummary({ user: USER, readings: [], unit: "kg", goal: null, now: 1_700_000_000 });
  assert.equal(d.last, null);
  assert.equal(d.trendKg, null);
  assert.deepEqual(d.chips, []);
  assert.deepEqual(d.mini.daily, []);
  noBadText(serializeDashboard(d));
});

test("weight only, 90 days: shape, trend, raw LOD, table", () => {
  const r = synth({ days: 120, slopePerWeek: -0.3, noiseSd: 0.3 });
  const now = r[r.length - 1].t + 3600;
  const a = buildUserAnalysis(input(r, { now, range: { key: "90d", from: now - 90 * DAY, to: now, morningOnly: false, compare: "none" } }));
  const w = a.weight!;
  assert.equal(w.key, "weight_kg");
  assert.ok(w.lod.raw && w.lod.raw.length >= 85 && w.lod.raw.length <= 91);
  assert.equal(w.lod.daily.length, w.lod.raw!.length);
  assert.equal(w.defaultAgg, "raw");
  assert.ok(w.lod.weekly.length >= 12);
  assert.ok(w.trend.every((p) => p.t >= now - 90 * DAY));
  assert.ok(w.stats && w.stats.changeTrend! < -2.5 && w.stats.changeTrend! > -5.5);
  assert.ok(w.rate && Math.abs(w.rate.perWeek + 0.3) < 0.15);
  assert.ok(w.yExtent[0] < w.stats!.min.v && w.yExtent[1] > w.stats!.max.v);
  assert.ok(w.table.rows.length > 0 && w.table.rows.length <= 400);
  assert.equal(w.table.rows[0].length, w.table.headers.length);
  assert.equal(a.bmi?.series.key, "bmi");
  assert.equal(a.bmi?.category, "normal");
  assert.equal(a.composition, null);
  assert.equal(a.habits.count, w.lod.raw!.length);
  assert.equal(a.habits.daysLast7, 7);
  assert.ok(a.records.length > 0);
  assert.match(w.summary, /^Weight, last 90 days, individual readings with trend\. Trend fell from/);
  assert.match(a.summary[0], /^Over the last 90 days your trend weight went from \d+\.\d kg to \d+\.\d kg \(−\d+\.\d kg\)\.$/);
  assert.match(a.summary[1], /^Losing about 0\.\d kg per week\.$/);
  noBadText(a);
  noBadText(a.summary);
});

test("full composition builds composition, recomposition and extra metrics", () => {
  const r = synth({ days: 200, slopePerWeek: -0.3, composition: true, outliers: [{ day: 50, delta: 15 }] });
  const a = buildUserAnalysis(input(r));
  const c = a.composition!;
  assert.ok(c.fatMass && c.leanMass && c.fatPct);
  assert.equal(c.fatPct!.unit, "%");
  assert.ok(c.monthly.length >= 6);
  assert.notEqual(c.recomposition.kind, "insufficient");
  assert.ok(c.ffmi && c.fmi && c.waterPct);
  assert.deepEqual(a.metrics.map((m) => m.type), [76, 77, 88]);
  assert.ok(a.metrics.every((m) => m.lod.raw === null && m.lod.daily.length > 0));
  assert.equal(a.weight!.outliers.length, 1);
  assert.equal(a.weight!.outliers[0].reason, "jump");
  assert.ok(a.weight!.stats!.max.v < 95, "the +15 kg spike is excluded from stats");
  assert.equal(a.quality.outliers.find((o) => o.type === 1)?.count, 1);
  assert.match(a.summary.join(" "), /left out of the trend/);
  assert.ok(a.summary.some((s) => s.includes("Bathroom-scale body composition")));
  noBadText(a);
});

test("morning-only keeps only comparable readings", () => {
  const r = synth({ days: 60, eveningOffset: 2, eveningShare: 1, zone: "Europe/Berlin" });
  const both = buildUserAnalysis(input(r));
  const morning = buildUserAnalysis(input(r, { range: { key: "all", from: r[0].t, to: r[r.length - 1].t + 3600, morningOnly: true, compare: "none" } }));
  assert.ok(both.weight!.lod.daily.some((d) => d.n === 2));
  assert.ok(morning.weight!.lod.daily.every((d) => d.n === 1));
  assert.equal(morning.weight!.lod.raw!.length, 60);
  assert.equal(both.weight!.lod.raw!.length, 120);
});

test("custom range clips display only, the trend is warmed up before the left edge", () => {
  const r = synth({ days: 200, slopePerWeek: -0.5, noiseSd: 0 });
  const from = r[100].t;
  const to = r[150].t;
  const a = buildUserAnalysis(input(r, { range: { key: "custom", from, to, morningOnly: false, compare: "none" } }));
  const w = a.weight!;
  assert.ok(w.lod.daily.every((d) => d.t >= from && d.t <= to));
  assert.equal(w.lod.daily.length, 51);
  assert.ok(w.trend[0].t >= from);
  // Without warm-up the first trend value would equal the first daily value; with warm-up it lags a falling series.
  assert.ok(w.trend[0].v > w.lod.daily[0].v);
  assert.match(w.summary, /^Weight, selected period/);
  assert.match(a.summary[0], /^Between /);
});

test("compare: yoy with under one year of data is null, with two years it is present", () => {
  const short = synth({ days: 200 });
  const nowS = short[short.length - 1].t + 3600;
  const a = buildUserAnalysis(input(short, { now: nowS, range: { key: "90d", from: nowS - 90 * DAY, to: nowS, morningOnly: false, compare: "yoy" } }));
  assert.equal(a.weight!.compare, null);
  const long = synth({ days: 800, slopePerWeek: -0.05 });
  const nowL = long[long.length - 1].t + 3600;
  const b = buildUserAnalysis(input(long, { now: nowL, range: { key: "90d", from: nowL - 90 * DAY, to: nowL, morningOnly: false, compare: "yoy" } }));
  assert.equal(b.weight!.compare!.mode, "yoy");
  assert.ok(b.weight!.compare!.series.length > 60);
  const c = buildUserAnalysis(input(long, { now: nowL, range: { key: "90d", from: nowL - 90 * DAY, to: nowL, morningOnly: false, compare: "prev" } }));
  assert.equal(c.weight!.compare!.mode, "prev");
  assert.ok(buildUserAnalysis(input(long)).weight!.compare === null);
});

test("goal produces progress and projection", () => {
  const r = synth({ days: 120, base: 85, slopePerWeek: -0.5, noiseSd: 0.2 });
  const now = r[r.length - 1].t + 3600;
  const goal = { kg: 70, date: null, startKg: 85, startAt: r[0].t };
  const a = buildUserAnalysis(input(r, { goal, now }));
  assert.equal(a.projection!.status, "on-track");
  assert.ok(a.progress!.fraction > 0.3 && a.progress!.fraction < 1);
  assert.match(a.summary[1], /At this pace you would reach your goal of 70.0 kg around \w+ 20\d\d/);
  const stat = a.weight!.yExtent;
  assert.ok(stat[0] <= 70, "y extent includes the goal line");
});

test("performance and payload size: Alex 900 days and 6,000 readings", () => {
  const alex = synth({
    days: 900, slopePerWeek: -0.08, composition: true, eveningOffset: 0.9, eveningShare: 0.15,
    weekdayEffect: [0.5, 0, 0, 0, 0.1, -0.3, 0], gaps: [[300, 345]], zone: "Europe/Berlin",
    outliers: [{ day: 100, delta: 12 }, { day: 400, delta: -9 }, { day: 700, delta: 14 }],
  });
  const now = alex[alex.length - 1].t + 3600;
  const goal = { kg: 72, date: null, startKg: 82, startAt: alex[0].t };
  let a = buildUserAnalysis(input(alex, { now, goal }));
  const t0 = performance.now();
  a = buildUserAnalysis(input(alex, { now, goal }));
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `Alex model ${ms.toFixed(0)} ms`);
  const wire = JSON.stringify(serializeAnalysis(a));
  assert.ok(wire.length < 400_000, `Alex payload ${wire.length} bytes`);
  noBadText(a);

  const big = synth({ days: 1200, perDay: 5 });
  assert.equal(big.length, 6000);
  const t1 = performance.now();
  const b = buildUserAnalysis(input(big));
  const ms2 = performance.now() - t1;
  assert.ok(ms2 < 500, `6000 readings model ${ms2.toFixed(0)} ms`);
  assert.equal(b.readingCount, 6000);
  assert.equal(b.weight!.lod.raw, null, "raw is dropped beyond 400 days");
  assert.equal(b.weight!.defaultAgg, "weekly");
});

test("serializeAnalysis uses the tuple shapes data.ts decodes and round-trips", () => {
  const r = synth({ days: 150, slopePerWeek: -0.2, composition: true, gaps: [[60, 100]], zone: "Europe/Berlin" });
  const now = r[r.length - 1].t + 3600;
  const a = buildUserAnalysis(input(r, { now, range: { key: "90d", from: now - 90 * DAY, to: now, morningOnly: false, compare: "prev" } }));
  const wire = JSON.parse(JSON.stringify(serializeAnalysis(a)));
  const w = wire.weight as WireMetric;
  assert.deepEqual(Object.keys(w.lod.raw![0]).length, 3);
  assert.equal(w.lod.raw![0].length, 3);
  assert.equal(typeof w.lod.daily[0][0], "string");
  assert.equal(w.lod.daily[0].length, 7);
  assert.equal(w.lod.weekly[0].length, 11);
  assert.equal(w.trend[0].length, 3);
  assert.equal(wire.metrics[0].lod.daily[0].length, 6, "ids only for weight");
  assert.equal(wire.weeklyRate[0].length, 2);
  assert.equal(typeof wire.habits.calendar[0][0], "string");
  const back = decodeMetric(w);
  assert.equal(back.lod.daily.length, a.weight!.lod.daily.length);
  assert.equal(back.trend.length, a.weight!.trend.length);
  assert.ok(back.trend.some((p) => p.segment === 1), "gap > 30 d starts segment 1");
  for (let i = 0; i < back.trend.length; i++) {
    assert.ok(Math.abs(back.trend[i].v - a.weight!.trend[i].v) <= 0.0005);
    assert.equal(back.trend[i].segment, a.weight!.trend[i].segment);
    assert.equal(back.trend[i].t, a.weight!.trend[i].t);
  }
  const d0 = back.lod.daily[0];
  const s0 = a.weight!.lod.daily[0];
  assert.deepEqual([d0.day, d0.t, d0.n, d0.readingId], [s0.day, s0.t, s0.n, s0.readingId]);
  assert.ok(Math.abs(d0.v - s0.v) <= 0.0005);
  assert.equal(back.lod.weekly[0].key, a.weight!.lod.weekly[0].key);
  assert.equal(back.lod.raw![0].id, a.weight!.lod.raw![0].id);
  assert.equal(back.compare!.series.length, a.weight!.compare!.series.length);
  assert.equal(back.summary, a.weight!.summary);
  // Every number has at most three decimals.
  assert.ok(!/\d\.\d{4,}/.test(JSON.stringify(wire)), "numbers are rounded to 3 decimals");
});

test("long secondary series are thinned to weekly detail on the wire", () => {
  const r = synth({ days: 700, composition: true });
  const a = buildUserAnalysis(input(r));
  const wire = serializeAnalysis(a);
  const m = wire.metrics[0];
  assert.equal(m.lod.daily.length, 0);
  assert.equal(m.defaultAgg, "weekly");
  assert.ok(m.lod.weekly.length > 90);
  assert.ok(m.trend.length < 120 && m.trend.length > 90);
  assert.equal(wire.weight!.lod.daily.length, a.weight!.lod.daily.length, "weight is never thinned");
  assert.equal(a.metrics[0].lod.daily.length, 700, "the in-memory model keeps full detail");
});

test("summarize: sentences exist, are clean, and respect missing inputs", () => {
  const r = synth({ days: 120, base: 85, slopePerWeek: -0.5, composition: true, perDay: 1 });
  const now = r[r.length - 1].t + 3600;
  const a = buildUserAnalysis(input(r, { now, goal: { kg: 78, date: null, startKg: 85, startAt: r[0].t } }));
  const s = summarize(a);
  assert.ok(s.length >= 3 && s.length <= 5);
  assert.deepEqual(s, a.summary);
  assert.match(s.join("\n"), /You weighed in on 7 of the last 7 days; 100% of weigh-ins were in the morning\./);
  noBadText(s);
  const noWeight = { ...a, weight: null };
  assert.deepEqual(summarize(noWeight), []);
  const lb = buildUserAnalysis({ ...input(r, { now }), unit: "lb" });
  assert.match(lb.summary[0], / lb /);
});

test("buildDashboardSummary: hero, deltas, mini chart, chips, consistency", () => {
  const r = synth({ days: 400, base: 85, slopePerWeek: -0.4, composition: true, zone: "Europe/Berlin" });
  const now = r[r.length - 1].t + 2 * 3600;
  const goal = { kg: 70, date: null, startKg: 85, startAt: r[0].t };
  const d = buildDashboardSummary({ user: USER, readings: r, unit: "kg", goal, now });
  assert.equal(d.last!.t, r[r.length - 1].t);
  assert.equal(d.last!.weightKg, r[r.length - 1].values[1]);
  assert.equal(d.daysSinceLast, 0);
  assert.ok(d.trendKg! > 60 && d.trendKg! < 90);
  assert.ok(d.deltas.d7 !== null && d.deltas.d30 !== null && d.deltas.d90 !== null);
  assert.ok(d.deltas.d90! < d.deltas.d7!, "a falling series loses more over 90 days");
  assert.equal(d.mini.to, now);
  assert.equal(d.mini.from, now - 90 * DAY);
  assert.ok(d.mini.daily.length >= 85 && d.mini.trend.length === d.mini.daily.length);
  assert.equal(d.mini.goalKg, 70);
  assert.ok(d.rate && d.rateText.startsWith("Losing about"));
  assert.ok(d.progress && d.projection);
  assert.deepEqual(d.chips.map((c) => c.id), ["fatPct", "fatMass", "muscle", "bmi"]);
  assert.ok(d.chips.every((c) => Number.isFinite(c.value) && c.delta30 !== null));
  assert.equal(d.chips[3].type, null);
  assert.equal(d.consistency.daysLast7, 7);
  assert.equal(d.consistency.morningShare90, 1);
  const wire = serializeDashboard(d);
  assert.equal(wire.mini.daily[0].length, 2);
  assert.equal(wire.mini.trend[0].length, 3);
  noBadText(wire);

  // Short history: the mini chart starts at the first reading; stale data gets daysSinceLast.
  const few = synth({ days: 20 });
  const lateNow = few[few.length - 1].t + 12 * DAY;
  const e = buildDashboardSummary({ user: { ...USER, heightCm: null }, readings: few, unit: "kg", goal: null, now: lateNow });
  assert.equal(e.mini.from, few[0].t);
  assert.equal(e.daysSinceLast, 12);
  assert.equal(e.rateText, "Not enough recent data");
  assert.deepEqual(e.chips, []);
  assert.equal(e.consistency.morningShare90, 1);
  assert.equal(e.consistency.daysLast7, 0);
});

test("zones: a late-evening UTC reading lands on the local day in Berlin", () => {
  const t = localToEpoch("2024-03-05", 23, 30, "Europe/Berlin");
  const base = synth({ days: 20, zone: "Europe/Berlin" });
  const r = [...base, { id: 999, t, zone: "Europe/Berlin", trusted: true, scaleId: 1, values: { 1: 80 } }];
  const a = buildUserAnalysis(input(r));
  assert.ok(a.weight!.lod.daily.every((d, i, l) => i === 0 || l[i - 1].day < d.day));
});
