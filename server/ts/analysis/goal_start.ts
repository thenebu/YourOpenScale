/** Goal start date and start weight (R4a). Pure: no database access. */
import { dailySeries } from "./series.ts";
import { flagOutliers } from "./quality.ts";
import { specFor } from "./spec.ts";
import { ewmaTrend, trendAt } from "./trend.ts";
import { localTime } from "./time.ts";
import type { Reading } from "./types.ts";

const DAY = 86400;
export const GOAL_MIN_START_DAY = "2000-01-01";
/** Window in which a plain weight reading stands in for a missing trend value. */
const NEAR_DAYS = 14;

/** Local noon of a calendar day in a zone (a null zone means UTC), as epoch seconds. */
export function localNoon(day: string, zone: string | null): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12) / 1000;
  const lt = localTime(guess, zone);
  const local = Date.UTC(Number(lt.day.slice(0, 4)), Number(lt.day.slice(5, 7)) - 1, Number(lt.day.slice(8, 10)), lt.hour, lt.minutes) / 1000;
  return guess - (local - guess);
}

export type StartSource = "trend" | "reading" | "reference";
export type DerivedStart = { kg: number; source: StartSource };

/** Weight at a start day: trend value there, else the nearest reading on/after (within 14 days), else before, else the reference. */
export function deriveStart(readings: Reading[], day: string, zone: string | null, referenceKg: number): DerivedStart {
  const spec = specFor(1)!;
  const sorted = readings.slice().sort((a, b) => a.t - b.t || a.id - b.id);
  const flags = flagOutliers(sorted, 1);
  const daily = dailySeries(sorted, 1, { morningOnly: false, exclude: new Set(flags.keys()) });
  const at = localNoon(day, zone);
  const trend = trendAt(ewmaTrend(daily, spec), at, 3);
  if (trend !== null) return { kg: trend, source: "trend" };
  const after = daily.find((p) => p.t >= at - DAY / 2 && p.t - at <= NEAR_DAYS * DAY);
  if (after) return { kg: after.v, source: "reading" };
  const before = [...daily].reverse().find((p) => p.t < at);
  if (before) return { kg: before.v, source: "reading" };
  return { kg: referenceKg, source: "reference" };
}
