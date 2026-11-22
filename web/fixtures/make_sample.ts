/**
 * Generates web/fixtures/analysis.sample.json (synthetic, deterministic; no real data).
 *   node --experimental-strip-types web/fixtures/make_sample.ts
 * Wire format follows 03 §6: points as tuples, daily as [day,t,v,min,max,n,readingId],
 * buckets as [key,start,end,t,mean,min,max,p25,p75,n,days], trend as [t,v,segment].
 * The weight series ships `raw` (the server would drop it above 400 days) to exercise the raw level.
 */
import { writeFileSync } from "node:fs";
import { bucketize, dailySeries, yExtent } from "../../server/ts/analysis/series.ts";
import { specFor } from "../../server/ts/analysis/spec.ts";
import { stats } from "../../server/ts/analysis/stats.ts";
import { ewmaTrend, linearRate } from "../../server/ts/analysis/trend.ts";
import { addDays } from "../../server/ts/analysis/time.ts";
import { weeklyRateSeries } from "../../server/ts/analysis/trend.ts";
import { histogram, timeOfDayEffect, weekdayEffect, yearOverlay } from "../../server/ts/analysis/patterns.ts";
import { calendarCells } from "../../server/ts/analysis/consistency.ts";
import { compositionMonthly } from "../../server/ts/analysis/composition.ts";
import { weighHabits } from "../../server/ts/habits.ts";
import { synth } from "../../server/ts/tests/fixtures/synthetic.ts";
import type { DayPoint, Outlier, Reading } from "../../server/ts/analysis/types.ts";

const DAYS = 900;
const START = "2023-06-05";
const HEIGHT_CM = 178;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const readings: Reading[] = synth({
  seed: 8, days: DAYS, start: START, base: 93, slopePerWeek: -0.085, noiseSd: 0.35,
  weekdayEffect: [0.3, 0.1, 0, -0.1, -0.1, -0.2, 0.2], eveningOffset: 0.8, eveningShare: 0.3,
  gaps: [[300, 346]], outliers: [{ day: 120, delta: 4.2 }, { day: 520, delta: -3.8 }, { day: 780, delta: 5 }],
  composition: true, zone: "Europe/Berlin",
});
const spikeDays = new Set([120, 520, 780].map((i) => addDays(START, i)));

function metric(type: number, key: string, label: string, opts: { raw?: boolean; compare?: boolean; derive?: (r: Reading) => number | undefined } = {}) {
  const spec = specFor(type)!;
  const rs = opts.derive ? readings.map((r) => ({ ...r, values: { [type]: opts.derive!(r) } })) : readings;
  const all = dailySeries(rs, type, { morningOnly: false });
  const outliers: Outlier[] = [];
  const exclude = new Set<number>();
  if (type === 1 || type === -1) {
    for (const d of all) {
      if (spikeDays.has(d.day)) {
        exclude.add(d.readingId);
        outliers.push({ readingId: d.readingId, t: d.t, v: r3(d.v), reason: "jump" });
      }
    }
  }
  const daily: DayPoint[] = dailySeries(rs, type, { morningOnly: false, exclude });
  const trend = ewmaTrend(daily, spec);
  const st = stats(daily, trend);
  const weekly = bucketize(daily, "week");
  const monthly = bucketize(daily, "month");
  const last = daily[daily.length - 1].t;
  const values = [...daily.map((d) => d.v), ...trend.map((p) => p.v)];
  const [lo, hi] = yExtent(values, spec);
  const rate = linearRate(daily, 28, last);
  const bucket = (b: (typeof weekly)[number]) => [b.key, b.start, b.end, b.t, r3(b.mean), r3(b.min), r3(b.max), r3(b.p25), r3(b.p75), b.n, b.days];
  const raw = opts.raw
    ? rs.filter((r) => r.values[type] !== undefined).map((r) => [r.t, r3(r.values[type]!), r.id])
    : null;
  const unitLabel = spec.unit;
  return {
    type, key, label, unit: unitLabel,
    lod: {
      raw,
      daily: daily.map((d) => [d.day, d.t, r3(d.v), r3(d.min), r3(d.max), d.n, d.readingId]),
      weekly: weekly.map(bucket),
      monthly: monthly.map(bucket),
    },
    defaultAgg: "daily",
    trend: trend.map((p) => [p.t, r3(p.v), p.segment]),
    stats: st && {
      latest: { t: st.latest.t, v: r3(st.latest.v) }, trendLatest: st.trendLatest && r3(st.trendLatest),
      min: { t: st.min.t, v: r3(st.min.v) }, max: { t: st.max.t, v: r3(st.max.v) },
      mean: r3(st.mean), changeTrend: st.changeTrend && r3(st.changeTrend),
    },
    rate, outliers,
    yExtent: [r3(lo), r3(hi)],
    compare: opts.compare
      ? {
          mode: "yoy", label: "Same period last year",
          series: daily.filter((d) => d.t + 365 * 86400 <= last).map((d) => [d.t + 365 * 86400, r3(d.v)]),
        }
      : null,
    table: { headers: ["Date", label], rows: daily.slice(-12).map((d) => [d.day, String(r3(d.v))]) },
    summary: `${label}, all ${DAYS} days, daily values with trend. Synthetic data.`,
  };
}

