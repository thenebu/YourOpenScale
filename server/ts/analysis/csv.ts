/** CSV export (WP-07). Pure. RFC 4180, CRLF, UTF-8 without BOM, "." decimal, up to 3 decimals. */
import { METRICS } from "../metrics.ts";
import { toDisplay } from "./format.ts";
import { flagOutliers } from "./quality.ts";
import { bucketize, dailySeries } from "./series.ts";
import { localTime } from "./time.ts";
import { trendAt } from "./trend.ts";
import { MORNING } from "../habits.ts";
import type { Agg, Bucket, DayPoint, Reading, Unit, UserAnalysis } from "./types.ts";

type Cell = string | number | null;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(r3(v)) : "";
  // Spreadsheet formula guard for text cells.
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(cell).join(",") + "\r\n").join("");
}

const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");
const pad = (n: number) => String(n).padStart(2, "0");

export function exportRows(
  readings: Reading[],
  analysis: UserAnalysis,
  agg: Agg,
  metrics: number[],
  unit: Unit,
): (string | number | null)[][] {
  const { from, to, morningOnly } = analysis.range;
  const chosen = METRICS.filter((m) => metrics.includes(m.type));
  const sorted = readings.slice().sort((a, b) => a.t - b.t || a.id - b.id);
  const inRange = sorted.filter((r) => r.t >= from && r.t <= to);
  const trend = analysis.weight?.trend ?? [];
  const showWeightUnit = unit !== "kg" && chosen.some((m) => m.type === 1);
  const weightUnitCol = `weight_${unit}`;
  const withUnit = (kg: number | null): Cell => (kg === null ? null : toDisplay(kg, unit));
  const trendCell = (t: number): Cell => trendAt(trend, t, 3);

  if (agg === "raw") {
    const flags = new Map<number, Set<string>>();
    for (const m of chosen) {
      for (const [id, reason] of flagOutliers(sorted, m.type)) {
        const set = flags.get(id);
        if (set) set.add(reason);
        else flags.set(id, new Set([reason]));
      }
    }
    const header: Cell[] = [
      "reading_id", "timestamp_utc", "local_date", "local_time", "time_zone", "clock_trusted",
      ...chosen.map((m) => m.key), ...(showWeightUnit ? [weightUnitCol] : []), "trend_weight_kg", "outlier",
    ];
    const rows: Cell[][] = [header];
    for (const r of inRange) {
      const lt = localTime(r.t, r.zone);
      if (morningOnly && !(lt.hour >= MORNING.from && lt.hour < MORNING.to)) continue;
      const w = r.values[1];
      rows.push([
        r.id, iso(r.t), lt.day, `${pad(lt.hour)}:${pad(lt.minutes)}`, r.zone ?? "", r.trusted ? 1 : 0,
        ...chosen.map((m) => r.values[m.type] ?? null),
        ...(showWeightUnit ? [w === undefined ? null : withUnit(w)] : []),
        trendCell(r.t), [...(flags.get(r.id) ?? [])].join("|"),
      ]);
    }
    return rows;
  }

  // Aggregated exports recompute the per-metric daily series (outliers excluded, morning filter applied).
  const perType = chosen.map((m) => {
    const exclude = new Set(flagOutliers(sorted, m.type).keys());
    const daily = dailySeries(inRange, m.type, { morningOnly, exclude }).filter((d) => d.t >= from && d.t <= to);
    return { m, daily };
  });

  if (agg === "daily") {
    const days = new Map<string, number>();
    for (const r of inRange) {
      const day = localTime(r.t, r.zone).day;
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    const byDay = perType.map(({ daily }) => new Map(daily.map((d) => [d.day, d])));
    const header: Cell[] = [
      "local_date", "n_readings",
      ...chosen.flatMap((m) => [`${m.key}_first`, `${m.key}_mean`, `${m.key}_min`, `${m.key}_max`]),
      ...(showWeightUnit ? [weightUnitCol] : []), "trend_weight_kg",
    ];
    const rows: Cell[][] = [header];
    const shown = [...new Set(byDay.flatMap((m) => [...m.keys()]))].sort();
    const weightIdx = chosen.findIndex((m) => m.type === 1);
    for (const day of shown) {
      const wd: DayPoint | undefined = weightIdx >= 0 ? byDay[weightIdx].get(day) : undefined;
      rows.push([
        day, days.get(day) ?? 0,
        ...byDay.flatMap((m) => {
          const d = m.get(day);
          return d ? [d.v, d.mean, d.min, d.max] : [null, null, null, null];
        }),
        ...(showWeightUnit ? [wd ? withUnit(wd.v) : null] : []),
        wd ? trendCell(wd.t) : (() => {
          const any = byDay.map((m) => m.get(day)).find(Boolean);
          return any ? trendCell(any.t) : null;
        })(),
      ]);
    }
    return rows;
  }

  const by = agg === "weekly" ? "week" : "month";
  const buckets = perType.map(({ daily }) => new Map(bucketize(daily, by).map((b) => [b.key, b])));
  const allBuckets = new Map<string, Bucket>();
  for (const map of buckets) for (const [k, b] of map) if (!allBuckets.has(k)) allBuckets.set(k, b);
  const keys = [...allBuckets.keys()].sort((a, b) => allBuckets.get(a)!.start - allBuckets.get(b)!.start);
  const weightIdx = chosen.findIndex((m) => m.type === 1);
  const header: Cell[] = [
    "period", "period_start", "period_end", "n_readings", "n_days",
    ...chosen.flatMap((m) => [`${m.key}_mean`, `${m.key}_min`, `${m.key}_max`, `${m.key}_p25`, `${m.key}_p75`]),
    ...(showWeightUnit ? [`${weightUnitCol}_mean`] : []), "trend_weight_kg_end",
  ];
  const rows: Cell[][] = [header];
  for (const key of keys) {
    const ref = allBuckets.get(key)!;
    const present = buckets.map((m) => m.get(key));
    const lead = (weightIdx >= 0 ? present[weightIdx] : undefined) ?? present.find(Boolean)!;
    let end: Cell = null;
    for (const p of trend) if (p.t >= ref.start && p.t < ref.end) end = p.v;
    const w = weightIdx >= 0 ? present[weightIdx] : undefined;
    rows.push([
      key, iso(ref.start), iso(ref.end - 1), lead.n, lead.days,
      ...present.flatMap((b) => (b ? [b.mean, b.min, b.max, b.p25, b.p75] : [null, null, null, null, null])),
      ...(showWeightUnit ? [w ? withUnit(w.mean) : null] : []),
      end,
    ]);
  }
  return rows;
}

/** `yow-<ascii slug of name>-<from>_<to>-<agg>.csv` with UTC dates. */
export function csvFilename(name: string, from: number, to: number, agg: Agg): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  return `yow-${slug}-${day(from)}_${day(to)}-${agg}.csv`;
}
