import assert from "node:assert/strict";
import test from "node:test";
import { synth } from "./fixtures/synthetic.ts";
import { dailySeries } from "../analysis/series.ts";
import { ewmaTrend } from "../analysis/trend.ts";
import { specFor } from "../analysis/spec.ts";
import { streaks } from "../analysis/consistency.ts";
import { records } from "../analysis/records.ts";
import { dayNoonUtc } from "../analysis/time.ts";
import type { RecordItem } from "../analysis/types.ts";

const get = (items: RecordItem[], id: RecordItem["id"]) => items.find((i) => i.id === id)!;
const build = (opts: Parameters<typeof synth>[0]) => {
  const rs = synth({ noiseSd: 0, ...opts });
  const daily = dailySeries(rs, 1, { morningOnly: false });
  const trend = ewmaTrend(daily, specFor(1)!);
  const st = streaks(daily.map((d) => d.day), daily[daily.length - 1].day);
  return { daily, trend, st, now: daily[daily.length - 1].t + 3600 };
};

test("lowest, highest and since-start on a steady decline", () => {
  const { daily, trend, st, now } = build({ days: 120, base: 90, slopePerWeek: -0.7 });
  const items = records(daily, trend, st, now);
  assert.equal(items.length, 8);
  assert.equal(get(items, "highest").value, daily[0].v);
  assert.equal(get(items, "lowest").value, daily[daily.length - 1].v);
  assert.equal(get(items, "lowest").t, daily[daily.length - 1].t);
  assert.ok(get(items, "sinceStart").value! < -9);
  assert.equal(get(items, "gain7").value, null);
  const drop = get(items, "drop7").value!;
  assert.ok(drop > 0.5 && drop < 0.8, String(drop));
  assert.equal(get(items, "longestStreak").value, 120);
});

test("low12m looks only at the last 365 days", () => {
  const { daily, trend, st } = build({ days: 600, base: 80, slopePerWeek: 0 });
  daily[10].v = 70; // old low
  daily[500].v = 76; // recent low
  const now = daily[daily.length - 1].t;
  const items = records(daily, trend, st, now);
  assert.equal(get(items, "lowest").value, 70);
  assert.equal(get(items, "low12m").value, 76);
});

test("biggest 7-day gain and best month", () => {
  const rs = [
    ...synth({ days: 60, start: "2024-01-01", base: 80, noiseSd: 0 }),
  ];
  // Feb 2024 (days 31..59) is 3 kg lighter than Jan; plus a late jump in Jan.
  for (const x of rs) if (x.t >= Date.UTC(2024, 1, 1) / 1000) x.values[1] = 77;
  const daily = dailySeries(rs, 1, { morningOnly: false });
  const trend = ewmaTrend(daily, specFor(1)!);
  const st = streaks(daily.map((d) => d.day), "2024-02-29");
  const items = records(daily, trend, st, daily[daily.length - 1].t);
  const best = get(items, "bestMonth");
  assert.ok(Math.abs(best.value! + 3) < 1e-9);
  assert.equal(best.t, dayNoonUtc("2024-02-15"));
  const gain = records([...daily].reverse().map((d, i) => ({ ...d, t: daily[i].t, day: daily[i].day })),
    ewmaTrend([...daily].reverse().map((d, i) => ({ ...d, t: daily[i].t, day: daily[i].day })), specFor(1)!), st, 0);
  assert.ok(get(gain, "gain7").value! > 0.5); // reversed series rises
});

test("best month needs two consecutive months with five days each", () => {
  const { daily, trend, st, now } = build({ days: 40, start: "2024-01-01", base: 80, slopePerWeek: 0 });
  const only = daily.filter((d) => d.day < "2024-02-03"); // Feb has 2 days
  const items = records(only, trend, st, now);
  assert.equal(get(items, "bestMonth").value, null);
});

test("records ignore any display range: they use every point passed in", () => {
  const { daily, trend, st, now } = build({ days: 400, base: 90, slopePerWeek: -0.2 });
  const all = records(daily, trend, st, now);
  const recent = records(daily.slice(-30), trend.slice(-30), st, now);
  assert.equal(get(all, "highest").value, daily[0].v);
  assert.notEqual(get(recent, "highest").value, daily[0].v);
});

test("empty input yields null values, not NaN", () => {
  const items = records([], [], { current: 0, longest: null }, 0);
  assert.equal(items.length, 8);
  for (const i of items) {
    assert.equal(i.value, null);
    assert.equal(i.t, null);
    assert.ok(!/NaN|undefined/.test(i.detail));
  }
});