const weight = metric(1, "weight_kg", "Weight", { raw: true });
const wdaily = weight.lod.daily;
const bmi = metric(-1, "bmi", "BMI", { derive: (r) => r.values[1]! / (HEIGHT_CM / 100) ** 2 });
const fatPct = metric(6, "fat_ratio_pct", "Body fat", { compare: true });
const fatMass = metric(8, "fat_mass_kg", "Fat mass");
const leanMass = metric(5, "fat_free_mass_kg", "Lean mass");
const bone = metric(88, "bone_mass_kg", "Bone mass");

const lastWeight = wdaily[wdaily.length - 1];

// WP-09 additions: data for the bar / histogram / calendar / composition / year charts.
const wSpec = specFor(1)!;
const wDailyObjs = dailySeries(readings, 1, { morningOnly: false, exclude: new Set(weight.outliers.map((o) => o.readingId)) });
const wTrend = ewmaTrend(wDailyObjs, wSpec);
const hist = histogram(wDailyObjs, wSpec, "kg", wTrend[wTrend.length - 1].v)!;
const years = yearOverlay(wDailyObjs)!;
const wk = weekdayEffect(wDailyObjs);
const tod = timeOfDayEffect(readings, wDailyObjs, 1);
const habits = weighHabits(readings.map((r) => ({ t: r.t, zone: r.zone })));
const extra = {
  weeklyRate: weeklyRateSeries(wTrend).map((p) => [p.t, r3(p.v)]),
  habits: {
    hours: habits.hours,
    calendar: calendarCells(readings, readings[0].t, readings[readings.length - 1].t).map((c) => [c.day, c.count]),
  },
  patterns: {
    weekday: wk && wk.map((w) => ({ ...w, mean: r3(w.mean), se: r3(w.se) })),
    timeOfDay: tod && tod.map((w) => ({ ...w, mean: r3(w.mean), se: r3(w.se) })),
    histogram: { ...hist, bins: hist.bins.map((b) => [r3(b.from), r3(b.to), b.count]), mean: r3(hist.mean), median: r3(hist.median), p10: r3(hist.p10), p90: r3(hist.p90), current: hist.current && r3(hist.current) },
    years: years.map((y) => [y.year, y.points.map((p) => [p.doy, r3(p.v)])]),
  },
};
const monthly = compositionMonthly(readings).map((m) => [m.key, m.t, m.fat, m.muscle, m.bone, m.otherLean, m.water].map((x) => (typeof x === "number" && x < 1e9 ? r3(x) : x)));
const out = {
  version: 1,
  user: { id: 1, name: "Sample User", shortName: "Sample", heightCm: HEIGHT_CM, ageYears: 40, sex: 1 },
  unit: "kg",
  range: { key: "all", from: wdaily[0][1], to: lastWeight[1], morningOnly: false, compare: "none" },
  generatedAt: lastWeight[1],
  firstReadingAt: wdaily[0][1], readingCount: readings.length,
  weight,
  bmi: { series: bmi, latest: bmi.stats!.latest.v, category: "overweight" },
  composition: { fatMass, leanMass, fatPct, monthly },
  ...extra,
  metrics: [bone],
  goal: { kg: 78, date: null, startKg: 92.6, startAt: wdaily[0][1] },
};
writeFileSync(new URL("./analysis.sample.json", import.meta.url), JSON.stringify(out));
console.log("readings", readings.length, "bytes", JSON.stringify(out).length);
