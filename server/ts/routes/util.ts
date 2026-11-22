/** Helpers shared by the fork routes. */
import { DATEFMT_COOKIE, TIMEFMT_COOKIE, isDateFormat, isTimeFormat, type DateFormatPref, type DatePrefs, type TimeFormatPref } from "../i18n/locale.ts";
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Reads the `yow_theme` cookie: "light" | "dark", otherwise null (system). */
export function themeFromCookie(request: Request): "light" | "dark" | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== "yow_theme") continue;
    const value = part.slice(index + 1).trim();
    return value === "light" || value === "dark" ? value : null;
  }
  return null;
}

function cookieRaw(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Reads `yos_datefmt`; invalid or missing values mean "auto". */
export function dateFormatFromCookie(request: Request): DateFormatPref {
  const value = cookieRaw(request, DATEFMT_COOKIE);
  return isDateFormat(value) ? value : "auto";
}

/** Reads `yos_timefmt`; invalid or missing values mean "auto". */
export function timeFormatFromCookie(request: Request): TimeFormatPref {
  const value = cookieRaw(request, TIMEFMT_COOKIE);
  return isTimeFormat(value) ? value : "auto";
}

export function datePrefsFromCookie(request: Request): DatePrefs {
  return { date: dateFormatFromCookie(request), time: timeFormatFromCookie(request) };
}
