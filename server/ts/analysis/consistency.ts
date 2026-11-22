/** Weigh-in consistency: calendar, streaks (WP-06). Pure. */
import type { Reading, Streaks } from "./types.ts";

export function calendarCells(
  readings: Reading[],
  from: number,
  to: number,
): { day: string; count: number }[] {
  throw new Error("not implemented: calendarCells");
}
export function streaks(days: string[], today: string): Streaks {
  throw new Error("not implemented: streaks");
}
export function daysInLast(readings: Reading[], days: number, now: number): number {
  throw new Error("not implemented: daysInLast");
}
