/**
 * Category-axis charts (03 §5): weekly-rate diverging bars, weekday / time-of-day effect bars with
 * whiskers, and weigh-in count bars. Also hosts the small kit shared by the other WP-09 modules
 * (tooltip markup, chart set-up with theme + keyboard, alpha scaling, payload helpers).
 */
import { formatDate, formatDelta, formatRate, toDisplay } from "@analysis/format.ts";
import type { Goal, TimeOfDayEffect, Unit, WeekdayEffect } from "@analysis/types.ts";
import { readPayload, resolveMetric } from "./data.ts";
import type { WireAnalysis } from "./data.ts";
import { initChart } from "./echarts.ts";
import type { ECharts } from "./echarts.ts";
import { attachKeyboard } from "./keyboard.ts";
import type { Mounted } from "./mount.ts";
import { baseOption, onThemeChange, prefersReducedMotion, readTheme } from "./theme.ts";
import type { ChartTheme } from "./theme.ts";
import { fixed, t as i18n } from "../i18n/index.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Opt = Record<string, any>;

// ---------------------------------------------------------------------------------------------
// Shared kit
// ---------------------------------------------------------------------------------------------

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Multiplies the alpha of a #rrggbb[aa] colour; other formats pass through. */
export function scaleAlpha(color: string, k: number): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!m) return color;
  const a = Math.min(255, Math.max(0, Math.round(parseInt(m[2] ?? "ff", 16) * k)));
  return `#${m[1]}${a.toString(16).padStart(2, "0")}`;
}

export const plain = (v: number, decimals = 1): string => fixed(v, decimals);

export function niceAxis(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number; decimals: number } {
  const span = hi - lo > 0 ? hi - lo : 1;
  const raw = span / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 3 ? 2.5 : norm <= 6 ? 5 : 10) * mag;
  const fix = (x: number) => Number(x.toFixed(8));
  const decimals = (String(fix(step)).split(".")[1] ?? "").length;
  return { min: fix(Math.floor(lo / step + 1e-9) * step), max: fix(Math.ceil(hi / step - 1e-9) * step), step: fix(step), decimals };
}

export type Tip = {
  title: string;
  rows: { swatch: "dot" | "line" | "none"; color: string; label: string; value: string }[];
  notes: string[];
  warn?: string | null;
};

export function tipHtml(t: Tip): string {
  return (
    `<div class="tt"><div class="tt-title">${esc(t.title)}</div>` +
    t.rows.map((r) =>
      `<div class="tt-row"><span class="tt-key">${r.swatch === "none" ? "" : `<i class="tt-${r.swatch}" style="background:${esc(r.color)}"></i>`}${esc(r.label)}</span><span class="tt-val">${esc(r.value)}</span></div>`,
    ).join("") +
    t.notes.map((n) => `<div class="tt-note">${esc(n)}</div>`).join("") +
    (t.warn ? `<div class="tt-warn">${esc(t.warn)}</div>` : "") + "</div>"
  );
}

export const tipPlain = (t: Tip): string =>
  [t.title, ...t.rows.map((r) => `${r.label} ${r.value}`), ...t.notes, ...(t.warn ? [t.warn] : [])].join(". ");

/** Reads the analysis payload named by data-payload; throws a clear error when missing. */
export function payloadOf(el: HTMLElement): WireAnalysis {
  const p = readPayload(el.dataset.payload ?? "");
  if (!p) throw new Error(`payload "${el.dataset.payload}" not found`);
  return p;
}

export type ChartSpec = {
  /** Accessible name; the keyboard hint is appended. */
  label: string;
  /** Option without tooltip / base text settings (those are merged in). Called again on theme change. */
  build: (theme: ChartTheme, reducedMotion: boolean) => Opt;
  /** Number of keyboard stops. */
  count: () => number;
  tip: (i: number) => Tip;
  /** Index of the hovered point from tooltip params. Default: params[0].dataIndex. */
  indexOf?: (params: Opt | Opt[]) => number;
  /** Shows the tooltip for stop i. Default: series 0, data index i. */
  show?: (chart: ECharts, i: number) => void;
  trigger?: "axis" | "item";
  /** Rebuild the option when the container width changes (for size-dependent layouts). */
  responsive?: boolean;
  className?: string;
};

