/** Weigh-in consistency: calendar, streaks (WP-06). Pure. */
import { addDays, localTime } from "./time.ts";
import type { Reading, Streaks } from "./types.ts";

function zoneOf(readings: Reading[]): string | null {
  return readings.length ? readings[readings.length - 1].zone : null;
}

/** One cell per local day in [from, to] (epoch seconds) with the number of readings that day. */
export function calendarCells(
  readings: Reading[],
  from: number,
  to: number,
): { day: string; count: number }[] {
  const zone = zoneOf(readings);
  const counts = new Map<string, number>();
  for (const r of readings) {
    const day = localTime(r.t, r.zone).day;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const first = localTime(from, zone).day;
  const last = localTime(to, zone).day;
  const out: { day: string; count: number }[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) out.push({ day, count: counts.get(day) ?? 0 });
  return out;
}

/** `current` counts back from today, or from yesterday when today has no reading yet. */
export function streaks(days: string[], today: string): Streaks {
  const set = new Set(days.filter((d) => d <= today));
  const sorted = [...set].sort();
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let longest: Streaks["longest"] = null;
  let runStart = "";
  let prev = "";
  let run = 0;
  for (const day of sorted) {
    if (prev && addDays(prev, 1) === day) run++;
    else {
      run = 1;
      runStart = day;
    }
    if (!longest || run >= longest.days) longest = { days: run, from: runStart, to: day };
    prev = day;
  }
  return { current, longest };
}

/** Distinct local days with a reading among the last `days` days, today included. */
export function daysInLast(readings: Reading[], days: number, now: number): number {
  if (!readings.length) return 0;
  const today = localTime(now, zoneOf(readings)).day;
  const start = addDays(today, -(days - 1));
  const seen = new Set<string>();
  for (const r of readings) {
    if (r.t > now) continue;
    const day = localTime(r.t, r.zone).day;
    if (day >= start && day <= today) seen.add(day);
  }
  return seen.size;
}
