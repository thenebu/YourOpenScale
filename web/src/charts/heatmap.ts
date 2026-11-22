/** Calendar heatmap (03 §4.11/§5): one ECharts calendar per year, at most 5, cell colour = weigh-ins that day (0, 1, 2, 3, 4+). */
import type { ECharts } from "./echarts.ts";
import type { Mounted } from "./mount.ts";
import { payloadOf, setupChart } from "./bars.ts";
import type { Opt, Tip } from "./bars.ts";

export type CalendarCell = { day: string; count: number };

const MAX_YEARS = 5;
const LEFT = 36;
const HEAD = 44; // year title + month labels
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`)).replace(/^(\p{L}+) /u, "$1, ");

export function mountCalendarHeatmap(el: HTMLElement, cells: CalendarCell[], ctx: { label?: string } = {}): Mounted & { chart: ECharts } {
  const years = [...new Set(cells.map((c) => c.day.slice(0, 4)))].sort().slice(-MAX_YEARS);
  const shown = cells.filter((c) => years.includes(c.day.slice(0, 4))).sort((a, b) => (a.day < b.day ? -1 : 1));
  const byYear = years.map((y) => shown.filter((c) => c.day.startsWith(y)));
  // Flat keyboard order == chronological order, so a stop maps to (year index, index in year).
  const where = (i: number): [number, number] => {
    let k = i;
    for (let y = 0; y < byYear.length; y++) {
      if (k < byYear[y].length) return [y, k];
      k -= byYear[y].length;
    }
    return [byYear.length - 1, byYear[byYear.length - 1].length - 1];
  };
  const flatIndex = (y: number, k: number) => byYear.slice(0, y).reduce((a, l) => a + l.length, 0) + k;
  const tip = (i: number): Tip => {
    const [y, k] = where(i);
    const c = byYear[y][k];
    return {
      title: dayLabel(c.day),
      rows: [{ swatch: "none", color: "", label: "Weigh-ins", value: c.count ? String(c.count) : "None" }],
      notes: [],
    };
  };
  const layout = () => {
    const w = el.clientWidth || 600;
    const cell = Math.max(6, Math.min(16, Math.floor((w - LEFT - 8) / 54)));
    return { cell, block: 7 * cell + HEAD + 16 };
  };

  return setupChart(el, {
    label: ctx.label ?? "Weigh-in calendar",
    className: "chart--calendar",
    trigger: "item",
    responsive: true,
    count: () => shown.length,
    tip,
    indexOf: (p) => {
      const q = (Array.isArray(p) ? p[0] : p) as Opt;
      return flatIndex(Number(q.seriesIndex), Number(q.dataIndex));
    },
    show: (chart, i) => {
      const [y, k] = where(i);
      chart.dispatchAction({ type: "showTip", seriesIndex: y, dataIndex: k });
    },
    build: (theme) => {
      const { cell, block } = layout();
      el.style.height = `${block * years.length - 16}px`;
      const bw = cell >= 12 ? 2 : 1;
      const zero = theme.heat[0].toLowerCase() === theme.surface.toLowerCase() ? theme.grid : theme.heat[0];
      return {
        visualMap: {
          type: "piecewise", show: false, dimension: 1, seriesIndex: years.map((_, i) => i),
          pieces: [
            { value: 0, color: zero }, { value: 1, color: theme.heat[1] }, { value: 2, color: theme.heat[2] },
            { value: 3, color: theme.heat[3] }, { min: 4, color: theme.heat[4] },
          ],
        },
        calendar: years.map((y, i) => ({
          range: y, left: LEFT, top: i * block + HEAD, cellSize: [cell, cell], orient: "horizontal",
          itemStyle: { color: zero, borderColor: theme.surface, borderWidth: bw },
          splitLine: { show: false }, yearLabel: { show: true, position: "top", margin: 28, fontSize: 13, fontWeight: 600, color: theme.text },
          monthLabel: { nameMap: MONTHS, fontSize: 12, color: theme.axis, margin: 8 },
          dayLabel: { firstDay: 1, nameMap: ["", "Mon", "", "Wed", "", "Fri", ""], fontSize: 12, color: theme.axis, margin: 6 },
        })),
        series: byYear.map((list, i) => ({
          type: "heatmap", coordinateSystem: "calendar", calendarIndex: i, animation: false,
          data: list.map((c) => [c.day, c.count]),
          itemStyle: { borderColor: theme.surface, borderWidth: bw, borderRadius: cell >= 12 ? 3 : 1 },
          emphasis: { itemStyle: { borderColor: theme.text, borderWidth: 1.5 } },
        })),
      };
    },
  });
}

/** <div data-island="calendar" data-payload="id"> reads payload.habits.calendar: [{day, count}] or [day, count] tuples, one per local day. */
export function mountCalendarIsland(el: HTMLElement): Mounted {
  const payload = payloadOf(el);
  const raw = (payload as unknown as { habits?: { calendar?: (CalendarCell | [string, number])[] } }).habits?.calendar;
  if (!raw?.length) throw new Error("payload has no habits.calendar");
  return mountCalendarHeatmap(el, raw.map((c) => (Array.isArray(c) ? { day: c[0], count: c[1] } : c)));
}
