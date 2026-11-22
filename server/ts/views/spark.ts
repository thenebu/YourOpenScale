/** Server-rendered micro charts (WP-11). Pure; no text elements, so they stay legible at any scale. */
import { extent } from "../analysis/extent.ts";
import type { Point, TrendPoint } from "../analysis/types.ts";

const r1 = (n: number): number => Math.round(n * 10) / 10;
const finite = (p: { t: number; v: number }): boolean => Number.isFinite(p.t) && Number.isFinite(p.v);

/** Keeps at most `max` points, evenly spread, always including the last one. */
function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor((i * points.length) / (max - 1))]);
  out.push(points[points.length - 1]);
  return out;
}

export type MiniTrendInput = {
  daily: Point[];
  trend: TrendPoint[];
  from: number;
  to: number;
  goalKg: number | null;
  width?: number;
  height?: number;
};

/**
 * 90-day mini chart: faint daily dots, the trend path, an emphasised last point and an optional goal line.
 * Stretches to its box (`preserveAspectRatio="none"`); dots and strokes use `vector-effect: non-scaling-stroke`
 * so they stay round and constant in width. Styling lives in pages/dashboard.css.
 */
export function miniTrend(input: MiniTrendInput): string {
  const W = input.width ?? 320;
  const H = input.height ?? 72;
  const daily = thin(input.daily.filter(finite), 120);
  const trend = input.trend.filter(finite);
  if (!daily.length && !trend.length) return "";

  const all = [...daily, ...trend].map((p) => p.v);
  let [lo, hi] = extent(all);
  const span = Math.max(hi - lo, 1);
  const goal = input.goalKg !== null && Number.isFinite(input.goalKg) ? input.goalKg : null;
  const goalShown = goal !== null && goal >= lo - span / 2 && goal <= hi + span / 2;
  if (goalShown) {
    lo = Math.min(lo, goal);
    hi = Math.max(hi, goal);
  }
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const padX = 4;
  const padY = 8;
  const ts = [...daily, ...trend].map((p) => p.t);
  const from = Number.isFinite(input.from) ? input.from : extent(ts)[0];
  let to = Number.isFinite(input.to) ? input.to : extent(ts)[1];
  const tSpan = to > from ? to - from : 0;
  to = from + tSpan;
  const x = (t: number): number => r1(tSpan ? padX + ((Math.min(Math.max(t, from), to) - from) / tSpan) * (W - 2 * padX) : W - padX);
  const y = (v: number): number => r1(padY + (1 - (v - lo) / (hi - lo)) * (H - 2 * padY));

  const dots = daily.map((p) => `M${x(p.t)} ${y(p.v)}h0`).join("");
  const segments = new Map<number, TrendPoint[]>();
  for (const p of trend) {
    const list = segments.get(p.segment) ?? [];
    list.push(p);
    segments.set(p.segment, list);
  }
  const line = [...segments.values()]
    .map((s) => (s.length > 1 ? `M${s.map((p) => `${x(p.t)} ${y(p.v)}`).join("L")}` : `M${x(s[0].t)} ${y(s[0].v)}h0`))
    .join("");
  const lastPoint = trend.length ? trend[trend.length - 1] : daily[daily.length - 1];
  const parts = [
    goalShown ? `<path class="mini-goal" d="M0 ${y(goal)}H${W}" vector-effect="non-scaling-stroke"/>` : "",
    dots ? `<path class="mini-dots" d="${dots}" vector-effect="non-scaling-stroke"/>` : "",
    line ? `<path class="mini-trend-line" d="${line}" vector-effect="non-scaling-stroke"/>` : "",
    `<path class="mini-last" d="M${x(lastPoint.t)} ${y(lastPoint.v)}h0" vector-effect="non-scaling-stroke"/>`,
  ];
  return `<svg class="mini-trend" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}

/** Compact axis-less line for tiles (same contract as the legacy charts.ts sparkline). */
export function sparkline(raw: Point[], from: number, to: number): string {
  const points = thin(raw.filter(finite), 60);
  if (!points.length) return "";
  const W = 100;
  const H = 28;
  let [lo, hi] = extent(points.map((p) => p.v));
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const span = to > from ? to - from : 86400;
  const x = (t: number): number => r1(2 + ((t - from) / span) * (W - 4));
  const y = (v: number): number => r1(2 + (1 - (v - lo) / (hi - lo)) * (H - 4));
  const d =
    points.length > 1
      ? `M${points.map((p) => `${x(p.t)} ${y(p.v)}`).join("L")}`
      : `M${x(points[0].t) - 1} ${y(points[0].v)}h2`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}
