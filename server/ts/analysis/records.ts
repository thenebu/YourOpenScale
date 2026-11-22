/** Personal records over the whole history (WP-06). Pure. */
import type { DayPoint, RecordItem, Streaks, TrendPoint } from "./types.ts";

export function records(
  daily: DayPoint[],
  trend: TrendPoint[],
  streak: Streaks,
  now: number,
): RecordItem[] {
  throw new Error("not implemented: records");
}
