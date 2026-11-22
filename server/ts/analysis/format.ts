/** Display formatting (WP-05). Also imported by the web bundle: no node:* imports. */
import { currentDatePrefs, currentLocale, intlTag, type DateFormatPref, type Locale } from "../i18n/locale.ts";
import { specFor } from "./spec.ts";
import type { Unit } from "./types.ts";
export { chooseAgg } from "./series.ts";

export type DateStyle = "short" | "medium" | "long" | "time" | "month" | "day";

const KG_TO_LB = 2.2046226218487757;
const MINUS = "−";

/** Value in the display unit; stones are decimal stones. */
export function toDisplay(kg: number, unit: Unit): number {
  if (unit === "lb") return kg * KG_TO_LB;
  if (unit === "st") return (kg * KG_TO_LB) / 14;
  return kg;
}

const grouped = new Map<string, Intl.NumberFormat>();
function num(value: number, minDecimals: number, maxDecimals = minDecimals): string {
  const locale = currentLocale();
  const key = `${locale}|${minDecimals * 10 + maxDecimals}`;
  let f = grouped.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlTag(locale), { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals });
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
  return spec.unit === "%" ? `${text}${currentLocale() === "de" ? "\u00a0" : ""}%` : `${text} ${spec.unit}`;
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

/** The unit word of a weekly rate; kept here because this module is shared with the web bundle. */
const WEEK: Record<Locale, string> = { en: "week", de: "Woche" };
const RELATIVE: Record<Locale, { today: string; yesterday: string; tomorrow: string; ago: (n: number) => string; in: (n: number) => string }> = {
  en: { today: "today", yesterday: "yesterday", tomorrow: "tomorrow", ago: (n) => `${n} days ago`, in: (n) => `in ${n} days` },
  de: { today: "heute", yesterday: "gestern", tomorrow: "morgen", ago: (n) => `vor ${n} Tagen`, in: (n) => `in ${n} Tagen` },
};

/** Unit label of a weekly rate: "kg/week" ("kg/Woche"), "lb/week" for lb and st. */
export function rateUnitLabel(unit: Unit): string {
  return `${unit === "kg" ? "kg" : "lb"}/${WEEK[currentLocale()]}`;
}

/** Weekly rate of change, e.g. "−0.3 kg/week" or "−0,3 kg/Woche" (lb for lb and st). */
export function formatRate(perWeekKg: number, unit: Unit): string {
  const v = unit === "kg" ? perWeekKg : perWeekKg * KG_TO_LB;
  const label = unit === "kg" ? "kg" : "lb";
  const week = WEEK[currentLocale()];
  if (Math.abs(v) < 0.005) return `0 ${label}/${week}`;
  const d = Math.abs(v) < 0.1 ? 2 : 1;
  const rounded = Number(Math.abs(v).toFixed(d));
  return `${v < 0 ? MINUS : "+"}${num(rounded, d)} ${label}/${week}`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(zone: string, style: DateStyle | "parts" | "weekday" | "weekdayShort"): Intl.DateTimeFormat {
  const locale = currentLocale();
  const key = `${locale}|${zone}|${style}`;
  let f = dateFormats.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      style === "short" ? { day: "numeric", month: "short" }
      : style === "medium" ? { day: "numeric", month: "short", year: "numeric" }
      : style === "long" ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : style === "time" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : style === "day" ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
      : style === "weekdayShort" ? { weekday: "short" }
      : style === "weekday" ? { weekday: "long" }
      : style === "parts" ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { month: "short", year: "numeric" };
    f = new Intl.DateTimeFormat(style === "parts" ? "en-GB" : intlTag(locale), { ...options, timeZone: zone });
    dateFormats.set(key, f);
  }
  return f;
}

type Parts = { y: string; m: string; d: string; h: number; min: string };
function partsOf(t: number, zone: string): Parts {
  const p: Record<string, string> = {};
  for (const part of dateFormat(zone, "parts").formatToParts(new Date(t * 1000))) p[part.type] = part.value;
  return { y: p.year, m: p.month, d: p.day, h: Number(p.hour) % 24, min: p.minute };
}

/** The date format in effect: an explicit preference, else the one that fits the language. */
function effectiveDateFormat(): Exclude<DateFormatPref, "auto"> | "auto-en" {
  const pref = currentDatePrefs().date;
  if (pref !== "auto") return pref;
  return currentLocale() === "de" ? "dmy-dot" : "auto-en";
}

function numericDate(f: Exclude<DateFormatPref, "auto">, style: "short" | "medium", p: Parts): string {
  if (f === "dmy-dot") return style === "short" ? `${p.d}.${p.m}.` : `${p.d}.${p.m}.${p.y}`;
  if (f === "ymd") return style === "short" ? `${p.m}-${p.d}` : `${p.y}-${p.m}-${p.d}`;
  if (f === "mdy") return style === "short" ? `${p.m}/${p.d}` : `${p.m}/${p.d}/${p.y}`;
  return style === "short" ? `${p.d}/${p.m}` : `${p.d}/${p.m}/${p.y}`;
}

function clock(p: Parts): string {
  const pref = currentDatePrefs().time;
  const twelve = pref === "12h";
  if (!twelve) return `${String(p.h).padStart(2, "0")}:${p.min}`;
  return `${p.h % 12 || 12}:${p.min} ${p.h < 12 ? "AM" : "PM"}`;
}

/** t is epoch seconds; a missing or unknown zone means UTC. Honours the date and time format preferences. */
export function formatDate(t: number, zone: string | null | undefined, style: DateStyle): string {
  let z = zone || "UTC";
  try {
    dateFormat(z, "parts");
  } catch {
    z = "UTC";
  }
  if (style === "time") return clock(partsOf(t, z));
  if (style === "month") return dateFormat(z, "month").format(new Date(t * 1000));
  const eff = effectiveDateFormat();
  if (style === "day") {
    const date = new Date(t * 1000);
    if (eff === "auto-en") return dateFormat(z, "day").format(date).replace(/^(\p{L}+) /u, "$1, ");
    return `${dateFormat(z, "weekdayShort").format(date)}, ${numericDate(eff, "medium", partsOf(t, z))}`;
  }
  if (eff === "auto-en" || (style === "long" && currentDatePrefs().date === "auto")) {
    const text = dateFormat(z, style).format(new Date(t * 1000));
    return style === "long" && currentLocale() === "en" ? text.replace(/^(\p{L}+),/u, "$1") : text;
  }
  const numeric = numericDate(eff, style === "short" ? "short" : "medium", partsOf(t, z));
  if (style !== "long") return numeric;
  const weekday = dateFormat(z, "weekday").format(new Date(t * 1000));
  return currentLocale() === "de" ? `${weekday}, ${numeric}` : `${weekday} ${numeric}`;
}

/** Date and clock time together, e.g. "22.11.2026 14:35". */
export function formatDateTime(t: number, zone: string | null | undefined): string {
  return `${formatDate(t, zone, "medium")} ${formatDate(t, zone, "time")}`;
}

export function relativeDays(n: number): string {
  const r = RELATIVE[currentLocale()];
  if (n === 0) return r.today;
  if (n === 1) return r.yesterday;
  if (n === -1) return r.tomorrow;
  return n > 0 ? r.ago(n) : r.in(-n);
}
