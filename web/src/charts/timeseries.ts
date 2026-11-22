/**
 * Time-series chart (01 §B5, 03 §4.3/§5): LOD dots, min-max / IQR bands, trend, compare overlay,
 * outlier rings, latest/min/max marks, goal line, BMI bands, tooltip, keyboard, reset zoom.
 */
import { extent } from "./extent.ts";
import { formatDate, formatDelta, formatMetric, toDisplay } from "@analysis/format.ts";
import { specFor } from "@analysis/spec.ts";
import { yExtent } from "@analysis/series.ts";
import { trendAt } from "@analysis/trend.ts";
import type { Agg, Bucket, DayPoint, Goal, MetricAnalysis, Outlier, TrendPoint, Unit } from "@analysis/types.ts";
import { readPayload, resolveMetric } from "./data.ts";
import { initChart } from "./echarts.ts";
import type { ECharts } from "./echarts.ts";
import { attachKeyboard } from "./keyboard.ts";
import { chooseLod, lowerBound, slice } from "./lod.ts";
import type { Mounted } from "./mount.ts";
import { baseOption, onThemeChange, prefersReducedMotion, readTheme } from "./theme.ts";
import type { ChartTheme } from "./theme.ts";
import { fixed, t as i18n, tag } from "../i18n/index.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Opt = Record<string, any>;

export type TimeSeriesCtx = {
  unit: Unit;
  /** IANA zone used for tooltip dates and times. */
  zone: string;
  /** [from, to] epoch seconds of the requested range. */
  range?: [number, number];
  goal?: Goal | null;
  compact?: boolean;
  /** Show the range slider (overview main chart only). */
  slider?: boolean;
  /** Draw WHO bands (BMI chart). */
  bands?: "bmi" | null;
};

type NavPoint = {
  t: number;
  v: number;
  kind: "raw" | "daily" | "bucket";
  day?: string;
  bucket?: Bucket;
  dayPoint?: DayPoint;
  outlier?: Outlier["reason"];
};

const DAY = 86400;
const outlierText = (reason: Outlier["reason"]): string => i18n(`chart.outlier.${reason}`);
const BMI_BANDS = [
  { from: -Infinity, to: 18.5, name: "chart.bmi.under", color: "bmiUnder" },
  { from: 18.5, to: 25, name: "chart.bmi.normal", color: "bmiNormal" },
  { from: 25, to: 30, name: "chart.bmi.over", color: "bmiOver" },
  { from: 30, to: Infinity, name: "chart.bmi.obese", color: "bmiObese" },
] as const;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Multiplies the alpha of a #rrggbbaa colour; other formats pass through. */
function scaleAlpha(color: string, k: number): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!m) return color;
  const a = Math.min(255, Math.round(parseInt(m[2] ?? "ff", 16) * k));
  return `#${m[1]}${a.toString(16).padStart(2, "0")}`;
}

function niceAxis(lo: number, hi: number): { min: number; max: number; step: number; decimals: number } {
  const span = hi - lo > 0 ? hi - lo : 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 3 ? 2.5 : norm <= 6 ? 5 : 10) * mag;
  const fix = (x: number) => Number(x.toFixed(8));
  const decimals = (String(fix(step)).split(".")[1] ?? "").length;
  return { min: fix(Math.floor(lo / step) * step), max: fix(Math.ceil(hi / step) * step), step: fix(step), decimals };
}

