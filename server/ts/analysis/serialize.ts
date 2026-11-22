/**
 * Wire encoding (tuples, rounded numbers) for the browser payload (WP-07). Pure.
 * Shapes match web/src/charts/data.ts: raw [t,v,id], daily [day,t,v,min,max,n,id?],
 * trend [t,v,segment], buckets [key,start,end,t,mean,min,max,p25,p75,n,days], points [t,v].
 */
import type {
  Bucket, DashboardSummary, DayPoint, MetricAnalysis, Point, TrendPoint, UserAnalysis,
} from "./types.ts";

export type PointTuple = [number, number];
export type RawTuple = [number, number, number]; // [t, v, readingId]
export type DayTuple = [string, number, number, number, number, number, number?]; // [day, t, v, min, max, n, readingId]
export type TrendTuple = [number, number, number]; // [t, v, segment]
export type BucketTuple = [string, number, number, number, number, number, number, number, number, number, number];
export type CalendarTuple = [string, number]; // [day, readings]
export type YearTuple = [number, number]; // [dayOfYear, v]

export type WireMetric = Omit<MetricAnalysis, "lod" | "trend" | "compare"> & {
  lod: { raw: RawTuple[] | null; daily: DayTuple[]; weekly: BucketTuple[]; monthly: BucketTuple[] };
  trend: TrendTuple[];
  compare: { mode: "prev" | "yoy"; label: string; series: PointTuple[] } | null;
};
export type WireComposition = Omit<
  NonNullable<UserAnalysis["composition"]>, "fatMass" | "leanMass" | "fatPct"
> & { fatMass: WireMetric | null; leanMass: WireMetric | null; fatPct: WireMetric | null };

export type WireUserAnalysis = Omit<
  UserAnalysis, "weight" | "bmi" | "composition" | "metrics" | "weeklyRate" | "habits" | "patterns"
> & {
  weight: WireMetric | null;
  bmi: { series: WireMetric; latest: number; category: NonNullable<UserAnalysis["bmi"]>["category"] } | null;
  composition: WireComposition | null;
  metrics: WireMetric[];
  weeklyRate: PointTuple[];
  habits: Omit<UserAnalysis["habits"], "calendar"> & { calendar: CalendarTuple[] };
  patterns: Omit<UserAnalysis["patterns"], "years"> & {
    years: { year: number; points: YearTuple[] }[] | null;
  };
};

export type WireDashboardSummary = Omit<DashboardSummary, "mini"> & {
  mini: { from: number; to: number; daily: PointTuple[]; trend: TrendTuple[]; goalKg: number | null };
};

/** Three decimals; non-finite numbers become 0 so JSON stays valid. */
export const r3 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);
const ts = (t: number) => Math.round(t);

/** Deep copy with numbers rounded to 3 decimals; NaN/Infinity become null. */
function round<T>(value: T): T {
  if (typeof value === "number") return (Number.isFinite(value) ? r3(value) : null) as T;
  if (Array.isArray(value)) return value.map(round) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = round(v);
    return out as T;
  }
  return value;
}

const pointTuple = (p: Point): PointTuple => [ts(p.t), r3(p.v)];
const trendTuple = (p: TrendPoint): TrendTuple => [ts(p.t), r3(p.v), p.segment];
const dayTuple = (d: DayPoint, withId: boolean): DayTuple =>
  withId ? [d.day, ts(d.t), r3(d.v), r3(d.min), r3(d.max), d.n, d.readingId]
    : [d.day, ts(d.t), r3(d.v), r3(d.min), r3(d.max), d.n];
const bucketTuple = (b: Bucket): BucketTuple => [
  b.key, ts(b.start), ts(b.end), ts(b.t), r3(b.mean), r3(b.min), r3(b.max), r3(b.p25), r3(b.p75), b.n, b.days,
];

/** Secondary series longer than this many daily points are thinned to weekly detail on the wire. */
export const THIN_DAILY_ABOVE = 400;

