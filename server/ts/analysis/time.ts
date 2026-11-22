/** Local-day helpers (WP-05). Pure: no node:* imports. */
export type LocalTime = { day: string; hour: number; minutes: number; weekday: number };

const formats = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    formats.set(zone, f);
  }
  return f;
}

/** Local calendar parts of an instant (epoch seconds). A null/unknown zone means UTC. weekday: 0 = Monday. */
export function localTime(t: number, zone: string | null): LocalTime {
  let f: Intl.DateTimeFormat;
  try {
    f = formatterFor(zone ?? "UTC");
  } catch {
    f = formatterFor("UTC");
  }
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(t * 1000))) parts[p.type] = p.value;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const [y, m, d] = [Number(parts.year), Number(parts.month), Number(parts.day)];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return { day, hour: Number(parts.hour) % 24, minutes: Number(parts.minute), weekday };
}

function parseDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return fmtDay(parseDay(day) + n * 86400000);
}
/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}
/** 0 = Monday. */
export function weekdayOf(day: string): number {
  return (new Date(parseDay(day)).getUTCDay() + 6) % 7;
}
/** The Thursday of the ISO week containing `day`. */
export function isoWeekThursday(day: string): string {
  return addDays(day, 3 - weekdayOf(day));
}
/** ISO 8601 week key, e.g. "2026-W53". */
export function isoWeekKey(day: string): string {
  const thursday = isoWeekThursday(day);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export function monthKey(day: string): string {
  return day.slice(0, 7);
}
/** Epoch seconds of 12:00 UTC on the given day. */
export function dayNoonUtc(day: string): number {
  return (parseDay(day) + 12 * 3600000) / 1000;
}