export function mountTimeSeries(el: HTMLElement, metric: MetricAnalysis, ctx: TimeSeriesCtx): Mounted & { chart: ECharts } {
  const spec = specFor(metric.type);
  const isMass = spec?.unit === "kg";
  const compact = !!ctx.compact;
  const unit = ctx.unit;
  const disp = (v: number) => (isMass ? toDisplay(v, unit) : v);
  const fmt = (v: number) => formatMetric(v, metric.type, unit, isMass ? { decimals: 1 } : {});
  const plain = (v: number, decimals = 1) => {
    const d = Number.isFinite(v) ? v : 0;
    return fixed(d, decimals);
  };
  const bands = ctx.bands ?? (metric.type === -1 ? "bmi" : null);

  let theme: ChartTheme = readTheme();
  let reducedMotion = prefersReducedMotion();

  // ---- domain and window (epoch seconds) ----
  const ends = [
    ...metric.lod.daily.slice(0, 1).map((d) => d.t), ...metric.lod.daily.slice(-1).map((d) => d.t),
    ...metric.trend.slice(0, 1).map((p) => p.t), ...metric.trend.slice(-1).map((p) => p.t),
    ...(ctx.range ?? []),
  ];
  let [dMin, dMax] = ends.length ? extent(ends) : [0, DAY];
  if (ctx.range) [dMin, dMax] = [Math.min(dMin, ctx.range[0]), Math.max(dMax, ctx.range[1])];
  if (dMax - dMin < DAY) dMax = dMin + DAY;
  const minSpan = Math.min(7 * DAY, dMax - dMin);
  let win: [number, number] = [dMin, dMax];
  let agg: Agg = "daily";

  // ---- navigation lists per LOD (full, unsliced; built lazily) ----
  const outlierIds = new Set(metric.outliers.map((o) => o.readingId));
  const navCache = new Map<Agg, NavPoint[]>();
  const navList = (a: Agg): NavPoint[] => {
    let list = navCache.get(a);
    if (list) return list;
    const out: NavPoint[] = [];
    if (a === "raw" && metric.lod.raw) {
      for (const r of metric.lod.raw) if (!outlierIds.has(r.id)) out.push({ t: r.t, v: r.v, kind: "raw" });
    } else if (a === "daily") {
      for (const d of metric.lod.daily) out.push({ t: d.t, v: d.v, kind: "daily", day: d.day, dayPoint: d });
    } else if (a === "weekly" || a === "monthly") {
      for (const b of metric.lod[a]) out.push({ t: b.t, v: b.mean, kind: "bucket", bucket: b });
    }
    for (const o of metric.outliers) out.push({ t: o.t, v: o.v, kind: a === "raw" ? "raw" : "daily", outlier: o.reason });
    list = out.sort((x, y) => x.t - y.t);
    navCache.set(a, list);
    return list;
  };

  // ---- tooltip content ----
  const longDate = (t: number) => {
    const parts = new Intl.DateTimeFormat(tag(), {
      weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: safeZone(ctx.zone),
    }).format(new Date(t * 1000));
    return parts.replace(/^(\p{L}+) /u, "$1, ");
  };
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(tag(), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${day}T12:00:00Z`)).replace(/^(\p{L}+) /u, "$1, ");

  type Tip = { title: string; rows: { swatch: "dot" | "line" | "none"; color: string; label: string; value: string }[]; notes: string[]; warn: string | null };
  const tipFor = (list: NavPoint[], i: number): Tip => {
    const p = list[i];
    const rows: Tip["rows"] = [];
    const notes: string[] = [];
    let title: string;
    if (p.kind === "bucket" && p.bucket) {
      const b = p.bucket;
      title = b.key.includes("W")
        ? i18n("chart.weekOf", { date: formatDate(b.start, "UTC", "short") })
        : formatDate(b.t, "UTC", "month");
      rows.push({ swatch: "dot", color: theme.trend, label: i18n("chart.mean", { label: metric.label }), value: fmt(b.mean) });
      notes.push(i18n("chart.rangeNote", { min: fmt(b.min), max: fmt(b.max), n: b.n }));
    } else {
      title = p.day && !p.outlier ? dayLabel(p.day) : longDate(p.t);
      if (p.kind === "raw" || p.outlier) title += ` · ${formatDate(p.t, safeZone(ctx.zone), "time")}`;
      rows.push({ swatch: "dot", color: theme.accent, label: metric.label, value: fmt(p.v) });
    }
    const trend = trendAt(metric.trend, p.t);
    if (trend !== null && !p.outlier) rows.push({ swatch: "line", color: theme.trend, label: i18n("chart.trend"), value: fmt(trend) });
    if (p.kind !== "bucket" && !p.outlier) {
      let j = i - 1;
      while (j >= 0 && list[j].outlier) j--;
      if (j >= 0) {
        const gap = p.t - list[j].t;
        const when = gap < DAY ? i18n("chart.hoursEarlier", { n: Math.max(1, Math.round(gap / 3600)) })
          : i18n("chart.daysEarlier", { n: Math.round(gap / DAY) });
        rows.push({ swatch: "none", color: "", label: i18n("chart.deltaPrevious"), value: `${formatDelta(p.v - list[j].v, metric.type, unit)} (${when})` });
      }
      if (trend !== null) rows.push({ swatch: "none", color: "", label: i18n("chart.deltaTrend"), value: formatDelta(p.v - trend, metric.type, unit) });
    }
    return { title, rows, notes, warn: p.outlier ? i18n("chart.outlierNote", { reason: outlierText(p.outlier) }) : null };
  };
  const tipHtml = (t: Tip) =>
    `<div class="tt"><div class="tt-title">${esc(t.title)}</div>` +
    t.rows.map((r) =>
      `<div class="tt-row"><span class="tt-key">${r.swatch === "none" ? "" : `<i class="tt-${r.swatch}" style="background:${esc(r.color)}"></i>`}${esc(r.label)}</span><span class="tt-val">${esc(r.value)}</span></div>`,
    ).join("") +
    t.notes.map((n) => `<div class="tt-note">${esc(n)}</div>`).join("") +
    (t.warn ? `<div class="tt-warn">${esc(t.warn)}</div>` : "") + "</div>";
  const tipPlain = (t: Tip) =>
    [t.title, ...t.rows.map((r) => `${r.label} ${r.value}`), ...t.notes, ...(t.warn ? [t.warn] : [])].join(". ");

  const nearest = (list: NavPoint[], tSec: number): number => {
    if (!list.length) return -1;
    const k = lowerBound(list, tSec, (p) => p.t);
    if (k <= 0) return 0;
    if (k >= list.length) return list.length - 1;
    return tSec - list[k - 1].t <= list[k].t - tSec ? k - 1 : k;
  };

  // ---- series for the current window ----
  type View = { series: Opt[]; lo: number; hi: number; step: number; decimals: number };
  function buildView(): View {
    const [a, b] = win;
    const list = navList(agg);
    const visible = slice(list, a, b, (p) => p.t, 1);
    const inWin = (t: number) => t >= a && t <= b;
    const trendWin = slice(metric.trend, a, b, (p) => p.t, 1);
    const goalKg = ctx.goal && metric.type === 1 ? ctx.goal.kg : null;

    // y extent over visible, non-outlier values + trend + goal (native units)
    const values: number[] = [];
    for (const p of list) {
      if (!inWin(p.t) || p.outlier) continue;
      if (p.bucket) values.push(p.bucket.min, p.bucket.max);
      else values.push(p.v);
    }
    for (const p of trendWin) if (inWin(p.t)) values.push(p.v);
    if (goalKg !== null) values.push(goalKg);
    let [lo, hi]: [number, number] = values.length && spec ? yExtent(values, spec) : [...metric.yExtent];
    lo = disp(lo);
    hi = disp(hi);
    const axis = niceAxis(lo, hi);
    lo = axis.min;
    hi = axis.max;
    const clampV = (v: number) => Math.min(hi, Math.max(lo, v));

    const x = (t: number) => t * 1000;
    const common = { silent: true, clip: true, animation: false } as const;
    const series: Opt[] = [];

    if (agg === "weekly" || agg === "monthly") {
      const bs = visible.filter((p) => p.bucket).map((p) => p.bucket!);
      const stackSeries = (id: string, stack: string, base: (b: Bucket) => number, size: (b: Bucket) => number, fill: string) => {
        series.push({ ...common, id: `${id}-base`, type: "line", stack, symbol: "none", z: 1, lineStyle: { opacity: 0 }, data: bs.map((b) => [x(b.t), disp(base(b))]) });
        series.push({ ...common, id, type: "line", stack, symbol: "none", z: 1, lineStyle: { opacity: 0 }, areaStyle: { color: fill, opacity: 1 }, data: bs.map((b) => [x(b.t), disp(base(b) + size(b)) - disp(base(b))]) });
      };
      stackSeries("band-range", "range", (b) => b.min, (b) => b.max - b.min, theme.band);
      stackSeries("band-iqr", "iqr", (b) => b.p25, (b) => b.p75 - b.p25, scaleAlpha(theme.band, 2));
    }

    if (metric.compare) {
      series.push({
        ...common, id: "compare", type: "line", symbol: "none", z: 2, name: metric.compare.label,
        lineStyle: { color: theme.compare, width: 1.5 },
        data: slice(metric.compare.series, a, b, (p) => p.t, 1).map((p) => [x(p.t), disp(p.v)]),
      });
    }

    // trend, one series per segment; dashed connectors across gaps
    const segments = new Map<number, TrendPoint[]>();
    for (const p of trendWin) {
      const s = segments.get(p.segment);
      if (s) s.push(p);
      else segments.set(p.segment, [p]);
    }
    const ordered = [...segments.entries()].sort((p, q) => p[0] - q[0]);
    ordered.forEach(([seg, pts], k) => {
      series.push({
        ...common, id: `trend-${seg}`, type: "line", symbol: "none", smooth: false, connectNulls: false,
        sampling: "lttb", z: 4, lineStyle: { color: theme.trend, width: 2.5 },
        data: pts.map((p) => [x(p.t), disp(p.v)]),
      });
      const next = ordered[k + 1];
      if (next) {
        const end = pts[pts.length - 1];
        const start = next[1][0];
        series.push({
          ...common, id: `gap-${seg}`, type: "line", symbol: "none", z: 2,
          lineStyle: { color: theme.compare, width: 1, type: [4, 4] },
          data: [[x(end.t), disp(end.v)], [x(start.t), disp(start.v)]],
        });
      }
    });

    // dots (raw / daily / bucket mean) and outlier rings
    const dots = visible.filter((p) => !p.outlier);
    series.push({
      id: "dots", type: "scatter", clip: true, animation: false, z: 3, cursor: "default", emphasis: { disabled: true },
      symbolSize: agg === "weekly" || agg === "monthly" ? 4 : 5,
      itemStyle: { color: agg === "weekly" || agg === "monthly" ? theme.trend : theme.raw, borderWidth: 0 },
      data: dots.map((p) => [x(p.t), disp(p.v)]),
    });
    const rings = metric.outliers.filter((o) => inWin(o.t));
    series.push({
      ...common, id: "outliers", type: "scatter", z: 5,
      data: rings.map((o) => {
        const v = disp(o.v);
        const out = v > hi ? 1 : v < lo ? -1 : 0;
        return {
          value: [x(o.t), clampV(v)],
          symbol: out ? "path://M-1,0.6 L0,-0.6 L1,0.6" : "circle",
          symbolSize: out ? 9 : 8,
          symbolRotate: out < 0 ? 180 : 0,
          itemStyle: out
            ? { color: "none", borderColor: theme.outlier, borderWidth: 1.5 }
            : { color: "transparent", borderColor: theme.outlier, borderWidth: 1.5 },
        };
      }),
    });

    // marks: latest / min / max, goal, BMI bands
    const marks: Opt = { ...common, id: "marks", type: "scatter", z: 6, data: [] };
    const stats = metric.stats;
    const points: Opt[] = [];
    if (stats && inWin(stats.latest.t)) {
      points.push({
        coord: [x(stats.latest.t), disp(stats.latest.v)], symbol: "circle", symbolSize: 10,
        itemStyle: { color: theme.accent, borderColor: theme.surface, borderWidth: 3 },
        label: { show: true, position: "right", distance: 8, formatter: plain(disp(stats.latest.v)), color: theme.text, fontSize: 12, fontWeight: 600 },
      });
    }
    if (stats && !compact) {
      for (const [m, vertical] of [[stats.max, "top"], [stats.min, "bottom"]] as const) {
        if (!inWin(m.t) || (m.t === stats.latest.t && m.v === stats.latest.v)) continue;
        const pos = m.t < a + (b - a) * 0.06 ? "right" : vertical; // keep labels off the y-axis text
        points.push({
          coord: [x(m.t), disp(m.v)], symbol: "circle", symbolSize: 7,
          itemStyle: { color: theme.surface, borderColor: theme.textMuted, borderWidth: 1.5 },
          label: { show: true, position: pos, distance: 4, formatter: plain(disp(m.v)), color: theme.textSubtle, fontSize: 12 },
        });
      }
    }
    marks.markPoint = { silent: true, animation: false, data: points };
    if (goalKg !== null) {
      marks.markLine = {
        silent: true, symbol: "none", animation: false,
        lineStyle: { color: theme.goal, width: 1.5, type: [6, 4] },
        label: { show: true, position: "insideStartTop", formatter: i18n("chart.goal", { value: plain(disp(goalKg)) }), color: theme.goal, fontSize: 12 },
        data: [{ yAxis: disp(goalKg) }],
      };
    }
    if (bands === "bmi") {
      marks.markArea = {
        silent: true, animation: false,
        data: BMI_BANDS.filter((band) => band.to > lo && band.from < hi).map((band) => [
          {
            yAxis: Math.max(lo, band.from), name: i18n(band.name), itemStyle: { color: theme[band.color] },
            label: { show: true, position: "insideBottomLeft", color: theme.textSubtle, fontSize: 12 },
          },
          { yAxis: Math.min(hi, band.to) },
        ]),
      };
    }
    series.push(marks);
    return { series, lo, hi, step: axis.step, decimals: axis.decimals };
  }

  // ---- full option ----
  const sliderOn = !!ctx.slider && !compact;
  const pct = (t: number) => ((t - dMin) / (dMax - dMin)) * 100;
  let view = buildView();

  const fullOption = (): Opt => ({
    ...baseOption(theme, { reducedMotion }),
    animationDurationUpdate: 0,
    grid: { left: 44, right: 52, top: 16, bottom: sliderOn ? 60 : 24 },
    tooltip: {
      ...(baseOption(theme, { reducedMotion }) as Opt).tooltip,
      trigger: "axis", triggerOn: "mousemove|click",
      extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);",
      formatter: (params: Opt | Opt[]) => {
        const first = Array.isArray(params) ? params[0] : params;
        const axisMs = Number(first?.axisValue);
        const list = navList(agg);
        const i = nearest(list, axisMs / 1000);
        if (i < 0) return "";
        cursorT = list[i].t;
        const tip = tipFor(list, i);
        return tipHtml(tip);
      },
    },
    xAxis: {
      type: "time", min: dMin * 1000, max: dMax * 1000,
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: {
        hideOverlap: true, fontSize: 12, color: theme.axis, margin: 10,
        formatter: { year: "{MMM} '{yy}", month: "{MMM} '{yy}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}", second: "{HH}:{mm}:{ss}", millisecond: "{HH}:{mm}:{ss}", none: "{d} {MMM}" },
      },
      axisPointer: { type: "line", snap: true, label: { show: false }, lineStyle: { color: theme.crosshair, width: 1 } },
    },
    yAxis: {
      type: "value", scale: true, min: view.lo, max: view.hi, interval: view.step,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: theme.grid, width: 1, type: "solid" } },
      axisLabel: { fontSize: 12, color: theme.axis, margin: 8, formatter: (v: number) => plain(v, view.decimals) },
    },
    dataZoom: compact ? [] : [
      {
        type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: "ctrl", moveOnMouseMove: true,
        moveOnMouseWheel: false, preventDefaultMouseMove: false, minValueSpan: minSpan * 1000,
        start: pct(win[0]), end: pct(win[1]),
      },
      ...(sliderOn ? [{
        type: "slider", xAxisIndex: 0, filterMode: "none", height: 24, bottom: 8, brushSelect: false,
        showDetail: false, showDataShadow: false, minValueSpan: minSpan * 1000,
        borderColor: "transparent", backgroundColor: theme.grid, fillerColor: theme.band,
        handleStyle: { color: theme.surface, borderColor: theme.textSubtle, borderWidth: 1 },
        moveHandleStyle: { color: theme.textSubtle }, dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
        start: pct(win[0]), end: pct(win[1]),
      }] : []),
    ],
    series: view.series,
  });

  const chart = initChart(el);
  let cursorT: number | null = null;
  el.tabIndex = 0;
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", i18n("chart.ariaLabel", { label: metric.label }));
  const summary = el.closest(".chart-card")?.querySelector<HTMLElement>(".chart-summary");
  if (summary) {
    summary.id ||= `chart-summary-${Math.random().toString(36).slice(2, 8)}`;
    el.setAttribute("aria-describedby", summary.id);
  }

  let resetBtn: HTMLButtonElement | null = null;
  const updateReset = () => {
    if (resetBtn) resetBtn.hidden = win[0] <= dMin + 1 && win[1] >= dMax - 1;
  };
  const setWindow = (a: number, b: number) => {
    a = Math.max(dMin, a);
    b = Math.min(dMax, b);
    if (b - a < minSpan) return;
    chart.dispatchAction({ type: "dataZoom", start: pct(a), end: pct(b) });
    win = [a, b];
    refresh();
  };
  const reset = () => setWindow(dMin, dMax);

  function refresh() {
    clearTimeout(timer);
    agg = chooseLod(metric, win[0], win[1]);
    view = buildView();
    chart.setOption(
      {
        series: view.series,
        yAxis: {
          min: view.lo, max: view.hi, interval: view.step,
          axisLabel: { formatter: (v: number) => plain(v, view.decimals) },
        },
      },
      { replaceMerge: ["series"] },
    );
    updateReset();
  }
  let timer = 0;
  const onZoom = () => {
    const dz = (chart.getOption() as Opt).dataZoom?.[0];
    if (dz) win = [dMin + ((dMax - dMin) * dz.start) / 100, dMin + ((dMax - dMin) * dz.end) / 100];
    clearTimeout(timer);
    timer = window.setTimeout(refresh, 120);
  };

  agg = chooseLod(metric, win[0], win[1]);
  view = buildView();
  chart.setOption(fullOption(), true);
  if (!compact) {
    chart.on("datazoom", onZoom);
    chart.getZr().on("dblclick", reset);
    const tools = el.closest(".chart-card")?.querySelector<HTMLElement>(".chart-tools");
    if (tools || el.parentElement) {
      resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn-ghost btn-sm";
      resetBtn.textContent = i18n("chart.resetZoom");
      resetBtn.hidden = true;
      resetBtn.addEventListener("click", reset);
      if (tools) tools.append(resetBtn);
      else {
        const holder = document.createElement("div");
        holder.className = "chart-tools";
        holder.append(resetBtn);
        el.before(holder);
      }
    }
  }

  const keyboard = attachKeyboard(el, {
    count: () => navList(agg).length,
    cursor: () => (cursorT === null ? -1 : nearest(navList(agg), cursorT)),
    show: (i) => {
      const list = navList(agg);
      const p = list[i];
      if (p.t < win[0] || p.t > win[1]) {
        const span = win[1] - win[0];
        const a = Math.min(Math.max(dMin, p.t - span / 2), dMax - span);
        setWindow(a, a + span);
      }
      const j = nearest(navList(agg), p.t);
      const q = navList(agg)[j];
      cursorT = q.t;
      const px = chart.convertToPixel({ xAxisIndex: 0 }, q.t * 1000) as number;
      const py = chart.convertToPixel({ yAxisIndex: 0 }, disp(q.v)) as number;
      chart.dispatchAction({ type: "showTip", x: px, y: Math.min(Math.max(py, 0), el.clientHeight) });
      return tipPlain(tipFor(navList(agg), j));
    },
    hide: () => chart.dispatchAction({ type: "hideTip" }),
    zoom: (dir) => {
      if (compact) return;
      const span = win[1] - win[0];
      const mid = cursorT !== null && cursorT >= win[0] && cursorT <= win[1] ? cursorT : (win[0] + win[1]) / 2;
      const next = Math.min(dMax - dMin, Math.max(minSpan, dir > 0 ? span / 2 : span * 2));
      const a = Math.min(Math.max(dMin, mid - next / 2), dMax - next);
      setWindow(a, a + next);
    },
  });

  const stopTheme = onThemeChange(() => {
    theme = readTheme();
    reducedMotion = prefersReducedMotion();
    view = buildView();
    chart.setOption(fullOption(), { replaceMerge: ["series"] });
  });

  return {
    chart,
    dispose: () => {
      clearTimeout(timer);
      stopTheme();
      keyboard();
      resetBtn?.remove();
    },
  };
}

function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat(tag(), { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** Island adapter: <div data-island="timeseries" data-payload="id" data-metric="weight" [data-compact] [data-slider]>. */
export function mountTimeSeriesIsland(el: HTMLElement): Mounted {
  const payload = readPayload(el.dataset.payload ?? "");
  if (!payload) throw new Error(`payload "${el.dataset.payload}" not found`);
  const name = el.dataset.metric ?? "weight";
  const metric = resolveMetric(payload, name);
  if (!metric) throw new Error(`metric "${name}" not in payload`);
  return mountTimeSeries(el, metric, {
    unit: payload.unit,
    zone: el.dataset.zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    range: payload.range ? [payload.range.from, payload.range.to] : undefined,
    goal: name === "weight" ? payload.goal : null,
    compact: el.hasAttribute("data-compact"),
    slider: el.hasAttribute("data-slider"),
    bands: name === "bmi" ? "bmi" : null,
  });
}
