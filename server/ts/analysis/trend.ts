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

/** Fit needs at least this many daily points spread over this many days since the goal start. */
const DECAY_MIN_POINTS = 20;
const DECAY_MIN_SPAN_DAYS = 42;
/** Time constants tried, in days (geometric grid); the grid's upper end means "no visible flattening". */
const TAUS = Array.from({ length: 40 }, (_, i) => 10 * 100 ** (i / 39));
/** An asymptote within this distance of the goal counts as "the goal is not reached". */
const PLATEAU_MARGIN_KG = 0.25;

export type DecayFit = { plateau: number; tauDays: number; etaDays: number | null; earliestDays: number | null; latestDays: number | null };

/** Days for a curve flattening towards `a` (time constant tau) to go from `from` to `to`; null if it never gets there. */
function decayEta(from: number, to: number, a: number, tau: number): number | null {
  const x = from - a;
  const y = to - a;
  if (Math.sign(x) !== Math.sign(y) || Math.abs(y) < PLATEAU_MARGIN_KG || Math.abs(y) >= Math.abs(x)) return null;
  return tau * Math.log(x / y);
}

/**
 * Exponential-approach fit w(t) = a + c·exp(-t/tau) over the last contiguous stretch since the goal start,
 * for a goal that lies beyond the current trend. Losing weight slows down as the body nears its balance
 * point, so a straight line is too optimistic. For every tau the fit is a linear least squares in (a, c);
 * the best tau wins, and only when it beats the straight line clearly (F-test, 1 extra parameter).
 * The date range comes from all taus whose error stays within the 95% profile-likelihood band.
 * Returns null when the history is too short, not curved, or does not move towards the goal.
 */
export function fitDecay(daily: DayPoint[], startAt: number, trendNow: number, goalKg: number, now: number): DecayFit | null {
  let pts = daily.filter((d) => d.t >= startAt - DAY && d.t <= now);
  for (let k = pts.length - 1; k > 0; k--) {
    if (pts[k].t - pts[k - 1].t > 30 * DAY) { pts = pts.slice(k); break; }
  }
  const n = pts.length;
  if (n < DECAY_MIN_POINTS || (pts[n - 1].t - pts[0].t) / DAY < DECAY_MIN_SPAN_DAYS) return null;
  const xs = pts.map((p) => (p.t - pts[0].t) / DAY);
  const ys = pts.map((p) => p.v);
  const ols = (e: number[]) => {
    const eBar = e.reduce((s, v) => s + v, 0) / n;
    const yBar = ys.reduce((s, v) => s + v, 0) / n;
    let see = 0;
    let sey = 0;
    for (let i = 0; i < n; i++) { see += (e[i] - eBar) ** 2; sey += (e[i] - eBar) * (ys[i] - yBar); }
    if (see < 1e-12) return null;
    const c = sey / see;
    const a = yBar - c * eBar;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (ys[i] - a - c * e[i]) ** 2;
    return { a, c, sse };
  };
  const lin = ols(xs);
  if (!lin) return null;
  const fits = TAUS.map((tau) => {
    const f = ols(xs.map((x) => Math.exp(-x / tau)));
    return f ? { tau, ...f } : null;
  }).filter((f): f is NonNullable<typeof f> => f !== null);
  if (!fits.length) return null;
  const best = fits.reduce((m, f) => (f.sse < m.sse ? f : m));
  if (best.tau >= TAUS[TAUS.length - 1] * 0.95) return null;     // no flattening visible
  if (best.sse <= 0 || (lin.sse - best.sse) / (best.sse / (n - 3)) < 4) return null;
  // The curve must be heading towards the goal right now.
  const slopeNow = (-best.c / best.tau) * Math.exp(-xs[n - 1] / best.tau);
  if (Math.sign(slopeNow) !== Math.sign(goalKg - trendNow)) return null;
  const band = best.sse * (1 + 3.84 / (n - 3));
  const etas = fits.filter((f) => f.sse <= band).map((f) => decayEta(trendNow, goalKg, f.a, f.tau));
  const finite = etas.filter((v): v is number => v !== null);
  return {
    plateau: best.a, tauDays: best.tau,
    etaDays: decayEta(trendNow, goalKg, best.a, best.tau),
    earliestDays: finite.length ? Math.min(...finite) : null,
    latestDays: finite.length === etas.length ? Math.max(...finite) : null,
  };
}

/** Body data that shapes the expected slow-down. Everything is optional. */
export type ProjectionProfile = { heightCm: number | null; ageYears: number | null; sex: 0 | 1; fatPct: number | null };

