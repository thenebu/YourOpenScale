/** Outliers, duplicates and the data-quality report (WP-06). Pure. */
import { specLabel } from "./labels.ts";
import { specFor } from "./spec.ts";
import { mad, median } from "./stats.ts";
import { daysBetween, localTime } from "./time.ts";
import type { QualityReport, Reading } from "./types.ts";

const DAY = 86400;
const WINDOW_READINGS = 15;
const FUTURE_TOLERANCE = 300;

type Entry = { id: number; t: number; v: number };

/**
 * Flags implausible values (outside the metric bounds), sudden weight jumps that no other
 * reading within 48 h confirms, and robust-z outliers for every non-weight metric.
 */
export function flagOutliers(
  readings: Reading[],
  type: number,
): Map<number, "implausible" | "jump" | "robust-z"> {
  const flags = new Map<number, "implausible" | "jump" | "robust-z">();
  const spec = specFor(type);
  const entries: Entry[] = [];
  for (const r of readings) {
    const v = r.values[type];
    if (v === undefined || v === null || !Number.isFinite(v)) continue;
    entries.push({ id: r.id, t: r.t, v });
  }
  entries.sort((a, b) => a.t - b.t || a.id - b.id);

  const plausible: Entry[] = [];
  for (const e of entries) {
    if (spec && (e.v < spec.bounds[0] || e.v > spec.bounds[1])) flags.set(e.id, "implausible");
    else plausible.push(e);
  }

  if (type === 1) {
    for (let i = 0; i < plausible.length; i++) {
      const x = plausible[i];
      const near: number[] = [];
      for (let j = i - 1; j >= 0 && x.t - plausible[j].t <= 7 * DAY; j--) near.push(plausible[j].v);
      for (let j = i + 1; j < plausible.length && plausible[j].t - x.t <= 7 * DAY; j++) near.push(plausible[j].v);
      if (near.length < 3) continue;
      const m = median(near);
      if (Math.abs(x.v - m) <= Math.max(2.0, 0.025 * m)) continue;
      let confirmed = false;
      for (let j = i - 1; j >= 0 && x.t - plausible[j].t <= 2 * DAY; j--)
        if (Math.abs(plausible[j].v - x.v) <= 1.0) confirmed = true;
      for (let j = i + 1; j < plausible.length && plausible[j].t - x.t <= 2 * DAY; j++)
        if (Math.abs(plausible[j].v - x.v) <= 1.0) confirmed = true;
      if (!confirmed) flags.set(x.id, "jump");
    }
  } else if (spec) {
    for (let i = 0; i < plausible.length; i++) {
      const window = plausible.slice(Math.max(0, i - WINDOW_READINGS), i + WINDOW_READINGS + 1).map((e) => e.v);
      if (window.length < 5) continue;
      const m = median(window);
      const scale = Math.max(1.4826 * mad(window), spec.madFloor);
      if (Math.abs(plausible[i].v - m) / scale > 6) flags.set(plausible[i].id, "robust-z");
    }
  }
  return flags;
}

/** Ids of readings that repeat an earlier reading (same scale, same values) within the window. */
export function findDuplicates(readings: Reading[], windowSeconds = 180): number[] {
  const sorted = [...readings].sort((a, b) => a.t - b.t || a.id - b.id);
  const out: number[] = [];
  const key = (r: Reading) =>
    Object.keys(r.values).sort((a, b) => Number(a) - Number(b)).map((k) => `${k}=${r.values[Number(k)]}`).join(",");
  const lastByScale = new Map<number, { t: number; keys: Set<string> }[]>();
  for (const r of sorted) {
    const recent = (lastByScale.get(r.scaleId) ?? []).filter((e) => r.t - e.t <= windowSeconds);
    const k = key(r);
    if (recent.some((e) => e.keys.has(k))) out.push(r.id);
    recent.push({ t: r.t, keys: new Set([k]) });
    lastByScale.set(r.scaleId, recent);
  }
  return out;
}

export function qualityReport(readings: Reading[], now: number): QualityReport {
  let untrustedClock = 0;
  let zoneAssumed = 0;
  let futureTimestamps = 0;
  const types = new Set<number>();
  for (const r of readings) {
    if (!r.trusted) untrustedClock++;
    if (r.zone === null) zoneAssumed++;
    if (r.t > now + FUTURE_TOLERANCE) futureTimestamps++;
    for (const k of Object.keys(r.values)) types.add(Number(k));
  }
  const outliers: QualityReport["outliers"] = [];
  for (const type of [...types].sort((a, b) => a - b)) {
    const spec = specFor(type);
    if (!spec || type < 0) continue;
    const count = flagOutliers(readings, type).size;
    if (count > 0) outliers.push({ type, label: specLabel(spec), count });
  }
  const times = readings.filter((r) => r.t <= now + FUTURE_TOLERANCE).map((r) => r.t).sort((a, b) => a - b);
  const gaps: QualityReport["gaps"] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > 30 * DAY) {
      const a = localTime(times[i - 1], null).day;
      const b = localTime(times[i], null).day;
      gaps.push({ from: times[i - 1], to: times[i], days: daysBetween(a, b) });
    }
  }
  return {
    untrustedClock, zoneAssumed, duplicates: findDuplicates(readings).length, futureTimestamps,
    outliers, gaps,
  };
}
