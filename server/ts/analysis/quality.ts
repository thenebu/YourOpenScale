/** Outliers, duplicates and the data-quality report (WP-06). Pure. */
import type { QualityReport, Reading } from "./types.ts";

export function flagOutliers(
  readings: Reading[],
  type: number,
): Map<number, "implausible" | "jump" | "robust-z"> {
  throw new Error("not implemented: flagOutliers");
}
export function findDuplicates(readings: Reading[], windowSeconds = 180): number[] {
  throw new Error("not implemented: findDuplicates");
}
export function qualityReport(readings: Reading[], now: number): QualityReport {
  throw new Error("not implemented: qualityReport");
}
