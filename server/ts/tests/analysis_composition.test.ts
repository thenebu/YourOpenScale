import assert from "node:assert/strict";
import test from "node:test";
import { synth } from "./fixtures/synthetic.ts";
import {
  bmiCategory, bmiSeries, compositionMonthly, deriveComposition, ffmi, fmi, recomposition,
} from "../analysis/composition.ts";
import { dailySeries } from "../analysis/series.ts";
import type { Reading } from "../analysis/types.ts";

const rd = (values: Reading["values"], t = Date.UTC(2024, 2, 5, 7) / 1000): Reading =>
  ({ id: 1, t, zone: "UTC", trusted: true, scaleId: 1, values });
const NOTE = "Bathroom-scale body composition (bioimpedance) shifts with hydration; trust multi-week trends, not single days.";

test("deriveComposition derives fat mass, lean mass and fat percent", () => {
  const [a] = deriveComposition([rd({ 1: 80, 6: 25 })]);
  assert.equal(a.values[8], 20);
  assert.equal(a.values[5], 60);
  const [b] = deriveComposition([rd({ 1: 80, 8: 16 })]);
  assert.equal(b.values[6], 20);
  assert.equal(b.values[5], 64);
  const [c] = deriveComposition([rd({ 1: 80, 8: 16, 5: 62, 6: 21 })]);
  assert.deepEqual([c.values[8], c.values[5], c.values[6]], [16, 62, 21]);
  const [d] = deriveComposition([rd({ 6: 25 })]);
  assert.equal(d.values[8], undefined);
  const input = rd({ 1: 80, 6: 25 });
  deriveComposition([input]);
  assert.equal(input.values[8], undefined); // no mutation
});

test("recomposition: recomposition", () => {
  const r = recomposition(-0.2, -1.2, 0.8, 90);
  assert.equal(r.kind, "recomposition");
  assert.equal(r.text, `Your weight held steady while fat mass fell 1.2 kg and lean mass rose 0.8 kg. ${NOTE}`);
});

test("recomposition: fat loss and mixed loss", () => {
  const fat = recomposition(-4.1, -3.3, -0.8, 90);
  assert.equal(fat.kind, "fat-loss");
  assert.equal(fat.text, `About 80% of the 4.1 kg you lost was fat. ${NOTE}`);
  assert.ok(Math.abs(fat.fatShare! - 3.3 / 4.1) < 1e-12);
  const mixed = recomposition(-4.1, -1.85, -2.25, 90);
  assert.equal(mixed.kind, "mixed-loss");
  assert.equal(mixed.text, `Of the 4.1 kg lost, about 45% was fat; the rest came from lean mass (water, glycogen, muscle). ${NOTE}`);
});

test("recomposition: lean gain, fat gain, stable, unclear", () => {
  assert.equal(recomposition(2, 0.5, 1.5, 60).kind, "lean-gain");
  assert.equal(recomposition(2, 1.5, 0.5, 60).kind, "fat-gain");
  assert.equal(recomposition(0.3, 0.2, 0.1, 60).kind, "stable");
  assert.equal(recomposition(2, 1, 1, 60).kind, "unclear");
  assert.equal(recomposition(-0.5, -0.9, 0.4, 60).kind, "unclear");
  for (const r of [recomposition(2, 0.5, 1.5, 60), recomposition(0.3, 0.2, 0.1, 60)]) assert.ok(r.text.endsWith(NOTE));
});

test("recomposition is insufficient for a short range or missing deltas", () => {
  assert.equal(recomposition(-4, -3, -1, 41).kind, "insufficient");
  assert.equal(recomposition(-4, -3, -1, 42).kind, "fat-loss");
  const missing = recomposition(-4, null, -1, 90);
  assert.equal(missing.kind, "insufficient");
  assert.equal(missing.fatShare, null);
  assert.ok(!/NaN|undefined/.test(missing.text));
});

test("compositionMonthly averages per month and derives other lean", () => {
  const rs = synth({ days: 75, start: "2024-01-01", composition: true });
  const m = compositionMonthly(rs);
  assert.deepEqual(m.map((x) => x.key), ["2024-01", "2024-02", "2024-03"]);
  assert.ok(m.every((x) => x.fat! > 0 && x.muscle! > 0 && x.bone! > 0 && x.water! > 0));
  assert.ok(m.every((x) => x.otherLean !== null && x.otherLean >= 0));
  assert.equal(m[0].t, Date.UTC(2024, 0, 15, 12) / 1000);
  const none = compositionMonthly(synth({ days: 10 }));
  assert.deepEqual(none, []);
  const neg = compositionMonthly([rd({ 5: 50, 76: 49, 88: 3 })]);
  assert.equal(neg[0].otherLean, null);
});

test("bmiCategory boundaries and minors", () => {
  assert.equal(bmiCategory(18.49, 30), "underweight");
  assert.equal(bmiCategory(18.5, 30), "normal");
  assert.equal(bmiCategory(24.99, 30), "normal");
  assert.equal(bmiCategory(25, 30), "overweight");
  assert.equal(bmiCategory(29.99, 30), "overweight");
  assert.equal(bmiCategory(30, 30), "obesity-1");
  assert.equal(bmiCategory(35, null), "obesity-2");
  assert.equal(bmiCategory(39.99, 30), "obesity-2");
  assert.equal(bmiCategory(40, 30), "obesity-3");
  assert.equal(bmiCategory(22, 17), null);
  assert.equal(bmiCategory(NaN, 30), null);
});

test("bmiSeries divides by height squared; null for minors or unknown height", () => {
  const d = dailySeries(synth({ days: 5, base: 81 }), 1, { morningOnly: false });
  const s = bmiSeries(d, 180, 40)!;
  assert.equal(s.length, 5);
  assert.ok(Math.abs(s[0].v - d[0].v / 3.24) < 1e-12);
  assert.equal(s[0].day, d[0].day);
  assert.equal(bmiSeries(d, null, 40), null);
  assert.equal(bmiSeries(d, 0, 40), null);
  assert.equal(bmiSeries(d, 180, 17), null);
  assert.ok(bmiSeries(d, 180, null));
});

test("FFMI normalisation and FMI", () => {
  assert.ok(Math.abs(ffmi(64.8, 180, false) - 20) < 1e-12);
  assert.ok(Math.abs(ffmi(64.8, 180) - 20) < 1e-12); // at 1.8 m the normalisation is neutral
  assert.ok(Math.abs(ffmi(64, 170) - (64 / 1.7 ** 2 + 6.1 * 0.1)) < 1e-12);
  assert.ok(Math.abs(fmi(16.2, 180) - 5) < 1e-12);
});
