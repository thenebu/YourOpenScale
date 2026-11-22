import test from "node:test";
import assert from "node:assert/strict";
import { csvFilename, exportRows, toCsv } from "../analysis/csv.ts";
import { buildUserAnalysis } from "../analysis/model.ts";
import type { Agg, Reading, Unit } from "../analysis/types.ts";
import { synth } from "./fixtures/synthetic.ts";

const USER = { id: 1, name: "Alex", shortName: "ALX", heightCm: 180, ageYears: 40, sex: 0 as const };

function fixture(unit: Unit = "kg", over: { morningOnly?: boolean } = {}) {
  const readings = synth({
    days: 70, slopePerWeek: -0.3, composition: true, eveningOffset: 1, eveningShare: 0.5,
    zone: "Europe/Berlin", outliers: [{ day: 30, delta: 15 }],
  });
  const now = readings[readings.length - 1].t + 3600;
  const analysis = buildUserAnalysis({
    user: USER, readings, unit, goal: null, now,
    range: { key: "all", from: readings[0].t, to: now, morningOnly: over.morningOnly ?? false, compare: "none" },
  });
  return { readings, analysis };
}
const parse = (csv: string) => csv.split("\r\n").slice(0, -1).map((l) => l.split(","));

test("toCsv: RFC 4180 quoting, CRLF, empty cells, 3 decimals, no BOM", () => {
  const csv = toCsv([
    ["a", "b,c", 'say "hi"', "line1\nline2", "cr\rx"],
    [1.23456, null, 2, 0.1 + 0.2, NaN],
    ["=SUM(A1)", "-5", "plain", "", "é"],
  ]);
  assert.equal(
    csv,
    'a,"b,c","say ""hi""","line1\nline2","cr\rx"\r\n1.235,,2,0.3,\r\n\'=SUM(A1),\'-5,plain,,é\r\n',
  );
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(!csv.startsWith("﻿"));
  assert.equal(toCsv([]), "");
});

test("csvFilename: ascii slug and UTC dates", () => {
  const from = Date.UTC(2025, 0, 5) / 1000;
  const to = Date.UTC(2025, 10, 22, 23, 0) / 1000;
  assert.equal(csvFilename("Alex", from, to, "raw"), "yow-alex-2025-01-05_2025-11-22-raw.csv");
  assert.equal(csvFilename("José Müller-Smith ", from, to, "weekly"), "yow-jose-muller-smith-2025-01-05_2025-11-22-weekly.csv");
  assert.equal(csvFilename('../"x"; rm', from, to, "daily"), "yow-x-rm-2025-01-05_2025-11-22-daily.csv");
  assert.equal(csvFilename("日本語", from, to, "monthly"), "yow-user-2025-01-05_2025-11-22-monthly.csv");
  assert.match(csvFilename("Alex", from, to, "raw"), /^[\x20-\x7e]+$/);
});

test("raw columns and first row", () => {
  const { readings, analysis } = fixture();
  const rows = exportRows(readings, analysis, "raw", [1, 6, 76], "kg");
  assert.deepEqual(rows[0], [
    "reading_id", "timestamp_utc", "local_date", "local_time", "time_zone", "clock_trusted",
    "weight_kg", "fat_ratio_pct", "muscle_mass_kg", "trend_weight_kg", "outlier",
  ]);
  assert.equal(rows.length, readings.length + 1);
  const first = rows[1];
  assert.equal(first[0], readings[0].id);
  assert.equal(first[1], "2023-01-02T06:00:00Z"); // 07:00 Berlin (UTC+1)
  assert.equal(first[2], "2023-01-02");
  assert.equal(first[3], "07:00");
  assert.equal(first[4], "Europe/Berlin");
  assert.equal(first[5], 1);
  assert.equal(first[6], readings[0].values[1]);
  assert.equal(first[10], "");
  const spike = rows.find((r) => String(r[10]).split("|").includes("jump"));
  assert.ok(spike, "the +15 kg spike is marked");
  const csv = toCsv(rows);
  assert.ok(!csv.includes("NaN") && !csv.includes("undefined"));
});

