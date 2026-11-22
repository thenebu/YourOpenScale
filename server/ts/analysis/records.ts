/** Personal records over the whole history (WP-06). Pure. */
import { formatDate } from "./format.ts";
import { mean } from "./stats.ts";
import { dayNoonUtc } from "./time.ts";
import { trendAt } from "./trend.ts";
import type { DayPoint, RecordItem, Streaks, TrendPoint } from "./types.ts";

const DAY = 86400;
const when = (t: number) => formatDate(t, "UTC", "medium");

/** Values are kg (or kg change); all history, independent of the chart range. */
export function records(
  daily: DayPoint[],
  trend: TrendPoint[],
  streak: Streaks,
  now: number,
): RecordItem[] {
  const none = (id: RecordItem["id"], label: string, detail = "Not enough data yet"): RecordItem =>
    ({ id, label, value: null, t: null, detail });
  const out: RecordItem[] = [];

  let lo: DayPoint | null = null;
  let hi: DayPoint | null = null;
  let lo12: DayPoint | null = null;
  for (const d of daily) {
    if (!lo || d.v < lo.v) lo = d;
    if (!hi || d.v > hi.v) hi = d;
    if (d.t >= now - 365 * DAY && d.t <= now && (!lo12 || d.v < lo12.v)) lo12 = d;
  }
  out.push(lo ? { id: "lowest", label: "Lowest weight", value: lo.v, t: lo.t, detail: when(lo.t) } : none("lowest", "Lowest weight"));
  out.push(hi ? { id: "highest", label: "Highest weight", value: hi.v, t: hi.t, detail: when(hi.t) } : none("highest", "Highest weight"));
  out.push(lo12
    ? { id: "low12m", label: "Lowest in the last 12 months", value: lo12.v, t: lo12.t, detail: when(lo12.t) }
    : none("low12m", "Lowest in the last 12 months"));

  let drop: { v: number; t: number } | null = null;
  let gain: { v: number; t: number } | null = null;
  for (const p of trend) {
    const before = trendAt(trend, p.t - 7 * DAY, 0);
    if (before === null) continue;
    const change = before - p.v;
    if (change > 0 && (!drop || change > drop.v)) drop = { v: change, t: p.t };
    if (-change > 0 && (!gain || -change > gain.v)) gain = { v: -change, t: p.t };
  }
  out.push(drop
    ? { id: "drop7", label: "Biggest 7-day drop", value: drop.v, t: drop.t, detail: `Ending ${when(drop.t)}` }
    : none("drop7", "Biggest 7-day drop", "No 7-day drop yet"));
  out.push(gain
    ? { id: "gain7", label: "Biggest 7-day gain", value: gain.v, t: gain.t, detail: `Ending ${when(gain.t)}` }
    : none("gain7", "Biggest 7-day gain", "No 7-day gain yet"));

  const months = new Map<string, number[]>();
  for (const d of daily) {
    const key = d.day.slice(0, 7);
    const list = months.get(key);
    if (list) list.push(d.v);
    else months.set(key, [d.v]);
  }
  const nextMonth = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  };
  let best: { delta: number; key: string; prev: string } | null = null;
  for (const [key, vals] of months) {
    const prev = months.get(nextMonth(key));
    if (vals.length < 5 || !prev || prev.length < 5) continue;
    const delta = mean(prev) - mean(vals);
    if (delta < 0 && (!best || delta < best.delta)) best = { delta, key: nextMonth(key), prev: key };
  }
  if (best) {
    const t = dayNoonUtc(`${best.key}-15`);
    out.push({
      id: "bestMonth", label: "Best month", value: best.delta, t,
      detail: `${formatDate(t, "UTC", "month")}, against ${formatDate(dayNoonUtc(`${best.prev}-15`), "UTC", "month")}`,
    });
  } else out.push(none("bestMonth", "Best month", "Needs two consecutive months with 5 weigh-in days"));

  out.push(streak.longest
    ? {
      id: "longestStreak", label: "Longest streak", value: streak.longest.days,
      t: dayNoonUtc(streak.longest.to), detail: `${streak.longest.from} to ${streak.longest.to}`,
    }
    : none("longestStreak", "Longest streak"));

  if (trend.length >= 2) {
    const last = trend[trend.length - 1];
    out.push({
      id: "sinceStart", label: "Change since the first weigh-in", value: last.v - trend[0].v, t: last.t,
      detail: `Since ${when(trend[0].t)}`,
    });
  } else out.push(none("sinceStart", "Change since the first weigh-in"));
  return out;
}
