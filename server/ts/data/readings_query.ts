/** Reading queries for the analytics (WP-07). */
import type { Goal, Reading } from "../analysis/types.ts";

export async function loadReadings(db: D1Database, userId: number, since: number): Promise<Reading[]> {
  throw new Error("not implemented: loadReadings");
}
export async function loadGoal(db: D1Database, userId: number): Promise<Goal | null> {
  throw new Error("not implemented: loadGoal");
}
export async function saveGoal(db: D1Database, userId: number, goal: Goal | null): Promise<void> {
  throw new Error("not implemented: saveGoal");
}
export async function countUnassigned(db: D1Database): Promise<number> {
  throw new Error("not implemented: countUnassigned");
}
export async function activeUsers(db: D1Database): Promise<{ id: number; name: string }[]> {
  throw new Error("not implemented: activeUsers");
}
