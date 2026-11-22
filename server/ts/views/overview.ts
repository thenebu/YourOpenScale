/** User overview view (WP-12): 02 §5. Pure string rendering; no node:*, no DB, no clock. */
import { formatDate, formatDelta, formatMass, formatMetric, formatRate, toDisplay } from "../analysis/format.ts";
import { dayNoonUtc } from "../analysis/time.ts";
import type {
  BmiCategory, MetricAnalysis, RecordItem, TimeOfDayEffect, UserAnalysis,
} from "../analysis/types.ts";
import { COMPARABLE_SHARE, MIN_READINGS, MORNING, type Habits } from "../habits.ts";
import { escapeHtml as e } from "../ui.ts";
import {
  badge, buttonLink, callout, chartFigure, chip, dataTable, emptyState, link, segmented, stat,
} from "./components.ts";

export type OverviewCtx = {
  users: { id: number; name: string }[];
  query: URLSearchParams;
  csrf: string;
  /** JSON.stringify(serializeAnalysis(a)); embedded in the page (script-closing sequences are escaped here). */
  wireJson: string;
};

const DAY = 86400;
const PAYLOAD_ID = "analysis-data";
const RANGE_ITEMS = [
  { key: "30d", text: "30 d", aria: "Last 30 days" },
  { key: "90d", text: "90 d", aria: "Last 90 days" },
  { key: "1y", text: "1 y", aria: "Last year" },
  { key: "all", text: "All", aria: "All time" },
] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = new Intl.NumberFormat("en-GB");
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;
const hh = (h: number) => String(h).padStart(2, "0");
const unitText = (u: UserAnalysis["unit"]) => (u === "kg" ? "kg" : u === "lb" ? "lb" : "st");

// ---------------------------------------------------------------------------------------------
// Links that keep the other params
// ---------------------------------------------------------------------------------------------

function paramHref(base: string, query: URLSearchParams, overrides: Record<string, string | null>): string {
  const p = new URLSearchParams(query);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

function rangeLabel(a: UserAnalysis): string {
  const k = a.range.key;
  if (k === "30d") return "30 d";
  if (k === "90d") return "90 d";
  if (k === "1y") return "1 y";
  if (k === "all") return "all time";
  return `${isoDay(a.range.from)} to ${isoDay(a.range.to)}`;
}

// ---------------------------------------------------------------------------------------------
// Small helpers for the chart markup
// ---------------------------------------------------------------------------------------------

type Extra = { attrs?: Record<string, string | true>; afterTitle?: string; figureAttrs?: string };

/** chartFigure emits the contract attributes; island options and extra markup are added here. */
function figure(opts: Omit<Parameters<typeof chartFigure>[0], "dataRef">, extra: Extra = {}): string {
  let html = chartFigure({ ...opts, dataRef: PAYLOAD_ID });
  const attrs = Object.entries(extra.attrs ?? {})
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${e(v)}"`))
    .join("");
  if (attrs) html = html.replace(/(<div class="chart" data-island="[^"]*")/, `$1${attrs}`);
  if (extra.afterTitle) html = html.replace("</h3>", `</h3>${extra.afterTitle}`);
  if (extra.figureAttrs) html = html.replace('<figure class="chart-card"', `<figure class="chart-card"${extra.figureAttrs}`);
  return html;
}

const metricTable = (m: MetricAnalysis): string =>
  dataTable(m.table.headers, m.table.rows, {
    numericCols: m.table.headers.map((_, i) => i).filter((i) => i > 0),
    caption: `${m.label} values`,
  });

/** Static preview for no-JS and until the island mounts: a path through the trend (or daily) points. */
function sparkFallback(m: MetricAnalysis): string {
  let pts: [number, number][] = m.trend.length > 1 ? m.trend.map((p) => [p.t, p.v]) : m.lod.daily.map((d) => [d.t, d.v]);
  if (pts.length < 2) pts = m.lod.weekly.map((b) => [b.t, b.mean]);
  if (pts.length < 2) return "";
  const step = Math.ceil(pts.length / 80);
  pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const [t0, t1] = [pts[0][0], pts[pts.length - 1][0]];
  let lo = Math.min(...pts.map((p) => p[1]));
  let hi = Math.max(...pts.map((p) => p[1]));
  if (hi === lo) { lo -= 1; hi += 1; }
  const x = (t: number) => (4 + ((t - t0) / Math.max(1, t1 - t0)) * 192).toFixed(1);
  const y = (v: number) => (6 + (1 - (v - lo) / (hi - lo)) * 48).toFixed(1);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0])} ${y(p[1])}`).join("");
  return `<svg class="spark-fallback" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

type LegendItem = { label: string; kind?: "dot" | "line" | "dash" | "box"; color?: string };
function legend(items: LegendItem[], cls = ""): string {
  return `<ul class="chart-legend${cls ? ` ${cls}` : ""}">${items
    .map((i) => {
      const style = i.color ? ` style="--swatch:${i.color}"` : "";
      const kind = i.kind === "line" ? " swatch--line" : i.kind === "dash" ? " swatch--dash" : i.kind === "box" ? " swatch--box" : "";
      return `<li><span class="swatch${kind}"${style} aria-hidden="true"></span>${e(i.label)}</li>`;
    })
    .join("")}</ul>`;
}

const section = (id: string, title: string, body: string, extraClass = ""): string =>
  `<section id="${id}" class="overview-section${extraClass ? ` ${extraClass}` : ""}" aria-labelledby="${id}-heading"><h2 id="${id}-heading">${e(title)}</h2>${body}</section>`;

