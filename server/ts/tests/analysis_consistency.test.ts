import assert from "node:assert/strict";
import test from "node:test";
import { synth, localToEpoch } from "./fixtures/synthetic.ts";
import { calendarCells, daysInLast, streaks } from "../analysis/consistency.ts";
import type { Reading } from "../analysis/types.ts";

const rd = (id: number, day: string, hour = 7): Reading =>
  ({ id, t: localToEpoch(day, hour, 0, "UTC"), zone: "UTC", trusted: true, scaleId: 1, values: { 1: 80 } });

test("current streak ends today", () => {
  const s = streaks(["2024-03-01", "2024-03-02", "2024-03-03"], "2024-03-03");
  assert.equal(s.current, 3);
});

test("current streak survives a missing reading today (yesterday rule)", () => {
  assert.equal(streaks(["2024-03-01", "2024-03-02"], "2024-03-03").current, 2);
  assert.equal(streaks(["2024-03-01"], "2024-03-03").current, 0);
  assert.equal(streaks([], "2024-03-03").current, 0);
});

test("longest streak with from/to, duplicates ignored, latest wins ties", () => {
  const s = streaks(
    ["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-01", "2024-03-05", "2024-03-06", "2024-03-07", "2024-03-08"],
    "2024-03-20",
  );
  assert.deepEqual(s.longest, { days: 4, from: "2024-03-05", to: "2024-03-08" });
  assert.equal(s.current, 0);
  assert.equal(streaks([], "2024-03-01").longest, null);
});

test("calendarCells has one cell per local day with all readings counted", () => {
  const rs = [rd(1, "2024-03-01"), rd(2, "2024-03-01", 19), rd(3, "2024-03-03"), rd(4, "2024-03-03", 8), rd(5, "2024-03-03", 9)];
  const cells = calendarCells(rs, localToEpoch("2024-03-01", 0, 0, "UTC"), localToEpoch("2024-03-04", 12, 0, "UTC"));
  assert.deepEqual(cells, [
    { day: "2024-03-01", count: 2 }, { day: "2024-03-02", count: 0 },
    { day: "2024-03-03", count: 3 }, { day: "2024-03-04", count: 0 },
  ]);
});

test("calendarCells over synthetic data covers the whole range", () => {
  const rs = synth({ days: 30, start: "2024-01-01", gaps: [[10, 12]] });
  const cells = calendarCells(rs, rs[0].t, rs[rs.length - 1].t);
  assert.equal(cells.length, 30);
  assert.equal(cells.filter((c) => c.count === 0).length, 3);
});

test("daysInLast counts distinct local days in the window", () => {
  const rs = [rd(1, "2024-03-10"), rd(2, "2024-03-10", 19), rd(3, "2024-03-08"), rd(4, "2024-03-04"), rd(5, "2024-03-03")];
  const now = localToEpoch("2024-03-10", 21, 0, "UTC");
  assert.equal(daysInLast(rs, 7, now), 3); // 04, 08, 10 (03 is outside)
  assert.equal(daysInLast(rs, 8, now), 4);
  assert.equal(daysInLast([], 7, now), 0);
});
