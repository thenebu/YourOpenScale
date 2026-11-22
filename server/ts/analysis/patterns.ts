/** Weekday / time-of-day effects, histogram, comparisons (WP-06). Pure. */
import { extent } from "./extent.ts";
import { mean, median, quantile, sd, centredBaseline } from "./stats.ts";
import { addDays, dayNoonUtc, daysBetween, localTime, weekdayOf } from "./time.ts";
import type {
  DayPoint, Histogram, MetricSpec, PeriodComparison, Point, Reading, TimeOfDayEffect,
  Unit, WeekdayEffect, YearSeries,
} from "./types.ts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KG_PER_LB = 1 / 2.2046226218487757;

/** Residuals of daily values against the centred baseline, keyed by day. */
function residuals(daily: DayPoint[]): { day: string; r: number; base: number }[] {
  const base = centredBaseline(daily);
  const byT = new Map(base.map((p) => [p.t, p.v]));
  const out: { day: string; r: number; base: number }[] = [];
  for (const d of daily) {
    const b = byT.get(d.t);
    if (b !== undefined) out.push({ day: d.day, r: d.v - b, base: b });
  }
  return out;
}

/** Mean deviation per weekday, re-centred to average 0; null with < 28 residuals or a weekday with n < 4. */
export function weekdayEffect(daily: DayPoint[]): WeekdayEffect[] | null {
  const res = residuals(daily);
  if (res.length < 28) return null;
  const groups: number[][] = [[], [], [], [], [], [], []];
  for (const e of res) groups[weekdayOf(e.day)].push(e.r);
  if (groups.some((g) => g.length < 4)) return null;
  const means = groups.map((g) => mean(g));
  const centre = mean(means);
  return groups.map((g, weekday) => ({
    weekday, label: WEEKDAYS[weekday], mean: means[weekday] - centre, se: sd(g) / Math.sqrt(g.length), n: g.length,
  }));
}

const SLOTS: { slot: TimeOfDayEffect["slot"]; hours: [number, number] }[] = [
  { slot: "night", hours: [22, 4] },
  { slot: "morning", hours: [4, 10] },
  { slot: "midday", hours: [10, 16] },
  { slot: "evening", hours: [16, 22] },
];
function slotOf(hour: number): TimeOfDayEffect["slot"] {
  if (hour >= 22 || hour < 4) return "night";
  if (hour < 10) return "morning";
  if (hour < 16) return "midday";
  return "evening";
}

/** Every reading against the centred baseline of its local day; slots with n < 5 are omitted. */
export function timeOfDayEffect(
  readings: Reading[],
  daily: DayPoint[],
  type: number,
): TimeOfDayEffect[] | null {
  const base = new Map(residuals(daily).map((e) => [e.day, e.base]));
  const groups = new Map<TimeOfDayEffect["slot"], number[]>();
  for (const r of readings) {
    const v = r.values[type];
    if (v === undefined || v === null || !Number.isFinite(v)) continue;
    const lt = localTime(r.t, r.zone);
    const b = base.get(lt.day);
    if (b === undefined) continue;
    const slot = slotOf(lt.hour);
    const list = groups.get(slot);
    if (list) list.push(v - b);
    else groups.set(slot, [v - b]);
  }
  const out: TimeOfDayEffect[] = [];
  for (const { slot, hours } of SLOTS) {
    const g = groups.get(slot);
    if (!g || g.length < 5) continue;
    out.push({ slot, hours, mean: mean(g), se: sd(g) / Math.sqrt(g.length), n: g.length });
  }
  return out.length ? out : null;
}

/** Bins aligned to multiples of the width (spec.binWidth, or 1 lb for lb/st), capped at 40 bins. */
export function histogram(
  daily: DayPoint[],
  spec: MetricSpec,
  unit: Unit,
  current: number | null,
): Histogram | null {
  if (daily.length < 5) return null;
  const values = daily.map((d) => d.v);
  let width = spec.unit === "kg" && unit !== "kg" ? KG_PER_LB : spec.binWidth;
  const [lo, hi] = extent(values);
  const count = (w: number) => Math.floor(hi / w + 1e-9) - Math.floor(lo / w + 1e-9) + 1;
  while (count(width) > 40) width *= 2;
  const first = Math.floor(lo / width + 1e-9);
  const bins = Array.from({ length: count(width) }, (_, i) => ({
    from: (first + i) * width, to: (first + i + 1) * width, count: 0,
  }));
  for (const v of values) bins[Math.min(bins.length - 1, Math.floor(v / width + 1e-9) - first)].count++;
  return {
    bins, mean: mean(values), median: median(values), p10: quantile(values, 0.1), p90: quantile(values, 0.9), current,
  };
}

