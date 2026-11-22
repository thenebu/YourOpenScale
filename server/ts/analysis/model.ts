/** Builds the UserAnalysis / DashboardSummary payloads (WP-07). Pure: `now` is a parameter. */
import { t } from "../i18n/index.ts";
import { specLabel } from "./labels.ts";
import { MORNING, MIN_READINGS, weighHabits } from "../habits.ts";
import {
  bmiCategory, bmiSeries, compositionMonthly, deriveComposition, ffmi, fmi, recomposition,
} from "./composition.ts";
import { calendarCells, daysInLast, streaks } from "./consistency.ts";
import { formatDate, formatMass, formatMetric } from "./format.ts";
import {
  compareSeries, histogram, periodComparisons, timeOfDayEffect, weekdayEffect, yearOverlay,
} from "./patterns.ts";
import { findDuplicates, flagOutliers } from "./quality.ts";
import { rateText } from "./rate_text.ts";
import { records } from "./records.ts";
import { bucketize, chooseAgg, dailySeries, readingPoints, yExtent } from "./series.ts";
import { specFor } from "./spec.ts";
import { mean, stats } from "./stats.ts";
import { summarize } from "./summary.ts";
import { dayNoonUtc, daysBetween, localTime } from "./time.ts";
import {
  ewmaTrend, goalProgress, linearRate, projectGoal, trendAt, weeklyRateSeries, type ProjectionProfile,
} from "./trend.ts";
import type {
  Agg, Bucket, CompositionAnalysis, DashboardSummary, DayPoint, Goal, MetricAnalysis, MetricSpec,
  Outlier, Point, QualityReport, RangeKey, Reading, Unit, UserAnalysis,
} from "./types.ts";

const DAY = 86400;
const FUTURE_TOLERANCE = 300;
const TABLE_ROWS = 400;
const COMPOSITION_TYPES = new Set([5, 6, 8]);

export type UserInfo = {
  id: number; name: string; shortName: string; heightCm: number | null; ageYears: number | null; sex: 0 | 1;
};
export type AnalysisInput = {
  user: UserInfo;
  /** All history the caller has loaded (records are global); sorted or not. */
  readings: Reading[];
  unit: Unit;
  range: { key: RangeKey | "custom"; from: number; to: number; morningOnly: boolean; compare: "none" | "prev" | "yoy" };
  goal: Goal | null;
  now: number;
};

type Reason = "implausible" | "jump" | "robust-z";
type Series = {
  type: number; spec: MetricSpec; readings: Reading[];
  flags: Map<number, Reason>; daily: DayPoint[]; trend: ReturnType<typeof ewmaTrend>;
};

function sortReadings(readings: Reading[]): Reading[] {
  return readings.slice().sort((a, b) => a.t - b.t || a.id - b.id);
}

function makeSeries(readings: Reading[], type: number, morningOnly: boolean): Series | null {
  const spec = specFor(type);
  if (!spec) return null;
  const flags = flagOutliers(readings, type);
  const daily = dailySeries(readings, type, { morningOnly, exclude: new Set(flags.keys()) });
  return { type, spec, readings, flags, daily, trend: ewmaTrend(daily, spec) };
}

/** Series with at least one value; used for display decisions. */
const populated = (s: Series | null): Series | null => (s && s.daily.length ? s : null);

const inRange = <T extends { t: number }>(list: T[], from: number, to: number): T[] =>
  list.filter((p) => p.t >= from && p.t <= to);

const dayLabel = (day: string) => formatDate(dayNoonUtc(day), "UTC", "medium");

function rangePhrase(key: RangeKey | "custom"): string {
  return t(key === "30d" ? "an.rangeLast30" : key === "90d" ? "an.rangeLast90" : key === "1y" ? "an.rangeLastYear"
    : key === "all" ? "an.rangeAll" : "an.rangeSelected");
}
const AGG_PHRASE: Record<Agg, () => string> = {
  raw: () => t("an.aggRaw"), daily: () => t("an.aggDaily"), weekly: () => t("an.aggWeekly"), monthly: () => t("an.aggMonthly"),
};

type Ctx = {
  from: number; to: number; now: number; end: number; morningOnly: boolean; unit: Unit;
  zone: string | null; key: RangeKey | "custom"; spanDays: number; compare: "none" | "prev" | "yoy";
};

