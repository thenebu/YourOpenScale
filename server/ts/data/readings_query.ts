/** Reading queries for the analytics (WP-07). The only analytics module that touches the DB. */
import { metricValue, storedMeasures } from "../metrics.ts";
import type { Goal, Reading } from "../analysis/types.ts";

const TIME =
  "CASE WHEN r.time_quality='trusted' THEN r.meastime ELSE r.first_received_at END";

type Row = {
  id: number; t: number; time_quality: string; weight_value: number | null; weight_unit: number | null;
  measures_json: string; scale_id: number; time_zone: string | null;
};

/**
 * One query per user, oldest first. Types that occur more than once in a reading (body segments) are
 * dropped; weight falls back to weight_value/weight_unit when no type-1 measure exists; malformed
 * measures are skipped rather than failing the page.
 */
export async function loadReadings(db: D1Database, userId: number, since: number): Promise<Reading[]> {
  const result = await db
    .prepare(
      `SELECT r.id, ${TIME} AS t, r.time_quality, r.weight_value, r.weight_unit, r.measures_json,
              r.scale_id, s.time_zone
       FROM readings r JOIN scales s ON s.id = r.scale_id
       WHERE r.user_id = ? AND ${TIME} >= ?
       ORDER BY t, r.id`,
    )
    .bind(userId, since)
    .all<Row>();
  const out: Reading[] = [];
  for (const row of result.results) {
    const t = Number(row.t);
    if (!(t > 0)) continue;
    let measures: ReturnType<typeof storedMeasures> = [];
    try {
      measures = storedMeasures(row);
    } catch {
      measures = [];
    }
    const counts = new Map<number, number>();
    for (const m of measures) if (m && typeof m === "object") counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    const values: Reading["values"] = {};
    for (const m of measures) {
      if (!m || typeof m !== "object" || counts.get(m.type) !== 1) continue;
      try {
        const v = metricValue(Number(m.value), Number(m.unit));
        if (Number.isFinite(v)) values[m.type] = v;
      } catch {
        // Malformed stored measure: skip.
      }
    }
    if (!counts.has(1) && row.weight_value != null && row.weight_unit != null) {
      try {
        const v = metricValue(Number(row.weight_value), Number(row.weight_unit));
        if (Number.isFinite(v)) values[1] = v;
      } catch {
        // skip
      }
    }
    if (!Object.keys(values).length) continue;
    out.push({
      id: row.id, t, zone: row.time_zone ?? null, trusted: row.time_quality === "trusted",
      scaleId: row.scale_id, values,
    });
  }
  return out;
}

const goalKey = (userId: number) => `goal:${userId}`;

export async function loadGoal(db: D1Database, userId: number): Promise<Goal | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key=?")
    .bind(goalKey(userId))
    .first<{ value: string }>();
  if (!row) return null;
  try {
    const g = JSON.parse(row.value);
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (!g || !num(g.kg) || !num(g.startKg) || !num(g.startAt)) return null;
    if (g.date !== null && typeof g.date !== "string") return null;
    return { kg: g.kg, date: g.date ?? null, startKg: g.startKg, startAt: g.startAt, ...(g.startManual === true ? { startManual: true } : {}) };
  } catch {
    return null;
  }
}

/** null deletes the goal. */
export async function saveGoal(db: D1Database, userId: number, goal: Goal | null): Promise<void> {
  if (goal === null) {
    await db.prepare("DELETE FROM settings WHERE key=?").bind(goalKey(userId)).run();
    return;
  }
  const value = JSON.stringify({
    kg: goal.kg, date: goal.date, startKg: goal.startKg, startAt: goal.startAt,
    ...(goal.startManual ? { startManual: true } : {}),
  });
  await db
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(goalKey(userId), value)
    .run();
}

export async function countUnassigned(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM readings WHERE user_id IS NULL").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function activeUsers(db: D1Database): Promise<{ id: number; name: string }[]> {
  const result = await db
    .prepare("SELECT id,name FROM users WHERE active=1 ORDER BY name,id")
    .all<{ id: number; name: string }>();
  return result.results.map((u) => ({ id: u.id, name: u.name }));
}
