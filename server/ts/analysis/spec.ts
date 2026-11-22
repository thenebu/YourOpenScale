import type { MetricSpec } from "./types.ts";

/** Per-metric analysis parameters (pseudo-type -1 is BMI). */
const row = (
  type: number,
  key: string,
  label: string,
  unit: string,
  minSpan: number,
  alpha: number,
  bounds: [number, number],
  madFloor: number,
  binWidth: number,
): MetricSpec => ({ type, key, label, unit, minSpan, alpha, bounds, madFloor, binWidth });

export const METRIC_SPEC: MetricSpec[] = [
  row(1, "weight_kg", "Weight", "kg", 2, 0.1, [20, 350], 0.4, 0.5),
  row(6, "fat_ratio_pct", "Body fat", "%", 2, 0.1, [2, 70], 0.5, 0.5),
  row(8, "fat_mass_kg", "Fat mass", "kg", 1, 0.1, [1, 250], 0.3, 0.5),
  row(5, "fat_free_mass_kg", "Lean mass", "kg", 1, 0.1, [15, 200], 0.3, 0.5),
  row(76, "muscle_mass_kg", "Muscle mass", "kg", 1, 0.1, [10, 150], 0.3, 0.5),
  row(77, "water_mass_kg", "Water mass", "kg", 1, 0.1, [10, 150], 0.3, 0.5),
  row(88, "bone_mass_kg", "Bone mass", "kg", 0.5, 0.1, [0.5, 8], 0.1, 0.1),
  row(11, "heart_rate_bpm", "Heart rate", "bpm", 10, 0.15, [25, 230], 3, 2),
  row(170, "visceral_fat_index", "Visceral fat", "", 2, 0.1, [0, 60], 0.5, 1),
  row(226, "basal_metabolic_rate_kcal", "Basal metabolic rate", "kcal", 100, 0.1, [500, 5000], 20, 25),
  row(227, "metabolic_age_years", "Metabolic age", "years", 4, 0.1, [5, 120], 1, 1),
  row(91, "pulse_wave_velocity_mps", "Pulse wave velocity", "m/s", 1, 0.1, [2, 25], 0.2, 0.25),
  row(155, "vascular_age_years", "Vascular age", "years", 4, 0.1, [5, 120], 1, 1),
  row(-1, "bmi", "BMI", "", 1, 0.1, [8, 90], 0.15, 0.25),
];

export function specFor(type: number): MetricSpec | undefined {
  return METRIC_SPEC.find((spec) => spec.type === type);
}
