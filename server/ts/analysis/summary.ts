/** Plain-language summary sentences (WP-07). Pure. */
import { formatDate, formatDelta, formatMass } from "./format.ts";
import { dayNoonUtc } from "./time.ts";
import { rateText } from "./trend.ts";
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
      a.range.key === "all" && a.firstReadingAt !== null ? `Since ${formatDate(a.firstReadingAt, "UTC", "month")}`
      : a.range.key === "30d" ? "Over the last 30 days"
      : a.range.key === "90d" ? "Over the last 90 days"
      : a.range.key === "1y" ? "Over the last year"
      : `Between ${formatDate(t0.t, "UTC", "medium")} and ${formatDate(t1.t, "UTC", "medium")}`;
    out.push(
      `${when} your trend weight went from ${mass(t0.v)} to ${mass(t1.v)} (${formatDelta(Math.round((t1.v - t0.v) * 10) / 10, 1, unit)}).`,
    );
  }

  // 2. Rate and projection.
  const parts = [`${rateText(w.rate, unit)}.`];
  const p = a.projection;
  if (a.goal && p) {
    const goal = mass(a.goal.kg);
    if (p.status === "reached") parts.push(`You have reached your goal of ${goal}.`);
    else if (p.status === "on-track" && p.date) {
      let s = `At this pace you would reach your goal of ${goal} around ${month(p.date)}`;
      if (p.earliest && p.latest && month(p.earliest) !== month(p.latest))
        s += `, somewhere between ${month(p.earliest)} and ${month(p.latest)}`;
      else if (p.earliest && !p.latest) s += `, possibly as early as ${month(p.earliest)} but it could take considerably longer`;
      parts.push(`${s}.`);
    } else if (p.status === "too-slow") parts.push(`At this pace your goal of ${goal} is more than two years away.`);
    else if (p.status === "moving-away") parts.push(`Your trend is currently moving away from your goal of ${goal}.`);
    else if (p.status === "stable") parts.push("At your current pace you are holding steady.");
  }
  out.push(parts.join(" "));

  // 3. Composition.
  const rc = a.composition?.recomposition;
  if (rc && rc.kind !== "insufficient") out.push(rc.text);

  // 4. Consistency.
  if (a.habits.count > 0) {
    let s = `You weighed in on ${a.habits.daysLast7} of the last 7 days`;
    if (a.habits.verdict !== "unknown") s += `; ${Math.round(a.habits.morningShare * 100)}% of weigh-ins were in the morning`;
    out.push(`${s}.`);
  }

  // 5. Quality hint.
  const flagged = a.quality.outliers.reduce((n, o) => n + o.count, 0);
  if (flagged > 0) {
    const implausible = w.outliers.length === flagged && w.outliers.every((o) => o.reason === "implausible");
    out.push(
      `${flagged} reading${flagged === 1 ? " looks" : "s look"} ${implausible ? "implausible" : "unusual"} and ${flagged === 1 ? "is" : "are"} left out of the trend.`,
    );
  }
  return out;
}
