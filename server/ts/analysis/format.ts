/** Display formatting (WP-05). Also imported by the web bundle: no node:* imports. */
import { specFor } from "./spec.ts";
import type { Unit } from "./types.ts";
export { chooseAgg } from "./series.ts";

export type DateStyle = "short" | "medium" | "long" | "time" | "month";

const KG_TO_LB = 2.2046226218487757;
const MINUS = "−";

/** Value in the display unit; stones are decimal stones. */
export function toDisplay(kg: number, unit: Unit): number {
  if (unit === "lb") return kg * KG_TO_LB;
  if (unit === "st") return (kg * KG_TO_LB) / 14;
  return kg;
}

const grouped = new Map<number, Intl.NumberFormat>();
function num(value: number, minDecimals: number, maxDecimals = minDecimals): string {
  const key = minDecimals * 10 + maxDecimals;
  let f = grouped.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-GB", { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals });
    grouped.set(key, f);
  }
  return f.format(value);
}

/** "81.40 kg", "179.5 lb" or "12 st 11.4 lb" (the stone carries when the pounds round up to 14). */
export function formatMass(kg: number, unit: Unit, opts: { decimals?: number } = {}): string {
  if (!Number.isFinite(kg)) return "–";
  const neg = kg < 0;
  const sign = neg ? MINUS : "";
  const abs = Math.abs(kg);
  if (unit === "kg") return `${sign}${num(abs, opts.decimals ?? 2)} kg`;
  const d = opts.decimals ?? 1;
  const scale = 10 ** d;
  const units = Math.round(abs * KG_TO_LB * scale);
  if (unit === "lb") return `${sign}${num(units / scale, d)} lb`;
  const perStone = 14 * scale;
  const stone = Math.floor(units / perStone);
  return `${sign}${stone} st ${num((units % perStone) / scale, d)} lb`;
}

const DEFAULT_DECIMALS: Record<string, number> = { "%": 1, bpm: 0, kcal: 0, years: 0, "m/s": 1 };

function metricDecimals(type: number, unit: string): number {
  if (type === -1) return 1;
  return DEFAULT_DECIMALS[unit] ?? 0;
}

/** A metric value with its unit; kg-valued metrics follow the display weight unit. */
export function formatMetric(
  value: number,
  type: number,
  unit: Unit,
  opts: { decimals?: number } = {},
): string {
  if (!Number.isFinite(value)) return "–";
  const spec = specFor(type);
  if (!spec) return num(value, opts.decimals ?? 2, opts.decimals ?? 2);
  if (spec.unit === "kg") return formatMass(value, unit, opts);
  const d = opts.decimals ?? metricDecimals(type, spec.unit);
  const text = `${value < 0 ? MINUS : ""}${num(Math.abs(value), d)}`;
  if (spec.unit === "") return text;
  return spec.unit === "%" ? `${text}%` : `${text} ${spec.unit}`;
}

function signed(value: number, suffix: string): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return `0${suffix}`;
  return `${rounded < 0 ? MINUS : "+"}${num(Math.abs(rounded), 0, 2)}${suffix}`;
}

/** Signed change with a true minus sign; percentage-point for body fat, lb for st. */
export function formatDelta(value: number, type: number, unit: Unit): string {
  const spec = specFor(type);
  if (!spec) return signed(value, "");
  if (spec.unit === "kg") return unit === "kg" ? signed(value, " kg") : signed(value * KG_TO_LB, " lb");
  if (type === 6) return signed(value, " pp");
  return signed(value, spec.unit === "" || spec.unit === "%" ? "" : ` ${spec.unit}`);
}

/** Weekly rate of change, e.g. "−0.3 kg/week" (lb for lb and st). */
export function formatRate(perWeekKg: number, unit: Unit): string {
  const v = unit === "kg" ? perWeekKg : perWeekKg * KG_TO_LB;
  const label = unit === "kg" ? "kg" : "lb";
  if (Math.abs(v) < 0.005) return `0 ${label}/week`;
  const d = Math.abs(v) < 0.1 ? 2 : 1;
  const rounded = Number(Math.abs(v).toFixed(d));
  return `${v < 0 ? MINUS : "+"}${num(rounded, d)} ${label}/week`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(zone: string, style: DateStyle): Intl.DateTimeFormat {
  const key = `${zone}|${style}`;
  let f = dateFormats.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      style === "short" ? { day: "numeric", month: "short" }
      : style === "medium" ? { day: "numeric", month: "short", year: "numeric" }
      : style === "long" ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : style === "time" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { month: "short", year: "numeric" };
    f = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone });
    dateFormats.set(key, f);
  }
  return f;
}

/** t is epoch seconds; a missing or unknown zone means UTC. */
export function formatDate(t: number, zone: string | null | undefined, style: DateStyle): string {
  let f: Intl.DateTimeFormat;
  try {
    f = dateFormat(zone || "UTC", style);
  } catch {
    f = dateFormat("UTC", style);
  }
  const text = f.format(new Date(t * 1000));
  return style === "long" ? text.replace(/^(\p{L}+),/u, "$1") : text;
}

export function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n === -1) return "tomorrow";
  return n > 0 ? `${n} days ago` : `in ${-n} days`;
}
