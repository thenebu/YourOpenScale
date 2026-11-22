import assert from "node:assert/strict";
import test from "node:test";
import { synth } from "./fixtures/synthetic.ts";
import { findDuplicates, flagOutliers, qualityReport } from "../analysis/quality.ts";
import type { Reading } from "../analysis/types.ts";

const T0 = Date.UTC(2024, 0, 1, 7) / 1000;
const DAY = 86400;
const r = (id: number, t: number, values: Reading["values"], extra: Partial<Reading> = {}): Reading =>
  ({ id, t, zone: "UTC", trusted: true, scaleId: 1, values, ...extra });

test("implausible values outside the metric bounds are flagged", () => {
  const rs = synth({ days: 20, noiseSd: 0.2 });
  rs[5].values[1] = 19;
  rs[6].values[1] = 351;
  const flags = flagOutliers(rs, 1);
  assert.equal(flags.get(rs[5].id), "implausible");
  assert.equal(flags.get(rs[6].id), "implausible");
  assert.equal(flags.size, 2);
});

test("a lone +4 kg spike is a jump", () => {
  const rs = synth({ days: 30, noiseSd: 0.2, outliers: [{ day: 15, delta: 4 }] });
  const flags = flagOutliers(rs, 1);
  assert.equal(flags.size, 1);
  assert.equal(flags.get(rs[15].id), "jump");
});

test("a confirmed fast change is not a jump", () => {
  const rs = synth({ days: 30, noiseSd: 0.2, outliers: [{ day: 15, delta: 4 }, { day: 16, delta: 4 }] });
  assert.equal(flagOutliers(rs, 1).size, 0);
});

test("jump detection needs at least three neighbours", () => {
  const rs = [r(1, T0, { 1: 80 }), r(2, T0 + DAY, { 1: 90 })];
  assert.equal(flagOutliers(rs, 1).size, 0);
});

test("robust-z flags a bone-mass spike", () => {
  const rs = synth({ days: 40, composition: true });
  rs[20].values[88] = 5.5;
  const flags = flagOutliers(rs, 88);
  assert.equal(flags.get(rs[20].id), "robust-z");
  assert.equal(flags.size, 1);
});

test("duplicates within the window on the same scale", () => {
  const rs = [
    r(1, T0, { 1: 80 }), r(2, T0 + 60, { 1: 80 }), r(3, T0 + 120, { 1: 80.5 }),
    r(4, T0 + 100, { 1: 80 }, { scaleId: 2 }), r(5, T0 + 600, { 1: 80 }),
  ];
  assert.deepEqual(findDuplicates(rs, 180), [2]);
});

test("qualityReport counts clock, zone, duplicates, future timestamps and gaps", () => {
  const now = T0 + 100 * DAY;
  const rs = [
    r(1, T0, { 1: 80 }, { trusted: false }),
    r(2, T0 + 30, { 1: 80 }, { trusted: false, zone: null }),
    r(3, T0 + 10 * DAY, { 1: 80 }),
    r(4, T0 + 60 * DAY, { 1: 80 }),
    r(5, now + 3 * DAY, { 1: 80 }),
    r(6, T0 + 70 * DAY, { 1: 19 }),
  ];
  const q = qualityReport(rs, now);
  assert.equal(q.untrustedClock, 2);
  assert.equal(q.zoneAssumed, 1);
  assert.equal(q.duplicates, 1);
  assert.equal(q.futureTimestamps, 1);
  assert.deepEqual(q.outliers, [{ type: 1, label: "Weight", count: 1 }]);
  assert.equal(q.gaps.length, 1);
  assert.equal(q.gaps[0].days, 50);
  assert.equal(q.gaps[0].from, T0 + 10 * DAY);
});
