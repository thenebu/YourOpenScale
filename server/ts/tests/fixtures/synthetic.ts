/** Deterministic synthetic readings for analysis tests and the dev server. No real data. */
import type { Reading } from "../../analysis/types.ts";

export type SynthOptions = {
  seed?: number;
  days?: number;
  /** First local day, "YYYY-MM-DD" (default a Monday). */
  start?: string;
  base?: number;
  slopePerWeek?: number;
  noiseSd?: number;
  /** Additive kg per local weekday, Monday first. */
  weekdayEffect?: number[];
  /** Adds an evening reading (19:00) on ~eveningShare of the days at weight + offset. */
  eveningOffset?: number;
  eveningShare?: number;
  /** Inclusive day-index ranges without readings. */
  gaps?: [number, number][];
  /** Day-index spikes added to that day's first reading. */
  outliers?: { day: number; delta: number }[];
  /** Morning readings per day (minutes apart). */
  perDay?: number;
  composition?: boolean;
  zone?: string;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Epoch seconds of a local wall-clock time in an IANA zone. */
export function localToEpoch(day: string, hour: number, minute: number, zone: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((guess - (shown - guess)) / 1000);
}

function addDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function synth(options: SynthOptions = {}): Reading[] {
  const {
    seed = 1, days = 90, start = "2023-01-02", base = 80, slopePerWeek = 0, noiseSd = 0.3,
    weekdayEffect, eveningOffset, eveningShare = 0.15, gaps = [], outliers = [],
    perDay = 1, composition = false, zone = "UTC",
  } = options;
  const rand = mulberry32(seed);
  const normal = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const out: Reading[] = [];
  let id = 1;
  const push = (day: string, hour: number, minute: number, weight: number, w0: number) => {
    const values: Reading["values"] = { 1: round(weight) };
    if (composition) {
      const fatPct = 28 + 0.6 * (weight - w0) + 0.3 * normal();
      const fat = (weight * fatPct) / 100;
      const lean = weight - fat;
      values[6] = round(fatPct);
      values[8] = round(fat);
      values[5] = round(lean);
      values[76] = round(lean * 0.46);
      values[77] = round(lean * 0.73);
      values[88] = round(3.1 + 0.02 * normal());
    }
    out.push({ id: id++, t: localToEpoch(day, hour, minute, zone), zone, trusted: true, scaleId: 1, values });
  };
  for (let i = 0; i < days; i++) {
    if (gaps.some(([from, to]) => i >= from && i <= to)) continue;
    const day = addDay(start, i);
    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    const trend = base + (slopePerWeek * i) / 7 + (weekdayEffect?.[weekday] ?? 0);
    const spike = outliers.filter((o) => o.day === i).reduce((s, o) => s + o.delta, 0);
    for (let k = 0; k < perDay; k++) {
      const noise = noiseSd * normal();
      push(day, 7, k * 2, trend + noise + (k === 0 ? spike : 0), base);
    }
    if (eveningOffset !== undefined && rand() < eveningShare)
      push(day, 19, 0, trend + eveningOffset + noiseSd * normal(), base);
  }
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
