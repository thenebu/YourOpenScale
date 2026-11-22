/** Histogram of daily values (03 §4.9): bins as rectangles on a value axis, markers for mean / median / now, p10-p90 shaded. */
import { formatMetric, toDisplay } from "@analysis/format.ts";
import { specFor } from "@analysis/spec.ts";
import type { Histogram, Unit } from "@analysis/types.ts";
import { niceAxis, payloadOf, plain, setupChart, valueY } from "./bars.ts";
import type { Opt, Tip } from "./bars.ts";
import type { ECharts } from "./echarts.ts";
import type { Mounted } from "./mount.ts";
import { t as i18n } from "../i18n/index.ts";

export type HistogramCtx = { unit: Unit; type?: number; label?: string };

export function mountHistogram(el: HTMLElement, h: Histogram, ctx: HistogramCtx): Mounted & { chart: ECharts } {
  const type = ctx.type ?? 1;
  const isMass = specFor(type)?.unit === "kg";
  const disp = (v: number) => (isMass ? toDisplay(v, ctx.unit) : v);
  const fmt = (v: number) => formatMetric(v, type, ctx.unit, isMass ? { decimals: 1 } : {});
  const total = h.bins.reduce((a, b) => a + b.count, 0);
  const tip = (i: number): Tip => {
    const b = h.bins[i];
    return {
      title: `${i18n("chart.range", { from: plain(disp(b.from)), to: plain(disp(b.to)) })}${isMass ? ` ${ctx.unit === "kg" ? "kg" : "lb"}` : ""}`,
      rows: [{ swatch: "none", color: "", label: i18n("chart.days"), value: `${b.count}${total ? ` (${Math.round((100 * b.count) / total)}%)` : ""}` }],
      notes: [],
    };
  };
  return setupChart(el, {
    label: ctx.label ?? i18n("chart.histLabel"),
    className: "chart--histogram",
    trigger: "item",
    responsive: true,
    count: () => h.bins.length,
    tip,
    build: (theme) => {
      const lo = disp(h.bins[0].from);
      const hi = disp(h.bins[h.bins.length - 1].to);
      const ymax = niceAxis(0, Math.max(1, ...h.bins.map((b) => b.count)) * 1.4, 3);
      const mid = (lo + hi) / 2;
      const line = (name: string, v: number, color: string, type: "solid" | "dashed", row: number): Opt => ({
        xAxis: disp(v),
        lineStyle: { color, width: name === i18n("chart.now") ? 2.5 : 1.5, type },
        label: {
          show: true, formatter: `${name} ${plain(disp(v))}`, color: theme.text, fontSize: 12,
          position: "end", align: disp(v) > mid ? "right" : "left", offset: [disp(v) > mid ? -4 : 4, 14 * row + 12],
          backgroundColor: "transparent",
        },
      });
      const markers: Opt[] = [line(i18n("chart.mean2"), h.mean, theme.text, "solid", 0), line(i18n("chart.median"), h.median, theme.textMuted, "dashed", 1)];
      if (h.current != null) markers.push(line(i18n("chart.now"), h.current, theme.accent, "solid", 2));
      return {
        grid: { left: 36, right: 12, top: 8, bottom: 28 },
        xAxis: {
          type: "value", min: lo, max: hi, axisLine: { lineStyle: { color: theme.grid } }, axisTick: { show: false },
          splitLine: { show: false }, axisLabel: { fontSize: 12, color: theme.axis, margin: 8, hideOverlap: true, formatter: (v: number) => plain(v, h.bins.length && (hi - lo) / h.bins.length < 1 ? 1 : 0) },
        },
        yAxis: valueY(theme, 0, ymax.max, ymax.step, ymax.decimals),
        series: [
          {
            type: "custom", animation: false, z: 2,
            data: h.bins.map((b, i) => [disp(b.from), disp(b.to), b.count, i]),
            encode: { x: [0, 1], y: 2 },
            renderItem: (params: Opt, api: Opt) => {
              const a = api.coord([api.value(0), api.value(2)]);
              const b = api.coord([api.value(1), 0]);
              const cs = params.coordSys as { y: number; height: number };
              const w = Math.max(1, b[0] - a[0] - 2);
              return {
                type: "group",
                children: [
                  { type: "rect", shape: { x: a[0], y: cs.y, width: b[0] - a[0], height: cs.height }, style: { fill: "transparent" } },
                  { type: "rect", shape: { x: a[0] + 1, y: a[1], width: w, height: Math.max(0, b[1] - a[1]), r: [2, 2, 0, 0] }, style: { fill: theme.trend } },
                ],
              };
            },
          },
          {
            type: "scatter", data: [], silent: true, tooltip: { show: false }, animation: false,
            markArea: {
              silent: true, animation: false, itemStyle: { color: theme.band },
              data: [[{ xAxis: disp(h.p10) }, { xAxis: disp(h.p90) }]],
            },
            markLine: { silent: true, symbol: "none", animation: false, data: markers },
          },
        ],
      };
    },
    show: (chart, i) => chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: i }),
  });
}

type BinTuple = [number, number, number];

/** <div data-island="histogram" data-payload="id" [data-type="1"]> reads payload.patterns.histogram (bins as {from,to,count} or [from,to,count]; values in native units). */
export function mountHistogramIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const raw = (payload as unknown as { patterns?: { histogram?: (Omit<Histogram, "bins"> & { bins: (Histogram["bins"][number] | BinTuple)[] }) | null } }).patterns?.histogram;
  if (!raw?.bins?.length) throw new Error("payload has no patterns.histogram");
  const h: Histogram = { ...raw, bins: raw.bins.map((b) => (Array.isArray(b) ? { from: b[0], to: b[1], count: b[2] } : b)) };
  return mountHistogram(el, h, { unit: payload.unit, type: Number(el.dataset.type ?? 1) });
}