function buildMetric(
  s: Series,
  ctx: Ctx,
  opts: { label?: string; primary?: boolean; goalKg?: number | null; allLod?: boolean; tableRows?: number },
): MetricAnalysis {
  const { spec, type } = s;
  const label = opts.label ?? specLabel(spec);
  const dailyVis = inRange(s.daily, ctx.from, ctx.to);
  const trendVis = inRange(s.trend, ctx.from, ctx.to);
  const byId = new Map<number, Reading>();
  for (const r of s.readings) byId.set(r.id, r);

  let raw: (Point & { id: number })[] | null = null;
  let rawCount = 0;
  if (opts.primary) {
    const rangeReadings = s.readings.filter((r) => {
      if (r.t < ctx.from || r.t > ctx.to) return false;
      if (!ctx.morningOnly) return true;
      const h = localTime(r.t, r.zone).hour;
      return h >= MORNING.from && h < MORNING.to;
    });
    const pts = readingPoints(rangeReadings, type, new Set(s.flags.keys()));
    rawCount = pts.length;
    if (ctx.spanDays <= 400 && pts.length <= 6000) raw = pts;
  }
  const full = opts.primary || opts.allLod || ctx.key === "all" || ctx.spanDays > 1100 || dailyVis.length > 400;
  const weekly = full ? bucketize(dailyVis, "week") : [];
  const monthly = full ? bucketize(dailyVis, "month") : [];
  let defaultAgg = chooseAgg(ctx.spanDays, opts.primary ? rawCount : Infinity);
  if (defaultAgg === "raw" && !raw) defaultAgg = "daily";

  const outliers: Outlier[] = [];
  for (const [id, reason] of s.flags) {
    const r = byId.get(id);
    const v = r?.values[type];
    if (!r || v === undefined || r.t < ctx.from || r.t > ctx.to) continue;
    outliers.push({ readingId: id, t: r.t, v, reason });
  }
  outliers.sort((a, b) => a.t - b.t || a.readingId - b.readingId);

  const extentValues = [...dailyVis.map((d) => d.v), ...trendVis.map((p) => p.v)];
  if (opts.goalKg != null) extentValues.push(opts.goalKg);

  let compare: MetricAnalysis["compare"] = null;
  if (opts.primary && ctx.compare !== "none") {
    const series = compareSeries(s.daily, ctx.compare, ctx.from, ctx.to);
    if (series.length >= 2)
      compare = {
        mode: ctx.compare, series,
        label: t(ctx.compare === "yoy" ? "an.compare.yoy" : "an.compare.prev"),
      };
  }

  const trendByT = new Map(s.trend.map((p) => [p.t, p.v]));
  const fmt = (v: number) => formatMetric(v, type, ctx.unit);
  const tr = (t: number) => {
    const v = trendByT.get(t) ?? trendAt(s.trend, t, 3);
    return v === null || v === undefined ? "–" : fmt(v);
  };
  const limit = Math.min(TABLE_ROWS, opts.tableRows ?? TABLE_ROWS);
  const table = buildTable(defaultAgg, { raw, dailyVis, weekly, monthly }, byId, label, ctx, tr, fmt, type, limit);

  const metric: MetricAnalysis = {
    type, key: spec.key, label, unit: spec.unit,
    lod: { raw, daily: dailyVis, weekly, monthly },
    defaultAgg,
    trend: trendVis,
    stats: stats(dailyVis, trendVis),
    rate: opts.primary ? linearRate(s.daily, 28, ctx.end) : null,
    outliers,
    yExtent: yExtent(extentValues, spec),
    compare,
    table,
    summary: "",
  };
  metric.summary = describe(metric, ctx, fmt);
  return metric;
}

