/** Descriptive statistics (WP-05). Pure. Empty input yields NaN for mean/median/quantile/mad, 0 for sd. */
import { daysBetween } from "./time.ts";
import type { DayPoint, MetricStats, Point, TrendPoint } from "./types.ts";

export function stats(daily: DayPoint[], trend: TrendPoint[]): MetricStats | null {
  if (!daily.length) return null;
  let min = daily[0];
  let max = daily[0];
  let sum = 0;
  for (const d of daily) {
    if (d.v < min.v) min = d;
    if (d.v > max.v) max = d;
    sum += d.v;
  }
  const last = daily[daily.length - 1];
  return {
    latest: { t: last.t, v: last.v },
    trendLatest: trend.length ? trend[trend.length - 1].v : null,
    min: { t: min.t, v: min.v },
    max: { t: max.t, v: max.v },
    mean: sum / daily.length,
    changeTrend: trend.length >= 2 ? trend[trend.length - 1].v - trend[0].v : null,
  };
}
export function mean(values: number[]): number {
  if (!values.length) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}
/** Linear-interpolated quantile (R type 7). */
export function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function median(values: number[]): number {
  return quantile(values, 0.5);
}
/** Median absolute deviation (unscaled). */
export function mad(values: number[]): number {
  if (!values.length) return NaN;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}
/** Sample standard deviation. */
export function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / (values.length - 1));
}
/** Per day: the mean of the *other* days within ±halfWindowDays; omitted when fewer than minNeighbours. */
export function centredBaseline(
  daily: DayPoint[],
  halfWindowDays = 3,
  minNeighbours = 3,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < daily.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - 1; j >= 0 && daysBetween(daily[j].day, daily[i].day) <= halfWindowDays; j--) {
      sum += daily[j].v;
      count++;
    }
    for (let j = i + 1; j < daily.length && daysBetween(daily[i].day, daily[j].day) <= halfWindowDays; j++) {
      sum += daily[j].v;
      count++;
    }
    if (count >= minNeighbours) out.push({ t: daily[i].t, v: sum / count });
  }
  return out;
}
