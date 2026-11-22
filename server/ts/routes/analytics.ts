/** "/", "/users/:id/overview", "/api/ui/*", CSV export, goal POST (WP-13). */
import { extent } from "../analysis/extent.ts";
import { csvFilename, exportRows, toCsv } from "../analysis/csv.ts";
import { toDisplay } from "../analysis/format.ts";
import { buildDashboardSummary, buildUserAnalysis, type UserInfo } from "../analysis/model.ts";
import { serializeAnalysis, serializeDashboard } from "../analysis/serialize.ts";
import { RANGES } from "../analysis/spec.ts";
import type { Agg, Goal, RangeKey, Reading, Unit } from "../analysis/types.ts";
import { t } from "../i18n/index.ts";
import { loadGoal, loadReadings, saveGoal } from "../data/readings_query.ts";
import { dashboardView } from "../views/dashboard.ts";
import { overviewView } from "../views/overview.ts";
import type { ForkCtx } from "./index.ts";
import { equal } from "./util.ts";

const DAY = 86400;
const DASHBOARD_DAYS = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OVERVIEW = /^\/users\/(\d+)\/overview$/;
const API_ANALYSIS = /^\/api\/ui\/users\/(\d+)\/analysis$/;
const EXPORT = /^\/users\/(\d+)\/export\.csv$/;
const GOAL = /^\/users\/(\d+)\/goal$/;
const AGGS: Agg[] = ["raw", "daily", "weekly", "monthly"];