function buildTable(
  agg: Agg,
  lod: { raw: (Point & { id: number })[] | null; dailyVis: DayPoint[]; weekly: Bucket[]; monthly: Bucket[] },
  byId: Map<number, Reading>,
  label: string,
  ctx: Ctx,
  tr: (t: number) => string,
  fmt: (v: number) => string,
  type: number,
  limit: number,
): MetricAnalysis["table"] {
  if (agg === "raw" && lod.raw) {
    return {
      headers: [t("an.th.date"), t("an.th.time"), label, t("an.th.trend")],
      rows: lod.raw.slice(-limit).reverse().map((p) => {
        const zone = byId.get(p.id)?.zone ?? ctx.zone;
        return [formatDate(p.t, zone, "medium"), formatDate(p.t, zone, "time"), fmt(p.v), tr(p.t)];
      }),
    };
  }
  if (agg === "weekly" || agg === "monthly") {
    const list = agg === "weekly" ? lod.weekly : lod.monthly;
    return {
      headers: [t(agg === "weekly" ? "an.th.weekOf" : "an.th.month"), t("an.th.mean", { label }), t("an.th.range"), t("an.th.weighInDays")],
      rows: list.slice(-limit).reverse().map((b) => [
        agg === "weekly" ? formatDate(b.start, "UTC", "medium") : formatDate(b.t, "UTC", "month"),
        fmt(b.mean), t("an.rangeTo", { from: fmt(b.min), to: fmt(b.max) }), String(b.days),
      ]),
    };
  }
  return {
    headers: [t("an.th.date"), label, t("an.th.trend"), t("an.th.readings")],
    rows: lod.dailyVis.slice(-limit).reverse().map((d) => [dayLabel(d.day), fmt(d.v), tr(d.t), String(d.n)]),
  };
}

/** One-sentence chart description for aria-describedby. */
function describe(m: MetricAnalysis, ctx: Ctx, fmt: (v: number) => string): string {
  const head = t("an.describe.head", {
    label: m.label, range: rangePhrase(ctx.key), agg: AGG_PHRASE[m.defaultAgg](), trend: m.trend.length ? t("an.describe.withTrend") : "",
  });
  const st = m.stats;
  if (!st || !m.lod.daily.length) return t("an.describe.none", { head });
  const short = (ts: number) => formatDate(ts, "UTC", "short");
  if (m.lod.daily.length === 1) return t("an.describe.one", { head, value: fmt(st.latest.v), date: short(st.latest.t) });
  const parts: string[] = [];
  if (m.trend.length >= 2 && st.changeTrend !== null) {
    const a = m.trend[0].v;
    const b = m.trend[m.trend.length - 1].v;
    const tiny = Math.abs(st.changeTrend) < 0.05 * (specFor(m.type)?.minSpan ?? 1);
    parts.push(tiny ? t("an.describe.stable", { value: fmt(b) }) : t(st.changeTrend < 0 ? "an.describe.fell" : "an.describe.rose", { from: fmt(a), to: fmt(b) }));
  }
  parts.push(t("an.describe.minmax", { min: fmt(st.min.v), minDate: short(st.min.t), max: fmt(st.max.v), maxDate: short(st.max.t) }));
  return `${head} ${parts.join(" ")}`;
}

const meanIn = (daily: DayPoint[], from: number, to: number): { mean: number; n: number } => {
  const v = daily.filter((d) => d.t >= from && d.t <= to).map((d) => d.v);
  return { mean: v.length ? mean(v) : NaN, n: v.length };
};

function lastTrendValue(trend: { t: number; v: number }[], end: number, maxAgeDays: number): number | null {
  let last: { t: number; v: number } | null = null;
  for (const p of trend) if (p.t <= end) last = p;
  return last && end - last.t <= maxAgeDays * DAY ? last.v : null;
}

