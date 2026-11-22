/** CSV export (WP-07). Pure. */
import type { Agg, Reading, Unit, UserAnalysis } from "./types.ts";

export function toCsv(rows: (string | number | null)[][]): string {
  throw new Error("not implemented: toCsv");
}
export function exportRows(
  readings: Reading[],
  analysis: UserAnalysis,
  agg: Agg,
  metrics: number[],
  unit: Unit,
): (string | number | null)[][] {
  throw new Error("not implemented: exportRows");
}
export function csvFilename(name: string, from: number, to: number, agg: Agg): string {
  throw new Error("not implemented: csvFilename");
}
