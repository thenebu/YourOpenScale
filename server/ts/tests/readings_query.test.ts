import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSqlite } from "../sqlite.ts";
import { activeUsers, countUnassigned, loadGoal, loadReadings, saveGoal } from "../data/readings_query.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "yow-rq-"));
  const store = new LocalSqlite(join(dir, "t.db"));
  return { db: store.asD1(), done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

let hash = 0;
async function insert(
  db: D1Database,
  r: { id: number; scale: number; user: number | null; meastime: number; quality?: string; received?: number;
    w?: [number, number] | null; measures: unknown },
) {
  const measures = typeof r.measures === "string" ? r.measures : JSON.stringify(r.measures);
  await db.prepare(
    `INSERT INTO readings(id,scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,
       weight_value,weight_unit,measures_json,payload_hash,first_received_at,last_received_at,attempts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
  ).bind(
    r.id, r.scale, r.user, r.user === null ? "unassigned" : "auto", "[]", 0, r.meastime, r.quality ?? "trusted",
    r.w ? r.w[0] : null, r.w ? r.w[1] : null, measures, `h${++hash}`, r.received ?? r.meastime, r.received ?? r.meastime,
  ).run();
}

test("loadReadings: segments skipped, weight fallback, clock choice, null zone, malformed data", async () => {
  const { db, done } = setup();
  try {
    await db.prepare("INSERT INTO scales(id,label,model,mac,secret,time_zone) VALUES(1,'A','WBS03','001122334401','s','Europe/Berlin'),(2,'B','WBS03','001122334402','s',NULL)").run();
    await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(1,'Zed','ZED',180,40,0,80,1),(2,'Amy','AMY',170,30,1,60,1)").run();
    const wm = [{ type: 1, value: 81234, unit: -3 }];
    await insert(db, { id: 1, scale: 1, user: 1, meastime: 1700000000, w: [81234, -3], measures: wm });
    // Weight only in the legacy columns (no type-1 measure) falls back.
    await insert(db, { id: 2, scale: 1, user: 1, meastime: 1700100000, w: [80000, -3], measures: [{ type: 11, value: 62, unit: 0 }] });
    // Segment duplicates: the type is dropped, other types stay; type-1 twice means no weight at all.
    await insert(db, {
      id: 3, scale: 1, user: 1, meastime: 1700200000, w: [80000, -3],
      measures: [{ type: 1, value: 80000, unit: -3 }, { type: 1, value: 79000, unit: -3 }, { type: 76, value: 3000, unit: -2 }, { type: 76, value: 3100, unit: -2 }, { type: 11, value: 60, unit: 0 }],
    });
    // Untrusted clock uses first_received_at; null scale zone gives zone null.
    await insert(db, { id: 4, scale: 2, user: 1, meastime: 5, quality: "untrusted", received: 1700300000, w: [79500, -3], measures: [{ type: 1, value: 79500, unit: -3 }] });
    // Malformed JSON keeps the legacy weight; a malformed measure is skipped; no values at all drops the row.
    await insert(db, { id: 5, scale: 1, user: 1, meastime: 1700400000, w: [79000, -3], measures: "not json" });
    await insert(db, { id: 6, scale: 1, user: 1, meastime: 1700500000, w: null, measures: [{ type: 11, value: 1.5, unit: 0 }, { type: 8, value: 12000, unit: -3 }] });
    await insert(db, { id: 7, scale: 1, user: 1, meastime: 1700600000, w: null, measures: [{ type: 11, value: 1, unit: 99 }] });
    // Another user and an old reading before `since`.
    await insert(db, { id: 8, scale: 1, user: 2, meastime: 1700000000, w: [60000, -3], measures: [{ type: 1, value: 60000, unit: -3 }] });
    await insert(db, { id: 9, scale: 1, user: null, meastime: 1700000100, w: [70000, -3], measures: [{ type: 1, value: 70000, unit: -3 }] });

    const all = await loadReadings(db, 1, 0);
    assert.deepEqual(all.map((r) => r.id), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(all[0], { id: 1, t: 1700000000, zone: "Europe/Berlin", trusted: true, scaleId: 1, values: { 1: 81.234 } });
    assert.deepEqual(all[1].values, { 11: 62, 1: 80 });
    assert.deepEqual(all[2].values, { 11: 60 }, "segment types dropped, no weight fallback when type 1 is present twice");
    assert.equal(all[3].t, 1700300000);
    assert.equal(all[3].zone, null);
    assert.equal(all[3].trusted, false);
    assert.deepEqual(all[4].values, { 1: 79 });
    assert.deepEqual(all[5].values, { 8: 12 }, "non-integer measure skipped");

    const since = await loadReadings(db, 1, 1700250000);
    assert.deepEqual(since.map((r) => r.id), [4, 5, 6]);
    assert.deepEqual((await loadReadings(db, 2, 0)).map((r) => r.id), [8]);
    assert.deepEqual(await loadReadings(db, 99, 0), []);
  } finally {
    done();
  }
});

test("goal round trip, unassigned count and active users", async () => {
  const { db, done } = setup();
  try {
    assert.equal(await loadGoal(db, 1), null);
    const goal = { kg: 78.5, date: "2027-03-01", startKg: 85, startAt: 1700000000 };
    await saveGoal(db, 1, goal);
    assert.deepEqual(await loadGoal(db, 1), goal);
    await saveGoal(db, 1, { ...goal, kg: 77, date: null });
    assert.deepEqual(await loadGoal(db, 1), { ...goal, kg: 77, date: null });
    assert.equal(await loadGoal(db, 2), null, "goals are per user");
    await db.prepare("INSERT INTO settings(key,value) VALUES('goal:3','{oops')").run();
    assert.equal(await loadGoal(db, 3), null, "corrupt goal is ignored");
    await saveGoal(db, 1, { ...goal, startManual: true });
    assert.equal((await loadGoal(db, 1))?.startManual, true);
    await saveGoal(db, 1, null);
    assert.equal(await loadGoal(db, 1), null);

    await db.prepare("INSERT INTO scales(id,label,model,mac,secret) VALUES(1,'A','WBS03','001122334401','s')").run();
    await db.prepare("INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,active,created_at) VALUES(1,'Zed','ZED',180,40,0,80,1,1),(2,'Amy','AMY',170,30,1,60,1,1),(3,'Old','OLD',170,30,1,60,0,1)").run();
    assert.deepEqual(await activeUsers(db), [{ id: 2, name: "Amy" }, { id: 1, name: "Zed" }]);
    assert.equal(await countUnassigned(db), 0);
    await insert(db, { id: 1, scale: 1, user: null, meastime: 1700000000, w: [70000, -3], measures: [{ type: 1, value: 70000, unit: -3 }] });
    await insert(db, { id: 2, scale: 1, user: null, meastime: 1700000100, w: [70100, -3], measures: [{ type: 1, value: 70100, unit: -3 }] });
    await insert(db, { id: 3, scale: 1, user: 1, meastime: 1700000200, w: [70200, -3], measures: [{ type: 1, value: 70200, unit: -3 }] });
    assert.equal(await countUnassigned(db), 2);
  } finally {
    done();
  }
});
