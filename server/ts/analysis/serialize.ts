/** Wire encoding (tuples, rounded numbers) for the browser payload (WP-07). */
import type { DashboardSummary, UserAnalysis } from "./types.ts";

// WP-07 replaces these with the real tuple-encoded Wire* types.
export type WireUserAnalysis = unknown;
export type WireDashboardSummary = unknown;

export function serializeAnalysis(analysis: UserAnalysis): WireUserAnalysis {
  throw new Error("not implemented: serializeAnalysis");
}
export function serializeDashboard(summary: DashboardSummary): WireDashboardSummary {
  throw new Error("not implemented: serializeDashboard");
}
