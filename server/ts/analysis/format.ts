/** Display formatting (WP-05). Also imported by the web bundle: no node:* imports. */
import type { Unit } from "./types.ts";
export { chooseAgg } from "./series.ts";

export type DateStyle = "short" | "medium" | "long" | "time" | "month";

export function toDisplay(kg: number, unit: Unit): number {
  throw new Error("not implemented: toDisplay");
}
export function formatMass(kg: number, unit: Unit, opts: { decimals?: number } = {}): string {
  throw new Error("not implemented: formatMass");
}
export function formatMetric(
  value: number,
  type: number,
  unit: Unit,
  opts: { decimals?: number } = {},
): string {
  throw new Error("not implemented: formatMetric");
}
export function formatDelta(value: number, type: number, unit: Unit): string {
  throw new Error("not implemented: formatDelta");
}
export function formatRate(perWeekKg: number, unit: Unit): string {
  throw new Error("not implemented: formatRate");
}
export function formatDate(t: number, zone: string | null | undefined, style: DateStyle): string {
  throw new Error("not implemented: formatDate");
}
export function relativeDays(n: number): string {
  throw new Error("not implemented: relativeDays");
}