/** Same calendar date one year earlier (29 Feb maps to 28 Feb). */
function shiftYears(day: string, years: number): string {
  const y = Number(day.slice(0, 4)) + years;
  const md = day.slice(5);
  if (md === "02-29") {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${leap ? "02-29" : "02-28"}`;
  }
  return `${String(y).padStart(4, "0")}-${md}`;
}

/** Week, month-to-date, last 30 days and year-to-date against their predecessors; rows need n >= 3 per side. */
export function periodComparisons(daily: DayPoint[], now: number, zone: string | null): PeriodComparison[] {
  const today = localTime(now, zone).day;
  const side = (from: string, to: string) => {
    const vals = daily.filter((d) => d.day >= from && d.day <= to).map((d) => d.v);
    return { from: dayNoonUtc(from), to: dayNoonUtc(to), mean: vals.length ? mean(vals) : NaN, n: vals.length };
  };
  const rows: { id: PeriodComparison["id"]; label: string; a: [string, string]; b: [string, string] }[] = [];
  rows.push({
    id: "week", label: "Last 7 days vs the 7 before",
    a: [addDays(today, -6), today], b: [addDays(today, -13), addDays(today, -7)],
  });
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevEnd = addDays(monthStart, -1);
  rows.push({
    id: "month", label: "This month vs last month",
    a: [monthStart, today], b: [`${prevEnd.slice(0, 7)}-01`, prevEnd],
  });
  rows.push({
    id: "yoy30", label: "Last 30 days vs a year ago",
    a: [addDays(today, -29), today], b: [shiftYears(addDays(today, -29), -1), shiftYears(today, -1)],
  });
  rows.push({
    id: "ytd", label: "This year to date vs last year",
    a: [`${today.slice(0, 4)}-01-01`, today], b: [shiftYears(`${today.slice(0, 4)}-01-01`, -1), shiftYears(today, -1)],
  });
  const out: PeriodComparison[] = [];
  for (const row of rows) {
    const a = side(...row.a);
    const b = side(...row.b);
    if (a.n >= 3 && b.n >= 3) out.push({ id: row.id, label: row.label, a, b, delta: a.mean - b.mean });
  }
  return out;
}

/** Previous period or year-over-year, already shifted onto the current time axis. */
export function compareSeries(
  daily: DayPoint[],
  mode: "prev" | "yoy",
  from: number,
  to: number,
): Point[] {
  if (mode === "prev") {
    const span = to - from;
    return daily.filter((d) => d.t >= from - span && d.t <= from).map((d) => ({ t: d.t + span, v: d.v }));
  }
  const fromDay = localTime(from, "UTC").day;
  const toDay = localTime(to, "UTC").day;
  const out: Point[] = [];
  const seen = new Set<string>();
  // Prefer a real 28 Feb over a shifted 29 Feb.
  const ordered = [...daily].sort((a, b) => Number(a.day.endsWith("02-29")) - Number(b.day.endsWith("02-29")));
  for (const d of ordered) {
    const day = shiftYears(d.day, 1);
    if (day < fromDay || day > toDay || seen.has(day)) continue;
    seen.add(day);
    out.push({ t: dayNoonUtc(day), v: d.v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** One series per calendar year by day of year; null with fewer than two years of data. */
export function yearOverlay(daily: DayPoint[]): YearSeries[] | null {
  const years = new Map<number, { doy: number; v: number }[]>();
  for (const d of daily) {
    const year = Number(d.day.slice(0, 4));
    const doy = daysBetween(`${year}-01-01`, d.day) + 1;
    const list = years.get(year);
    if (list) list.push({ doy, v: d.v });
    else years.set(year, [{ doy, v: d.v }]);
  }
  if (years.size < 2) return null;
  return [...years.keys()].sort((a, b) => a - b).map((year) => ({ year, points: years.get(year)! }));
}

/** Pearson r; null unless n >= 30 and |r| >= 0.3 (worded as association, never as cause). */
export function correlation(xs: number[], ys: number[]): { r: number; n: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 30) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  return Math.abs(r) >= 0.3 ? { r, n } : null;
}