/**
 * Payload budget (03 §6): a secondary metric with a long daily series ships empty `lod.daily`, a trend
 * thinned to the last point per week and segment, and defaultAgg "weekly". The weekly and monthly
 * buckets still cover the whole range. The client must fall back to the finest non-empty LOD.
 */
function thin(m: MetricAnalysis): MetricAnalysis {
  if (m.lod.daily.length <= THIN_DAILY_ABOVE || !m.lod.weekly.length) return m;
  const trend: TrendPoint[] = [];
  let lastKey = "";
  for (const p of m.trend) {
    const key = `${p.segment}|${Math.floor(p.t / 604800)}`;
    if (key === lastKey) trend[trend.length - 1] = p;
    else trend.push(p);
    lastKey = key;
  }
  return {
    ...m, trend, lod: { ...m.lod, daily: [] }, defaultAgg: "weekly",
    summary: m.summary.replace(", daily values", ", weekly averages"),
  };
}

/** `ids`: include the reading id in daily tuples (weight only, to keep payloads small). */
export function serializeMetric(m: MetricAnalysis, ids = false, thinned = false): WireMetric {
  if (thinned) m = thin(m);
  return {
    ...round({ ...m, lod: undefined, trend: undefined, compare: undefined }),
    lod: {
      raw: m.lod.raw ? m.lod.raw.map((p): RawTuple => [ts(p.t), r3(p.v), p.id]) : null,
      daily: m.lod.daily.map((d) => dayTuple(d, ids)),
      weekly: m.lod.weekly.map(bucketTuple),
      monthly: m.lod.monthly.map(bucketTuple),
    },
    trend: m.trend.map(trendTuple),
    compare: m.compare ? { mode: m.compare.mode, label: m.compare.label, series: m.compare.series.map(pointTuple) } : null,
  } as WireMetric;
}

export function serializeAnalysis(a: UserAnalysis): WireUserAnalysis {
  const metric = (m: MetricAnalysis | null, ids = false) => (m ? serializeMetric(m, ids, !ids) : null);
  const comp = a.composition;
  return {
    ...round({
      ...a, weight: undefined, bmi: undefined, composition: undefined, metrics: undefined,
      weeklyRate: undefined, habits: undefined, patterns: undefined,
    }),
    weight: metric(a.weight, true),
    bmi: a.bmi ? { series: serializeMetric(a.bmi.series, false, true), latest: r3(a.bmi.latest), category: a.bmi.category } : null,
    composition: comp
      ? {
        ...round({ ...comp, fatMass: undefined, leanMass: undefined, fatPct: undefined }),
        fatMass: metric(comp.fatMass),
        leanMass: metric(comp.leanMass),
        fatPct: metric(comp.fatPct),
      } as WireComposition
      : null,
    metrics: a.metrics.map((m) => serializeMetric(m, false, true)),
    weeklyRate: a.weeklyRate.map(pointTuple),
    habits: {
      ...round({ ...a.habits, calendar: undefined }),
      calendar: a.habits.calendar.map((c): CalendarTuple => [c.day, c.count]),
    },
    patterns: {
      ...round({ ...a.patterns, years: undefined }),
      years: a.patterns.years
        ? a.patterns.years.map((y) => ({ year: y.year, points: y.points.map((p): YearTuple => [p.doy, r3(p.v)]) }))
        : null,
    },
  } as WireUserAnalysis;
}

export function serializeDashboard(s: DashboardSummary): WireDashboardSummary {
  return {
    ...round({ ...s, mini: undefined }),
    mini: {
      from: ts(s.mini.from), to: ts(s.mini.to),
      daily: s.mini.daily.map(pointTuple),
      trend: s.mini.trend.map(trendTuple),
      goalKg: s.mini.goalKg === null ? null : r3(s.mini.goalKg),
    },
  } as WireDashboardSummary;
}
