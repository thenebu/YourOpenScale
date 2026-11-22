/** Weekday / time-of-day effects, histogram, comparisons (WP-06). Pure. */
import type {
  DayPoint, Histogram, MetricSpec, PeriodComparison, Point, Reading, TimeOfDayEffect,
  Unit, WeekdayEffect, YearSeries,
} from "./types.ts";

export function weekdayEffect(daily: DayPoint[]): WeekdayEffect[] | null {
  throw new Error("not implemented: weekdayEffect");
}
export function timeOfDayEffect(
  readings: Reading[],
  daily: DayPoint[],
  type: number,
): TimeOfDayEffect[] | null {
  throw new Error("not implemented: timeOfDayEffect");
}
export function histogram(
  daily: DayPoint[],
  spec: MetricSpec,
  unit: Unit,
  current: number | null,
): Histogram | null {
  throw new Error("not implemented: histogram");
}
export function periodComparisons(daily: DayPoint[], now: number, zone: string | null): PeriodComparison[] {
  throw new Error("not implemented: periodComparisons");
}
export function compareSeries(
  daily: DayPoint[],
  mode: "prev" | "yoy",
  from: number,
  to: number,
): Point[] {
  throw new Error("not implemented: compareSeries");
}
export function yearOverlay(daily: DayPoint[]): YearSeries[] | null {
  throw new Error("not implemented: yearOverlay");
}
export function correlation(xs: number[], ys: number[]): { r: number; n: number } | null {
  throw new Error("not implemented: correlation");
}