/** Healthy-weight BMI used as the "little left to lose" level; rises slowly with age (older bodies hold on harder). */
const FLOOR_BMI = 21;
const FLOOR_BMI_PER_YEAR = 0.05;
/** Lowest sensible body-fat share (men, women); also rises a little with age. */
const MIN_FAT = [0.12, 0.2];
const MIN_FAT_PER_YEAR = 0.001;
/** The assumed floor always leaves at least this much to lose. */
const MIN_RESERVE_KG = 2;

/**
 * Weight below which losing gets very hard: the higher of the weight at the age-adjusted floor BMI and
 * the weight at which the current lean mass would carry the minimum fat share. Null without height and body fat.
 */
export function reserveFloorKg(weightKg: number, p: ProjectionProfile): number | null {
  const over = Math.max(0, (p.ageYears ?? 30) - 30);
  const candidates: number[] = [];
  if (p.heightCm && p.heightCm > 100) candidates.push((FLOOR_BMI + FLOOR_BMI_PER_YEAR * over) * (p.heightCm / 100) ** 2);
  if (p.fatPct !== null && p.fatPct > 2 && p.fatPct < 70)
    candidates.push((weightKg * (1 - p.fatPct / 100)) / (1 - (MIN_FAT[p.sex] + MIN_FAT_PER_YEAR * over)));
  if (!candidates.length) return null;
  return Math.min(Math.max(...candidates), weightKg - MIN_RESERVE_KG);
}

/** Pace proportional to the reserve above the floor: a curve with tau = reserve / current pace. */
function priorEta(w: number, goalKg: number, floor: number, perDay: number): number {
  // A goal at or below the floor would never be reached; keep the floor clearly under the goal.
  const a = Math.min(floor, goalKg - Math.max(1, 0.3 * (w - goalKg)));
  return ((w - a) / perDay) * Math.log((w - a) / (goalKg - a));
}

export function projectGoal(
  trendNow: number | null,
  rate: Rate | null,
  goal: Goal,
  now: number,
  history: DayPoint[] = [],
  profile: ProjectionProfile | null = null,
): Projection {
  const base: Projection = {
    status: "insufficient", goal: goal.kg, remaining: 0, etaDays: null, date: null,
    earliest: null, latest: null, requiredPerWeek: null, model: "linear", plateauKg: null,
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
  const at = (days: number) => addDays(today, Math.round(days));
  const fit = fitDecay(history, goal.startAt, trendNow, goal.kg, now);
  if (fit) {
    const curved = { ...base, model: "decay" as const, plateauKg: fit.plateau };
    if (fit.etaDays === null) return { ...curved, status: "levels-off" };
    if (fit.etaDays > 730) return { ...curved, status: "too-slow", etaDays: fit.etaDays };
    return {
      ...curved, status: "on-track", etaDays: fit.etaDays, date: at(fit.etaDays),
      earliest: fit.earliestDays !== null ? at(Math.min(fit.earliestDays, fit.etaDays)) : null,
      latest: fit.latestDays !== null && fit.latestDays <= 1095 ? at(Math.max(fit.latestDays, fit.etaDays)) : null,
    };
  }
  const etaDays = remaining / b;
  // No curve visible in the data yet: for weight loss assume the pace eases off as the reserve shrinks.
  const floor = profile && remaining < 0 ? reserveFloorKg(trendNow, profile) : null;
  if (floor !== null) {
    const perDay = Math.abs(b);
    const eta = priorEta(trendNow, goal.kg, floor, perDay);
    if (eta > 730) return { ...base, model: "prior", status: "too-slow", etaDays: eta };
    // Slowest plausible: floor halfway to the goal. Fastest: the straight line.
    const slow = priorEta(trendNow, goal.kg, (floor + goal.kg) / 2, perDay);
    return {
      ...base, model: "prior", status: "on-track", etaDays: eta, date: at(eta),
      earliest: at(Math.min(etaDays, eta)), latest: slow <= 1095 ? at(Math.max(slow, eta)) : null,
    };
  }
  if (etaDays > 730) return { ...base, status: "too-slow", etaDays };
  const se = rate.seWeek / 7;
  const sign = Math.sign(b);
  const bFast = b + sign * 1.96 * se;
  const bSlow = b - sign * 1.96 * se;
  const lateDays = Math.sign(bSlow) === sign ? remaining / bSlow : null;
  return {
    ...base, status: "on-track", etaDays, date: at(etaDays), earliest: at(remaining / bFast),
    latest: lateDays !== null && lateDays <= 1095 ? at(lateDays) : null,
  };
}

export function goalProgress(trendNow: number | null, goal: Goal): GoalProgress | null {
  if (trendNow === null) return null;
  // Works for loss (goal < start) and gain (goal > start) goals alike: the signs cancel.
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
