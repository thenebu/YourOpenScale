/** Descriptive statistics (WP-05). Pure. */
import type { DayPoint, MetricStats, Point, TrendPoint } from "./types.ts";

export function stats(daily: DayPoint[], trend: TrendPoint[]): MetricStats | null {
  throw new Error("not implemented: stats");
}
export function mean(values: number[]): number {
  throw new Error("not implemented: mean");
}
export function median(values: number[]): number {
  throw new Error("not implemented: median");
}
export function quantile(values: number[], q: number): number {
  throw new Error("not implemented: quantile");
}
export function mad(values: number[]): number {
  throw new Error("not implemented: mad");
}
export function sd(values: number[]): number {
  throw new Error("not implemented: sd");
}
export function centredBaseline(
  daily: DayPoint[],
  halfWindowDays = 3,
  minNeighbours = 3,
): Point[] {
  throw new Error("not implemented: centredBaseline");
}
