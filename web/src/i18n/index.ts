/** Browser i18n: strings follow <html lang> (set by the server from the yos_lang cookie / Accept-Language). Tiny on purpose. */
import { currentDatePrefs, currentLocale, intlTag, interpolate } from "../../../server/ts/i18n/locale.ts";
import { de } from "./de.ts";
import { en, type WebKey } from "./en.ts";

export { currentLocale };
export type { WebKey };

export function t(key: WebKey, params?: Record<string, string | number>): string {
  const locale = currentLocale();
  return interpolate((locale === "de" ? de : en)[key] ?? en[key], params, locale);
}

/** Intl tag of the page language ("en-GB" / "de-DE"). */
export const tag = (): string => intlTag(currentLocale());

/** Short month names of the page language (Jan..Dec). */
export function monthNames(): string[] {
  const f = new Intl.DateTimeFormat(tag(), { month: "short", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, m) => f.format(new Date(Date.UTC(2026, m, 15))));
}

/** Short weekday names, Monday first. */
export function weekdayNames(): string[] {
  const f = new Intl.DateTimeFormat(tag(), { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, d) => f.format(new Date(Date.UTC(2024, 0, 1 + d))));
}

const numbers = new Map<string, Intl.NumberFormat>();
/** Fixed-decimals number in the page language ("81.4" / "81,4"). */
export function fixed(value: number, decimals = 1): string {
  const key = `${tag()}|${decimals}`;
  let f = numbers.get(key);
  if (!f) numbers.set(key, (f = new Intl.NumberFormat(tag(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })));
  return f.format(Number.isFinite(value) ? value : 0);
}

/** ECharts time-axis template for day-level tick labels ("12 Nov", "12.11.", "11/12"), following the date format preference. */
export function dayAxis(): string {
  const pref = currentDatePrefs().date;
  const f = pref === "auto" ? (currentLocale() === "de" ? "dmy-dot" : "auto") : pref;
  if (f === "dmy-dot") return "{dd}.{MM}.";
  if (f === "ymd") return "{MM}-{dd}";
  if (f === "mdy") return "{MM}/{dd}";
  if (f === "dmy-slash") return "{dd}/{MM}";
  return "{d} {MMM}";
}
