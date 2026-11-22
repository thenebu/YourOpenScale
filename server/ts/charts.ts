/** Dependency-free, server-rendered SVG charts for the dashboard.
 * Everything here is pure (no I/O) and emits inline SVG, which the strict CSP
 * allows without scripts. Colours and strokes come from CSS classes in app.css.
 */
export type Point = { t: number; v: number };
export type ChartOptions = {
  /** Visible time window, epoch seconds. */
  from: number;
  to: number;
  /** Accessible name, e.g. "Weight over the last 90 days". */
  label: string;
  /** Plain-text value formatter for tooltips (not HTML-escaped). */
  text: (value: number) => string;
  /** Short formatter for y-axis ticks. */
  axis: (value: number) => string;
  /** Draw a trailing moving average (default true). */
  trend?: boolean;
};

const esc = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const r1 = (x: number) => Math.round(x * 10) / 10;
const DAY = 86400;
/** A weigh-in gap longer than this breaks the line instead of interpolating. */
const GAP_SECONDS = 21 * DAY;

/** Average into at most `max` evenly spaced buckets so long histories stay light. */
export function downsample(points: Point[], max: number): Point[] {
  if (points.length <= max || max < 2) return points;
  const t0 = points[0].t;
  const width = (points[points.length - 1].t - t0) / (max - 1) || 1;
  const buckets = new Map<number, { t: number; v: number; n: number }>();
  for (const p of points) {
    const i = Math.min(max - 1, Math.floor((p.t - t0) / width));
    const b = buckets.get(i) ?? { t: 0, v: 0, n: 0 };
    b.t += p.t;
    b.v += p.v;
    b.n++;
    buckets.set(i, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => ({ t: b.t / b.n, v: b.v / b.n }));
}

/** Trailing average over the last `window` points. */
export function movingAverage(points: Point[], window = 7): Point[] {
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1);
    return { t: p.t, v: slice.reduce((s, q) => s + q.v, 0) / slice.length };
  });
}

export function stats(points: Point[]) {
  if (!points.length) return null;
  let min = points[0].v;
  let max = points[0].v;
  let sum = 0;
  for (const p of points) {
    min = Math.min(min, p.v);
    max = Math.max(max, p.v);
    sum += p.v;
  }
  return {
    min,
    max,
    avg: sum / points.length,
    first: points[0].v,
    last: points[points.length - 1].v,
  };
}

/** "Nice" tick values (1/2/5 × 10^n) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const raw = (max - min) / target;
  if (!(raw > 0) || !Number.isFinite(raw)) return [min];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const first = Math.ceil(min / step - 1e-9);
  const ticks: number[] = [];
  for (let i = first; i * step <= max + step * 1e-9; i++)
    ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "2-digit",
});
const fullFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Split points into runs without long gaps; each run becomes one sub-path. */
function runs(points: Point[]): Point[][] {
  const out: Point[][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && p.t - last[last.length - 1].t <= GAP_SECONDS) last.push(p);
    else out.push([p]);
  }
  return out;
}

