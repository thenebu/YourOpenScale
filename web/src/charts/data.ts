/**
 * Payload access and wire decoding. The server sends points as tuples (03 §6); the charts work on
 * the object forms from server/ts/analysis/types.ts. Decoders accept object forms too, so they keep
 * working if the server serializer sends a bucket or trend point as an object.
 */
import type {
  Bucket, DayPoint, Goal, MetricAnalysis, Outlier, Point, TrendPoint, Unit, UserAnalysis,
} from "@analysis/types.ts";

export type PointTuple = [number, number];
export type RawTuple = [number, number, number?]; // [t, v, readingId]
export type DayTuple = [string, number, number, number, number, number, number?]; // [day, t, v, min, max, n, readingId]
export type TrendTuple = [number, number, number?]; // [t, v, segment]
export type BucketTuple = [string, number, number, number, number, number, number, number, number, number, number];
// [key, start, end, t, mean, min, max, p25, p75, n, days]

export type WireMetric = Omit<MetricAnalysis, "lod" | "trend" | "compare"> & {
  lod: {
    raw: (RawTuple | (Point & { id: number }))[] | null;
    daily: (DayTuple | DayPoint)[];
    weekly: (BucketTuple | Bucket)[];
    monthly: (BucketTuple | Bucket)[];
  };
  trend: (TrendTuple | TrendPoint)[];
  compare: { mode: "prev" | "yoy"; label: string; series: (PointTuple | Point)[] } | null;
};

export type WireAnalysis = Omit<UserAnalysis, "weight" | "bmi" | "composition" | "metrics" | "weeklyRate"> & {
  weight: WireMetric | null;
  bmi: { series: WireMetric; latest: number; category: NonNullable<UserAnalysis["bmi"]>["category"] } | null;
  composition: { fatMass: WireMetric | null; leanMass: WireMetric | null; fatPct: WireMetric | null } | null;
  metrics: WireMetric[];
};

export type Decoded = MetricAnalysis;

const payloads = new Map<string, unknown>();

/** Parses `<script type="application/json" id=ref>` once. Returns null when absent or invalid. */
export function readPayload<T = WireAnalysis>(ref: string): T | null {
  if (payloads.has(ref)) return payloads.get(ref) as T;
  let value: unknown = null;
  const node = document.getElementById(ref);
  if (node?.textContent) {
    try {
      value = JSON.parse(node.textContent);
    } catch {
      value = null;
    }
  }
  payloads.set(ref, value);
  return value as T | null;
}

export function forgetPayload(ref: string): void {
  payloads.delete(ref);
}

export const decodePoint = (p: PointTuple | Point): Point => (Array.isArray(p) ? { t: p[0], v: p[1] } : p);

export function decodeDay(d: DayTuple | DayPoint): DayPoint {
  if (!Array.isArray(d)) return d;
  return { day: d[0], t: d[1], v: d[2], min: d[3], max: d[4], mean: d[2], n: d[5], readingId: d[6] ?? 0 };
}

export function decodeBucket(b: BucketTuple | Bucket): Bucket {
  if (!Array.isArray(b)) return b;
  return {
    key: b[0], start: b[1], end: b[2], t: b[3], mean: b[4], min: b[5], max: b[6],
    p25: b[7], p75: b[8], n: b[9], days: b[10],
  };
}

const GAP_SECONDS = 30 * 86400;

/** Trend tuples may omit the segment; it is then rebuilt from gaps above 30 days (as ewmaTrend does). */
export function decodeTrend(list: (TrendTuple | TrendPoint)[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  let segment = 0;
  for (const p of list) {
    if (!Array.isArray(p)) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    if (p[2] !== undefined) segment = p[2];
    else if (prev && p[0] - prev.t > GAP_SECONDS) segment++;
    out.push({ t: p[0], v: p[1], segment });
  }
  return out;
}

const decoded = new WeakMap<object, MetricAnalysis>();

export function decodeMetric(w: WireMetric): MetricAnalysis {
  const hit = decoded.get(w);
  if (hit) return hit;
  const m: MetricAnalysis = {
    ...w,
    lod: {
      raw: w.lod.raw ? w.lod.raw.map((r) => (Array.isArray(r) ? { t: r[0], v: r[1], id: r[2] ?? 0 } : r)) : null,
      daily: w.lod.daily.map(decodeDay),
      weekly: w.lod.weekly.map(decodeBucket),
      monthly: w.lod.monthly.map(decodeBucket),
    },
    trend: decodeTrend(w.trend),
    compare: w.compare ? { ...w.compare, series: w.compare.series.map(decodePoint) } : null,
  };
  decoded.set(w, m);
  return m;
}

/** Looks a metric up by island name: weight, bmi, fatMass, leanMass, fatPct, or a key/type from `metrics`. */
export function resolveMetric(payload: WireAnalysis, name: string): MetricAnalysis | null {
  let w: WireMetric | null | undefined;
  switch (name) {
    case "weight": w = payload.weight; break;
    case "bmi": w = payload.bmi?.series; break;
    case "fatMass": w = payload.composition?.fatMass; break;
    case "leanMass": w = payload.composition?.leanMass; break;
    case "fatPct": w = payload.composition?.fatPct; break;
    default: w = payload.metrics?.find((m) => m.key === name || String(m.type) === name);
  }
  return w ? decodeMetric(w) : null;
}

export function goalOf(payload: WireAnalysis): Goal | null {
  return payload.goal ?? null;
}

export type { Outlier, Unit };