type UserRow = {
  id: number; name: string; short_name: string; height_cm: number; age_years: number;
  birth_date: string | null; sex: number; reference_weight_kg: number;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/** Parses a real calendar day; null for anything else. */
function parseDay(value: string | null): number | null {
  if (!value || !DAY_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms / 1000;
}

function ageYears(user: UserRow, now: number): number {
  const born = user.birth_date ? Date.parse(`${user.birth_date}T00:00:00Z`) / 1000 : NaN;
  if (Number.isFinite(born)) return Math.round(((now - born) / DAY / 365.2425) * 10) / 10;
  return user.age_years;
}

function userInfo(user: UserRow, now: number): UserInfo {
  return {
    id: user.id, name: user.name, shortName: user.short_name,
    heightCm: user.height_cm > 0 ? user.height_cm : null,
    ageYears: ageYears(user, now),
    sex: user.sex === 1 ? 1 : 0,
  };
}

async function displayUnit(db: D1Database): Promise<Unit> {
  const row = await db.prepare("SELECT value FROM settings WHERE key='display_weight_unit'").first<{ value: string }>();
  return row?.value === "lb" || row?.value === "st" ? row.value : "kg";
}

async function findUser(db: D1Database, id: number): Promise<UserRow | null> {
  return (await db.prepare("SELECT * FROM users WHERE id=?").bind(id).first<UserRow>()) ?? null;
}

/** Range, morning and compare params of the overview, the JSON API and the CSV export (02 §3). */
function parseRange(query: URLSearchParams, readings: Reading[], now: number) {
  const morningOnly = query.get("morning") === "1";
  const compareParam = query.get("compare");
  const compare: "none" | "prev" | "yoy" = compareParam === "prev" || compareParam === "yoy" ? compareParam : "none";
  const from = parseDay(query.get("from"));
  const to = parseDay(query.get("to"));
  if (from !== null && to !== null && from <= to) {
    // The whole last day is included.
    return { key: "custom" as const, from, to: to + DAY - 1, morningOnly, compare };
  }
  const preset = RANGES.find((r) => r.key === query.get("range")) ?? RANGES[1];
  let start: number;
  if (preset.days) start = now - preset.days * DAY;
  else start = readings.length ? extent(readings.map((r) => r.t))[0] : now - DAY;
  return { key: preset.key as RangeKey, from: Math.floor(start), to: now, morningOnly, compare };
}

async function analysisFor(ctx: ForkCtx, user: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const [readings, goal, unit] = await Promise.all([
    loadReadings(ctx.db, user.id, 0),
    loadGoal(ctx.db, user.id),
    displayUnit(ctx.db),
  ]);
  const range = parseRange(ctx.url.searchParams, readings, now);
  const analysis = buildUserAnalysis({ user: userInfo(user, now), readings, unit, range, goal, now });
  return { analysis, readings, unit, now };
}

function unauthenticated(ctx: ForkCtx, api: boolean): Response {
  if (api) return jsonResponse({ error: "Sign in first" }, 401);
  return ctx.go(ctx.adminConfigured ? "/login" : "/setup");
}

async function dashboard(ctx: ForkCtx): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const users = (await ctx.db.prepare("SELECT * FROM users WHERE active=1 ORDER BY id").all<UserRow>()).results;
  const unit = await displayUnit(ctx.db);
  const summaries = [];
  let zone: string | null = null;
  let lastWeighIn: number | null = null;
  for (const user of users) {
    const readings = await loadReadings(ctx.db, user.id, now - DASHBOARD_DAYS * DAY);
    const goal = await loadGoal(ctx.db, user.id);
    const summary = buildDashboardSummary({ user: userInfo(user, now), readings, unit, goal, now });
    summaries.push({ summary, readings });
    if (summary.last && (lastWeighIn === null || summary.last.t > lastWeighIn)) lastWeighIn = summary.last.t;
    if (!zone && readings.length) zone = readings[readings.length - 1].zone;
  }
  if (!zone) {
    const scale = await ctx.db
      .prepare("SELECT time_zone FROM scales WHERE time_zone IS NOT NULL AND time_zone<>'' ORDER BY id LIMIT 1")
      .first<{ time_zone: string }>();
    zone = scale?.time_zone ?? null;
  }
  const body = dashboardView(summaries.map((s) => s.summary), { now, lastWeighIn, zone });
  return ctx.page(t("page.dashboard"), body, "/", { entries: ["app"] });
}

async function overview(ctx: ForkCtx, id: number): Promise<Response> {
  const user = await findUser(ctx.db, id);
  if (!user) return new Response("Not Found", { status: 404 });
  const switchTo = ctx.url.searchParams.get("user");
  if (switchTo !== null) {
    // The user switcher is a GET form; move to the chosen user and keep the other params.
    const rest = new URLSearchParams(ctx.url.searchParams);
    rest.delete("user");
    const qs = rest.toString();
    const target = /^\d+$/.test(switchTo) ? Number(switchTo) : id;
    return new Response(null, {
      status: 303,
      headers: { Location: `/users/${target}/overview${qs ? `?${qs}` : ""}`, "Cache-Control": "no-store" },
    });
  }
  const { analysis } = await analysisFor(ctx, user);
  const users = (await ctx.db.prepare("SELECT id,name FROM users WHERE active=1 ORDER BY name,id").all<{ id: number; name: string }>()).results;
  // "<" is escaped as a JSON unicode escape so the payload can never close or confuse the script element.
  const wireJson = JSON.stringify(serializeAnalysis(analysis)).replaceAll("<", "\\u003c");
  const body = overviewView(analysis, { users, query: ctx.url.searchParams, csrf: ctx.csrf, wireJson });
  return ctx.page(user.name, body, `/users/${id}/overview`, { entries: ["app", "charts"] });
}

async function exportCsv(ctx: ForkCtx, id: number): Promise<Response> {
  const user = await findUser(ctx.db, id);
  if (!user) return new Response("Not Found", { status: 404 });
  const { analysis, readings, unit } = await analysisFor(ctx, user);
  const q = ctx.url.searchParams;
  const aggParam = q.get("agg");
  const agg: Agg = AGGS.includes(aggParam as Agg) ? (aggParam as Agg) : "raw";
  const observed = new Set<number>();
  for (const r of readings) for (const key of Object.keys(r.values)) observed.add(Number(key));
  const requested = (q.get("metrics") ?? "")
    .split(",")
    .filter((v) => /^-?\d+$/.test(v.trim()))
    .map((v) => Number(v));
  const metrics = requested.length ? requested : [...observed];
  const rows = exportRows(readings, analysis, agg, metrics, unit);
  const filename = csvFilename(user.name, analysis.range.from, analysis.range.to, agg);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function saveGoalForm(ctx: ForkCtx, id: number): Promise<Response> {
  if (!ctx.loggedIn || !ctx.adminConfigured) return unauthenticated(ctx, false);
  const form = await ctx.request.formData();
  const token = form.get("_csrf");
  if (typeof token !== "string" || !equal(token, ctx.csrf)) return new Response("Invalid CSRF token", { status: 403 });
  const user = await findUser(ctx.db, id);
  if (!user) return new Response("Not Found", { status: 404 });
  const back = `/users/${id}/overview`;
  const fail = (message: string) => ctx.go(`${back}#progress`, message);
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v.trim() : "";
  };
  const weight = text("goal_weight").replace(",", ".");
  if (!weight) {
    await saveGoal(ctx.db, id, null);
    return ctx.go(`${back}#progress`, t("msg.goalRemoved"));
  }
  const unit = await displayUnit(ctx.db);
  const entered = Number(weight);
  if (!/^\d+(\.\d+)?$/.test(weight) || !Number.isFinite(entered)) return fail(t("msg.goalNumber"));
  const kg = entered / toDisplay(1, unit);
  if (kg < 20 || kg > 350) return fail(t("msg.goalRange"));
  const now = Math.floor(Date.now() / 1000);
  const dateText = text("goal_date");
  let date: string | null = null;
  if (dateText) {
    const day = parseDay(dateText);
    if (day === null || day + DAY <= now) return fail(t("msg.goalDateFuture"));
    date = dateText;
  }
  const existing = await loadGoal(ctx.db, id);
  let goal: Goal;
  if (existing) goal = { kg, date, startKg: existing.startKg, startAt: existing.startAt };
  else {
    const readings = await loadReadings(ctx.db, id, now - DASHBOARD_DAYS * DAY);
    const summary = buildDashboardSummary({ user: userInfo(user, now), readings, unit, goal: null, now });
    const start = summary.trendKg ?? summary.last?.weightKg ?? user.reference_weight_kg;
    goal = { kg, date, startKg: start, startAt: now };
  }
  await saveGoal(ctx.db, id, goal);
  return ctx.go(`${back}#progress`, t("msg.goalSaved"));
}

export async function handleAnalyticsRoute(ctx: ForkCtx): Promise<Response | null> {
  const { path, method } = ctx;
  if (method === "POST") {
    const goal = GOAL.exec(path);
    return goal ? saveGoalForm(ctx, Number(goal[1])) : null;
  }
  if (method !== "GET") return null;
  const apiAnalysis = API_ANALYSIS.exec(path);
  const isApi = apiAnalysis !== null || path === "/api/ui/dashboard";
  const page = path === "/" ? "dashboard" : OVERVIEW.exec(path) ? "overview" : EXPORT.exec(path) ? "export" : null;
  if (!isApi && !page) return null;
  if (!ctx.loggedIn || !ctx.adminConfigured) return unauthenticated(ctx, isApi);

  if (path === "/") return dashboard(ctx);
  if (path === "/api/ui/dashboard") {
    const now = Math.floor(Date.now() / 1000);
    const users = (await ctx.db.prepare("SELECT * FROM users WHERE active=1 ORDER BY id").all<UserRow>()).results;
    const unit = await displayUnit(ctx.db);
    const out = [];
    for (const user of users) {
      const readings = await loadReadings(ctx.db, user.id, now - DASHBOARD_DAYS * DAY);
      const goal = await loadGoal(ctx.db, user.id);
      out.push(serializeDashboard(buildDashboardSummary({ user: userInfo(user, now), readings, unit, goal, now })));
    }
    return jsonResponse({ generatedAt: now, users: out });
  }
  if (apiAnalysis) {
    const user = await findUser(ctx.db, Number(apiAnalysis[1]));
    if (!user) return jsonResponse({ error: "Not found" }, 404);
    const { analysis } = await analysisFor(ctx, user);
    return jsonResponse(serializeAnalysis(analysis));
  }
  const o = OVERVIEW.exec(path);
  if (o) return overview(ctx, Number(o[1]));
  const x = EXPORT.exec(path);
  return exportCsv(ctx, Number(x![1]));
}
