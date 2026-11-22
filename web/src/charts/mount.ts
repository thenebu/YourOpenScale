/**
 * Island mounting. Markup contract (server views):
 *   <div class="chart" data-island="timeseries" data-payload="analysis-json" data-metric="weight">
 *     <div class="chart-fallback">…static spark + text…</div>
 *   </div>
 * Optional attributes read by the timeseries island: data-compact, data-slider, data-zone.
 * A mounter may return { chart, dispose }; the chart is resized with its container and everything
 * is disposed on pagehide.
 */
import type { ECharts } from "./echarts.ts";

export type Mounted = { chart?: ECharts; dispose?: () => void } | void;
export type Island = (el: HTMLElement) => Mounted | Promise<Mounted>;

const islands = new Map<string, Island>();
const mounted = new WeakSet<HTMLElement>();
const cleanups: (() => void)[] = [];
let observer: IntersectionObserver | null = null;
let hooked = false;

export function registerIsland(name: string, fn: Island): void {
  islands.set(name, fn);
}

async function mountOne(el: HTMLElement): Promise<void> {
  if (mounted.has(el)) return;
  mounted.add(el);
  const fn = islands.get(el.dataset.island ?? "");
  if (!fn) return;
  try {
    const result = await fn(el);
    el.querySelector(":scope > .chart-fallback")?.remove();
    el.dataset.mounted = "true";
    if (result) {
      const { chart, dispose } = result;
      let ro: ResizeObserver | undefined;
      if (chart && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);
      }
      cleanups.push(() => {
        ro?.disconnect();
        dispose?.();
        chart?.dispose();
      });
    }
  } catch (error) {
    mounted.delete(el);
    console.error(`chart island "${el.dataset.island}" failed`, error);
  }
}

/** Finds [data-island] elements under root and mounts each one when it nears the viewport. */
export function mountIslands(root: ParentNode = document): void {
  const nodes = [...root.querySelectorAll<HTMLElement>("[data-island]")].filter((n) => !mounted.has(n));
  if (!hooked) {
    hooked = true;
    window.addEventListener("pagehide", disposeAll);
  }
  if (typeof IntersectionObserver === "undefined") {
    nodes.forEach((n) => void mountOne(n));
    return;
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        void mountOne(entry.target as HTMLElement);
      }
    },
    { rootMargin: "200px" },
  );
  nodes.forEach((n) => observer!.observe(n));
}

export function disposeAll(): void {
  observer?.disconnect();
  observer = null;
  for (const fn of cleanups.splice(0)) fn();
}