export function setupChart(el: HTMLElement, spec: ChartSpec): Mounted & { chart: ECharts } {
  let theme = readTheme();
  let reduced = prefersReducedMotion();
  let cursor = -1;
  if (spec.className) el.classList.add(spec.className);

  const chart = initChart(el);
  const option = (): Opt => {
    const base = baseOption(theme, { reducedMotion: reduced }) as Opt;
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: spec.trigger ?? "axis",
        triggerOn: "mousemove|click",
        extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);",
        formatter: (params: Opt | Opt[]) => {
          const i = spec.indexOf ? spec.indexOf(params) : Number((Array.isArray(params) ? params[0] : params)?.dataIndex);
          if (!(i >= 0)) return "";
          cursor = i;
          return tipHtml(spec.tip(i));
        },
      },
      ...spec.build(theme, reduced),
    };
  };
  const apply = () => {
    chart.setOption(option(), true);
    chart.resize(); // layouts that set the container height inside build()
  };

  el.tabIndex = 0;
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", i18n("chart.ariaLabelPlain", { label: spec.label }));
  const summary = el.closest(".chart-card")?.querySelector<HTMLElement>(".chart-summary");
  if (summary) {
    summary.id ||= `chart-summary-${Math.random().toString(36).slice(2, 8)}`;
    el.setAttribute("aria-describedby", summary.id);
  }
  apply();

  const stopTheme = onThemeChange(() => {
    theme = readTheme();
    reduced = prefersReducedMotion();
    apply();
  });
  let ro: ResizeObserver | undefined;
  if (spec.responsive && typeof ResizeObserver !== "undefined") {
    let w = el.clientWidth;
    ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      apply();
      chart.resize();
    });
    ro.observe(el);
  }
  const keyboard = attachKeyboard(el, {
    count: spec.count,
    cursor: () => cursor,
    show: (i) => {
      cursor = i;
      if (spec.show) spec.show(chart, i);
      else chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: i });
      return tipPlain(spec.tip(i));
    },
    hide: () => chart.dispatchAction({ type: "hideTip" }),
    zoom: () => {},
  });
  return {
    chart,
    dispose: () => {
      stopTheme();
      ro?.disconnect();
      keyboard();
    },
  };
}

/** Shared axis look for category charts. */
export function categoryX(theme: ChartTheme, data: string[], extra: Opt = {}): Opt {
  return {
    type: "category", data,
    axisLine: { lineStyle: { color: theme.grid } }, axisTick: { show: false }, splitLine: { show: false },
    axisLabel: { fontSize: 12, color: theme.axis, margin: 8, hideOverlap: true, ...(extra.axisLabel ?? {}) },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "axisLabel")),
  };
}

export function valueY(theme: ChartTheme, lo: number, hi: number, step: number, decimals: number, extra: Opt = {}): Opt {
  return {
    type: "value", min: lo, max: hi, interval: step,
    axisLine: { show: false }, axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: theme.grid, width: 1, type: "solid" } },
    axisLabel: { fontSize: 12, color: theme.axis, margin: 8, formatter: (v: number) => plain(v, decimals) },
    ...extra,
  };
}

const MINUS = "−";
const signedPlain = (v: number, d = 1) => `${v < 0 ? MINUS : v > 0 ? "+" : ""}${plain(Math.abs(v), d)}`;

// ---------------------------------------------------------------------------------------------
// Diverging bars: weekly rate of change
// ---------------------------------------------------------------------------------------------