export function buildUserAnalysis(input: AnalysisInput): UserAnalysis {
  const { user, unit, range, goal, now } = input;
  const all = sortReadings(input.readings);
  const clean = all.filter((r) => r.t <= now + FUTURE_TOLERANCE);
  const zone = clean.length ? clean[clean.length - 1].zone : null;
  const end = Math.min(range.to, now);
  const first = clean.length ? clean[0].t : null;
  const spanDays = first === null ? 0 : Math.max(1, (end - Math.max(range.from, first)) / DAY);
  const ctx: Ctx = {
    from: range.from, to: range.to, now, end, morningOnly: range.morningOnly, unit, zone,
    key: range.key, spanDays, compare: range.compare,
  };
  const derived = deriveComposition(clean);

  const cache = new Map<number, Series | null>();
  const get = (type: number): Series | null => {
    if (!cache.has(type))
      cache.set(type, makeSeries(COMPOSITION_TYPES.has(type) ? derived : clean, type, range.morningOnly));
    return cache.get(type)!;
  };
  const weightS = populated(get(1));
  const trendNow = weightS ? lastTrendValue(weightS.trend, end, 30) : null;
  const weight = weightS
    ? buildMetric(weightS, ctx, { primary: true, goalKg: goal?.kg ?? null })
    : null;

  // BMI is derived from the cleaned weight series.
  let bmi: UserAnalysis["bmi"] = null;
  if (weightS) {
    const bmiDaily = bmiSeries(weightS.daily, user.heightCm, user.ageYears);
    const bmiSpec = specFor(-1)!;
    if (bmiDaily?.length) {
      const s: Series = {
        type: -1, spec: bmiSpec, readings: [], flags: new Map(), daily: bmiDaily,
        trend: ewmaTrend(bmiDaily, bmiSpec),
      };
      const series = buildMetric(s, ctx, { label: t("an.bmi"), allLod: true, tableRows: 60 });
      const latest = series.trend.length ? series.trend[series.trend.length - 1].v : series.stats?.latest.v;
      if (latest !== undefined && series.lod.daily.length)
        bmi = { series, latest, category: bmiCategory(latest, user.ageYears) };
    }
  }

  const sFat = get(6);
  const sFatMass = get(8);
  const sLean = get(5);
  const visible = (s: Series | null) => (s && s.daily.some((d) => d.t >= ctx.from && d.t <= ctx.to) ? s : null);
  const fatMass = visible(sFatMass) && buildMetric(sFatMass!, ctx, { label: t("an.fatMass"), tableRows: 60 });
  const leanMass = visible(sLean) && buildMetric(sLean!, ctx, { label: t("an.leanMass"), tableRows: 60 });
  const fatPct = visible(sFat) && buildMetric(sFat!, ctx, { label: t("an.bodyFat"), tableRows: 60 });

  let composition: CompositionAnalysis | null = null;
  if (fatMass || leanMass || fatPct) {
    const half = 14 * DAY;
    const startFrom = Math.max(ctx.from, weightS?.daily[0]?.t ?? ctx.from);
    const win = (s: Series | null) => ({
      a: s ? meanIn(s.daily, startFrom, startFrom + half - 1) : { mean: NaN, n: 0 },
      b: s ? meanIn(s.daily, end - half + 1, end) : { mean: NaN, n: 0 },
    });
    const w = win(weightS);
    const f = win(sFatMass);
    const l = win(sLean);
    const enough = f.a.n >= 4 && f.b.n >= 4 && l.a.n >= 4 && l.b.n >= 4 && w.a.n >= 1 && w.b.n >= 1;
    const recomp = recomposition(
      enough ? w.b.mean - w.a.mean : null,
      enough ? f.b.mean - f.a.mean : null,
      enough ? l.b.mean - l.a.mean : null,
      spanDays,
    );
    const recent = (s: Series | null) => (s && s.daily.length ? meanIn(s.daily, end - 7 * DAY, end) : null);
    const lean7 = recent(sLean);
    const fat7 = recent(sFatMass);
    const water = recent(get(77));
    const wt7 = recent(weightS);
    const h = user.heightCm;
    const ok = (x: { mean: number; n: number } | null) => (x && x.n > 0 ? x.mean : null);
    composition = {
      fatMass, leanMass, fatPct,
      monthly: compositionMonthly(inRange(clean, ctx.from, ctx.to)),
      recomposition: recomp,
      ffmi: h && ok(lean7) !== null ? ffmi(ok(lean7)!, h) : null,
      fmi: h && ok(fat7) !== null ? fmi(ok(fat7)!, h) : null,
      waterPct: ok(water) !== null && ok(wt7) !== null ? (100 * ok(water)!) / ok(wt7)! : null,
    };
  }

  // Remaining observed metrics.
  const types = new Set<number>();
  for (const r of derived) for (const k of Object.keys(r.values)) types.add(Number(k));
  const metrics: MetricAnalysis[] = [];
  for (const type of [...types].sort((a, b) => a - b)) {
    if (type === 1 || COMPOSITION_TYPES.has(type) || !specFor(type) || type < 0) continue;
    const s = visible(get(type));
    if (s) metrics.push(buildMetric(s, ctx, { tableRows: 60 }));
  }

  // Goal, rate, weekly rate, periods.
  const rate = weight?.rate ?? null;
  const goalOut = goal;
  const progress = goal ? goalProgress(trendNow, goal) : null;
  const fatNow = sFat && sFat.trend.length ? lastTrendValue(sFat.trend, end, 30) : null;
  const profile: ProjectionProfile = { heightCm: user.heightCm, ageYears: user.ageYears, sex: user.sex, fatPct: fatNow };
  const projection = goal ? projectGoal(trendNow, rate, goal, now, weightS?.daily, profile) : null;
  const weeklyRate = weightS ? inRange(weeklyRateSeries(weightS.trend), ctx.from, ctx.to) : [];
  const periods = weightS ? periodComparisons(weightS.daily, now, zone) : [];

  // Habits.
  const weighings = clean.filter((r) => r.values[1] !== undefined);
  const inRangeWeighings = weighings.filter((r) => r.t >= ctx.from && r.t <= ctx.to);
  const weighDays = weighings.map((r) => localTime(r.t, r.zone).day);
  const today = localTime(now, zone).day;
  const calFrom = Math.max(ctx.from, end - 5 * 366 * DAY, first ?? ctx.from);
  const habits = {
    ...weighHabits(inRangeWeighings.map((r) => ({ t: r.t, zone: r.zone }))),
    streaks: streaks(weighDays, today),
    calendar: first === null ? [] : calendarCells(weighings, calFrom, end),
    daysLast7: daysInLast(weighings, 7, now),
  };

  const dailyVis = weightS ? inRange(weightS.daily, ctx.from, ctx.to) : [];
  const patterns: UserAnalysis["patterns"] = {
    weekday: weightS ? weekdayEffect(dailyVis) : null,
    timeOfDay: weightS ? timeOfDayEffect(inRangeWeighings, dailyVis, 1) : null,
    histogram: weightS ? histogram(dailyVis, weightS.spec, unit, trendNow) : null,
    years: weightS ? yearOverlay(weightS.daily) : null,
  };

  const recs = weightS ? records(weightS.daily, weightS.trend, habits.streaks, now) : [];

  const quality = (): QualityReport => {
    let untrustedClock = 0;
    let zoneAssumed = 0;
    let futureTimestamps = 0;
    for (const r of all) {
      if (!r.trusted) untrustedClock++;
      if (r.zone === null) zoneAssumed++;
      if (r.t > now + FUTURE_TOLERANCE) futureTimestamps++;
    }
    const outliers: QualityReport["outliers"] = [];
    for (const type of [...types].sort((a, b) => a - b)) {
      const s = get(type);
      if (s && s.flags.size > 0) outliers.push({ type, label: specLabel(s.spec), count: s.flags.size });
    }
    const gaps: QualityReport["gaps"] = [];
    for (let i = 1; i < clean.length; i++) {
      if (clean[i].t - clean[i - 1].t > 30 * DAY)
        gaps.push({
          from: clean[i - 1].t, to: clean[i].t,
          days: daysBetween(localTime(clean[i - 1].t, null).day, localTime(clean[i].t, null).day),
        });
    }
    return { untrustedClock, zoneAssumed, duplicates: findDuplicates(all).length, futureTimestamps, outliers, gaps };
  };

  const analysis: UserAnalysis = {
    version: 1,
    user: { ...user },
    unit,
    range: { ...range },
    generatedAt: now,
    firstReadingAt: first,
    readingCount: clean.length,
    weight, bmi, composition, metrics,
    goal: goalOut, progress, projection,
    weeklyRate, periods, habits, patterns,
    records: recs,
    quality: quality(),
    summary: [],
  };
  analysis.summary = summarize(analysis);
  return analysis;
}

