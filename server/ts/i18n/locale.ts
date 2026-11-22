/** Locale basics shared by the server and the web bundle: no node:* imports, no catalogue. */
export type Locale = "en" | "de";
export const LOCALES: readonly Locale[] = ["en", "de"];
export const DEFAULT_LOCALE: Locale = "en";
export const LANG_COOKIE = "yos_lang";

export const isLocale = (value: unknown): value is Locale => value === "en" || value === "de";

/** BCP 47 tag used for Intl formatting. English keeps the day-month-year order of the original UI. */
export const intlTag = (locale: Locale): string => (locale === "de" ? "de-DE" : "en-GB");

let provider: (() => Locale) | null = null;

/** The server installs an AsyncLocalStorage-backed provider; the browser falls back to <html lang>. */
export function setLocaleProvider(fn: (() => Locale) | null): void {
  provider = fn;
}

export function currentLocale(): Locale {
  if (provider) return provider();
  const doc = (globalThis as { document?: { documentElement?: { lang?: string } } }).document;
  const lang = doc?.documentElement?.lang?.slice(0, 2).toLowerCase();
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

export const DATEFMT_COOKIE = "yos_datefmt";
export const TIMEFMT_COOKIE = "yos_timefmt";
export const DATE_FORMATS = ["auto", "dmy-dot", "ymd", "mdy", "dmy-slash"] as const;
export const TIME_FORMATS = ["auto", "24h", "12h"] as const;
export type DateFormatPref = (typeof DATE_FORMATS)[number];
export type TimeFormatPref = (typeof TIME_FORMATS)[number];
export interface DatePrefs {
  date: DateFormatPref;
  time: TimeFormatPref;
}
export const isDateFormat = (value: unknown): value is DateFormatPref => DATE_FORMATS.includes(value as DateFormatPref);
export const isTimeFormat = (value: unknown): value is TimeFormatPref => TIME_FORMATS.includes(value as TimeFormatPref);

let prefsProvider: (() => DatePrefs) | null = null;

/** The server installs an AsyncLocalStorage-backed provider; the browser reads <html data-datefmt data-timefmt>. */
export function setDatePrefsProvider(fn: (() => DatePrefs) | null): void {
  prefsProvider = fn;
}

export function currentDatePrefs(): DatePrefs {
  if (prefsProvider) return prefsProvider();
  const data = (globalThis as { document?: { documentElement?: { dataset?: Record<string, string | undefined> } } }).document?.documentElement?.dataset;
  const date = data?.datefmt;
  const time = data?.timefmt;
  return { date: isDateFormat(date) ? date : "auto", time: isTimeFormat(time) ? time : "auto" };
}

/** ICU-lite plural choice: `plural(2, { one: "day", other: "days" })`. */
export function plural<T>(n: number, forms: { one: T; other: T }, locale: Locale = currentLocale()): T {
  return new Intl.PluralRules(intlTag(locale)).select(n) === "one" ? forms.one : forms.other;
}

type Params = Record<string, string | number>;

/** Finds the end of the `{...}` group that starts at `from` (the index of the opening brace). */
function closing(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return text.length;
}

/**
 * Interpolates `{name}` and `{n, plural, one {# day} other {# days}}` (`#` is the number).
 * Unknown parameters stay visible as `{name}` so a missing value is easy to spot.
 */
export function interpolate(template: string, params: Params = {}, locale: Locale = currentLocale()): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch !== "{") {
      out += ch;
      continue;
    }
    const end = closing(template, i);
    const inner = template.slice(i + 1, end);
    const head = /^\s*(\w+)\s*,\s*plural\s*,/.exec(inner);
    if (head) {
      const n = Number(params[head[1]] ?? 0);
      const forms = new Map<string, string>();
      const body = inner.slice(head[0].length);
      for (let j = 0; j < body.length; j++) {
        const m = /^\s*(\w+)\s*\{/.exec(body.slice(j));
        if (!m) break;
        const open = j + m[0].length - 1;
        const close = closing(body, open);
        forms.set(m[1], body.slice(open + 1, close));
        j = close;
      }
      const chosen = new Intl.PluralRules(intlTag(locale)).select(n);
      const form = forms.get(chosen) ?? forms.get("other") ?? "";
      out += interpolate(form.replaceAll("#", String(n)), params, locale);
    } else {
      const name = inner.trim();
      out += name in params ? String(params[name]) : `{${name}}`;
    }
    i = end;
  }
  return out;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
/** Fixed-decimals number in the current locale ("0.7" / "0,7"); a locale-aware toFixed(). */
export function decimal(value: number, digits = 1, locale: Locale = currentLocale()): string {
  const key = `${locale}|${digits}`;
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(intlTag(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(value);
}

/** "42%" in English, "42 %" (no-break space) in German. */
export function percent(value: number, locale: Locale = currentLocale()): string {
  return `${value}${locale === "de" ? " " : ""}%`;
}
