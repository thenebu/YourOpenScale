/** Local-day helpers (WP-05). Pure: no node:* imports. */
export type LocalTime = { day: string; hour: number; minutes: number; weekday: number };

export function localTime(t: number, zone: string | null): LocalTime {
  throw new Error("not implemented: localTime");
}
export function addDays(day: string, n: number): string {
  throw new Error("not implemented: addDays");
}
export function daysBetween(a: string, b: string): number {
  throw new Error("not implemented: daysBetween");
}
export function isoWeekKey(day: string): string {
  throw new Error("not implemented: isoWeekKey");
}
export function monthKey(day: string): string {
  throw new Error("not implemented: monthKey");
}
export function dayNoonUtc(day: string): number {
  throw new Error("not implemented: dayNoonUtc");
}
