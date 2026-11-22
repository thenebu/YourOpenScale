/** Body composition charts (03 §4.13/§5): fat vs lean trend lines, and monthly stacked bars. */
import { extent } from "./extent.ts";
import { formatMass, toDisplay } from "@analysis/format.ts";
import { trendAt } from "@analysis/trend.ts";
import type { MetricAnalysis, Unit } from "@analysis/types.ts";
import { resolveMetric } from "./data.ts";
import { categoryX, niceAxis, payloadOf, plain, scaleAlpha, setupChart, valueY } from "./bars.ts";
import type { Opt, Tip } from "./bars.ts";
import type { ECharts } from "./echarts.ts";
import { lowerBound, slice } from "./lod.ts";
import type { Mounted } from "./mount.ts";

const day = (t: number) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(t * 1000)).replace(/^(\p{L}+) /u, "$1, ");

// ---------------------------------------------------------------------------------------------
// Dual trend lines
// ---------------------------------------------------------------------------------------------

export type CompositionCtx = { unit: Unit; label?: string };

/** One shared kg axis when lean/fat < 6, otherwise two stacked grids sharing the time axis. */
export function mountComposition(
  el: HTMLElement, comp: { fatMass: MetricAnalysis | null; leanMass: MetricAnalysis | null }, ctx: CompositionCtx,
): Mounted & { chart: ECharts } {
  const fat = comp.fatMass;
  const lean = comp.leanMass;
  if (!fat || !lean) throw new Error("composition needs fat and lean mass");
  const disp = (v: number) => toDisplay(v, ctx.unit);
  const fmt = (v: number) => formatMass(v, ctx.unit, { decimals: 1 });
  const nav = fat.lod.daily.length >= lean.lod.daily.length ? fat.lod.daily : lean.lod.daily;
  const last = (m: MetricAnalysis) => m.trend[m.trend.length - 1]?.v ?? m.stats?.latest.v ?? 0;
  const stacked = last(lean) / Math.max(0.1, last(fat)) >= 6;
  const times = nav.map((d) => d.t);
  const t0 = Math.min(fat.trend[0]?.t ?? Infinity, lean.trend[0]?.t ?? Infinity, times[0] ?? Infinity);
  const t1 = Math.max(fat.trend.at(-1)?.t ?? 0, lean.trend.at(-1)?.t ?? 0, times.at(-1) ?? 0);

  const nearest = (t: number): number => {
    const k = lowerBound(nav, t, (p) => p.t);
    if (k <= 0) return 0;
    if (k >= nav.length) return nav.length - 1;
    return t - nav[k - 1].t <= nav[k].t - t ? k - 1 : k;
  };
  const valueAt = (m: MetricAnalysis, t: number) => {
    const d = m.lod.daily.find((p) => p.day === nav[nearest(t)]?.day);
    return d?.v ?? null;
  };
  const tip = (i: number): Tip => {
    if (!nav[i]) return { title: "", rows: [], notes: [] };
    const t = nav[i].t;
    const rows: Tip["rows"] = [];
    const notes: string[] = [];
    for (const [m, name, color] of [[fat, "Fat mass", "fat"], [lean, "Lean mass", "lean"]] as const) {
      const tr = trendAt(m.trend, t);
      const v = valueAt(m, t);
      rows.push({ swatch: "line", color: color === "fat" ? "var(--chart-fat)" : "var(--chart-lean)", label: `${name} (trend)`, value: tr === null ? "–" : fmt(tr) });
      if (v !== null) notes.push(`${name} that day: ${fmt(v)}`);
    }
    return { title: day(t), rows, notes };
  };
  return setupChart(el, {
    label: ctx.label ?? "Fat mass and lean mass over time",
    responsive: true,
    count: () => nav.length,
    tip,
    indexOf: (p) => {
      const q = Array.isArray(p) ? p[0] : p;
      return nearest(Number(q?.axisValue) / 1000);
    },
    show: (chart, i) => {
      const px = chart.convertToPixel({ xAxisIndex: 0 }, nav[i].t * 1000) as number;
      chart.dispatchAction({ type: "showTip", x: px, y: 30 });
    },
    build: (theme) => {
      const right = el.clientWidth < 560 ? 80 : 92;
      const ext = (m: MetricAnalysis) => {
        const vs = [...m.trend.map((p) => disp(p.v)), ...m.lod.daily.map((d) => disp(d.v))];
        return extent(vs);
      };
      const series = (m: MetricAnalysis, color: string, name: string, xi: number, yi: number): Opt[] => [
        {
          type: "scatter", xAxisIndex: xi, yAxisIndex: yi, silent: true, animation: false, z: 2, symbolSize: 3, clip: true,
          itemStyle: { color: scaleAlpha(color, 0.35) }, data: m.lod.daily.map((d) => [d.t * 1000, disp(d.v)]),
        },
        {
          type: "line", xAxisIndex: xi, yAxisIndex: yi, silent: true, animation: false, z: 4, symbol: "none", sampling: "lttb",
          lineStyle: { color, width: 2.5 }, data: slice(m.trend, -Infinity, Infinity, (p) => p.t, 0).map((p) => [p.t * 1000, disp(p.v)]),
          endLabel: { show: true, distance: 6, color: theme.text, fontSize: 12, fontWeight: 600, formatter: `${name} ${plain(disp(last(m)))}` },
        },
      ];
      const xAxis = (visible: boolean, gridIndex: number): Opt => ({
        type: "time", gridIndex, min: t0 * 1000, max: t1 * 1000, show: true,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: visible, hideOverlap: true, fontSize: 12, color: theme.axis, margin: 10,
          formatter: { year: "{MMM} '{yy}", month: "{MMM} '{yy}", day: "{d} {MMM}", none: "{d} {MMM}" } },
        axisPointer: { type: "line", snap: true, label: { show: false }, lineStyle: { color: theme.crosshair, width: 1 } },
      });
      const yAxis = (lo: number, hi: number, gridIndex: number): Opt => {
        const ax = niceAxis(lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.1, 3);
        return valueY(theme, ax.min, ax.max, ax.step, ax.decimals, { gridIndex, scale: true });
      };
      const [fl, fh] = ext(fat);
      const [ll, lh] = ext(lean);
      if (!stacked) {
        return {
          grid: { left: 44, right, top: 12, bottom: 26 },
          xAxis: xAxis(true, 0), yAxis: yAxis(Math.min(fl, ll), Math.max(fh, lh), 0),
          series: [...series(lean, theme.lean, "Lean", 0, 0), ...series(fat, theme.fat, "Fat", 0, 0)],
        };
      }
      return {
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: [
          { left: 44, right, top: 10, height: "36%" },
          { left: 44, right, top: "52%", bottom: 26 },
        ],
        xAxis: [xAxis(false, 0), xAxis(true, 1)],
        yAxis: [yAxis(ll, lh, 0), yAxis(fl, fh, 1)],
        series: [...series(lean, theme.lean, "Lean", 0, 0), ...series(fat, theme.fat, "Fat", 1, 1)],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Monthly stacked bars
// ---------------------------------------------------------------------------------------------

export type MonthlyComposition = { key: string; t: number; fat: number | null; muscle: number | null; bone: number | null; otherLean: number | null; water: number | null };
type MonthlyTuple = [string, number, number | null, number | null, number | null, number | null, number | null];

export function mountCompositionBars(el: HTMLElement, months: MonthlyComposition[], ctx: CompositionCtx): Mounted & { chart: ECharts } {
  const disp = (v: number | null) => (v === null ? null : Number(toDisplay(v, ctx.unit).toFixed(3)));
  const fmt = (v: number | null) => (v === null ? "–" : formatMass(v, ctx.unit, { decimals: 1 }));
  const short = (m: MonthlyComposition) =>
    new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(m.t * 1000)).replace(/ (\d\d)$/, " ’$1");
  const parts = [
    { key: "fat", name: "Fat", color: "fat" },
    { key: "muscle", name: "Muscle", color: "muscle" },
    { key: "bone", name: "Bone", color: "bone" },
    { key: "otherLean", name: "Other lean", color: "lean" },
  ] as const;
  const tip = (i: number): Tip => {
    const m = months[i];
    const total = parts.reduce((a, p) => a + (m[p.key] ?? 0), 0);
    const colorOf = (c: string) => `var(--chart-${c})`;
    return {
      title: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m.t * 1000)),
      rows: [
        ...parts.map((p) => ({ swatch: "dot" as const, color: colorOf(p.color), label: p.name, value: fmt(m[p.key]) })),
        { swatch: "line" as const, color: colorOf("water"), label: "Water", value: fmt(m.water) },
      ],
      notes: [`Total of the bars ${fmt(total)}`],
    };
  };
  return setupChart(el, {
    label: ctx.label ?? "Monthly body composition",
    className: "chart--bars",
    count: () => months.length,
    tip,
    build: (theme) => {
      const top = Math.max(1, ...months.map((m) => Math.max(toDisplay(parts.reduce((a, p) => a + (m[p.key] ?? 0), 0), ctx.unit), toDisplay(m.water ?? 0, ctx.unit))));
      const ax = niceAxis(0, top, 4);
      const colors = { fat: theme.fat, muscle: theme.muscle, bone: theme.bone, lean: theme.lean };
      return {
        grid: { left: 44, right: 12, top: 12, bottom: 28 },
        xAxis: categoryX(theme, months.map(short), { axisLabel: { margin: 10 } }),
        yAxis: valueY(theme, 0, ax.max, ax.step, ax.decimals),
        series: [
          ...parts.map((p) => ({
            name: p.name, type: "bar", stack: "mass", barMaxWidth: 22, animation: false,
            itemStyle: { color: colors[p.color] }, emphasis: { itemStyle: { opacity: 0.85 } },
            data: months.map((m) => disp(m[p.key])),
          })),
          {
            name: "Water", type: "line", symbol: "circle", symbolSize: 4, animation: false, z: 5, connectNulls: false,
            lineStyle: { color: theme.water, width: 2, type: "dashed" }, itemStyle: { color: theme.water },
            data: months.map((m) => disp(m.water)),
          },
        ],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Island adapters
// ---------------------------------------------------------------------------------------------

/** <div data-island="composition" data-payload="id"> reads payload.composition.fatMass / leanMass (metric objects, as for the timeseries island). */
export function mountCompositionIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const fatMass = resolveMetric(payload, "fatMass");
  const leanMass = resolveMetric(payload, "leanMass");
  if (!fatMass || !leanMass) throw new Error("payload has no composition fat/lean mass");
  return mountComposition(el, { fatMass, leanMass }, { unit: payload.unit });
}

/** <div data-island="composition-bars" data-payload="id"> reads payload.composition.monthly: [{key,t,fat,muscle,bone,otherLean,water}] or [key,t,fat,muscle,bone,otherLean,water] tuples (kg). */
export function mountCompositionBarsIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const raw = (payload as unknown as { composition?: { monthly?: (MonthlyComposition | MonthlyTuple)[] } | null }).composition?.monthly;
  if (!raw?.length) throw new Error("payload has no composition.monthly");
  const months = raw.map((m) => (Array.isArray(m)
    ? { key: m[0], t: m[1], fat: m[2], muscle: m[3], bone: m[4], otherLean: m[5], water: m[6] }
    : m));
  return mountCompositionBars(el, months, { unit: payload.unit });
}
