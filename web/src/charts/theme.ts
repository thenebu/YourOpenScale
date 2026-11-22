/** Chart theme: reads the CSS tokens (01 §B1/B5) and turns them into an ECharts option fragment. */
import type { EChartsCoreOption } from "./echarts.ts";

export type ChartTheme = {
  fontFamily: string;
  bg: string; surface: string; surfaceRaised: string;
  text: string; textMuted: string; textSubtle: string;
  border: string; accent: string;
  grid: string; axis: string; raw: string; trend: string; band: string; goal: string;
  outlier: string; crosshair: string; compare: string;
  fat: string; lean: string; muscle: string; water: string; bone: string; hr: string;
  heat: [string, string, string, string, string];
  bmiUnder: string; bmiNormal: string; bmiOver: string; bmiObese: string;
};

// Light-theme fallbacks, so charts stay readable if a token is missing.
const FALLBACK: Record<string, string> = {
  "--font-sans": "system-ui, sans-serif",
  "--color-bg": "#f5f6fa", "--color-surface": "#ffffff", "--color-surface-raised": "#ffffff",
  "--color-text": "#1a1d2e", "--color-text-muted": "#4c5270", "--color-text-subtle": "#5d6482",
  "--color-border": "#e0e3ee", "--color-accent": "#4a40c4",
  "--chart-grid": "#e6e8f1", "--chart-axis": "#5d6482", "--chart-raw": "#4a40c48c",
  "--chart-trend": "#4a40c4", "--chart-band": "#4a40c41f", "--chart-goal": "#9a5b00",
  "--chart-outlier": "#b3261e", "--chart-crosshair": "#4c5270", "--chart-compare": "#9aa0b8",
  "--chart-fat": "#c4581b", "--chart-lean": "#2f6db5", "--chart-muscle": "#2f8f3a",
  "--chart-water": "#2a9cc4", "--chart-bone": "#9a6bb5", "--chart-hr": "#b4487f",
  "--chart-heat-0": "#eef0f6", "--chart-heat-1": "#c9c5f5", "--chart-heat-2": "#9d97ec",
  "--chart-heat-3": "#6d64d8", "--chart-heat-4": "#4a40c4",
  "--chart-bmi-under": "#e8f0fb", "--chart-bmi-normal": "#e2f4ea", "--chart-bmi-over": "#fff4e0",
  "--chart-bmi-obese": "#fdeceb",
};

export function readTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || FALLBACK[name];
  return {
    fontFamily: v("--font-sans"),
    bg: v("--color-bg"), surface: v("--color-surface"), surfaceRaised: v("--color-surface-raised"),
    text: v("--color-text"), textMuted: v("--color-text-muted"), textSubtle: v("--color-text-subtle"),
    border: v("--color-border"), accent: v("--color-accent"),
    grid: v("--chart-grid"), axis: v("--chart-axis"), raw: v("--chart-raw"), trend: v("--chart-trend"),
    band: v("--chart-band"), goal: v("--chart-goal"), outlier: v("--chart-outlier"),
    crosshair: v("--chart-crosshair"), compare: v("--chart-compare"),
    fat: v("--chart-fat"), lean: v("--chart-lean"), muscle: v("--chart-muscle"),
    water: v("--chart-water"), bone: v("--chart-bone"), hr: v("--chart-hr"),
    heat: [v("--chart-heat-0"), v("--chart-heat-1"), v("--chart-heat-2"), v("--chart-heat-3"), v("--chart-heat-4")],
    bmiUnder: v("--chart-bmi-under"), bmiNormal: v("--chart-bmi-normal"),
    bmiOver: v("--chart-bmi-over"), bmiObese: v("--chart-bmi-obese"),
  };
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Option fragment shared by every chart: text, motion, tooltip skin. */
export function baseOption(theme: ChartTheme, opts: { reducedMotion: boolean }): EChartsCoreOption {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: theme.fontFamily, fontSize: 12, color: theme.axis },
    animation: !opts.reducedMotion,
    animationDuration: opts.reducedMotion ? 0 : 300,
    animationDurationUpdate: opts.reducedMotion ? 0 : 300,
    animationEasing: "cubicOut",
    tooltip: {
      confine: true,
      className: "chart-tooltip",
      backgroundColor: theme.surfaceRaised,
      borderColor: theme.border,
      borderWidth: 1,
      padding: 0,
      transitionDuration: opts.reducedMotion ? 0 : 0.15,
      textStyle: { fontFamily: theme.fontFamily, fontSize: 13, color: theme.text },
      axisPointer: {
        type: "line", snap: true, label: { show: false },
        lineStyle: { color: theme.crosshair, width: 1, type: "solid" },
      },
    },
  };
}

/**
 * Calls cb when the colours or motion preference may have changed: OS scheme, reduced motion,
 * the `yow:themechange` event, or a `data-theme` attribute change. Returns an unsubscribe function.
 */
export function onThemeChange(cb: () => void): () => void {
  let frame = 0;
  const fire = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(cb); // after the new styles have applied
  };
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  dark.addEventListener("change", fire);
  motion.addEventListener("change", fire);
  window.addEventListener("yow:themechange", fire);
  const observer = new MutationObserver(fire);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    cancelAnimationFrame(frame);
    dark.removeEventListener("change", fire);
    motion.removeEventListener("change", fire);
    window.removeEventListener("yow:themechange", fire);
    observer.disconnect();
  };
}