export type DivergingCtx = { unit: Unit; goal?: Goal | null; trendNowKg?: number | null; label?: string };

/** points: [epoch seconds (week midpoint, Thursday), kg per week][] */
export function mountDivergingBars(el: HTMLElement, points: [number, number][], ctx: DivergingCtx): Mounted & { chart: ECharts } {
  const dir = ctx.goal && ctx.trendNowKg != null ? Math.sign(ctx.goal.kg - ctx.trendNowKg) : 0;
  const kind = (v: number): "good" | "bad" | "neutral" =>
    !dir || v === 0 ? "neutral" : Math.sign(v) === dir ? "good" : "bad";
  const disp = (v: number) => toDisplay(v, ctx.unit);
  const span = points.length > 1 ? (points[points.length - 1][0] - points[0][0]) / 86400 : 0;
  const longLabel = (t: number) =>
    formatDate(t, "UTC", "short") + (span > 330 ? ` ’${String(new Date(t * 1000).getUTCFullYear()).slice(2)}` : "");
  const weekStart = (t: number) => t - 3 * 86400;
  const labels = points.map((p) => longLabel(weekStart(p[0])));

  const tip = (i: number): Tip => {
    const [t, v] = points[i];
    const k = kind(v);
    const notes: string[] = [];
    if (k === "good") notes.push(i18n("chart.toGoal"));
    else if (k === "bad") notes.push(i18n("chart.awayGoal"));
    return {
      title: i18n("chart.weekOf", { date: formatDate(weekStart(t), "UTC", "medium") }),
      rows: [{ swatch: "none", color: "", label: i18n("chart.trendChange"), value: formatRate(v, ctx.unit) }],
      notes,
    };
  };
  return setupChart(el, {
    label: ctx.label ?? i18n("chart.rateLabel"),
    className: "chart--bars",
    count: () => points.length,
    tip,
    build: (theme) => {
      const m = Math.max(0.1, ...points.map((p) => Math.abs(disp(p[1]))));
      const ax = niceAxis(-m, m, 4);
      const hi = Math.max(Math.abs(ax.min), Math.abs(ax.max));
      const colors = { good: theme.accent, bad: theme.goal, neutral: theme.compare };
      const decal = { symbol: "rect", symbolSize: 1, rotation: Math.PI / 4, dashArrayX: [1, 0], dashArrayY: [2, 4], color: theme.bg };
      return {
        grid: { left: 44, right: 12, top: 12, bottom: 28 },
        xAxis: categoryX(theme, labels, { axisLine: { show: false }, axisLabel: { margin: 10 } }),
        yAxis: valueY(theme, -hi, hi, ax.step, ax.decimals),
        series: [{
          type: "bar", barMaxWidth: 14, barCategoryGap: "25%", animation: false,
          data: points.map((p) => {
            const k = kind(p[1]);
            return { value: Number(disp(p[1]).toFixed(3)), itemStyle: { color: colors[k], decal: k === "bad" ? decal : undefined } };
          }),
          emphasis: { itemStyle: { opacity: 0.8 } },
          markLine: {
            silent: true, symbol: "none", label: { show: false }, animation: false,
            lineStyle: { color: theme.axis, width: 1, type: "solid" }, data: [{ yAxis: 0 }],
          },
        }],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Effect bars with whiskers: weekday / time of day
// ---------------------------------------------------------------------------------------------

export type EffectItem = { label: string; sub?: string; mean: number; se: number; n: number };
export type EffectCtx = { unit: Unit; label: string; baseline?: string };

/** mean and se are in kg (deviation from the centred baseline); whiskers are ±1.96·se. */
export function mountEffectBars(el: HTMLElement, items: EffectItem[], ctx: EffectCtx): Mounted & { chart: ECharts } {
  const disp = (v: number) => toDisplay(v, ctx.unit);
  const tip = (i: number): Tip => {
    const it = items[i];
    const half = 1.96 * it.se;
    return {
      title: it.sub ? `${it.label} · ${it.sub}` : it.label,
      rows: [
        { swatch: "none", color: "", label: ctx.baseline ?? i18n("chart.typicalDiff"), value: formatDelta(it.mean, 1, ctx.unit) },
        { swatch: "none", color: "", label: i18n("chart.range95"), value: i18n("chart.range", { from: formatDelta(it.mean - half, 1, ctx.unit), to: formatDelta(it.mean + half, 1, ctx.unit) }) },
      ],
      notes: [i18n("chart.readings", { n: it.n })],
    };
  };
  return setupChart(el, {
    label: ctx.label,
    className: "chart--bars",
    count: () => items.length,
    tip,
    build: (theme) => {
      const m = Math.max(0.1, ...items.map((it) => disp(Math.abs(it.mean) + 1.96 * it.se)));
      const ax = niceAxis(-m, m, 4);
      const hi = Math.max(Math.abs(ax.min), Math.abs(ax.max));
      return {
        grid: { left: 44, right: 12, top: 12, bottom: 28 },
        xAxis: categoryX(theme, items.map((it) => it.label), { axisLine: { show: false }, axisLabel: { margin: 10, interval: 0 } }),
        yAxis: valueY(theme, -hi, hi, ax.step, ax.decimals),
        series: [
          {
            type: "bar", barMaxWidth: 36, animation: false,
            itemStyle: { color: theme.trend, borderRadius: 0 },
            data: items.map((it) => ({
              value: Number(disp(it.mean).toFixed(3)),
              itemStyle: { color: it.mean < 0 ? theme.compare : theme.trend },
            })),
            markLine: {
              silent: true, symbol: "none", label: { show: false }, animation: false,
              lineStyle: { color: theme.axis, width: 1, type: "solid" }, data: [{ yAxis: 0 }],
            },
          },
          {
            type: "custom", silent: true, z: 5, animation: false, tooltip: { show: false },
            data: items.map((it, i) => [i, disp(it.mean - 1.96 * it.se), disp(it.mean + 1.96 * it.se)]),
            encode: { x: 0, y: [1, 2] },
            renderItem: (_p: Opt, api: Opt) => {
              const x = api.coord([api.value(0), api.value(2)]);
              const lo = api.coord([api.value(0), api.value(1)]);
              const style = { stroke: theme.text, lineWidth: 1.5 };
              return {
                type: "group",
                children: [
                  { type: "line", shape: { x1: x[0], y1: x[1], x2: x[0], y2: lo[1] }, style },
                  { type: "line", shape: { x1: x[0] - 5, y1: x[1], x2: x[0] + 5, y2: x[1] }, style },
                  { type: "line", shape: { x1: x[0] - 5, y1: lo[1], x2: x[0] + 5, y2: lo[1] }, style },
                ],
              };
            },
          },
        ],
      };
    },
  });
}

const slotLabel = (slot: TimeOfDayEffect["slot"]): string => i18n(`chart.slot.${slot}`);
const hh = (h: number) => String(h % 24).padStart(2, "0");

// ---------------------------------------------------------------------------------------------
// Count bars: weigh-ins by hour
// ---------------------------------------------------------------------------------------------

export type CountCtx = { label?: string; highlight?: [number, number] };

/** counts: 24 values (local hour 0..23). highlight: [fromHour, toHour) drawn in the accent colour. */
export function mountCountBars(el: HTMLElement, counts: number[], ctx: CountCtx = {}): Mounted & { chart: ECharts } {
  const [h0, h1] = ctx.highlight ?? [4, 10];
  const total = counts.reduce((a, b) => a + b, 0);
  const tip = (i: number): Tip => ({
    title: i18n("chart.hourRange", { h: hh(i) }),
    rows: [{ swatch: "none", color: "", label: i18n("chart.weighIns"), value: `${counts[i]}${total ? ` (${Math.round((100 * counts[i]) / total)}%)` : ""}` }],
    notes: i >= h0 && i < h1 ? [i18n("chart.morningWindow", { from: hh(h0), to: hh(h1) })] : [],
  });
  return setupChart(el, {
    label: ctx.label ?? i18n("chart.hoursLabel"),
    className: "chart--bars",
    count: () => counts.length,
    tip,
    build: (theme) => {
      const ax = niceAxis(0, Math.max(1, ...counts), 4);
      return {
        grid: { left: 36, right: 12, top: 12, bottom: 28 },
        xAxis: categoryX(theme, counts.map((_, i) => hh(i)), { axisLabel: { interval: 2, margin: 10 } }),
        yAxis: valueY(theme, 0, ax.max, ax.step, ax.decimals),
        series: [{
          type: "bar", barMaxWidth: 16, barCategoryGap: "20%", animation: false,
          data: counts.map((c, i) => ({ value: c, itemStyle: { color: i >= h0 && i < h1 ? theme.accent : theme.compare } })),
          emphasis: { itemStyle: { opacity: 0.8 } },
        }],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Island adapters
// ---------------------------------------------------------------------------------------------

type Pair = [number, number] | { t: number; v: number };
const pairOf = (p: Pair): [number, number] => (Array.isArray(p) ? [p[0], p[1]] : [p.t, p.v]);

/** <div data-island="diverging-bars" data-payload="id"> reads payload.weeklyRate ([t, kg/week] tuples), payload.goal, payload.weight.stats.trendLatest. */
export function mountDivergingBarsIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const rate = ((payload as unknown as { weeklyRate?: Pair[] }).weeklyRate ?? []).map(pairOf);
  if (!rate.length) throw new Error("payload has no weeklyRate");
  const weight = resolveMetric(payload, "weight");
  return mountDivergingBars(el, rate, { unit: payload.unit, goal: payload.goal, trendNowKg: weight?.stats?.trendLatest ?? null });
}

/** <div data-island="effect-bars" data-payload="id" data-kind="weekday|timeofday"> reads payload.patterns.weekday / timeOfDay. */
export function mountEffectBarsIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const patterns = (payload as unknown as { patterns?: { weekday?: WeekdayEffect[] | null; timeOfDay?: TimeOfDayEffect[] | null } }).patterns;
  const kind = el.dataset.kind === "timeofday" ? "timeofday" : "weekday";
  if (kind === "weekday") {
    const list = patterns?.weekday;
    if (!list?.length) throw new Error("payload has no patterns.weekday");
    return mountEffectBars(el, list.map((w) => ({ label: w.label, mean: w.mean, se: w.se, n: w.n })), {
      unit: payload.unit, label: i18n("chart.weekdayLabel"), baseline: i18n("chart.diffUsual"),
    });
  }
  const list = patterns?.timeOfDay;
  if (!list?.length) throw new Error("payload has no patterns.timeOfDay");
  return mountEffectBars(el, list.map((s) => ({
    label: slotLabel(s.slot), sub: i18n("chart.range", { from: `${hh(s.hours[0])}:00`, to: `${hh(s.hours[1])}:00` }), mean: s.mean, se: s.se, n: s.n,
  })), { unit: payload.unit, label: i18n("chart.timeOfDayLabel"), baseline: i18n("chart.diffUsual") });
}

/** <div data-island="count-bars" data-payload="id"> reads payload.habits.hours (24 counts); optional data-from / data-to (morning window hours, default 4 and 10). */
export function mountCountBarsIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const hours = (payload as unknown as { habits?: { hours?: number[] } }).habits?.hours;
  if (!hours || hours.length !== 24) throw new Error("payload has no habits.hours");
  const from = Number(el.dataset.from ?? 4);
  const to = Number(el.dataset.to ?? 10);
  return mountCountBars(el, hours, { highlight: [from, to] });
}
