import assert from "node:assert/strict";
import test from "node:test";
import { synth, localToEpoch } from "./fixtures/synthetic.ts";
import { addDays, daysBetween, isoWeekKey, localTime, monthKey, dayNoonUtc } from "../analysis/time.ts";
import { bucketize, chooseAgg, dailySeries, readingPoints, yExtent } from "../analysis/series.ts";
import { specFor } from "../analysis/spec.ts";
import { median, quantile, sd, mad, mean, centredBaseline, stats } from "../analysis/stats.ts";
import type { DayPoint, Reading } from "../analysis/types.ts";

const reading = (id: number, t: number, w: number, zone: string | null = "UTC"): Reading => ({
  id, t, zone, trusted: true, scaleId: 1, values: { 1: w },
});
const at = (day: string, h: number, m = 0, zone = "UTC") => localToEpoch(day, h, m, zone);
const weight = specFor(1)!;

test("dailySeries takes the first reading of each local day with min/max/mean/n", () => {
  const rs = [
    reading(2, at("2024-03-04", 8), 80.4),
    reading(1, at("2024-03-04", 6), 80.0),
    reading(3, at("2024-03-04", 19), 81.0),
    reading(4, at("2024-03-05", 7), 79.0),
  ];
  const d = dailySeries(rs, 1, { morningOnly: false });
  assert.equal(d.length, 2);
  assert.equal(d[0].day, "2024-03-04");
  assert.equal(d[0].v, 80.0);
  assert.equal(d[0].readingId, 1);
  assert.equal(d[0].min, 80.0);
  assert.equal(d[0].max, 81.0);
  assert.equal(d[0].n, 3);
  assert.ok(Math.abs(d[0].mean - (80.4 + 80 + 81) / 3) < 1e-9);
  assert.equal(d[1].n, 1);
  assert.ok(d[0].t < d[1].t);
});

test("dailySeries honours exclude and ignores readings without the metric", () => {
  const rs = [reading(1, at("2024-03-04", 6), 99), reading(2, at("2024-03-04", 7), 80)];
  rs.push({ id: 3, t: at("2024-03-05", 7), zone: "UTC", trusted: true, scaleId: 1, values: { 6: 20 } });
  const d = dailySeries(rs, 1, { morningOnly: false, exclude: new Set([1]) });
  assert.deepEqual(d.map((p) => p.v), [80]);
});

test("morning filter is [04:00, 10:00)", () => {
  const times: [number, number, boolean][] = [[3, 59, false], [4, 0, true], [9, 59, true], [10, 0, false]];
  times.forEach(([h, m, kept], i) => {
    const d = dailySeries([reading(1, at(`2024-03-0${i + 1}`, h, m), 80)], 1, { morningOnly: true });
    assert.equal(d.length, kept ? 1 : 0, `${h}:${m}`);
  });
});

test("morning filter keeps the first morning reading, not an earlier night one", () => {
  const rs = [reading(1, at("2024-03-04", 3, 0), 70), reading(2, at("2024-03-04", 7, 0), 80)];
  const d = dailySeries(rs, 1, { morningOnly: true });
  assert.equal(d[0].v, 80);
});

test("zone: the same instant lands on different local days in Berlin and UTC", () => {
  const t = Date.UTC(2024, 0, 14, 23, 30) / 1000; // 00:30 on the 15th in Berlin
  assert.equal(dailySeries([reading(1, t, 80, "UTC")], 1, { morningOnly: false })[0].day, "2024-01-14");
  assert.equal(dailySeries([reading(1, t, 80, "Europe/Berlin")], 1, { morningOnly: false })[0].day, "2024-01-15");
  assert.equal(dailySeries([reading(1, t, 80, null)], 1, { morningOnly: false })[0].day, "2024-01-14");
  const lt = localTime(t, "Europe/Berlin");
  assert.deepEqual(lt, { day: "2024-01-15", hour: 0, minutes: 30, weekday: 0 });
});

test("time helpers", () => {
  assert.equal(addDays("2024-02-28", 2), "2024-03-01");
  assert.equal(addDays("2023-01-01", -1), "2022-12-31");
  assert.equal(daysBetween("2024-01-01", "2024-03-01"), 60);
  assert.equal(monthKey("2024-03-15"), "2024-03");
  assert.equal(dayNoonUtc("1970-01-02"), 86400 + 43200);
});

test("isoWeekKey boundaries incl. 2026-W53 / 2027-W01", () => {
  assert.equal(isoWeekKey("2026-12-31"), "2026-W53");
  assert.equal(isoWeekKey("2027-01-03"), "2026-W53"); // Sunday
  assert.equal(isoWeekKey("2027-01-04"), "2027-W01"); // Monday
  assert.equal(isoWeekKey("2024-12-30"), "2025-W01");
  assert.equal(isoWeekKey("2023-01-01"), "2022-W52");
  assert.equal(isoWeekKey("2023-01-02"), "2023-W01");
});

