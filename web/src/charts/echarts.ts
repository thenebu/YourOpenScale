/** Tree-shaken ECharts 6 registration (SVG renderer only). The only place that imports echarts. */
import { init, use } from "echarts/core";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import { BarChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

use([
  LineChart, ScatterChart, BarChart, HeatmapChart, CustomChart,
  GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, MarkPointComponent,
  MarkAreaComponent, CalendarComponent, VisualMapComponent, AriaComponent,
  SVGRenderer,
]);

export type { ECharts, EChartsCoreOption };

export function initChart(el: HTMLElement): ECharts {
  return init(el, null, { renderer: "svg", locale: "EN" });
}
