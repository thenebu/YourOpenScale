/** Translated metric names for the analysis views (server only; spec.ts keeps the English label for the web bundle). */
import { has, t } from "../i18n/index.ts";
import type { MetricSpec } from "./types.ts";

export function specLabel(spec: Pick<MetricSpec, "type" | "label">): string {
  const key = `spec.${spec.type}`;
  return has(key) ? t(key) : spec.label;
}
