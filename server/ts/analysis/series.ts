/** Daily series, bucketing and level of detail (WP-05). Pure. */
import { MORNING } from "../habits.ts";
import { quantile } from "./stats.ts";
import { addDays, dayNoonUtc, isoWeekKey, isoWeekThursday, localTime, monthKey } from "./time.ts";
import type { Agg, Bucket, DayPoint, MetricSpec, Reading } from "./types.ts";
import type { Point } from "./types.ts";

/** First reading per local day (earliest t) as the day's value, plus min/max/mean/n of the kept readings. */
export function dailySeries(
  readings: Reading[],
  type: number,
  opts: { morningOnly: boolean; exclude?: Set<number> },
): DayPoint[] {
  const groups = new Map<string, { r: Reading; v: number }[]>();
  for (const r of readings) {
    const v = r.values[type];
    if (v === undefined || v === null || !Number.isFinite(v)) continue;
    if (opts.exclude?.has(r.id)) continue;
    const lt = localTime(r.t, r.zone);
    if (opts.morningOnly && !(lt.hour >= MORNING.from && lt.hour < MORNING.to)) continue;
    const list = groups.get(lt.day);
    if (list) list.push({ r, v });
    else groups.set(lt.day, [{ r, v }]);
  }
  const out: DayPoint[] = [];
  for (const [day, list] of groups) {
    let first = list[0];
    let min = first.v;
    let max = first.v;
    let sum = 0;
    for (const e of list) {
      if (e.r.t < first.r.t || (e.r.t === first.r.t && e.r.id < first.r.id)) first = e;
      min = Math.min(min, e.v);
      max = Math.max(max, e.v);
      sum += e.v;
    }
    out.push({
      day, t: first.r.t, v: first.v, min, max, mean: sum / list.length, n: list.length,
      readingId: first.r.id,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** ISO-week (Monday start) or calendar-month buckets; each day counts once with its representative value. */
export function bucketize(daily: DayPoint[], by: "week" | "month"): Bucket[] {
  const groups = new Map<string, { first: string; days: DayPoint[] }>();
  for (const d of daily) {
    const key = by === "week" ? isoWeekKey(d.day) : monthKey(d.day);
    const g = groups.get(key);
    if (g) g.days.push(d);
    else groups.set(key, { first: d.day, days: [d] });
  }
  const out: Bucket[] = [];
  for (const [key, { first, days }] of groups) {
    const values = days.map((d) => d.v).sort((a, b) => a - b);
    let startDay: string;
    let endDay: string;
    let mid: string;
    if (by === "week") {
      const thursday = isoWeekThursday(first);
      startDay = addDays(thursday, -3);
      endDay = addDays(thursday, 4);
      mid = thursday;
    } else {
      startDay = `${key}-01`;
      const [y, m] = key.split("-").map(Number);
      endDay = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      mid = `${key}-15`;
    }
    out.push({
      key,
      start: dayNoonUtc(startDay) - 43200,
      end: dayNoonUtc(endDay) - 43200,
      t: dayNoonUtc(mid),
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      min: values[0],
      max: values[values.length - 1],
      p25: quantile(values, 0.25),
      p75: quantile(values, 0.75),
      n: days.reduce((s, d) => s + d.n, 0),
      days: days.length,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function chooseAgg(visibleSpanDays: number, rawCount: number): Agg {
  if (visibleSpanDays <= 120 && rawCount <= 6000) return "raw";
  if (visibleSpanDays <= 1100) return "daily";
  if (visibleSpanDays <= 3650) return "weekly";
  return "monthly";
}

/** Padded y-range: at least spec.minSpan tall, 15% padding either side. Never NaN. */
export function yExtent(values: number[], spec: MetricSpec): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, spec.minSpan * 1.3];
  let lo = finite[0];
  let hi = finite[0];
  for (const v of finite) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = Math.max(hi - lo, spec.minSpan);
  const pad = 0.15 * span;
  const mid = (lo + hi) / 2;
  return [mid - span / 2 - pad, mid + span / 2 + pad];
}

export function readingPoints(
  readings: Reading[],
  type: number,
  exclude?: Set<number>,
): (Point & { id: number })[] {
  const out: (Point & { id: number })[] = [];
  for (const r of readings) {
    const v = r.values[type];
    if (v === undefined || v === null || !Number.isFinite(v) || exclude?.has(r.id)) continue;
    out.push({ t: r.t, v, id: r.id });
  }
  return out.sort((a, b) => a.t - b.t || a.id - b.id);
}
