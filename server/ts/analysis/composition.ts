/** Body composition, recomposition and BMI (WP-06). Pure. */
import type {
  BmiCategory, DayPoint, Reading, Recomposition,
} from "./types.ts";

export function deriveComposition(readings: Reading[]): Reading[] {
  throw new Error("not implemented: deriveComposition");
}
export function recomposition(
  dWeight: number | null,
  dFat: number | null,
  dLean: number | null,
  rangeDays: number,
): Recomposition {
  throw new Error("not implemented: recomposition");
}
export function compositionMonthly(readings: Reading[]): {
  key: string; t: number; fat: number | null; muscle: number | null; bone: number | null;
  otherLean: number | null; water: number | null;
}[] {
  throw new Error("not implemented: compositionMonthly");
}
export function bmiSeries(daily: DayPoint[], heightCm: number | null, ageYears: number | null): DayPoint[] | null {
  throw new Error("not implemented: bmiSeries");
}
export function bmiCategory(bmi: number, ageYears: number | null): BmiCategory {
  throw new Error("not implemented: bmiCategory");
}
export function ffmi(ffmKg: number, heightCm: number, normalised = true): number {
  throw new Error("not implemented: ffmi");
}
export function fmi(fatKg: number, heightCm: number): number {
  throw new Error("not implemented: fmi");
}
