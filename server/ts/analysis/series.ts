/** Daily series, bucketing and level of detail (WP-05). Pure. */
import type { Agg, Bucket, DayPoint, MetricSpec, Reading } from "./types.ts";
import type { Point } from "./types.ts";

export function dailySeries(
  readings: Reading[],
  type: number,
  opts: { morningOnly: boolean; exclude?: Set<number> },
): DayPoint[] {
  throw new Error("not implemented: dailySeries");
}
export function bucketize(daily: DayPoint[], by: "week" | "month"): Bucket[] {
  throw new Error("not implemented: bucketize");
}
export function chooseAgg(visibleSpanDays: number, rawCount: number): Agg {
  throw new Error("not implemented: chooseAgg");
}
export function yExtent(values: number[], spec: MetricSpec): [number, number] {
  throw new Error("not implemented: yExtent");
}
export function readingPoints(
  readings: Reading[],
  type: number,
  exclude?: Set<number>,
): (Point & { id: number })[] {
  throw new Error("not implemented: readingPoints");
}