test("bucketize weeks: Sunday to Monday boundary and midpoint", () => {
  const daily = dailySeries(
    [reading(1, at("2024-03-03", 7), 80), reading(2, at("2024-03-04", 7), 82), reading(3, at("2024-03-05", 7), 84)],
    1, { morningOnly: false },
  );
  const b = bucketize(daily, "week");
  assert.deepEqual(b.map((x) => x.key), ["2024-W09", "2024-W10"]);
  assert.equal(b[1].days, 2);
  assert.equal(b[1].mean, 83);
  assert.equal(b[1].min, 82);
  assert.equal(b[1].max, 84);
  assert.equal(b[1].p25, 82.5);
  assert.equal(b[1].p75, 83.5);
  assert.equal(b[1].t, dayNoonUtc("2024-03-07")); // Thursday
  assert.equal(b[1].start, dayNoonUtc("2024-03-04") - 43200);
  assert.equal(b[1].end, b[1].start + 7 * 86400);
});

test("bucketize across the year change", () => {
  const rs = ["2026-12-31", "2027-01-03", "2027-01-04"].map((d, i) => reading(i + 1, at(d, 7), 80));
  const b = bucketize(dailySeries(rs, 1, { morningOnly: false }), "week");
  assert.deepEqual(b.map((x) => [x.key, x.days]), [["2026-W53", 2], ["2027-W01", 1]]);
});

test("bucketize months: each day counts once, n sums readings", () => {
  const rs = synth({ days: 70, start: "2024-01-15", perDay: 2, noiseSd: 0 });
  const b = bucketize(dailySeries(rs, 1, { morningOnly: false }), "month");
  assert.deepEqual(b.map((x) => x.key), ["2024-01", "2024-02", "2024-03"]);
  assert.equal(b[0].days, 17);
  assert.equal(b[0].n, 34);
  assert.equal(b[1].days, 29);
  assert.equal(b[1].t, dayNoonUtc("2024-02-15"));
  assert.equal(b[1].end, b[2].start);
  assert.deepEqual(bucketize([], "week"), []);
});

test("chooseAgg thresholds", () => {
  assert.equal(chooseAgg(120, 6000), "raw");
  assert.equal(chooseAgg(120, 6001), "daily");
  assert.equal(chooseAgg(121, 10), "daily");
  assert.equal(chooseAgg(1100, 10), "daily");
  assert.equal(chooseAgg(1101, 10), "weekly");
  assert.equal(chooseAgg(3650, 10), "weekly");
  assert.equal(chooseAgg(3651, 10), "monthly");
});

test("yExtent: min span, padding, no NaN for 0 and 1 points", () => {
  const [lo, hi] = yExtent([80, 81], weight);
  assert.ok(Math.abs(lo - (80.5 - 1 - 0.3)) < 1e-9 && Math.abs(hi - (80.5 + 1 + 0.3)) < 1e-9);
  const [l2, h2] = yExtent([70, 90], weight);
  assert.ok(Math.abs(l2 - 67) < 1e-9 && Math.abs(h2 - 93) < 1e-9);
  const one = yExtent([80], weight);
  assert.ok(one.every(Number.isFinite) && one[0] < 80 && one[1] > 80);
  const none = yExtent([], weight);
  assert.ok(none.every(Number.isFinite) && none[0] < none[1]);
  assert.ok(yExtent([NaN, 80], weight).every(Number.isFinite));
});

test("readingPoints sorts and excludes", () => {
  const rs = [reading(2, 200, 81), reading(1, 100, 80), reading(3, 300, 99)];
  assert.deepEqual(readingPoints(rs, 1, new Set([3])), [{ t: 100, v: 80, id: 1 }, { t: 200, v: 81, id: 2 }]);
});

test("stats helpers", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([3, 1, 2, 10]), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(mad([1, 2, 3, 4, 100]), 1);
  assert.ok(Math.abs(sd([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138089935) < 1e-8);
  assert.equal(sd([5]), 0);
  const daily = dailySeries(synth({ days: 10, noiseSd: 0, base: 80, slopePerWeek: 0 }), 1, { morningOnly: false });
  const base = centredBaseline(daily);
  assert.equal(base.length, 10);
  assert.ok(base.every((p) => Math.abs(p.v - 80) < 1e-9));
  assert.equal(centredBaseline(daily.slice(0, 3)).length, 0);
  const s = stats(daily as DayPoint[], []);
  assert.equal(s?.mean, 80);
  assert.equal(s?.trendLatest, null);
  assert.equal(stats([], []), null);
});