const CHIPS: { id: DashboardSummary["chips"][number]["id"]; type: number }[] = [
  { id: "fatPct", type: 6 },
  { id: "fatMass", type: 8 },
  { id: "muscle", type: 76 },
];

export function buildDashboardSummary(input: {
  user: Pick<UserInfo, "id" | "name" | "shortName"> & Partial<UserInfo>;
  readings: Reading[];
  unit: Unit;
  goal: Goal | null;
  now: number;
}): DashboardSummary {
  const { user, unit, goal, now } = input;
  const clean = sortReadings(input.readings).filter((r) => r.t <= now + FUTURE_TOLERANCE);
  const zone = clean.length ? clean[clean.length - 1].zone : null;
  const weightS = populated(makeSeries(clean, 1, false));
  const userOut = { id: user.id, name: user.name, shortName: user.shortName };

  const lastPoint = weightS ? readingPoints(clean, 1, new Set(weightS.flags.keys())).pop() ?? null : null;
  const trend = weightS?.trend ?? [];
  const lastTrend = trend.length ? trend[trend.length - 1] : null;
  const delta = (days: number): number | null => {
    if (!lastTrend) return null;
    const before = trendAt(trend, lastTrend.t - days * DAY, 3);
    return before === null ? null : lastTrend.v - before;
  };

  const first = clean.length ? clean[0].t : now - 90 * DAY;
  const miniFrom = Math.max(now - 90 * DAY, first);
  // A rate over the last 4 weeks is misleading when the latest weigh-in is a week or more old.
  const stale = !lastPoint || now - lastPoint.t > 7 * DAY;
  const rate = weightS && !stale ? linearRate(weightS.daily, 28, now) : null;
  const trendNow = lastTrend ? lastTrend.v : null;
  const progress = goal ? goalProgress(trendNow, goal) : null;
  const derived = deriveComposition(clean);
  const sFat = populated(makeSeries(derived, 6, false));
  const profile: ProjectionProfile = {
    heightCm: user.heightCm ?? null, ageYears: user.ageYears ?? null, sex: user.sex ?? 0,
    fatPct: sFat?.trend.length ? lastTrendValue(sFat.trend, now, 30) : null,
  };
  const projection = goal ? projectGoal(trendNow, rate, goal, now, weightS?.daily, profile) : null;

  let text = rate ? rateText(rate, unit) : t("an.notEnoughRecent");
  if (goal && projection?.status === "on-track" && projection.date)
    text += t("an.goalAround", { goal: formatMass(goal.kg, unit, { decimals: 1 }), date: formatDate(dayNoonUtc(projection.date), "UTC", "month") });

  const chips: DashboardSummary["chips"] = [];
  const addChip = (id: DashboardSummary["chips"][number]["id"], label: string, unit_: string, type: number | null, daily: DayPoint[]) => {
    const recent = daily.filter((d) => d.t >= now - 90 * DAY);
    if (!recent.length) return;
    const lastT = recent[recent.length - 1].t;
    const value = meanIn(daily, lastT - 7 * DAY, lastT).mean;
    const prev = meanIn(daily, lastT - 37 * DAY, lastT - 30 * DAY);
    chips.push({ id, label, unit: unit_, value, delta30: prev.n ? value - prev.mean : null, type });
  };
  for (const c of CHIPS) {
    const s = populated(makeSeries(COMPOSITION_TYPES.has(c.type) ? derived : clean, c.type, false));
    if (s) addChip(c.id, specLabel(specFor(c.type)!), specFor(c.type)!.unit, c.type, s.daily);
  }
  if (weightS && user.heightCm) {
    const b = bmiSeries(weightS.daily, user.heightCm, user.ageYears ?? null);
    if (b?.length) addChip("bmi", t("an.bmi"), "", null, b);
  }

  const weighings = clean.filter((r) => r.values[1] !== undefined);
  const habits90 = weighHabits(
    weighings.filter((r) => r.t >= now - 90 * DAY).map((r) => ({ t: r.t, zone: r.zone })),
  );
  const today = localTime(now, zone).day;
  return {
    user: userOut,
    unit,
    last: lastPoint ? { t: lastPoint.t, weightKg: lastPoint.v } : null,
    daysSinceLast: lastPoint ? Math.max(0, daysBetween(localTime(lastPoint.t, zone).day, today)) : null,
    trendKg: trendNow,
    deltas: { d7: delta(7), d30: delta(30), d90: delta(90) },
    mini: {
      from: miniFrom, to: now,
      daily: weightS ? weightS.daily.filter((d) => d.t >= miniFrom && d.t <= now).map((d) => ({ t: d.t, v: d.v })) : [],
      trend: trend.filter((p) => p.t >= miniFrom && p.t <= now),
      goalKg: goal?.kg ?? null,
    },
    rate, rateText: text,
    goal, progress, projection,
    chips,
    consistency: {
      daysLast7: daysInLast(weighings, 7, now),
      morningShare90: habits90.count >= MIN_READINGS ? habits90.morningShare : null,
    },
  };
}
