import assert from "node:assert/strict";
import test from "node:test";
import { synth } from "./fixtures/synthetic.ts";

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const weekdayOf = (t: number) => (new Date(t * 1000).getUTCDay() + 6) % 7;

test("synth is deterministic per seed and differs across seeds", () => {
  const a = synth({ seed: 7, days: 60, composition: true, eveningOffset: 0.9 });
  const b = synth({ seed: 7, days: 60, composition: true, eveningOffset: 0.9 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, synth({ seed: 8, days: 60, composition: true, eveningOffset: 0.9 }));
});

test("synth respects gaps", () => {
  const readings = synth({ days: 100, gaps: [[10, 20], [50, 50]] });
  const days = new Set(readings.map((r) => dayOf(r.t)));
  assert.equal(days.size, 100 - 11 - 1);
  assert.ok(!days.has("2023-01-12"));
  assert.ok(!days.has("2023-02-21"));
  assert.ok(days.has("2023-01-02"));
});

test("synth injects outliers on the requested day", () => {
  const readings = synth({ days: 40, noiseSd: 0.2, outliers: [{ day: 10, delta: 4 }, { day: 20, delta: -5 }] });
  const at = (i: number) => readings.find((r) => dayOf(r.t) === `2023-01-${String(2 + i).padStart(2, "0")}`)!;
  assert.ok(at(10).values[1]! > 83);
  assert.ok(at(20).values[1]! < 76);
  assert.ok(Math.abs(at(5).values[1]! - 80) < 2);
});

test("synth applies the weekday effect", () => {
  const effect = [0.5, 0, 0, 0, 0, -0.3, 0];
  const readings = synth({ days: 700, noiseSd: 0.2, weekdayEffect: effect });
  const mean = (wd: number) => {
    const xs = readings.filter((r) => weekdayOf(r.t) === wd).map((r) => r.values[1]!);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  assert.ok(Math.abs(mean(0) - 80.5) < 0.1);
  assert.ok(Math.abs(mean(5) - 79.7) < 0.1);
  assert.ok(Math.abs(mean(2) - 80) < 0.1);
});

test("synth evening readings and composition values", () => {
  const readings = synth({ days: 300, eveningOffset: 1, composition: true, zone: "Europe/Berlin" });
  const evening = readings.filter((r) => new Date(r.t * 1000).getUTCHours() >= 17);
  assert.ok(evening.length > 20 && evening.length < 80);
  for (const r of readings) for (const type of [1, 5, 6, 8, 76, 77, 88]) assert.ok(r.values[type]! > 0);
  assert.equal(new Set(readings.map((r) => r.id)).size, readings.length);
});
