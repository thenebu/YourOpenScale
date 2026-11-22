/** Plain-language summary sentences (WP-07). Pure. */
import { percent, t } from "../i18n/index.ts";
import { formatDate, formatDelta, formatMass } from "./format.ts";
import { dayNoonUtc } from "./time.ts";
import { rateText } from "./rate_text.ts";
import type { UserAnalysis } from "./types.ts";

const month = (day: string) => formatDate(dayNoonUtc(day), "UTC", "month");

export function summarize(a: UserAnalysis): string[] {
  const out: string[] = [];
  const w = a.weight;
  if (!w || !w.stats) return out;
  const unit = a.unit;
  const mass = (kg: number) => formatMass(kg, unit, { decimals: 1 });

  // 1. Trend over the range.
  if (w.trend.length >= 2 && w.stats.changeTrend !== null) {
    const t0 = w.trend[0];
    const t1 = w.trend[w.trend.length - 1];
    const when =
      a.range.key === "all" && a.firstReadingAt !== null ? t("an.sum.since", { month: formatDate(a.firstReadingAt, "UTC", "month") })
      : a.range.key === "30d" ? t("an.sum.last30")
      : a.range.key === "90d" ? t("an.sum.last90")
      : a.range.key === "1y" ? t("an.sum.lastYear")
      : t("an.sum.between", { from: formatDate(t0.t, "UTC", "medium"), to: formatDate(t1.t, "UTC", "medium") });
    out.push(
      t("an.sum.trend", { when, from: mass(t0.v), to: mass(t1.v), delta: formatDelta(Math.round((t1.v - t0.v) * 10) / 10, 1, unit) }),
    );
  }

  // 2. Rate and projection.
  const parts = [`${rateText(w.rate, unit)}.`];
  const p = a.projection;
  if (a.goal && p) {
    const goal = mass(a.goal.kg);
    if (p.status === "reached") parts.push(t("an.sum.reached", { goal }));
    else if (p.status === "on-track" && p.date) {
      let s = t(p.model === "decay" ? "an.sum.onTrackDecay" : p.model === "prior" ? "an.sum.onTrackPrior" : "an.sum.onTrack", { goal, month: month(p.date) });
      if (p.earliest && p.latest && month(p.earliest) !== month(p.latest))
        s += t("an.sum.between2", { a: month(p.earliest), b: month(p.latest) });
      else if (p.earliest && !p.latest) s += t("an.sum.earliest", { a: month(p.earliest) });
      parts.push(`${s}.`);
    } else if (p.status === "levels-off") parts.push(t("an.sum.levelsOff", { goal, plateau: mass(p.plateauKg ?? p.goal) }));
    else if (p.status === "too-slow") parts.push(t("an.sum.tooSlow", { goal }));
    else if (p.status === "moving-away") parts.push(t("an.sum.away", { goal }));
    else if (p.status === "stable") parts.push(t("an.sum.holding"));
  }
  out.push(parts.join(" "));

  // 3. Composition.
  const rc = a.composition?.recomposition;
  if (rc && rc.kind !== "insufficient") out.push(rc.text);

  // 4. Consistency.
  if (a.habits.count > 0) {
    let s = t("an.sum.consistency", { n: a.habits.daysLast7 });
    if (a.habits.verdict !== "unknown") s += t("an.sum.mornings", { pct: percent(Math.round(a.habits.morningShare * 100)) });
    out.push(`${s}.`);
  }

  // 5. Quality hint.
  const flagged = a.quality.outliers.reduce((n, o) => n + o.count, 0);
  if (flagged > 0) {
    const implausible = w.outliers.length === flagged && w.outliers.every((o) => o.reason === "implausible");
    out.push(t("an.sum.flagged", { n: flagged, kind: t(implausible ? "an.sum.implausible" : "an.sum.unusual") }));
  }
  return out;
}
