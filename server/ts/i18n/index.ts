/** Server-side i18n: typed catalogue, `t()` and the per-request locale (AsyncLocalStorage). */
import { AsyncLocalStorage } from "node:async_hooks";
import { de } from "./de.ts";
import { en, type MessageKey } from "./en.ts";
import { DEFAULT_LOCALE, LANG_COOKIE, currentLocale, interpolate, isLocale, setDatePrefsProvider, setLocaleProvider, type DatePrefs, type Locale } from "./locale.ts";

export { DATEFMT_COOKIE, DATE_FORMATS, TIMEFMT_COOKIE, TIME_FORMATS, currentDatePrefs, isDateFormat, isTimeFormat, type DateFormatPref, type DatePrefs, type TimeFormatPref } from "./locale.ts";
export { DEFAULT_LOCALE, LANG_COOKIE, LOCALES, currentLocale, decimal, intlTag, interpolate, isLocale, percent, plural, type Locale } from "./locale.ts";
export type { MessageKey } from "./en.ts";

export const catalogues: Record<Locale, Record<MessageKey, string>> = { en, de };

const store = new AsyncLocalStorage<Locale>();
setLocaleProvider(() => store.getStore() ?? DEFAULT_LOCALE);

const prefsStore = new AsyncLocalStorage<DatePrefs>();
setDatePrefsProvider(() => prefsStore.getStore() ?? { date: "auto", time: "auto" });

/** Runs `fn` with the date/time display preferences of the request. */
export function withDatePrefs<T>(prefs: DatePrefs, fn: () => T): T {
  return prefsStore.run(prefs, fn);
}

/** Runs `fn` with `locale` as the current locale; async continuations keep it. */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return store.run(locale, fn);
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const locale = currentLocale();
  return interpolate(catalogues[locale][key] ?? en[key], params, locale);
}

/** True when `key` exists in the catalogue (for keys built from data, such as metric ids). */
export function has(key: string): key is MessageKey {
  return key in en;
}

/** Reads `yos_lang` from a Cookie header. */
export function langFromCookie(header: string | null | undefined): Locale | null {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== LANG_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return isLocale(value) ? value : null;
  }
  return null;
}

/** First Accept-Language entry (by order) whose primary subtag is supported: de* -> de, en* -> en. */
export function langFromAcceptLanguage(header: string | null | undefined): Locale | null {
  for (const part of (header ?? "").split(",")) {
    const [tag, ...rest] = part.trim().split(";");
    const q = rest.map((r) => /^\s*q\s*=\s*([\d.]+)/.exec(r)?.[1]).find(Boolean);
    if (q !== undefined && Number(q) === 0) continue;
    const primary = tag.trim().slice(0, 2).toLowerCase();
    if (isLocale(primary) && (tag.trim().length === 2 || tag.trim()[2] === "-")) return primary;
  }
  return null;
}

/** Cookie, then Accept-Language, then English. */
export function negotiateLocale(request: Request): Locale {
  return langFromCookie(request.headers.get("Cookie")) ?? langFromAcceptLanguage(request.headers.get("Accept-Language")) ?? DEFAULT_LOCALE;
}
