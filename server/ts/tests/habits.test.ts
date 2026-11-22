import assert from "node:assert/strict";
import test from "node:test";
import { clock, weighHabits } from "../habits.ts";

// 2026-03-02 is a Monday; 06:30 UTC.
const MON = Date.UTC(2026, 2, 2, 6, 30) / 1000;
const DAY = 86400;

test("morning weigh-ins are judged comparable", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    t: MON + i * DAY,
    zone: "UTC",
  }));
  const h = weighHabits(items);
  assert.equal(h.count, 20);
  assert.equal(h.hours[6], 20);
  assert.equal(h.morningShare, 1);
  assert.equal(h.verdict, "comparable");
  assert.equal(clock(h.medianMinutes), "06:30");
  assert.equal(h.weekdays[0], 3); // Mondays: days 0, 7, 14
  assert.equal(h.longestGapDays, 1);
});

test("scattered times are flagged as mixed", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    t: MON + i * DAY + (i % 2 ? 12 : 0) * 3600,
    zone: "UTC",
  }));
  const h = weighHabits(items);
  assert.equal(h.morningShare, 0.5);
  assert.equal(h.verdict, "mixed");
});

test("too few readings give no verdict", () => {
  assert.equal(weighHabits([{ t: MON, zone: "UTC" }]).verdict, "unknown");
  assert.equal(weighHabits([]).count, 0);
});

test("the scale's time zone decides the local hour; missing zone assumes UTC", () => {
  const berlin = weighHabits([{ t: MON, zone: "Europe/Berlin" }]); // 07:30 CET
  assert.equal(berlin.hours[7], 1);
  assert.equal(berlin.zoneAssumed, false);
  const none = weighHabits([{ t: MON, zone: null }]);
  assert.equal(none.hours[6], 1);
  assert.equal(none.zoneAssumed, true);
  assert.equal(weighHabits([{ t: MON, zone: "Not/AZone" }]).hours[6], 1);
});

test("months fill gaps so pauses stay visible", () => {
  const h = weighHabits([
    { t: Date.UTC(2026, 0, 5) / 1000, zone: "UTC" },
    { t: Date.UTC(2026, 3, 5) / 1000, zone: "UTC" },
  ]);
  assert.deepEqual(
    h.months.map((m) => [m.key, m.count]),
    [
      ["2026-01", 1],
      ["2026-02", 0],
      ["2026-03", 0],
      ["2026-04", 1],
    ],
  );
});
