/** Plain-language weekly rate sentence. Server only: it needs the message catalogue (trend.ts is shared with the web bundle). */
import { decimal, t } from "../i18n/index.ts";
import { isStable } from "./trend.ts";
import type { Rate, Unit } from "./types.ts";

const KG_TO_LB = 2.2046226218487757;

export function rateText(rate: Rate | null, unit: Unit): string {
  if (!rate) return t("an.rate.none");
  if (isStable(rate)) return t("an.rate.stable");
  const mass = unit === "kg" ? Math.abs(rate.perWeek) : Math.abs(rate.perWeek) * KG_TO_LB;
  const value = decimal(mass, mass < 0.1 ? 2 : 1);
  return t(rate.perWeek < 0 ? "an.rate.losing" : "an.rate.gaining", { value, unit: unit === "kg" ? "kg" : "lb" });
}