test("raw rows respect morning-only and empty cells for missing metrics", () => {
  const { readings, analysis } = fixture("kg", { morningOnly: true });
  const rows = exportRows(readings, analysis, "raw", [1, 11], "kg");
  assert.ok(rows.length - 1 < readings.length);
  assert.ok(rows.slice(1).every((r) => String(r[3]) < "10:00" && r[7] === null));
  assert.ok(toCsv(rows.slice(0, 3)).split("\r\n")[1].includes(",,"));
});

test("lb users get an extra weight_lb column", () => {
  const { readings, analysis } = fixture("lb");
  const rows = exportRows(readings, analysis, "raw", [1], "lb");
  assert.deepEqual(rows[0].slice(6), ["weight_kg", "weight_lb", "trend_weight_kg", "outlier"]);
  assert.ok(Math.abs((rows[1][7] as number) - (rows[1][6] as number) * 2.2046226) < 1e-4);
  const st = exportRows(readings, analysis, "daily", [1], "st");
  assert.ok(st[0].includes("weight_st"));
  const none = exportRows(readings, analysis, "raw", [6], "lb");
  assert.ok(!none[0].includes("weight_lb"));
});

test("daily columns and values", () => {
  const { readings, analysis } = fixture();
  const rows = exportRows(readings, analysis, "daily", [1, 6], "kg");
  assert.deepEqual(rows[0], [
    "local_date", "n_readings",
    "weight_kg_first", "weight_kg_mean", "weight_kg_min", "weight_kg_max",
    "fat_ratio_pct_first", "fat_ratio_pct_mean", "fat_ratio_pct_min", "fat_ratio_pct_max",
    "trend_weight_kg",
  ]);
  assert.ok(rows.length - 1 >= 69 && rows.length - 1 <= 70);
  const withTwo = rows.slice(1).find((r) => r[1] === 2)!;
  assert.ok((withTwo[5] as number) >= (withTwo[4] as number), "max >= min");
  assert.ok(withTwo.every((c) => c !== undefined));
  assert.equal(typeof rows[5][10], "number");
  // The +15 kg spike day keeps its other readings only; the spike itself is excluded.
  assert.ok(rows.slice(1).every((r) => (r[5] as number) < 100));
});

test("weekly and monthly columns", () => {
  const { readings, analysis } = fixture();
  for (const agg of ["weekly", "monthly"] as Agg[]) {
    const rows = exportRows(readings, analysis, agg, [1], "kg");
    assert.deepEqual(rows[0], [
      "period", "period_start", "period_end", "n_readings", "n_days",
      "weight_kg_mean", "weight_kg_min", "weight_kg_max", "weight_kg_p25", "weight_kg_p75", "trend_weight_kg_end",
    ]);
    assert.ok(rows.length > 2);
    const r = rows[2];
    assert.match(String(r[0]), agg === "weekly" ? /^\d{4}-W\d\d$/ : /^\d{4}-\d\d$/);
    assert.match(String(r[1]), /^\d{4}-\d\d-\d\dT00:00:00Z$/);
    assert.ok((r[4] as number) >= 1 && (r[3] as number) >= (r[4] as number));
    assert.ok((r[6] as number) <= (r[5] as number) && (r[5] as number) <= (r[7] as number));
    assert.equal(typeof r[10], "number");
  }
});

test("metrics without readings in range give empty cells, not NaN", () => {
  const { readings, analysis } = fixture();
  const rows = exportRows(readings, analysis, "weekly", [1, 11], "kg");
  const csv = toCsv(rows);
  assert.ok(!/NaN|undefined/.test(csv));
  assert.match(csv.split("\r\n")[1], /,,,,,/);
  assert.equal(exportRows([], analysis, "daily", [1], "kg").length, 1);
});
