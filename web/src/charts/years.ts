/** Year overlay (03 §5): one line per year over a Jan-Dec axis, current year in the accent colour, older years fading grey. */
import { extent } from "./extent.ts";
import { formatMetric, toDisplay } from "@analysis/format.ts";
import { specFor } from "@analysis/spec.ts";
import type { Unit, YearSeries } from "@analysis/types.ts";
import { niceAxis, payloadOf, scaleAlpha, setupChart, valueY } from "./bars.ts";
import type { Opt, Tip } from "./bars.ts";
import type { ECharts } from "./echarts.ts";
import type { Mounted } from "./mount.ts";
import { monthNames, t as i18n } from "../i18n/index.ts";

const MONTH_START = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const doyLabel = (doy: number) => {
  let m = 0;
  while (m < 11 && doy >= MONTH_START[m + 1]) m++;
  return `${doy - MONTH_START[m] + 1} ${monthNames()[m]}`;
};

export type YearsCtx = { unit: Unit; type?: number; label?: string };

export function mountYearOverlay(el: HTMLElement, years: YearSeries[], ctx: YearsCtx): Mounted & { chart: ECharts } {
  const type = ctx.type ?? 1;
  const isMass = specFor(type)?.unit === "kg";
  const disp = (v: number) => (isMass ? toDisplay(v, ctx.unit) : v);
  const fmt = (v: number) => formatMetric(v, type, ctx.unit, isMass ? { decimals: 1 } : {});
  const list = [...years].sort((a, b) => a.year - b.year);
  const current = list[list.length - 1];
  // One keyboard stop per day of year that the current year has a value for.
  const stops = current.points.map((p) => p.doy).sort((a, b) => a - b);
  const nearestStop = (doy: number) => {
    let best = 0;
    for (let i = 1; i < stops.length; i++) if (Math.abs(stops[i] - doy) < Math.abs(stops[best] - doy)) best = i;
    return best;
  };
  const valueNear = (y: YearSeries, doy: number): number | null => {
    let best: { doy: number; v: number } | null = null;
    for (const p of y.points) if (!best || Math.abs(p.doy - doy) < Math.abs(best.doy - doy)) best = p;
    return best && Math.abs(best.doy - doy) <= 4 ? best.v : null;
  };
  const tip = (i: number): Tip => {
    const doy = stops[i];
    return {
      title: doyLabel(doy),
      rows: [...list].reverse().map((y) => {
        const v = valueNear(y, doy);
        return {
          swatch: "line" as const,
          color: y === current ? "var(--chart-trend)" : "var(--chart-compare)",
          label: String(y.year),
          value: v === null ? i18n("chart.noReading") : fmt(v),
        };
      }),
      notes: [],
    };
  };
  return setupChart(el, {
    label: ctx.label ?? i18n("chart.yearsLabel"),
    responsive: true,
    count: () => stops.length,
    tip,
    indexOf: (p) => nearestStop(Number((Array.isArray(p) ? p[0] : p)?.axisValue)),
    show: (chart, i) => {
      const px = chart.convertToPixel({ xAxisIndex: 0 }, stops[i]) as number;
      chart.dispatchAction({ type: "showTip", x: px, y: 30 });
    },
    build: (theme) => {
      const all = list.flatMap((y) => y.points.map((p) => disp(p.v)));
      const [lo, hi] = extent(all);
      const pad = Math.max((hi - lo) * 0.08, 0.1);
      const ax = niceAxis(lo - pad, hi + pad, 4);
      const right = el.clientWidth < 560 ? 40 : 48;
      return {
        grid: { left: 44, right, top: 12, bottom: 26 },
        xAxis: {
          type: "value", min: 1, max: 366, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
          axisLabel: {
            customValues: MONTH_START, hideOverlap: true, fontSize: 12, color: theme.axis, margin: 10,
            formatter: (v: number) => monthNames()[MONTH_START.indexOf(v)] ?? "",
          },
          axisPointer: { type: "line", snap: false, label: { show: false }, lineStyle: { color: theme.crosshair, width: 1 } },
        },
        yAxis: valueY(theme, ax.min, ax.max, ax.step, ax.decimals, { scale: true }),
        labelLayout: { moveOverlap: "shiftY" },
        series: list.map((y) => {
          const age = current.year - y.year;
          const isNow = age === 0;
          const color = isNow ? theme.trend : scaleAlpha(theme.compare, Math.max(0.45, 1 - 0.18 * age));
          return {
            name: String(y.year), type: "line", symbol: "none", animation: false, silent: false, z: isNow ? 5 : 3 - age,
            lineStyle: { color, width: isNow ? 2.5 : 1.5 }, itemStyle: { color },
            data: [...y.points].sort((a, b) => a.doy - b.doy).map((p) => [p.doy, Number(disp(p.v).toFixed(3))]),
            endLabel: { show: true, distance: 6, color: isNow ? theme.text : theme.textMuted, fontSize: 12, fontWeight: isNow ? 600 : 400, formatter: String(y.year) },
            labelLayout: { moveOverlap: "shiftY" },
          } satisfies Opt;
        }),
      };
    },
  });
}

type YearWire = YearSeries | { year: number; points: [number, number][] } | [number, [number, number][]];

/** <div data-island="years" data-payload="id" [data-type="1"]> reads payload.patterns.years: [{year, points:[{doy,v}]}] or [year, [[doy, v], …]] (native units; null when < 2 years). */
export function mountYearsIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const raw = (payload as unknown as { patterns?: { years?: YearWire[] | null } }).patterns?.years;
  if (!raw || raw.length < 2) throw new Error("payload has no patterns.years");
  const pt = (p: [number, number] | { doy: number; v: number }) => (Array.isArray(p) ? { doy: p[0], v: p[1] } : p);
  const years: YearSeries[] = raw.map((y) =>
    Array.isArray(y) ? { year: y[0], points: y[1].map(pt) } : { year: y.year, points: (y.points as ([number, number] | { doy: number; v: number })[]).map(pt) },
  );
  return mountYearOverlay(el, years, { unit: payload.unit, type: Number(el.dataset.type ?? 1) });
}
