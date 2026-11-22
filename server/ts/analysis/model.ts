/** Builds the UserAnalysis / DashboardSummary payloads (WP-07). Pure: `now` is a parameter. */
import type {
  DashboardSummary, Goal, RangeKey, Reading, Unit, UserAnalysis,
} from "./types.ts";

export type UserInfo = {
  id: number; name: string; shortName: string; heightCm: number | null; ageYears: number | null; sex: 0 | 1;
};
export type AnalysisInput = {
  user: UserInfo;
  readings: Reading[];
  unit: Unit;
  range: { key: RangeKey | "custom"; from: number; to: number; morningOnly: boolean; compare: "none" | "prev" | "yoy" };
  goal: Goal | null;
  now: number;
};

export function buildUserAnalysis(input: AnalysisInput): UserAnalysis {
  throw new Error("not implemented: buildUserAnalysis");
}
export function buildDashboardSummary(input: {
  user: Pick<UserInfo, "id" | "name" | "shortName"> & Partial<UserInfo>;
  readings: Reading[];
  unit: Unit;
  goal: Goal | null;
  now: number;
}): DashboardSummary {
  throw new Error("not implemented: buildDashboardSummary");
}
