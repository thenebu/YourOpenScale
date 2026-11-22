/** Body composition, recomposition and BMI (WP-06). Pure. */
import { mean } from "./stats.ts";
import { dayNoonUtc, localTime } from "./time.ts";
import type { BmiCategory, DayPoint, Reading, Recomposition } from "./types.ts";

/** Copies of the readings with fat mass (8), lean mass (5) and fat % (6) derived where missing. */
export function deriveComposition(readings: Reading[]): Reading[] {
  return readings.map((r) => {
    const w = r.values[1];
    const hasW = w !== undefined && w !== null && w > 0;
    const fm = r.values[8] ?? (r.values[6] != null && hasW ? (w! * r.values[6]) / 100 : undefined);
    const ffm = r.values[5] ?? (fm != null && hasW ? w! - fm : undefined);
    const pct = r.values[6] ?? (fm != null && hasW ? (100 * fm) / w! : undefined);
    const values: Reading["values"] = { ...r.values };
    if (fm !== undefined) values[8] = fm;
    if (ffm !== undefined) values[5] = ffm;
    if (pct !== undefined) values[6] = pct;
    return { ...r, values };
  });
}

const NOTE =
  "Bathroom-scale body composition (bioimpedance) shifts with hydration; trust multi-week trends, not single days.";
const kg = (v: number) => Math.abs(v).toFixed(1);

/** deltas are 14-day means at the end of the range minus those at its start. */
export function recomposition(
  dWeight: number | null,
  dFat: number | null,
  dLean: number | null,
  rangeDays: number,
): Recomposition {
  const make = (
    kind: Recomposition["kind"], fatShare: number | null, text: string,
  ): Recomposition => ({ kind, dWeight, dFat, dLean, fatShare, text: `${text} ${NOTE}` });
  if (dWeight === null || dFat === null || dLean === null || rangeDays < 42)
    return make("insufficient", null, "Not enough body composition readings in this period to say what changed.");
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  if (Math.abs(dWeight) < 1 && dFat <= -0.7 && dLean >= 0.5)
    return make("recomposition", null,
      `Your weight held steady while fat mass fell ${kg(dFat)} kg and lean mass rose ${kg(dLean)} kg.`);
  if (dWeight <= -1) {
    const share = clamp(dFat / dWeight);
    const pct = Math.round(share * 100);
    if (share >= 0.6)
      return make("fat-loss", share, `About ${pct}% of the ${kg(dWeight)} kg you lost was fat.`);
    return make("mixed-loss", share,
      `Of the ${kg(dWeight)} kg lost, about ${pct}% was fat; the rest came from lean mass (water, glycogen, muscle).`);
  }
  if (dWeight >= 1) {
    if (dLean / dWeight >= 0.6)
      return make("lean-gain", clamp(dFat / dWeight),
        `About ${Math.round(clamp(dLean / dWeight) * 100)}% of the ${kg(dWeight)} kg you gained was lean mass.`);
    if (dFat / dWeight >= 0.6)
      return make("fat-gain", clamp(dFat / dWeight),
        `About ${Math.round(clamp(dFat / dWeight) * 100)}% of the ${kg(dWeight)} kg you gained was fat.`);
  }
  if (Math.abs(dWeight) < 1 && Math.abs(dFat) < 0.7 && Math.abs(dLean) < 0.7)
    return make("stable", null, "Your weight and body composition stayed about the same.");
  return make("unclear", null, "Weight and body composition changed, but not in a clear pattern.");
}

/** Monthly means; otherLean = lean − muscle − bone (null when missing or negative). */
export function compositionMonthly(readings: Reading[]): {
  key: string; t: number; fat: number | null; muscle: number | null; bone: number | null;
  otherLean: number | null; water: number | null;
}[] {
  const groups = new Map<string, Map<number, number[]>>();
  for (const r of deriveComposition(readings)) {
    const key = localTime(r.t, r.zone).day.slice(0, 7);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = new Map()));
    for (const type of [8, 5, 76, 88, 77]) {
      const v = r.values[type];
      if (v === undefined || v === null || !Number.isFinite(v)) continue;
      const list = g.get(type);
      if (list) list.push(v);
      else g.set(type, [v]);
    }
  }
  const out: ReturnType<typeof compositionMonthly> = [];
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    const m = (type: number) => (g.has(type) ? mean(g.get(type)!) : null);
    const [fat, ffm, muscle, bone, water] = [m(8), m(5), m(76), m(88), m(77)];
    if (fat === null && muscle === null && bone === null && water === null && ffm === null) continue;
    let otherLean: number | null = null;
    if (ffm !== null && muscle !== null && bone !== null) {
      const o = ffm - muscle - bone;
      otherLean = o >= 0 ? o : null;
    }
    out.push({ key, t: dayNoonUtc(`${key}-15`), fat, muscle, bone, otherLean, water });
  }
  return out;
}

/** BMI per day; null for unknown height or a minor (WHO adult categories only). */
export function bmiSeries(daily: DayPoint[], heightCm: number | null, ageYears: number | null): DayPoint[] | null {
  if (heightCm === null || !(heightCm > 0)) return null;
  if (ageYears !== null && ageYears < 18) return null;
  const h2 = (heightCm / 100) ** 2;
  return daily.map((d) => ({
    ...d, v: d.v / h2, min: d.min / h2, max: d.max / h2, mean: d.mean / h2,
  }));
}

export function bmiCategory(bmi: number, ageYears: number | null): BmiCategory {
  if (!Number.isFinite(bmi) || (ageYears !== null && ageYears < 18)) return null;
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  if (bmi < 35) return "obesity-1";
  if (bmi < 40) return "obesity-2";
  return "obesity-3";
}

/** Fat-free mass index; normalised to 1.8 m by default. */
export function ffmi(ffmKg: number, heightCm: number, normalised = true): number {
  const h = heightCm / 100;
  const raw = ffmKg / (h * h);
  return normalised ? raw + 6.1 * (1.8 - h) : raw;
}
export function fmi(fatKg: number, heightCm: number): number {
  const h = heightCm / 100;
  return fatKg / (h * h);
}
