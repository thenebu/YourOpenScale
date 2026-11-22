/** Analysis contracts shared by the server and the web bundle (type-only). */
export type Unit = "kg" | "lb" | "st";
export type RangeKey = "30d" | "90d" | "1y" | "all";
export type Agg = "raw" | "daily" | "weekly" | "monthly";
export type PointTuple = [number, number];
export type Point = { t: number; v: number };                     // t = epoch seconds
export type Reading = {
  id: number; t: number; zone: string | null; trusted: boolean; scaleId: number;
  values: Partial<Record<number, number>>;                         // metric type -> native value (kg, %, bpm…)
};
export type DayPoint = {
  day: string;          // local YYYY-MM-DD
  t: number;            // epoch seconds of the chosen (first) reading that day
  v: number;            // value of the chosen reading
  min: number; max: number; mean: number; n: number;              // over that day's (filtered) readings
  readingId: number;
};
export type Bucket = {
  key: string;          // "2025-W09" | "2025-03"
  start: number; end: number; t: number;                            // t = bucket midpoint for plotting
  mean: number; min: number; max: number; p25: number; p75: number;
  n: number;            // readings
  days: number;         // days with ≥ 1 reading
};
export type TrendPoint = { t: number; v: number; segment: number };
export type Rate = { perWeek: number; seWeek: number; n: number; days: number; from: number; to: number };
export type ProjectionStatus = "reached" | "on-track" | "too-slow" | "moving-away" | "stable" | "levels-off" | "insufficient";
export type Projection = {
  status: ProjectionStatus; goal: number; remaining: number;
  etaDays: number | null; date: string | null; earliest: string | null; latest: string | null;
  requiredPerWeek: number | null;   // only when the goal has a target date
  /** "decay": flattening-curve fit since the goal start; "linear": straight line at the current rate. */
  model: "linear" | "decay";
  plateauKg: number | null;         // fitted level the curve flattens out at (decay model only)
};
export type Goal = { kg: number; date: string | null; startKg: number; startAt: number; startManual?: boolean };
export type GoalProgress = { fraction: number; startKg: number; currentKg: number; goalKg: number };
export type Outlier = { readingId: number; t: number; v: number; reason: "implausible" | "jump" | "robust-z" };
export type MetricSpec = { type: number; key: string; label: string; unit: string;
  minSpan: number; alpha: number; bounds: [number, number]; madFloor: number; binWidth: number };
export type MetricStats = {
  latest: Point; trendLatest: number | null; min: Point; max: Point; mean: number;
  changeTrend: number | null;       // trend(to) − trend(from) over the visible range
};
export type MetricAnalysis = {
  type: number; key: string; label: string; unit: string;
  lod: { raw: (Point & { id: number })[] | null; daily: DayPoint[]; weekly: Bucket[]; monthly: Bucket[] };
  defaultAgg: Agg;
  trend: TrendPoint[];
  stats: MetricStats | null;
  rate: Rate | null;
  outliers: Outlier[];
  yExtent: [number, number];
  compare: { mode: "prev" | "yoy"; label: string; series: Point[] } | null;  // already shifted onto the current time axis
  table: { headers: string[]; rows: string[][] };                              // formatted fallback table (≤ 400 rows)
  summary: string;                                                              // one-sentence chart description
};
export type BmiCategory = "underweight" | "normal" | "overweight" | "obesity-1" | "obesity-2" | "obesity-3" | null;
export type RecompositionKind = "fat-loss" | "mixed-loss" | "recomposition" | "lean-gain" | "fat-gain" | "stable" | "unclear" | "insufficient";
export type Recomposition = { kind: RecompositionKind; dWeight: number | null; dFat: number | null; dLean: number | null; fatShare: number | null; text: string };
export type CompositionAnalysis = {
  fatMass: MetricAnalysis | null; leanMass: MetricAnalysis | null; fatPct: MetricAnalysis | null;
  monthly: { key: string; t: number; fat: number | null; muscle: number | null; bone: number | null; otherLean: number | null; water: number | null }[];
  recomposition: Recomposition;
  ffmi: number | null; fmi: number | null; waterPct: number | null;
};
export type WeekdayEffect = { weekday: number; label: string; mean: number; se: number; n: number };
export type TimeOfDayEffect = { slot: "night" | "morning" | "midday" | "evening"; hours: [number, number]; mean: number; se: number; n: number };
export type Histogram = { bins: { from: number; to: number; count: number }[]; mean: number; median: number; p10: number; p90: number; current: number | null };
export type YearSeries = { year: number; points: { doy: number; v: number }[] };
export type PeriodComparison = { id: "week" | "month" | "yoy30" | "ytd"; label: string;
  a: { from: number; to: number; mean: number; n: number }; b: { from: number; to: number; mean: number; n: number }; delta: number };
export type RecordItem = { id: "lowest" | "highest" | "low12m" | "drop7" | "gain7" | "bestMonth" | "longestStreak" | "sinceStart";
  label: string; value: number | null; t: number | null; detail: string };
export type Streaks = { current: number; longest: { days: number; from: string; to: string } | null };
export type QualityReport = {
  untrustedClock: number; zoneAssumed: number; duplicates: number; futureTimestamps: number;
  outliers: { type: number; label: string; count: number }[];
  gaps: { from: number; to: number; days: number }[];
};
export type UserAnalysis = {
  version: 1;
  user: { id: number; name: string; shortName: string; heightCm: number | null; ageYears: number | null; sex: 0 | 1 };
  unit: Unit;
  range: { key: RangeKey | "custom"; from: number; to: number; morningOnly: boolean; compare: "none" | "prev" | "yoy" };
  generatedAt: number;
  firstReadingAt: number | null; readingCount: number;
  weight: MetricAnalysis | null;
  bmi: { series: MetricAnalysis; latest: number; category: BmiCategory } | null;
  composition: CompositionAnalysis | null;
  metrics: MetricAnalysis[];          // all other observed metrics (not weight / fat / ffm / fat%)
  goal: Goal | null; progress: GoalProgress | null; projection: Projection | null;
  weeklyRate: Point[];                // Δtrend per ISO week (kg)
  periods: PeriodComparison[];
  habits: import("../habits.ts").Habits & { streaks: Streaks; calendar: { day: string; count: number }[]; daysLast7: number };
  patterns: { weekday: WeekdayEffect[] | null; timeOfDay: TimeOfDayEffect[] | null; histogram: Histogram | null; years: YearSeries[] | null };
  records: RecordItem[];
  quality: QualityReport;
  summary: string[];                  // plain-language paragraph sentences (Summary section)
};
export type DashboardSummary = {
  user: { id: number; name: string; shortName: string };
  unit: Unit;
  last: { t: number; weightKg: number | null } | null;
  daysSinceLast: number | null;
  trendKg: number | null;
  deltas: { d7: number | null; d30: number | null; d90: number | null };
  mini: { from: number; to: number; daily: Point[]; trend: TrendPoint[]; goalKg: number | null };
  rate: Rate | null; rateText: string;
  goal: Goal | null; progress: GoalProgress | null; projection: Projection | null;
  chips: { id: "fatPct" | "fatMass" | "muscle" | "bmi"; label: string; unit: string; value: number; delta30: number | null; type: number | null }[];
  consistency: { daysLast7: number; morningShare90: number | null };
};
