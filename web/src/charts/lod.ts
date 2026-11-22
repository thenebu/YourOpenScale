/** Level of detail: which aggregation to draw for the visible window (03 §4.3). */
import { chooseAgg } from "@analysis/format.ts";
import type { Agg, Bucket, DayPoint, MetricAnalysis, Point } from "@analysis/types.ts";

/** Hard cap on drawn dots per series so the SVG stays light at every zoom level. */
export const MAX_MARKS = 1000;

const DAY = 86400;

/** First index with key(item) >= x (items sorted ascending). */
export function lowerBound<T>(items: T[], x: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Items with key in [from, to] plus `pad` extra items each side (so lines run off the edge). */
export function slice<T>(items: T[], from: number, to: number, key: (item: T) => number, pad = 1): T[] {
  const a = Math.max(0, lowerBound(items, from, key) - pad);
  const b = Math.min(items.length, lowerBound(items, to, key) + pad);
  return items.slice(a, b);
}

const keyT = (p: { t: number }) => p.t;

export function countIn(items: { t: number }[], from: number, to: number): number {
  return lowerBound(items, to, keyT) - lowerBound(items, from, keyT);
}

/**
 * Picks the aggregation for a visible window [from, to] (epoch seconds). Starts from the plan's
 * chooseAgg and steps toward coarser data when the preferred level is missing or would draw
 * more than MAX_MARKS points.
 */
export function chooseLod(metric: MetricAnalysis, from: number, to: number): Agg {
  const spanDays = Math.max(0, (to - from) / DAY);
  const raw = metric.lod.raw;
  let agg = chooseAgg(spanDays, raw?.length ?? Infinity);
  const levels: Agg[] = ["raw", "daily", "weekly", "monthly"];
  const count = (a: Agg): number =>
    a === "raw" ? (raw ? countIn(raw, from, to) : Infinity)
    : a === "daily" ? countIn(metric.lod.daily, from, to)
    : a === "weekly" ? countIn(metric.lod.weekly, from, to)
    : countIn(metric.lod.monthly, from, to);
  const has = (a: Agg) =>
    a === "raw" ? !!raw : a === "daily" ? metric.lod.daily.length > 0
    : a === "weekly" ? metric.lod.weekly.length > 0 : metric.lod.monthly.length > 0;
  let i = levels.indexOf(agg);
  while (i < levels.length - 1 && (!has(levels[i]) || count(levels[i]) > MAX_MARKS)) i++;
  // Coarser levels may be absent (non-weight metrics only ship weekly/monthly for range=all): go finer.
  while (i > 0 && !has(levels[i])) i--;
  agg = levels[i];
  return agg;
}

export type { Bucket, DayPoint, Point };
