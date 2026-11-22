/** Trend, rate and goal projection (WP-05). Pure: `now` is always a parameter. */
import type {
  DayPoint, Goal, GoalProgress, MetricSpec, Point, Projection, Rate, TrendPoint, Unit,
} from "./types.ts";

export function ewmaTrend(daily: DayPoint[], spec: MetricSpec): TrendPoint[] {
  throw new Error("not implemented: ewmaTrend");
}
export function trendAt(trend: TrendPoint[], t: number, tolDays = 3): number | null {
  throw new Error("not implemented: trendAt");
}
export function linearRate(daily: DayPoint[], windowDays: number, now: number): Rate | null {
  throw new Error("not implemented: linearRate");
}
export function rateText(rate: Rate | null, unit: Unit): string {
  throw new Error("not implemented: rateText");
}
export function projectGoal(
  trendNow: number | null,
  rate: Rate | null,
  goal: Goal,
  now: number,
): Projection {
  throw new Error("not implemented: projectGoal");
}
export function goalProgress(trendNow: number | null, goal: Goal): GoalProgress | null {
  throw new Error("not implemented: goalProgress");
}
export function weeklyRateSeries(trend: TrendPoint[]): Point[] {
  throw new Error("not implemented: weeklyRateSeries");
}