export function lineChart(raw: Point[], opts: ChartOptions): string {
  const W = 640;
  const H = 250;
  const m = { l: 46, r: 14, t: 12, b: 26 };
  const points = downsample(raw, 400);
  const trend =
    opts.trend !== false && points.length >= 4 ? movingAverage(points, 7) : [];
  const values = points.map((p) => p.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = hi > lo ? (hi - lo) * 0.12 : Math.abs(hi) * 0.02 || 1;
  lo -= pad;
  hi += pad;
  const from = opts.from;
  const to = opts.to > from ? opts.to : from + DAY;
  const x = (t: number) =>
    r1(m.l + ((t - from) / (to - from)) * (W - m.l - m.r));
  const y = (v: number) =>
    r1(m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b));
  const base = y(lo);

  const grid = niceTicks(lo, hi, 4)
    .map(
      (v) =>
        `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(opts.axis(v))}</text>`,
    )
    .join("");
  const longSpan = to - from > 400 * DAY;
  const xTicks = [0, 1, 2, 3, 4]
    .map((i) => {
      const t = from + ((to - from) * i) / 4;
      const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle";
      return `<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="${anchor}">${esc((longSpan ? monthFormat : dayFormat).format(new Date(t * 1000)))}</text>`;
    })
    .join("");

  const segments = runs(points);
  const line = segments
    .filter((s) => s.length > 1)
    .map((s) => `M${s.map((p) => `${x(p.t)} ${y(p.v)}`).join("L")}`)
    .join("");
  const area = segments
    .filter((s) => s.length > 1)
    .map(
      (s) =>
        `M${x(s[0].t)} ${base}L${s.map((p) => `${x(p.t)} ${y(p.v)}`).join("L")}L${x(s[s.length - 1].t)} ${base}Z`,
    )
    .join("");
  const trendPath = runs(trend)
    .filter((s) => s.length > 1)
    .map((s) => `M${s.map((p) => `${x(p.t)} ${y(p.v)}`).join("L")}`)
    .join("");
  const radius = points.length > 120 ? 2 : 3;
  const dots = points
    .map((p) => {
      const label = `${fullFormat.format(new Date(p.t * 1000))} · ${opts.text(p.v)}`;
      return `<circle class="pt" cx="${x(p.t)}" cy="${y(p.v)}" r="${radius}" data-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
    })
    .join("");
  const last = points[points.length - 1];
  const latest = `Latest: ${fullFormat.format(new Date(last.t * 1000))} · ${opts.text(last.v)}`;
  return `<figure class="chart" data-chart><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}" preserveAspectRatio="xMidYMid meet">${grid}${xTicks}${area ? `<path class="area" d="${area}"/>` : ""}${trendPath ? `<path class="trend" d="${trendPath}"/>` : ""}${line ? `<path class="line" d="${line}"/>` : ""}${dots}</svg><figcaption class="chart-readout" data-default="${esc(latest)}">${esc(latest)}${trendPath ? ' <span class="legend"><i class="swatch line"></i>Measured <i class="swatch trend"></i>7-reading trend</span>' : ""}</figcaption></figure>`;
}

/** Compact axis-less trend line for overview tiles. */
export function sparkline(raw: Point[], from: number, to: number): string {
  const points = downsample(raw, 60);
  if (!points.length) return "";
  const W = 100;
  const H = 28;
  const values = points.map((p) => p.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const span = to > from ? to - from : DAY;
  const x = (t: number) => r1(2 + ((t - from) / span) * (W - 4));
  const y = (v: number) => r1(2 + (1 - (v - lo) / (hi - lo)) * (H - 4));
  const d = runs(points)
    .map((s) =>
      s.length > 1
        ? `M${s.map((p) => `${x(p.t)} ${y(p.v)}`).join("L")}`
        : `M${x(s[0].t) - 1} ${y(s[0].v)}h2`,
    )
    .join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

export type Bar = { label: string; value: number; highlight?: boolean };
/** Simple vertical bar chart; `every` thins the x labels. */
export function barChart(
  bars: Bar[],
  opts: { label: string; unit: string; every?: number },
): string {
  const W = 640;
  const H = 150;
  const m = { l: 30, r: 8, t: 8, b: 22 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const ticks0 = niceTicks(0, max, 3);
  const step = ticks0.length > 1 ? ticks0[1] - ticks0[0] : 1;
  const top =
    ticks0[ticks0.length - 1] < max
      ? ticks0[ticks0.length - 1] + step
      : ticks0[ticks0.length - 1];
  const slot = (W - m.l - m.r) / bars.length;
  const y = (v: number) => r1(m.t + (1 - v / top) * (H - m.t - m.b));
  const grid = niceTicks(0, top, 3)
    .map(
      (v) =>
        `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`,
    )
    .join("");
  const every = opts.every ?? 1;
  const body = bars
    .map((b, i) => {
      const x = r1(m.l + i * slot + slot * 0.15);
      const h = r1(y(0) - y(b.value));
      const text = `${b.label}: ${b.value} ${opts.unit}`;
      return `<rect class="bar${b.highlight ? " hl" : ""}" x="${x}" y="${y(b.value)}" width="${r1(slot * 0.7)}" height="${h}" rx="2"><title>${esc(text)}</title></rect>${i % every === 0 ? `<text class="axis" x="${r1(m.l + i * slot + slot / 2)}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>` : ""}`;
    })
    .join("");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">${grid}${body}</svg></figure>`;
}
