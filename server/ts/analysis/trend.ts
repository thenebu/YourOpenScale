/** Trend, rate and goal projection (WP-05). Pure: `now` is always a parameter. */
import { addDays, daysBetween, isoWeekThursday, dayNoonUtc } from "./time.ts";
import type {
  DayPoint, Goal, GoalProgress, MetricSpec, Point, Projection, Rate, TrendPoint, Unit,
} from "./types.ts";

const DAY = 86400;
const KG_TO_LB = 2.2046226218487757;
const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Time-aware EWMA over the daily series; a gap above 30 days starts a new segment. */
export function ewmaTrend(daily: DayPoint[], spec: MetricSpec): TrendPoint[] {
  const out: TrendPoint[] = [];
  let segment = -1;
  let current = 0;
  for (let k = 0; k < daily.length; k++) {
    const gapDays = k === 0 ? Infinity : (daily[k].t - daily[k - 1].t) / DAY;
    if (gapDays > 30) {
      segment++;
      let sum = 0;
      let count = 0;
      for (let j = k; j < daily.length && count < 3 && daily[j].t - daily[k].t <= 7 * DAY; j++) {
        sum += daily[j].v;
        count++;
      }
      current = sum / count;
    } else {
      const a = 1 - (1 - spec.alpha) ** gapDays;
      current += a * (daily[k].v - current);
    }
    out.push({ t: daily[k].t, v: current, segment: Math.max(segment, 0) });
  }
  return out;
}

/** Interpolated trend at t; within tolDays of a segment edge the edge value; otherwise null. */
export function trendAt(trend: TrendPoint[], t: number, tolDays = 3): number | null {
  if (!trend.length) return null;
  const tol = tolDays * DAY;
  const first = trend[0];
  const last = trend[trend.length - 1];
  if (t < first.t) return first.t - t <= tol ? first.v : null;
  if (t >= last.t) return t - last.t <= tol ? last.v : null;
  let lo = 0;
  let hi = trend.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trend[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = trend[lo];
  const b = trend[hi];
  if (a.t === t) return a.v;
  if (a.segment === b.segment) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  if (t - a.t <= tol && t - a.t <= b.t - t) return a.v;
  if (b.t - t <= tol) return b.v;
  return null;
}

/** OLS slope over the last windowDays; null for n < 8 or under 14 days covered. */
export function linearRate(daily: DayPoint[], windowDays: number, now: number): Rate | null {
  const from = now - windowDays * DAY;
  const pts = daily.filter((d) => d.t >= from && d.t <= now);
  const n = pts.length;
  if (n < 8) return null;
  const spanDays = (pts[n - 1].t - pts[0].t) / DAY;
  if (spanDays < 14) return null;
  const taus = pts.map((p) => (p.t - from) / DAY);
  const tBar = taus.reduce((s, v) => s + v, 0) / n;
  const xBar = pts.reduce((s, p) => s + p.v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (taus[i] - tBar) ** 2;
    sxy += (taus[i] - tBar) * (pts[i].v - xBar);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (pts[i].v - xBar - b * (taus[i] - tBar)) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return {
    perWeek: 7 * b, seWeek: 7 * se, n, days: Math.round(spanDays), from: pts[0].t, to: pts[n - 1].t,
  };
}

export const isStable = (r: Rate) => Math.abs(r.perWeek) < Math.max(0.1, 1.96 * r.seWeek);

export function projectGoal(
  trendNow: number | null,
  rate: Rate | null,
  goal: Goal,
  now: number,
): Projection {
  const base: Projection = {
    status: "insufficient", goal: goal.kg, remaining: 0, etaDays: null, date: null,
    earliest: null, latest: null, requiredPerWeek: null,
  };
  if (trendNow === null) return base;
  const today = utcDay(now);
  const remaining = goal.kg - trendNow;
  base.remaining = remaining;
  if (goal.date) {
    const left = daysBetween(today, goal.date);
    if (left > 0) base.requiredPerWeek = (7 * remaining) / left;
  }
  if (Math.abs(remaining) <= 0.3) return { ...base, status: "reached" };
  if (!rate) return base;
  if (isStable(rate)) return { ...base, status: "stable" };
  const b = rate.perWeek / 7;
  if (Math.sign(b) !== Math.sign(remaining)) return { ...base, status: "moving-away" };
  const etaDays = remaining / b;
  if (etaDays > 730) return { ...base, status: "too-slow", etaDays };
  const se = rate.seWeek / 7;
  const sign = Math.sign(b);
  const bFast = b + sign * 1.96 * se;
  const bSlow = b - sign * 1.96 * se;
  const at = (days: number) => addDays(today, Math.round(days));
  const lateDays = Math.sign(bSlow) === sign ? remaining / bSlow : null;
  return {
    ...base, status: "on-track", etaDays, date: at(etaDays), earliest: at(remaining / bFast),
    latest: lateDays !== null && lateDays <= 1095 ? at(lateDays) : null,
  };
}

export function goalProgress(trendNow: number | null, goal: Goal): GoalProgress | null {
  if (trendNow === null) return null;
  const denom = goal.startKg - goal.kg;
  const raw = denom === 0 ? 1 : (goal.startKg - trendNow) / denom;
  return {
    fraction: Math.min(1, Math.max(0, raw)), startKg: goal.startKg, currentKg: trendNow, goalKg: goal.kg,
  };
}

/** Change in the end-of-week trend vs the previous (consecutive) ISO week, same segment only. */
export function weeklyRateSeries(trend: TrendPoint[]): Point[] {
  const weeks: { thursday: string; v: number; segment: number }[] = [];
  for (const p of trend) {
    const day = utcDay(p.t);
    const thursday = isoWeekThursday(day);
    const w = weeks[weeks.length - 1];
    if (w && w.thursday === thursday) {
      w.v = p.v;
      w.segment = p.segment;
    } else weeks.push({ thursday, v: p.v, segment: p.segment });
  }
  const out: Point[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const a = weeks[i - 1];
    const b = weeks[i];
    if (a.segment !== b.segment || daysBetween(a.thursday, b.thursday) !== 7) continue;
    out.push({ t: dayNoonUtc(b.thursday), v: b.v - a.v });
  }
  return out;
}