const note = (text: string): string => `<p class="section-note">${e(text)}</p>`;

/** Metric value 30 days before its last trend point, or null when the series is too short. */
function change30d(m: MetricAnalysis): number | null {
  const tr = m.trend;
  if (tr.length < 2) return null;
  const last = tr[tr.length - 1];
  const target = last.t - 30 * DAY;
  if (tr[0].t > target + 3 * DAY) return null;
  let ref = tr[0];
  for (const p of tr) {
    if (p.t <= target) ref = p;
    else break;
  }
  return last.v - ref.v;
}

// ---------------------------------------------------------------------------------------------
// Header and controls
// ---------------------------------------------------------------------------------------------

function userSwitcher(a: UserAnalysis, ctx: OverviewCtx): string {
  const others = ctx.users.filter((u) => u.id !== a.user.id);
  if (!others.length) return "";
  const keep: Record<string, string> = {};
  for (const k of ["range", "from", "to", "morning", "compare"]) {
    const v = ctx.query.get(k);
    if (v) keep[k] = v;
  }
  if (ctx.users.length > 4) {
    const hidden = Object.entries(keep).map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`).join("");
    return `<form class="user-switch" method="get" action="/users/${a.user.id}/overview"><label class="visually-hidden" for="user-switch">Switch user</label><select id="user-switch" name="user" data-submit-on-change>${ctx.users
      .map((u) => `<option value="${u.id}"${u.id === a.user.id ? " selected" : ""}>${e(u.name)}</option>`)
      .join("")}</select>${hidden}<noscript><button class="btn btn-secondary btn-sm" type="submit">Switch</button></noscript></form>`;
  }
  const q = new URLSearchParams(keep);
  const qs = q.toString();
  return `<nav class="segmented segmented-users" aria-label="Switch user">${others
    .map((u) => `<a href="${e(`/users/${u.id}/overview${qs ? `?${qs}` : ""}`)}">${e(u.name)}</a>`)
    .join("")}</nav>`;
}

function subtitle(a: UserAnalysis): string {
  const parts: string[] = [];
  if (a.user.heightCm) parts.push(`${Math.round(a.user.heightCm)} cm`);
  if (a.user.ageYears !== null) parts.push(`${a.user.ageYears} years`);
  if (a.firstReadingAt !== null) parts.push(`since ${formatDate(a.firstReadingAt, "UTC", "month")}`);
  parts.push(plural(a.readingCount, "weigh-in"));
  return parts.join(" · ");
}

function csvHref(a: UserAnalysis, ctx: OverviewCtx): string {
  const p = new URLSearchParams();
  if (a.range.key === "custom") {
    const f = ctx.query.get("from");
    const t = ctx.query.get("to");
    p.set("from", f && DAY_RE.test(f) ? f : isoDay(a.range.from));
    p.set("to", t && DAY_RE.test(t) ? t : isoDay(a.range.to));
  } else p.set("range", a.range.key);
  if (a.range.morningOnly) p.set("morning", "1");
  p.set("agg", "raw");
  return `/users/${a.user.id}/export.csv?${p.toString()}`;
}

function controls(a: UserAnalysis, ctx: OverviewCtx, sections: { id: string; label: string }[]): string {
  const base = `/users/${a.user.id}/overview`;
  const q = ctx.query;
  const morning = a.range.morningOnly;
  const rangeItems = RANGE_ITEMS.map((r) => ({
    href: paramHref(base, q, { range: r.key, from: null, to: null }),
    text: r.text,
    current: a.range.key === r.key,
    ariaLabel: r.aria,
  }));
  const custom = a.range.key === "custom";
  const fromQ = q.get("from");
  const toQ = q.get("to");
  const fromVal = fromQ && DAY_RE.test(fromQ) ? fromQ : isoDay(a.range.from);
  const toVal = toQ && DAY_RE.test(toQ) ? toQ : isoDay(a.range.to);
  const keepHidden = [...q.entries()]
    .filter(([k]) => !["range", "from", "to"].includes(k))
    .map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`)
    .join("");
  const customForm = `<details class="range-custom"${custom ? " data-active" : ""}><summary class="btn btn-ghost btn-sm"${custom ? ' aria-current="true"' : ""}>Custom…</summary><form class="range-custom-form card" method="get" action="${e(base)}"><label>From<input type="date" name="from" value="${e(fromVal)}" required></label><label>To<input type="date" name="to" value="${e(toVal)}" required></label>${keepHidden}<button class="btn btn-primary btn-sm" type="submit">Apply</button></form></details>`;
  const morningChip = chip(paramHref(base, q, { morning: morning ? null : "1" }), "Morning only", morning).replace(
    '<a class="chip"',
    `<a class="chip" title="Only weigh-ins between ${hh(MORNING.from)}:00 and ${hh(MORNING.to)}:00 local time, the first one each day"`,
  );
  const cmp = a.range.compare;
  const compare = segmented("Compare", [
    { href: paramHref(base, q, { compare: null }), text: "None", current: cmp === "none" },
    { href: paramHref(base, q, { compare: "prev" }), text: "Previous period", current: cmp === "prev" },
    { href: paramHref(base, q, { compare: "yoy" }), text: "Year over year", current: cmp === "yoy" },
  ]);
  const nav = `<nav class="section-nav" aria-label="Sections">${sections.map((s) => `<a href="#${s.id}">${e(s.label)}</a>`).join("")}</nav>`;
  return `<div class="overview-controls"><div class="overview-controls-row"><div class="range-group">${segmented("Time range", rangeItems)}${customForm}</div>${morningChip}<div class="compare-group"><span class="compare-label">Compare:</span>${compare}</div></div>${nav}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const BMI_LABEL: Record<Exclude<BmiCategory, null>, [string, "info" | "good" | "warn" | "bad"]> = {
  underweight: ["Underweight", "info"],
  normal: ["Normal", "good"],
  overweight: ["Overweight", "warn"],
  "obesity-1": ["Obesity I", "bad"],
  "obesity-2": ["Obesity II", "bad"],
  "obesity-3": ["Obesity III", "bad"],
};

function summarySection(a: UserAnalysis): string {
  const w = a.weight;
  const unit = a.unit;
  const tiles: string[] = [];
  if (w?.stats) {
    const trendNow = w.stats.trendLatest ?? w.stats.latest.v;
    tiles.push(stat({ label: "Trend weight", value: formatMass(trendNow, unit, { decimals: 1 }), rawValue: trendNow }));
    if (w.stats.changeTrend !== null)
      tiles.push(stat({
        label: `Change · ${rangeLabel(a)}`, value: formatDelta(Math.round(w.stats.changeTrend * 10) / 10, 1, unit),
        rawValue: w.stats.changeTrend,
      }));
    const [rateNum, ...rateUnit] = (w.rate ? formatRate(w.rate.perWeek, unit) : "–").split(" ");
    tiles.push(stat({
      label: "Rate · last 28 d", value: rateNum, unit: rateUnit.join(" ") || undefined, rawValue: w.rate?.perWeek ?? null,
    }));
  }
  if (a.bmi) {
    const cat = a.bmi.category ? BMI_LABEL[a.bmi.category] : null;
    tiles.push(stat({
      label: "BMI", value: a.bmi.latest.toFixed(1), rawValue: a.bmi.latest,
      extra: cat ? `<span class="stat-badge">${badge(cat[0], cat[1])}</span>` : undefined,
    }));
  }
  const fat = a.composition?.fatPct?.stats;
  if (fat) {
    const v = fat.trendLatest ?? fat.latest.v;
    tiles.push(stat({ label: "Body fat", value: formatMetric(v, 6, unit), rawValue: v }));
  }
  tiles.push(stat({
    label: "Weigh-ins in range", value: num.format(a.habits.count), rawValue: a.habits.count,
    extra: a.habits.count ? `<span class="stat-note">${e(`${(Math.round(a.habits.perWeek * 10) / 10).toString()} per week`)}</span>` : undefined,
  }));
  const body = a.habits.count === 0 && !w
    ? emptyState({ icon: "scale", title: "No weigh-ins in this range", body: "Try a longer range, or turn off the morning filter." })
    : `<div class="stat-grid">${tiles.join("")}</div>${a.summary.length ? `<p class="summary-text">${e(a.summary.join(" "))}</p>` : ""}`;
  return section("summary", "Summary", body);
}

function trendSection(a: UserAnalysis): string {
  const w = a.weight;
  if (!w) return section("trend", "Trend", emptyState({ title: "No weight data in this range" }));
  const items: LegendItem[] = [
    { label: "Daily", kind: "dot", color: "var(--chart-raw)" },
    { label: "Trend (smoothed, ~1-week memory)", kind: "line", color: "var(--chart-trend)" },
    { label: "Range", kind: "box", color: "var(--chart-band)" },
  ];
  if (a.goal) items.push({ label: "Goal", kind: "dash", color: "var(--chart-goal)" });
  if (w.compare) items.push({ label: w.compare.label, kind: "dash", color: "var(--chart-compare)" });
  if (w.outliers.length) items.push({ label: "Left out of the trend", kind: "dot", color: "var(--chart-outlier)" });
  return section("trend", "Trend", figure({
    id: "chart-weight", title: "Weight", unitLabel: unitText(a.unit), summary: w.summary, island: "timeseries",
    height: 320, legendHtml: legend(items), tableHtml: metricTable(w), fallbackSvg: sparkFallback(w),
  }, { attrs: { "data-metric": "weight", "data-slider": true }, figureAttrs: ' data-main' }));
}

function projectionText(a: UserAnalysis): string {
  const p = a.projection;
  if (!p) return "";
  const month = (d: string) => formatDate(dayNoonUtc(d), "UTC", "month");
  switch (p.status) {
    case "reached": return "You have reached your goal.";
    case "on-track": {
      const rate = a.weight?.rate ? ` at ${formatRate(a.weight.rate.perWeek, a.unit)}` : "";
      let s = `On the current pace${rate} you would get there around ${p.date ? month(p.date) : "soon"}`;
      if (p.earliest && p.latest && month(p.earliest) !== month(p.latest)) s += ` (between ${month(p.earliest)} and ${month(p.latest)})`;
      return `${s}.`;
    }
    case "too-slow": return "At the current pace the goal is more than two years away.";
    case "moving-away": return "Your trend is currently moving away from the goal.";
    case "stable": return "Your trend is stable, so no date can be projected.";
    default: return "Not enough recent weigh-ins to project a date.";
  }
}

function goalCard(a: UserAnalysis, ctx: OverviewCtx): string {
  const g = a.goal;
  const unit = a.unit;
  const decimals = unit === "st" ? 2 : 1;
  const shown = g ? toDisplay(g.kg, unit).toFixed(decimals) : "";
  const form = `<form class="goal-form" method="post" action="/users/${a.user.id}/goal"><input type="hidden" name="_csrf" value="${e(ctx.csrf)}"><label>Goal weight (${e(unit === "st" ? "decimal stones" : unitText(unit))})<input type="number" name="goal_weight" inputmode="decimal" step="0.1" min="0" value="${e(shown)}" placeholder="${e(unit === "kg" ? "78.0" : unit === "lb" ? "172.0" : "12.3")}"></label><label>Target date (optional)<input type="date" name="goal_date" value="${e(g?.date ?? "")}"></label><p class="hint">Leave the weight empty and save to remove the goal.</p><button class="btn btn-primary btn-sm" type="submit">Save goal</button></form>`;
  let head = "";
  if (g) {
    const pr = a.progress;
    const pct = pr ? Math.round(Math.min(1, Math.max(0, pr.fraction)) * 100) : null;
    const req = a.projection?.requiredPerWeek;
    head =
      `<p class="goal-target"><data value="${g.kg}">${e(formatMass(g.kg, unit, { decimals: 1 }))}</data>${g.date ? ` <span class="hint">by ${e(formatDate(dayNoonUtc(g.date), "UTC", "medium"))}</span>` : ""}</p>` +
      (pct !== null && pr
        ? `<progress class="progress" max="100" value="${pct}" aria-label="Progress toward the goal">${pct}%</progress><p class="goal-progress-text"><strong>${pct}%</strong> of the way from ${e(formatMass(pr.startKg, unit, { decimals: 1 }))} to ${e(formatMass(pr.goalKg, unit, { decimals: 1 }))}</p>`
        : "") +
      `<p class="goal-projection">${e(projectionText(a))}</p>` +
      (req !== null && req !== undefined
        ? `<p class="hint">To reach it by the target date you need ${e(formatRate(req, unit))}${a.weight?.rate ? `; your current rate is ${e(formatRate(a.weight.rate.perWeek, unit))}` : ""}.</p>`
        : "");
  } else head = `<p class="hint">Set a goal to see a projection and the goal line on the chart.</p>`;
  return `<div class="card goal-card" id="goal"><h3 class="card-title">Goal</h3>${head}<details class="goal-edit"${g ? "" : " open"}><summary class="btn btn-ghost btn-sm">${g ? "Edit goal" : "Set a goal"}</summary>${form}</details></div>`;
}

function rateFigure(a: UserAnalysis): string {
  const wr = a.weeklyRate;
  if (!wr.length) return "";
  const avg = wr.reduce((s, p) => s + p.v, 0) / wr.length;
  const rows = wr.slice(-52).map((p) => [formatDate(p.t, "UTC", "medium"), formatDelta(Math.round(p.v * 100) / 100, 1, a.unit)]);
  return figure({
    id: "chart-rate", title: "Rate of change", unitLabel: `${a.unit === "kg" ? "kg" : "lb"}/week`,
    summary: `Weekly change in trend weight over ${plural(wr.length, "week")}; on average ${formatRate(avg, a.unit)}.`,
    island: "diverging-bars", height: 160,
    legendHtml: legend([{ label: "Change in trend weight per week", kind: "box", color: "var(--chart-compare)" }]),
    tableHtml: dataTable(["Week", "Change"], rows, { numericCols: [1], caption: "Weekly change in trend weight" }),
  });
}

function periodCard(a: UserAnalysis): string {
  if (!a.periods.length) return `<div class="card">${note("Not enough weigh-ins for period comparisons yet.")}</div>`;
  const m = (kg: number) => formatMass(kg, a.unit, { decimals: 1 });
  const rows = a.periods.map((p) => [p.label, m(p.b.mean), m(p.a.mean), formatDelta(Math.round(p.delta * 10) / 10, 1, a.unit), `${p.a.n} / ${p.b.n}`]);
  return `<div class="card period-card"><h3 class="card-title">Period comparison</h3><div class="table-wrap">${dataTable(
    ["Comparison", "Before", "Now", "Change", "Days now / before"], rows, { numericCols: [1, 2, 3, 4], caption: "Mean weight by period" },
  )}</div></div>`;
}

function progressSection(a: UserAnalysis, ctx: OverviewCtx): string {
  const rate = rateFigure(a);
  const right = `${rate ? `<div class="card">${rate}</div>` : ""}${periodCard(a)}`;
  return section("progress", "Progress", `<div class="progress-grid">${goalCard(a, ctx)}<div class="progress-side">${right}</div></div>`);
}

function compositionSection(a: UserAnalysis): string {
  const c = a.composition!;
  const parts: string[] = [];
  const row: string[] = [];
  if (c.fatMass && c.leanMass) {
    row.push(`<div class="card">${figure({
      id: "chart-composition", title: "Fat mass and lean mass", unitLabel: unitText(a.unit),
      summary: `${c.fatMass.summary} ${c.leanMass.summary}`, island: "composition", height: 240,
      legendHtml: legend([
        { label: "Fat mass (trend)", kind: "line", color: "var(--chart-fat)" },
        { label: "Lean mass (trend)", kind: "line", color: "var(--chart-lean)" },
      ]),
      tableHtml: `${metricTable(c.fatMass)}${metricTable(c.leanMass)}`,
      fallbackSvg: sparkFallback(c.fatMass),
    })}</div>`);
  }
  if (c.fatPct) {
    row.push(`<div class="card">${figure({
      id: "chart-fat-pct", title: "Body fat", unitLabel: "%", summary: c.fatPct.summary, island: "timeseries", height: 240,
      legendHtml: legend([
        { label: "Daily", kind: "dot", color: "var(--chart-raw)" },
        { label: "Trend", kind: "line", color: "var(--chart-trend)" },
      ]),
      tableHtml: metricTable(c.fatPct), fallbackSvg: sparkFallback(c.fatPct),
    }, { attrs: { "data-metric": "fatPct", "data-compact": true } })}</div>`);
  }
  if (row.length) parts.push(`<div class="chart-grid">${row.join("")}</div>`);
  if (c.monthly.length) {
    const f = (v: number | null) => (v === null ? "–" : formatMass(v, a.unit, { decimals: 1 }));
    const rows = c.monthly.slice(-36).map((m) => [
      formatDate(m.t, "UTC", "month"), f(m.fat), f(m.muscle), f(m.bone), f(m.otherLean), f(m.water),
    ]);
    parts.push(`<div class="card">${figure({
      id: "chart-composition-monthly", title: "Monthly composition", unitLabel: unitText(a.unit),
      summary: `Monthly means of fat, muscle, bone and other lean mass as stacked bars, with water as a line, over ${plural(c.monthly.length, "month")}.`,
      island: "composition-bars", height: 220,
      legendHtml: legend([
        { label: "Fat", kind: "box", color: "var(--chart-fat)" },
        { label: "Muscle", kind: "box", color: "var(--chart-muscle)" },
        { label: "Bone", kind: "box", color: "var(--chart-bone)" },
        { label: "Other lean", kind: "box", color: "var(--chart-lean)" },
        { label: "Water (line)", kind: "dash", color: "var(--chart-water)" },
      ]),
      tableHtml: dataTable(["Month", "Fat", "Muscle", "Bone", "Other lean", "Water"], rows, { numericCols: [1, 2, 3, 4, 5], caption: "Monthly body composition" }),
    })}</div>`);
  }
  const rc = c.recomposition;
  if (rc.kind !== "insufficient") {
    const tone = rc.kind === "fat-loss" || rc.kind === "recomposition" || rc.kind === "lean-gain" ? "good" : rc.kind === "fat-gain" || rc.kind === "mixed-loss" ? "warn" : "info";
    parts.push(callout(tone, "What changed", `<p>${e(rc.text)}</p>`));
  }
  if (a.bmi) {
    parts.push(`<div class="card">${figure({
      id: "chart-bmi", title: "BMI", summary: a.bmi.series.summary, island: "timeseries", height: 240,
      legendHtml: legend([
        { label: "Underweight", kind: "box", color: "var(--chart-bmi-under)" },
        { label: "Normal", kind: "box", color: "var(--chart-bmi-normal)" },
        { label: "Overweight", kind: "box", color: "var(--chart-bmi-over)" },
        { label: "Obese", kind: "box", color: "var(--chart-bmi-obese)" },
      ], "legend-bands"),
      tableHtml: metricTable(a.bmi.series), fallbackSvg: sparkFallback(a.bmi.series),
    }, { attrs: { "data-metric": "bmi", "data-compact": true } })}</div>`);
  }
  const tiles: string[] = [];
  if (c.ffmi !== null) tiles.push(stat({ label: "Fat-free mass index", value: c.ffmi.toFixed(1), rawValue: c.ffmi, unit: "kg/m²", size: "sm" }));
  if (c.fmi !== null) tiles.push(stat({ label: "Fat mass index", value: c.fmi.toFixed(1), rawValue: c.fmi, unit: "kg/m²", size: "sm" }));
  if (c.waterPct !== null) tiles.push(stat({ label: "Water", value: `${c.waterPct.toFixed(1)}%`, rawValue: c.waterPct, size: "sm" }));
  if (tiles.length) parts.push(`<div class="stat-grid">${tiles.join("")}</div>`);
  return section("composition", "Composition", parts.join(""));
}

function comparabilityCallout(h: Habits): string {
  const window = `${hh(MORNING.from)}:00 to ${hh(MORNING.to)}:00`;
  const pct = Math.round(h.morningShare * 100);
  const zone = h.zoneAssumed ? " The scale has no time zone set, so UTC was assumed." : "";
  if (h.verdict === "unknown")
    return callout("info", "", `<p>Not enough weigh-ins in this range to judge when you weigh yourself (${h.count}; at least ${MIN_READINGS} needed).${e(zone)}</p>`);
  if (h.verdict === "comparable")
    return callout("good", "Comparable readings", `<p>${pct}% of your weigh-ins are between ${window}, so changes in weight are likely real rather than time-of-day swings.${e(zone)}</p>`);
  return callout("warn", "Mixed weigh-in times", `<p>Only ${pct}% of your weigh-ins are between ${window}; the typical time is ${clock(h.medianMinutes)}. Body weight moves by a kilogram or more over a day, so weighing at a similar time (ideally mornings, before eating) makes the trend more reliable.${e(zone)}</p>`);
}

function habitsSection(a: UserAnalysis): string {
  const h = a.habits;
  const parts: string[] = [comparabilityCallout(h)];
  const tiles = [
    stat({ label: "Weigh-ins", value: num.format(h.count), rawValue: h.count, size: "sm" }),
    stat({ label: "Days with a weigh-in", value: num.format(h.days), rawValue: h.days, size: "sm" }),
    stat({ label: "Per week", value: (Math.round(h.perWeek * 10) / 10).toString(), rawValue: h.perWeek, size: "sm" }),
    stat({ label: "Typical time", value: h.count ? clock(h.medianMinutes) : "–", rawValue: h.count ? h.medianMinutes : null, size: "sm" }),
    stat({ label: "Current streak", value: plural(h.streaks.current, "day"), rawValue: h.streaks.current, size: "sm" }),
    stat({ label: "Longest streak", value: h.streaks.longest ? plural(h.streaks.longest.days, "day") : "–", rawValue: h.streaks.longest?.days ?? null, size: "sm" }),
    stat({ label: "Longest pause", value: plural(h.longestGapDays, "day"), rawValue: h.longestGapDays, size: "sm" }),
  ];
  parts.push(`<div class="stat-grid">${tiles.join("")}</div>`);
  if (h.calendar.length) {
    const years = new Set(h.calendar.map((c) => c.day.slice(0, 4)));
    const shownYears = Math.min(5, years.size);
    const byMonth = new Map<string, { n: number; days: number }>();
    for (const c of h.calendar) {
      const k = c.day.slice(0, 7);
      const m = byMonth.get(k) ?? { n: 0, days: 0 };
      m.n += c.count;
      if (c.count > 0) m.days++;
      byMonth.set(k, m);
    }
    const rows = [...byMonth.entries()].sort().slice(-36).map(([k, m]) => [formatDate(dayNoonUtc(`${k}-15`), "UTC", "month"), String(m.n), String(m.days)]);
    const heat = `<div class="heat-legend"><span>Weigh-ins per day</span><ul class="heat-scale">${["0", "1", "2", "3", "4+"]
      .map((l, i) => `<li><span class="heat-cell heat-${i}" aria-hidden="true"></span>${l}</li>`)
      .join("")}</ul></div>`;
    parts.push(`<div class="card">${figure({
      id: "chart-calendar", title: "Weigh-in calendar",
      summary: `Calendar of the days you weighed yourself: ${plural(h.days, "day")} with a weigh-in in this range, ${plural(h.streaks.current, "day")} current streak.${years.size > 5 ? " Only the latest five years are drawn." : ""}`,
      island: "calendar", height: shownYears * (7 * 14 + 60) - 16, legendHtml: heat,
      tableHtml: dataTable(["Month", "Weigh-ins", "Days with a weigh-in"], rows, { numericCols: [1, 2], caption: "Weigh-ins per month" }),
    })}</div>`);
  }
  if (h.count > 0 && h.hours.length === 24) {
    const rows = h.hours.map((n, i) => [`${hh(i)}:00`, String(n)]);
    parts.push(`<div class="card">${figure({
      id: "chart-hours", title: "Time of day", unitLabel: "weigh-ins",
      summary: `Weigh-ins by hour of the day; the typical time is ${clock(h.medianMinutes)} and ${Math.round(h.morningShare * 100)}% fall between ${hh(MORNING.from)}:00 and ${hh(MORNING.to)}:00.`,
      island: "count-bars", height: 160,
      legendHtml: legend([
        { label: `Morning window ${hh(MORNING.from)}:00 to ${hh(MORNING.to)}:00`, kind: "box", color: "var(--chart-trend)" },
        { label: "Other hours", kind: "box", color: "var(--chart-compare)" },
      ]),
      tableHtml: dataTable(["Hour", "Weigh-ins"], rows, { numericCols: [1], caption: "Weigh-ins by hour" }),
    }, { attrs: { "data-from": String(MORNING.from), "data-to": String(MORNING.to) } })}</div>`);
  }
  return section("habits", "Habits", parts.join(""));
}

const SLOT_LABEL: Record<TimeOfDayEffect["slot"], string> = { night: "Night", morning: "Morning", midday: "Midday", evening: "Evening" };

function patternsSection(a: UserAnalysis): string {
  const p = a.patterns;
  const unit = a.unit;
  const d = (kg: number) => formatDelta(Math.round(kg * 100) / 100, 1, unit);
  const cards: string[] = [];
  if (p.weekday?.length) {
    const sorted = [...p.weekday].sort((x, y) => y.mean - x.mean);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    const rows = p.weekday.map((w) => [w.label, d(w.mean), formatDelta(Math.round(1.96 * w.se * 100) / 100, 1, unit).replace(/^\+/, "± "), String(w.n)]);
    cards.push(`<div class="card">${figure({
      id: "chart-weekday", title: "Weekday effect", unitLabel: "vs your usual",
      summary: `Average difference between your weight and your trend by weekday: highest on ${hi.label} (${d(hi.mean)}), lowest on ${lo.label} (${d(lo.mean)}).`,
      island: "effect-bars", height: 160,
      legendHtml: legend([{ label: "Mean difference from trend, with 95% interval", kind: "box", color: "var(--chart-trend)" }]),
      tableHtml: dataTable(["Weekday", "Difference", "Interval", "Weigh-in days"], rows, { numericCols: [1, 2, 3], caption: "Weight by weekday" }),
    }, { attrs: { "data-kind": "weekday" } })}</div>`);
  }
  if (p.timeOfDay?.length) {
    const rows = p.timeOfDay.map((s) => [`${SLOT_LABEL[s.slot]} (${hh(s.hours[0])}:00 to ${hh(s.hours[1])}:00)`, d(s.mean), String(s.n)]);
    const hi = [...p.timeOfDay].sort((x, y) => y.mean - x.mean)[0];
    cards.push(`<div class="card">${figure({
      id: "chart-timeofday", title: "Time-of-day effect", unitLabel: "vs your usual",
      summary: `Average difference between your weight and your trend by time of day: highest in the ${SLOT_LABEL[hi.slot].toLowerCase()} (${d(hi.mean)}).`,
      island: "effect-bars", height: 160,
      legendHtml: legend([{ label: "Mean difference from trend, with 95% interval", kind: "box", color: "var(--chart-trend)" }]),
      tableHtml: dataTable(["Time of day", "Difference", "Weigh-ins"], rows, { numericCols: [1, 2], caption: "Weight by time of day" }),
    }, { attrs: { "data-kind": "timeofday" } })}</div>`);
  }
  if (p.histogram?.bins.length) {
    const h = p.histogram;
    const m = (kg: number) => formatMass(kg, unit, { decimals: 1 });
    const rows = h.bins.map((b) => [`${m(b.from)} to ${m(b.to)}`, String(b.count)]);
    cards.push(`<div class="card">${figure({
      id: "chart-histogram", title: "Distribution of daily values",
      summary: `Mean ${m(h.mean)}, median ${m(h.median)}; most days (10th to 90th percentile) fall between ${m(h.p10)} and ${m(h.p90)}${h.current !== null ? `; your current trend is ${m(h.current)}` : ""}.`,
      island: "histogram", height: 180,
      legendHtml: `${legend([
        { label: "Mean", kind: "line", color: "var(--color-text)" },
        { label: "Median", kind: "dash", color: "var(--color-text-muted)" },
        ...(h.current !== null ? [{ label: "Now (trend)", kind: "line" as const, color: "var(--color-accent)" }] : []),
        { label: "Middle 80% of days", kind: "box" as const, color: "var(--chart-band)" },
      ])}<p class="legend-note">Each bar counts the days whose weight fell in that band.</p>`,
      tableHtml: dataTable(["Weight band", "Days"], rows, { numericCols: [1], caption: "Days per weight band" }),
    }, { attrs: { "data-type": "1" } })}</div>`);
  }
  const years = p.years;
  if (years && years.length >= 2 && (a.range.key === "all" || a.range.key === "1y")) {
    const rows = years.map((y) => {
      const mean = y.points.reduce((s, q) => s + q.v, 0) / Math.max(1, y.points.length);
      return [String(y.year), String(y.points.length), formatMass(mean, unit, { decimals: 1 })];
    });
    cards.push(`<div class="card">${figure({
      id: "chart-years", title: "Year over year", unitLabel: unitText(unit),
      summary: `One line per year by day of the year, for ${plural(years.length, "year")}; the current year is highlighted.`,
      island: "years", height: 200,
      legendHtml: legend([
        { label: "Current year", kind: "line", color: "var(--color-accent)" },
        { label: "Earlier years", kind: "line", color: "var(--chart-compare)" },
      ]),
      tableHtml: dataTable(["Year", "Days with data", "Mean weight"], rows, { numericCols: [1, 2], caption: "Weight by year" }),
    }, { attrs: { "data-type": "1" } })}</div>`);
  }
  if (!cards.length) return section("patterns", "Patterns", note("Not enough data for weekday, time-of-day or distribution patterns yet."));
  return section("patterns", "Patterns", `<div class="chart-grid">${cards.join("")}</div>`);
}

function recordHref(base: string, query: URLSearchParams, t: number): string {
  return paramHref(base, query, { range: null, from: isoDay(t - 14 * DAY), to: isoDay(t + 14 * DAY) });
}

function recordsSection(a: UserAnalysis, ctx: OverviewCtx): string {
  if (!a.records.length) return section("records", "Records", note("Records appear after the first weigh-ins."));
  const base = `/users/${a.user.id}/overview`;
  const unit = a.unit;
  const value = (r: RecordItem): string => {
    if (r.value === null) return "–";
    switch (r.id) {
      case "lowest": case "highest": case "low12m": return formatMass(r.value, unit, { decimals: 1 });
      case "drop7": return formatDelta(-Math.round(r.value * 10) / 10, 1, unit);
      case "gain7": return formatDelta(Math.round(r.value * 10) / 10, 1, unit);
      case "longestStreak": return plural(r.value, "day");
      default: return formatDelta(Math.round(r.value * 10) / 10, 1, unit);
    }
  };
  const items = a.records.map((r) => {
    const when = r.t !== null && r.value !== null
      ? `<a href="${e(recordHref(base, ctx.query, r.t))}" title="Show the weeks around this date">${e(r.detail)}</a>`
      : `<span class="muted">${e(r.detail)}</span>`;
    return `<div class="record"><dt>${e(r.label)}</dt><dd><data class="record-value" value="${e(r.value ?? "")}">${e(value(r))}</data><span class="record-when">${when}</span></dd></div>`;
  });
  return section("records", "Records", `<div class="card"><dl class="records-list">${items.join("")}</dl></div>`);
}

function qualitySection(a: UserAnalysis): string {
  const q = a.quality;
  const id = a.user.id;
  const items: string[] = [];
  if (q.untrustedClock > 0)
    items.push(callout("warn", "Untrusted device clock", `<p>${plural(q.untrustedClock, "reading")} came from a scale whose clock was not confirmed, so the time may be off. <a href="/users/${id}/readings">Review readings</a></p>`));
  const flagged = q.outliers.reduce((n, o) => n + o.count, 0);
  if (flagged > 0)
    items.push(callout("info", "Outliers flagged", `<p>${q.outliers.map((o) => `${e(o.label)}: ${o.count}`).join(", ")}. Flagged readings are left out of the trend. <a href="/users/${id}/readings?outliers=1">Show flagged readings</a></p>`));
  if (q.duplicates > 0) items.push(callout("info", "Possible duplicates", `<p>${plural(q.duplicates, "reading")} repeat an earlier reading from the same scale within three minutes.</p>`));
  if (q.zoneAssumed > 0) items.push(callout("info", "No time zone", `<p>${plural(q.zoneAssumed, "reading")} came without a time zone; UTC was assumed for them.</p>`));
  if (q.futureTimestamps > 0) items.push(callout("warn", "Timestamps in the future", `<p>${plural(q.futureTimestamps, "reading")} are dated in the future and are ignored.</p>`));
  if (q.gaps.length > 0)
    items.push(callout("info", "Long gaps", `<p>${plural(q.gaps.length, "gap")} longer than 30 days: ${q.gaps.slice(-5).map((g) => `${e(formatDate(g.from, "UTC", "short"))} to ${e(formatDate(g.to, "UTC", "medium"))} (${g.days} days)`).join("; ")}.</p>`));
  const body = items.length ? items.join("") : note("No data quality issues found.");
  return section("quality", "Data quality", `<details class="quality-details"${items.length ? " open" : ""}><summary>${items.length ? plural(items.length, "thing") + " to check" : "All clear"}</summary><div class="quality-list">${body}</div></details>`);
}

function metricsSection(a: UserAnalysis, ctx: OverviewCtx): string {
  if (!a.metrics.length) return section("metrics", "More metrics", note("No other metrics have been measured yet."));
  const current = ctx.query.get("metric");
  const cards = a.metrics.map((m) => {
    const st = m.stats;
    const dlt = change30d(m);
    const latest = st ? formatMetric(st.latest.v, m.type, a.unit) : "–";
    const dir = dlt === null ? null : dlt > 0 ? "up" : dlt < 0 ? "down" : "flat";
    const afterTitle = `<p class="metric-now"><data class="metric-latest" value="${e(st?.latest.v ?? "")}">${e(latest)}</data>${dlt !== null && dir ? `<span class="metric-delta" data-direction="${dir}">${e(formatDelta(dlt, m.type, a.unit))} <span class="delta-ref">30 d</span></span>` : ""}</p>`;
    const unitLabel = m.unit === "kg" ? unitText(a.unit) : m.unit;
    return figure({
      id: `metric-${m.type}`, title: m.label, unitLabel: unitLabel || undefined, summary: m.summary, island: "timeseries",
      height: 180, tableHtml: metricTable(m), fallbackSvg: sparkFallback(m),
    }, { attrs: { "data-metric": String(m.type), "data-compact": true }, afterTitle, figureAttrs: current === String(m.type) ? " data-current" : "" });
  });
  return section("metrics", "More metrics", `<div class="chart-grid metric-grid">${cards.join("")}</div>`);
}

function footer(a: UserAnalysis, ctx: OverviewCtx): string {
  const id = a.user.id;
  return `<footer class="overview-footer"><div class="overview-footer-links">${link(`/users/${id}/readings`, "Raw readings", { variant: "quiet", chevron: true })}${link(csvHref(a, ctx), "Download CSV", { variant: "quiet", chevron: true })}</div><details class="definitions"><summary>How the numbers are calculated</summary><dl class="definition-list"><dt>How the trend is calculated</dt><dd>The trend is a moving average with about a one-week memory. It gives recent weigh-ins more weight than old ones, so water and meal swings fade out and the direction stays visible. A gap of more than 30 days starts a new line.</dd><dt>What “comparable” means</dt><dd>Weigh-ins between ${hh(MORNING.from)}:00 and ${hh(MORNING.to)}:00 local time are comparable with each other. When at least ${Math.round(COMPARABLE_SHARE * 100)}% of your weigh-ins (and at least ${MIN_READINGS}) fall in that window, changes in weight are likely real rather than time-of-day swings.</dd></dl></details></footer>`;
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function overviewView(a: UserAnalysis, ctx: OverviewCtx): string {
  const id = a.user.id;
  const sections: { id: string; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "trend", label: "Trend" },
    { id: "progress", label: "Progress" },
    ...(a.composition ? [{ id: "composition", label: "Composition" }] : []),
    { id: "habits", label: "Habits" },
    { id: "patterns", label: "Patterns" },
    { id: "records", label: "Records" },
    { id: "quality", label: "Data quality" },
    { id: "metrics", label: "More metrics" },
  ];
  const header = `<header class="page-header overview-header"><div class="page-header-text">${link("/", "Dashboard", { variant: "back" })}<div class="overview-title"><h1 class="page-title">${e(a.user.name)}</h1>${userSwitcher(a, ctx)}</div><p class="page-subtitle">${e(subtitle(a))}</p></div><div class="page-actions">${buttonLink(csvHref(a, ctx), "Download CSV", { variant: "ghost" })}${link(`/users/${id}/readings`, "Raw readings", { variant: "quiet", chevron: true })}</div></header>`;
  const body = [
    summarySection(a),
    trendSection(a),
    progressSection(a, ctx),
    a.composition ? compositionSection(a) : "",
    habitsSection(a),
    patternsSection(a),
    recordsSection(a, ctx),
    qualitySection(a),
    metricsSection(a, ctx),
  ].join("");
  const json = ctx.wireJson.replaceAll("</", "<\\/");
  return `<div class="overview">${header}${controls(a, ctx, sections)}${body}${footer(a, ctx)}<script type="application/json" id="${PAYLOAD_ID}">${json}</script></div>`;
}
