import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAgg, formatDate, formatDelta, formatMass, formatMetric, formatRate, relativeDays, toDisplay,
} from "../analysis/format.ts";
import { chooseAgg as seriesChooseAgg } from "../analysis/series.ts";

const LB = 2.2046226218487757;

test("toDisplay", () => {
  assert.equal(toDisplay(80, "kg"), 80);
  assert.ok(Math.abs(toDisplay(80, "lb") - 176.3698) < 1e-3);
  assert.ok(Math.abs(toDisplay(80, "st") - 176.3698 / 14) < 1e-3);
});

test("formatMass kg and lb", () => {
  assert.equal(formatMass(81.4, "kg"), "81.40 kg");
  assert.equal(formatMass(81.44, "kg", { decimals: 1 }), "81.4 kg");
  assert.equal(formatMass(80, "lb"), "176.4 lb");
  assert.equal(formatMass(-1.234, "kg"), "−1.23 kg");
});

test("formatMass stones: 12 st 11.4 lb and the carry", () => {
  assert.equal(formatMass((12 * 14 + 11.4) / LB, "st"), "12 st 11.4 lb");
  // 13.99 lb rounds up to the next stone
  assert.equal(formatMass((12 * 14 + 13.99) / LB, "st"), "13 st 0.0 lb");
  assert.equal(formatMass(13.96 / LB, "st"), "1 st 0.0 lb");
  assert.equal(formatMass(13.94 / LB, "st"), "0 st 13.9 lb");
  assert.equal(formatMass(80, "st"), "12 st 8.4 lb");
});

test("formatMetric by type", () => {
  assert.equal(formatMetric(80, 1, "lb"), "176.4 lb");
  assert.equal(formatMetric(28.44, 6, "kg"), "28.4%");
  assert.equal(formatMetric(62, 11, "kg"), "62 bpm");
  assert.equal(formatMetric(1650, 226, "kg"), "1,650 kcal");
  assert.equal(formatMetric(7, 170, "kg"), "7");
  assert.equal(formatMetric(24.46, -1, "kg"), "24.5");
  assert.equal(formatMetric(3.1, 88, "kg", { decimals: 1 }), "3.1 kg");
  assert.equal(formatMetric(NaN, 1, "kg"), "–");
});

test("formatDelta: true minus, pp, lb for non-kg units", () => {
  assert.equal(formatDelta(-0.4, 1, "kg"), "−0.4 kg");
  assert.equal(formatDelta(0.4, 1, "kg"), "+0.4 kg");
  assert.equal(formatDelta(1, 1, "lb"), "+2.2 lb");
  assert.equal(formatDelta(-1, 1, "st"), "−2.2 lb");
  assert.equal(formatDelta(-0.6, 6, "kg"), "−0.6 pp");
  assert.equal(formatDelta(2, 11, "kg"), "+2 bpm");
  assert.equal(formatDelta(0.001, 1, "kg"), "0 kg");
  assert.ok(!formatDelta(-0.4, 1, "kg").includes("-"));
});

test("formatRate", () => {
  assert.equal(formatRate(-0.3, "kg"), "−0.3 kg/week");
  assert.equal(formatRate(0.25, "kg"), "+0.3 kg/week".replace("0.3", "0.3"));
  assert.equal(formatRate(0.05, "kg"), "+0.05 kg/week");
  assert.equal(formatRate(-0.5, "lb"), "−1.1 lb/week");
  assert.equal(formatRate(0, "kg"), "0 kg/week");
});

test("formatDate", () => {
  const t = Date.UTC(2024, 2, 5, 23, 30) / 1000;
  assert.equal(formatDate(t, "UTC", "short"), "5 Mar");
  assert.equal(formatDate(t, "UTC", "medium"), "5 Mar 2024");
  assert.equal(formatDate(t, "UTC", "long"), "Tuesday 5 March 2024");
  assert.equal(formatDate(t, "UTC", "time"), "23:30");
  assert.equal(formatDate(t, "UTC", "month"), "Mar 2024");
  assert.equal(formatDate(t, "Europe/Berlin", "medium"), "6 Mar 2024");
  assert.equal(formatDate(t, null, "time"), "23:30");
  assert.equal(formatDate(t, "Not/AZone", "time"), "23:30");
});

test("relativeDays", () => {
  assert.equal(relativeDays(0), "today");
  assert.equal(relativeDays(1), "yesterday");
  assert.equal(relativeDays(5), "5 days ago");
  assert.equal(relativeDays(-1), "tomorrow");
  assert.equal(relativeDays(-3), "in 3 days");
});

test("chooseAgg is re-exported from series", () => {
  assert.equal(chooseAgg, seriesChooseAgg);
});
