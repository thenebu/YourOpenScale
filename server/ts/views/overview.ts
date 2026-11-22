/** User overview view (WP-12): 02 §5. Pure string rendering; no node:*, no DB, no clock. */
import { extent } from "../analysis/extent.ts";
import { formatDate, formatDelta, formatMass, formatMetric, formatRate, rateUnitLabel, toDisplay } from "../analysis/format.ts";
import { currentLocale, decimal, intlTag, percent, t } from "../i18n/index.ts";
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
  /** Time zone of the user (null = UTC); used to show the goal start date. */
  zone?: string | null;
  /** Prefill for the goal start fields: local start day and the automatically derived start weight on it. */
  goalStart?: { day: string; zone: string | null; autoKg: { kg: number; source: "trend" | "reading" | "reference" } };
};

const DAY = 86400;
const PAYLOAD_ID = "analysis-data";
const rangeItems = () => [
  { key: "30d", text: t("ov.range30d"), aria: t("ov.rangeAria30d") },
  { key: "90d", text: t("ov.range90d"), aria: t("ov.rangeAria90d") },
  { key: "1y", text: t("ov.range1y"), aria: t("ov.rangeAria1y") },
  { key: "all", text: t("ov.rangeAll"), aria: t("ov.rangeAriaAll") },
];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = { format: (n: number): string => new Intl.NumberFormat(intlTag(currentLocale())).format(n) };
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const days = (n: number) => t("ov.days", { n });
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
  if (k === "30d") return t("ov.range30d");
  if (k === "90d") return t("ov.range90d");
  if (k === "1y") return t("ov.range1y");
  if (k === "all") return t("ov.rangeLabelAll");
  return t("an.rangeTo", { from: formatDate(a.range.from, "UTC", "medium"), to: formatDate(a.range.to, "UTC", "medium") });
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
    caption: t("ov.valuesCaption", { label: m.label }),
  });

/** Static preview for no-JS and until the island mounts: a path through the trend (or daily) points. */
function sparkFallback(m: MetricAnalysis): string {
  let pts: [number, number][] = m.trend.length > 1 ? m.trend.map((p) => [p.t, p.v]) : m.lod.daily.map((d) => [d.t, d.v]);
  if (pts.length < 2) pts = m.lod.weekly.map((b) => [b.t, b.mean]);
  if (pts.length < 2) return "";
  const step = Math.ceil(pts.length / 80);
  pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const [t0, t1] = [pts[0][0], pts[pts.length - 1][0]];
  let [lo, hi] = extent(pts.map((p) => p[1]));
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
    return `<form class="user-switch" method="get" action="/users/${a.user.id}/overview"><label class="visually-hidden" for="user-switch">${e(t("ov.switchUser"))}</label><select id="user-switch" name="user" data-submit-on-change>${ctx.users
      .map((u) => `<option value="${u.id}"${u.id === a.user.id ? " selected" : ""}>${e(u.name)}</option>`)
      .join("")}</select>${hidden}<noscript><button class="btn btn-secondary btn-sm" type="submit">${e(t("common.switch"))}</button></noscript></form>`;
  }
  const q = new URLSearchParams(keep);
  const qs = q.toString();
  return `<nav class="segmented segmented-users" aria-label="${e(t("ov.switchUser"))}">${others
    .map((u) => `<a href="${e(`/users/${u.id}/overview${qs ? `?${qs}` : ""}`)}">${e(u.name)}</a>`)
    .join("")}</nav>`;
}

function subtitle(a: UserAnalysis): string {
  const parts: string[] = [];
  if (a.user.heightCm) parts.push(`${Math.round(a.user.heightCm)} cm`);
  if (a.user.ageYears !== null) parts.push(t("ov.subAge", { n: a.user.ageYears }));
  if (a.firstReadingAt !== null) parts.push(t("ov.subSince", { month: formatDate(a.firstReadingAt, "UTC", "month") }));
  parts.push(t("ov.subWeighIns", { n: a.readingCount }));
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
  const rangeLinks = rangeItems().map((r) => ({
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
  const customForm = `<details class="range-custom"${custom ? " data-active" : ""}><summary class="btn btn-ghost btn-sm"${custom ? ' aria-current="true"' : ""}>${e(t("ov.custom"))}</summary><form class="range-custom-form card" method="get" action="${e(base)}"><label>${e(t("ov.from"))}<input type="date" name="from" value="${e(fromVal)}" required></label><label>${e(t("ov.to"))}<input type="date" name="to" value="${e(toVal)}" required></label>${keepHidden}<button class="btn btn-primary btn-sm" type="submit">${e(t("ov.apply"))}</button></form></details>`;
  const morningChip = chip(paramHref(base, q, { morning: morning ? null : "1" }), t("ov.morningOnly"), morning).replace(
    '<a class="chip"',
    `<a class="chip" title="${e(t("ov.morningTitle", { from: hh(MORNING.from), to: hh(MORNING.to) }))}"`,
  );
  const cmp = a.range.compare;
  const compare = segmented(t("ov.compare"), [
    { href: paramHref(base, q, { compare: null }), text: t("ov.cmpNone"), current: cmp === "none" },
    { href: paramHref(base, q, { compare: "prev" }), text: t("ov.cmpPrev"), current: cmp === "prev" },
    { href: paramHref(base, q, { compare: "yoy" }), text: t("ov.cmpYoy"), current: cmp === "yoy" },
  ]);
  const nav = `<nav class="section-nav" aria-label="${e(t("ov.sections"))}">${sections.map((s) => `<a href="#${s.id}">${e(s.label)}</a>`).join("")}</nav>`;
  return `<div class="overview-controls"><div class="overview-controls-row"><div class="range-group">${segmented(t("ov.timeRange"), rangeLinks)}${customForm}</div>${morningChip}<div class="compare-group"><span class="compare-label">${e(t("ov.compareColon"))}</span>${compare}</div></div>${nav}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const BMI_TONE: Record<Exclude<BmiCategory, null>, "info" | "good" | "warn" | "bad"> = {
  underweight: "info",
  normal: "good",
  overweight: "warn",
  "obesity-1": "bad",
  "obesity-2": "bad",
  "obesity-3": "bad",
};
const bmiLabel = (c: Exclude<BmiCategory, null>): string => t(`ov.bmi.${c}`);

function summarySection(a: UserAnalysis): string {
  const w = a.weight;
  const unit = a.unit;
  const tiles: string[] = [];
  if (w?.stats) {
    const trendNow = w.stats.trendLatest ?? w.stats.latest.v;
    tiles.push(stat({ label: t("ov.trendWeight"), value: formatMass(trendNow, unit, { decimals: 1 }), rawValue: trendNow }));
    if (w.stats.changeTrend !== null)
      tiles.push(stat({
        label: t("ov.changeIn", { range: rangeLabel(a) }), value: formatDelta(Math.round(w.stats.changeTrend * 10) / 10, 1, unit),
        rawValue: w.stats.changeTrend,
      }));
    const [rateNum, ...rateUnit] = (w.rate ? formatRate(w.rate.perWeek, unit) : "–").split(" ");
    tiles.push(stat({
      label: t("ov.rate28"), value: rateNum, unit: rateUnit.join(" ") || undefined, rawValue: w.rate?.perWeek ?? null,
    }));
  }
  if (a.bmi) {
    const cat = a.bmi.category;
    tiles.push(stat({
      label: t("an.bmi"), value: decimal(a.bmi.latest, 1), rawValue: a.bmi.latest,
      extra: cat ? `<span class="stat-badge">${badge(bmiLabel(cat), BMI_TONE[cat])}</span>` : undefined,
    }));
  }
  const fat = a.composition?.fatPct?.stats;
  if (fat) {
    const v = fat.trendLatest ?? fat.latest.v;
    tiles.push(stat({ label: t("an.bodyFat"), value: formatMetric(v, 6, unit), rawValue: v }));
  }
  tiles.push(stat({
    label: t("ov.weighInsInRange"), value: num.format(a.habits.count), rawValue: a.habits.count,
    extra: a.habits.count ? `<span class="stat-note">${e(t("ov.perWeek", { n: decimal(Math.round(a.habits.perWeek * 10) / 10, Number.isInteger(Math.round(a.habits.perWeek * 10) / 10) ? 0 : 1) }))}</span>` : undefined,
  }));
  const body = a.habits.count === 0 && !w
    ? emptyState({ icon: "scale", title: t("ov.noWeighIns"), body: t("ov.noWeighInsBody") })
    : `<div class="stat-grid">${tiles.join("")}</div>${a.summary.length ? `<p class="summary-text">${e(a.summary.join(" "))}</p>` : ""}`;
  return section("summary", t("ov.sec.summary"), body);
}

function trendSection(a: UserAnalysis): string {
  const w = a.weight;
  if (!w) return section("trend", t("ov.sec.trend"), emptyState({ title: t("ov.noWeightData") }));
  const items: LegendItem[] = [
    { label: t("ov.leg.daily"), kind: "dot", color: "var(--chart-raw)" },
    { label: t("ov.leg.trendSmoothed"), kind: "line", color: "var(--chart-trend)" },
    { label: t("ov.leg.range"), kind: "box", color: "var(--chart-band)" },
  ];
  if (a.goal) items.push({ label: t("ov.leg.goal"), kind: "dash", color: "var(--chart-goal)" });
  if (w.compare) items.push({ label: w.compare.label, kind: "dash", color: "var(--chart-compare)" });
  if (w.outliers.length) items.push({ label: t("ov.leg.leftOut"), kind: "dot", color: "var(--chart-outlier)" });
  return section("trend", t("ov.sec.trend"), figure({
    id: "chart-weight", title: t("chart.weight"), unitLabel: unitText(a.unit), summary: w.summary, island: "timeseries",
    height: 320, legendHtml: legend(items), tableHtml: metricTable(w), fallbackSvg: sparkFallback(w),
  }, { attrs: { "data-metric": "weight", "data-slider": true }, figureAttrs: ' data-main' }));
}

function projectionText(a: UserAnalysis): string {
  const p = a.projection;
  if (!p) return "";
  const month = (d: string) => formatDate(dayNoonUtc(d), "UTC", "month");
  switch (p.status) {
    case "reached": return t("ov.proj.reached");
    case "on-track": {
      const rate = a.weight?.rate ? t("ov.proj.atRate", { rate: formatRate(a.weight.rate.perWeek, a.unit) }) : "";
      const between = p.earliest && p.latest && month(p.earliest) !== month(p.latest) ? t("ov.proj.between", { a: month(p.earliest), b: month(p.latest) }) : "";
      return t(p.model === "decay" ? "ov.proj.onTrackDecay" : "ov.proj.onTrack", { rate, when: p.date ? t("ov.proj.around", { date: month(p.date) }) : t("ov.proj.soon"), between });
    }
    case "levels-off": return t("ov.proj.levelsOff", { plateau: formatMass(p.plateauKg ?? p.goal, a.unit, { decimals: 1 }) });
    case "too-slow": return t("ov.proj.tooSlow");
    case "moving-away": return t("ov.proj.away");
    case "stable": return t("ov.proj.stable");
    default: return t("ov.proj.insufficient");
  }
}

function goalCard(a: UserAnalysis, ctx: OverviewCtx): string {
  const g = a.goal;
  const unit = a.unit;
  const decimals = unit === "st" ? 2 : 1;
  const shown = g ? toDisplay(g.kg, unit).toFixed(decimals) : ""; // form value: always a dot
  const ph = unit === "kg" ? "78.0" : unit === "lb" ? "172.0" : "12.3";
  const gs = ctx.goalStart;
  const startDay = gs?.day ?? (g ? isoDay(g.startAt) : "");
  const startShown = g?.startManual ? toDisplay(g.startKg, unit).toFixed(decimals) : "";
  const hint = gs
    ? t(`ov.startAuto.${gs.autoKg.source}`, { date: formatDate(dayNoonUtc(gs.day), "UTC", "medium"), mass: formatMass(gs.autoKg.kg, unit, { decimals: 1 }) })
    : "";
  const unitName = unit === "st" ? t("ov.decimalStones") : unitText(unit);
  const form = `<form class="goal-form" method="post" action="/users/${a.user.id}/goal"><input type="hidden" name="_csrf" value="${e(ctx.csrf)}"><label>${e(t("ov.goalWeight", { unit: unitName }))}<input type="number" name="goal_weight" inputmode="decimal" step="any" min="0" value="${e(shown)}" placeholder="${e(ph)}"></label><label>${e(t("ov.targetDate"))}<input type="date" name="goal_date" value="${e(g?.date ?? "")}"></label><label>${e(t("ov.startDate"))}<input type="date" name="goal_start" min="2000-01-01" value="${e(startDay)}"></label><label>${e(t("ov.startWeight", { unit: unitName }))}<input type="number" name="goal_start_kg" inputmode="decimal" step="any" min="0" value="${e(startShown)}" placeholder="${e(t("ov.startWeightAuto"))}"></label>${hint ? `<p class="hint goal-start-hint">${e(hint)}</p>` : ""}<p class="hint">${e(t("ov.startHint"))}</p><p class="hint">${e(t("ov.removeGoalHint"))}</p><button class="btn btn-primary btn-sm" type="submit">${e(t("ov.saveGoal"))}</button></form>`;
  let head = "";
  if (g) {
    const pr = a.progress;
    const pct = pr ? Math.round(Math.min(1, Math.max(0, pr.fraction)) * 100) : null;
    const req = a.projection?.requiredPerWeek;
    head =
      `<p class="goal-target"><data value="${g.kg}">${e(formatMass(g.kg, unit, { decimals: 1 }))}</data>${g.date ? ` <span class="hint">${e(t("ov.goalBy", { date: formatDate(dayNoonUtc(g.date), "UTC", "medium") }))}</span>` : ""}</p>` +
      (pct !== null && pr
        ? `<progress class="progress" max="100" value="${pct}" aria-label="${e(t("ov.goalProgressAria"))}">${percent(pct)}</progress><p class="goal-progress-text"><strong>${percent(pct)}</strong> ${e(t("ov.goalProgressRest", { start: formatMass(pr.startKg, unit, { decimals: 1 }), goal: formatMass(pr.goalKg, unit, { decimals: 1 }), date: formatDate(g.startAt, ctx.zone ?? ctx.goalStart?.zone ?? "UTC", "medium") }))}</p>`
        : "") +
      `<p class="goal-projection">${e(projectionText(a))}</p>` +
      (req !== null && req !== undefined
        ? `<p class="hint">${e(a.weight?.rate ? t("ov.needRateCurrent", { need: formatRate(req, unit), current: formatRate(a.weight.rate.perWeek, unit) }) : t("ov.needRate", { need: formatRate(req, unit) }))}</p>`
        : "");
  } else head = `<p class="hint">${e(t("ov.setGoalHint"))}</p>`;
  return `<div class="card goal-card" id="goal"><h3 class="card-title">${e(t("ov.goal"))}</h3>${head}<details class="goal-edit"${g ? "" : " open"}><summary class="btn btn-ghost btn-sm">${e(g ? t("ov.editGoal") : t("ov.setGoal"))}</summary>${form}</details></div>`;
}

function rateFigure(a: UserAnalysis): string {
  const wr = a.weeklyRate;
  if (!wr.length) return "";
  const avg = wr.reduce((s, p) => s + p.v, 0) / wr.length;
  const rows = wr.slice(-52).map((p) => [formatDate(p.t, "UTC", "medium"), formatDelta(Math.round(p.v * 100) / 100, 1, a.unit)]);
  return figure({
    id: "chart-rate", title: t("ov.rateTitle"), unitLabel: rateUnitLabel(a.unit),
    summary: t("ov.rateSummary", { n: wr.length, rate: formatRate(avg, a.unit) }),
    island: "diverging-bars", height: 160,
    legendHtml: legend([{ label: t("ov.rateLegend"), kind: "box", color: "var(--chart-compare)" }]),
    tableHtml: dataTable([t("ov.rateWeek"), t("ov.rateChange")], rows, { numericCols: [1], caption: t("ov.rateCaption") }),
  });
}

function periodCard(a: UserAnalysis): string {
  if (!a.periods.length) return `<div class="card">${note(t("ov.noPeriods"))}</div>`;
  const m = (kg: number) => formatMass(kg, a.unit, { decimals: 1 });
  const rows = a.periods.map((p) => [p.label, m(p.b.mean), m(p.a.mean), formatDelta(Math.round(p.delta * 10) / 10, 1, a.unit), `${p.a.n} / ${p.b.n}`]);
  return `<div class="card period-card"><h3 class="card-title">${e(t("ov.periodTitle"))}</h3><div class="table-wrap">${dataTable(
    [t("ov.th.comparison"), t("ov.th.before"), t("ov.th.now"), t("ov.th.change"), t("ov.th.daysNowBefore")], rows, { numericCols: [1, 2, 3, 4], caption: t("ov.periodCaption") },
  )}</div></div>`;
}

function progressSection(a: UserAnalysis, ctx: OverviewCtx): string {
  const rate = rateFigure(a);
  const right = `${rate ? `<div class="card">${rate}</div>` : ""}${periodCard(a)}`;
  return section("progress", t("ov.sec.progress"), `<div class="progress-grid">${goalCard(a, ctx)}<div class="progress-side">${right}</div></div>`);
}

function compositionSection(a: UserAnalysis): string {
  const c = a.composition!;
  const parts: string[] = [];
  const row: string[] = [];
  if (c.fatMass && c.leanMass) {
    row.push(`<div class="card">${figure({
      id: "chart-composition", title: t("ov.fatLeanTitle"), unitLabel: unitText(a.unit),
      summary: `${c.fatMass.summary} ${c.leanMass.summary}`, island: "composition", height: 240,
      legendHtml: legend([
        { label: t("ov.leg.fatTrend"), kind: "line", color: "var(--chart-fat)" },
        { label: t("ov.leg.leanTrend"), kind: "line", color: "var(--chart-lean)" },
      ]),
      tableHtml: `${metricTable(c.fatMass)}${metricTable(c.leanMass)}`,
      fallbackSvg: sparkFallback(c.fatMass),
    })}</div>`);
  }
  if (c.fatPct) {
    row.push(`<div class="card">${figure({
      id: "chart-fat-pct", title: t("an.bodyFat"), unitLabel: "%", summary: c.fatPct.summary, island: "timeseries", height: 240,
      legendHtml: legend([
        { label: t("ov.leg.daily"), kind: "dot", color: "var(--chart-raw)" },
        { label: t("ov.leg.trend"), kind: "line", color: "var(--chart-trend)" },
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
      id: "chart-composition-monthly", title: t("ov.monthlyTitle"), unitLabel: unitText(a.unit),
      summary: t("ov.monthlySummary", { n: c.monthly.length }),
      island: "composition-bars", height: 220,
      legendHtml: legend([
        { label: t("ov.leg.fat"), kind: "box", color: "var(--chart-fat)" },
        { label: t("ov.leg.muscle"), kind: "box", color: "var(--chart-muscle)" },
        { label: t("ov.leg.bone"), kind: "box", color: "var(--chart-bone)" },
        { label: t("ov.leg.otherLean"), kind: "box", color: "var(--chart-lean)" },
        { label: t("ov.leg.waterLine"), kind: "dash", color: "var(--chart-water)" },
      ]),
      tableHtml: dataTable([t("ov.th.month"), t("ov.leg.fat"), t("ov.leg.muscle"), t("ov.leg.bone"), t("ov.leg.otherLean"), t("ov.water")], rows, { numericCols: [1, 2, 3, 4, 5], caption: t("ov.monthlyCaption") }),
    })}</div>`);
  }
  const rc = c.recomposition;
  if (rc.kind !== "insufficient") {
    const tone = rc.kind === "fat-loss" || rc.kind === "recomposition" || rc.kind === "lean-gain" ? "good" : rc.kind === "fat-gain" || rc.kind === "mixed-loss" ? "warn" : "info";
    parts.push(callout(tone, t("ov.whatChanged"), `<p>${e(rc.text)}</p>`));
  }
  if (a.bmi) {
    parts.push(`<div class="card">${figure({
      id: "chart-bmi", title: t("an.bmi"), summary: a.bmi.series.summary, island: "timeseries", height: 240,
      legendHtml: legend([
        { label: t("ov.leg.underweight"), kind: "box", color: "var(--chart-bmi-under)" },
        { label: t("ov.leg.normal"), kind: "box", color: "var(--chart-bmi-normal)" },
        { label: t("ov.leg.overweight"), kind: "box", color: "var(--chart-bmi-over)" },
        { label: t("ov.bmiLegendObese"), kind: "box", color: "var(--chart-bmi-obese)" },
      ], "legend-bands"),
      tableHtml: metricTable(a.bmi.series), fallbackSvg: sparkFallback(a.bmi.series),
    }, { attrs: { "data-metric": "bmi", "data-compact": true } })}</div>`);
  }
  const tiles: string[] = [];
  if (c.ffmi !== null) tiles.push(stat({ label: t("ov.ffmi"), value: decimal(c.ffmi, 1), rawValue: c.ffmi, unit: "kg/m²", size: "sm" }));
  if (c.fmi !== null) tiles.push(stat({ label: t("ov.fmi"), value: decimal(c.fmi, 1), rawValue: c.fmi, unit: "kg/m²", size: "sm" }));
  if (c.waterPct !== null) tiles.push(stat({ label: t("ov.water"), value: `${decimal(c.waterPct, 1)}${currentLocale() === "de" ? "\u00a0" : ""}%`, rawValue: c.waterPct, size: "sm" }));
  if (tiles.length) parts.push(`<div class="stat-grid">${tiles.join("")}</div>`);
  return section("composition", t("ov.sec.composition"), parts.join(""));
}

function comparabilityCallout(h: Habits): string {
  const between = t("ov.betweenHours", { from: hh(MORNING.from), to: hh(MORNING.to) });
  const pct = percent(Math.round(h.morningShare * 100));
  const zone = h.zoneAssumed ? t("ov.zoneAssumed") : "";
  if (h.verdict === "unknown")
    return callout("info", "", `<p>${e(t("ov.unknownVerdict", { count: h.count, min: MIN_READINGS, zone }))}</p>`);
  if (h.verdict === "comparable")
    return callout("good", t("ov.comparableTitle"), `<p>${e(t("ov.comparableBody", { pct, between, zone }))}</p>`);
  return callout("warn", t("ov.mixedTitle"), `<p>${e(t("ov.mixedBody", { pct, between, time: clock(h.medianMinutes), zone }))}</p>`);
}

function habitsSection(a: UserAnalysis): string {
  const h = a.habits;
  const parts: string[] = [comparabilityCallout(h)];
  const tiles = [
    stat({ label: t("ov.weighIns"), value: num.format(h.count), rawValue: h.count, size: "sm" }),
    stat({ label: t("ov.daysWithWeighIn"), value: num.format(h.days), rawValue: h.days, size: "sm" }),
    stat({ label: t("ov.perWeekLabel"), value: decimal(Math.round(h.perWeek * 10) / 10, Number.isInteger(Math.round(h.perWeek * 10) / 10) ? 0 : 1), rawValue: h.perWeek, size: "sm" }),
    stat({ label: t("ov.typicalTime"), value: h.count ? clock(h.medianMinutes) : "–", rawValue: h.count ? h.medianMinutes : null, size: "sm" }),
    stat({ label: t("ov.currentStreak"), value: days(h.streaks.current), rawValue: h.streaks.current, size: "sm" }),
    stat({ label: t("ov.longestStreak"), value: h.streaks.longest ? days(h.streaks.longest.days) : "–", rawValue: h.streaks.longest?.days ?? null, size: "sm" }),
    stat({ label: t("ov.longestPause"), value: days(h.longestGapDays), rawValue: h.longestGapDays, size: "sm" }),
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
    const heat = `<div class="heat-legend"><span>${e(t("ov.heatLegend"))}</span><ul class="heat-scale">${["0", "1", "2", "3", "4+"]
      .map((l, i) => `<li><span class="heat-cell heat-${i}" aria-hidden="true"></span>${l}</li>`)
      .join("")}</ul></div>`;
    parts.push(`<div class="card">${figure({
      id: "chart-calendar", title: t("ov.calendarTitle"),
      summary: t("ov.calendarSummary", { days: days(h.days), streak: days(h.streaks.current), years: years.size > 5 ? t("ov.calendarYears") : "" }),
      island: "calendar", height: shownYears * (7 * 14 + 60) - 16, legendHtml: heat,
      tableHtml: dataTable([t("ov.th.month"), t("ov.th.weighIns"), t("ov.th.daysWithWeighIn")], rows, { numericCols: [1, 2], caption: t("ov.calendarCaption") }),
    })}</div>`);
  }
  if (h.count > 0 && h.hours.length === 24) {
    const rows = h.hours.map((n, i) => [`${hh(i)}:00`, String(n)]);
    parts.push(`<div class="card">${figure({
      id: "chart-hours", title: t("ov.hoursTitle"), unitLabel: t("ov.hoursUnit"),
      summary: t("ov.hoursSummary", { time: clock(h.medianMinutes), pct: percent(Math.round(h.morningShare * 100)), from: hh(MORNING.from), to: hh(MORNING.to) }),
      island: "count-bars", height: 160,
      legendHtml: legend([
        { label: t("ov.leg.morningWindow", { window: t("ov.windowRange", { from: hh(MORNING.from), to: hh(MORNING.to) }) }), kind: "box", color: "var(--chart-trend)" },
        { label: t("ov.leg.otherHours"), kind: "box", color: "var(--chart-compare)" },
      ]),
      tableHtml: dataTable([t("ov.th.hour"), t("ov.th.weighIns")], rows, { numericCols: [1], caption: t("ov.hoursCaption") }),
    }, { attrs: { "data-from": String(MORNING.from), "data-to": String(MORNING.to) } })}</div>`);
  }
  return section("habits", t("ov.sec.habits"), parts.join(""));
}

const slotLabel = (slot: TimeOfDayEffect["slot"]): string => t(`slot.${slot}`);

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
      id: "chart-weekday", title: t("ov.weekdayTitle"), unitLabel: t("ov.vsUsual"),
      summary: t("ov.weekdaySummary", { hi: hi.label, hiVal: d(hi.mean), lo: lo.label, loVal: d(lo.mean) }),
      island: "effect-bars", height: 160,
      legendHtml: legend([{ label: t("ov.leg.meanDiff"), kind: "box", color: "var(--chart-trend)" }]),
      tableHtml: dataTable([t("ov.th.weekday"), t("ov.th.difference"), t("ov.th.interval"), t("ov.th.weighInDays")], rows, { numericCols: [1, 2, 3], caption: t("ov.weekdayCaption") }),
    }, { attrs: { "data-kind": "weekday" } })}</div>`);
  }
  if (p.timeOfDay?.length) {
    const rows = p.timeOfDay.map((s) => [t("ov.slotRow", { slot: slotLabel(s.slot), from: hh(s.hours[0]), to: hh(s.hours[1]) }), d(s.mean), String(s.n)]);
    const hi = [...p.timeOfDay].sort((x, y) => y.mean - x.mean)[0];
    cards.push(`<div class="card">${figure({
      id: "chart-timeofday", title: t("ov.todTitle"), unitLabel: t("ov.vsUsual"),
      summary: t("ov.todSummary", { slot: currentLocale() === "en" ? slotLabel(hi.slot).toLowerCase() : slotLabel(hi.slot), val: d(hi.mean) }),
      island: "effect-bars", height: 160,
      legendHtml: legend([{ label: t("ov.leg.meanDiff"), kind: "box", color: "var(--chart-trend)" }]),
      tableHtml: dataTable([t("ov.th.timeOfDay"), t("ov.th.difference"), t("ov.th.weighIns")], rows, { numericCols: [1, 2], caption: t("ov.todCaption") }),
    }, { attrs: { "data-kind": "timeofday" } })}</div>`);
  }
  if (p.histogram?.bins.length) {
    const h = p.histogram;
    const m = (kg: number) => formatMass(kg, unit, { decimals: 1 });
    const rows = h.bins.map((b) => [t("ov.bandRange", { from: m(b.from), to: m(b.to) }), String(b.count)]);
    cards.push(`<div class="card">${figure({
      id: "chart-histogram", title: t("ov.histTitle"),
      summary: t("ov.histSummary", { mean: m(h.mean), median: m(h.median), p10: m(h.p10), p90: m(h.p90), current: h.current !== null ? t("ov.histCurrent", { value: m(h.current) }) : "" }),
      island: "histogram", height: 180,
      legendHtml: `${legend([
        { label: t("ov.leg.mean"), kind: "line", color: "var(--color-text)" },
        { label: t("ov.leg.median"), kind: "dash", color: "var(--color-text-muted)" },
        ...(h.current !== null ? [{ label: t("ov.leg.now"), kind: "line" as const, color: "var(--color-accent)" }] : []),
        { label: t("ov.leg.middle80"), kind: "box" as const, color: "var(--chart-band)" },
      ])}<p class="legend-note">${e(t("ov.histNote"))}</p>`,
      tableHtml: dataTable([t("ov.th.weightBand"), t("ov.th.days")], rows, { numericCols: [1], caption: t("ov.histCaption") }),
    }, { attrs: { "data-type": "1" } })}</div>`);
  }
  const years = p.years;
  if (years && years.length >= 2 && (a.range.key === "all" || a.range.key === "1y")) {
    const rows = years.map((y) => {
      const mean = y.points.reduce((s, q) => s + q.v, 0) / Math.max(1, y.points.length);
      return [String(y.year), String(y.points.length), formatMass(mean, unit, { decimals: 1 })];
    });
    cards.push(`<div class="card">${figure({
      id: "chart-years", title: t("ov.yearsTitle"), unitLabel: unitText(unit),
      summary: t("ov.yearsSummary", { years: t("ov.years", { n: years.length }) }),
      island: "years", height: 200,
      legendHtml: legend([
        { label: t("ov.leg.currentYear"), kind: "line", color: "var(--color-accent)" },
        { label: t("ov.leg.earlierYears"), kind: "line", color: "var(--chart-compare)" },
      ]),
      tableHtml: dataTable([t("ov.th.year"), t("ov.th.daysWithData"), t("ov.th.meanWeight")], rows, { numericCols: [1, 2], caption: t("ov.yearsCaption") }),
    }, { attrs: { "data-type": "1" } })}</div>`);
  }
  if (!cards.length) return section("patterns", t("ov.sec.patterns"), note(t("ov.noPatterns")));
  return section("patterns", t("ov.sec.patterns"), `<div class="chart-grid">${cards.join("")}</div>`);
}

function recordHref(base: string, query: URLSearchParams, t: number): string {
  return paramHref(base, query, { range: null, from: isoDay(t - 14 * DAY), to: isoDay(t + 14 * DAY) });
}

function recordsSection(a: UserAnalysis, ctx: OverviewCtx): string {
  if (!a.records.length) return section("records", t("ov.sec.records"), note(t("ov.recordsEmpty")));
  const base = `/users/${a.user.id}/overview`;
  const unit = a.unit;
  const value = (r: RecordItem): string => {
    if (r.value === null) return "–";
    switch (r.id) {
      case "lowest": case "highest": case "low12m": return formatMass(r.value, unit, { decimals: 1 });
      case "drop7": return formatDelta(-Math.round(r.value * 10) / 10, 1, unit);
      case "gain7": return formatDelta(Math.round(r.value * 10) / 10, 1, unit);
      case "longestStreak": return days(r.value);
      default: return formatDelta(Math.round(r.value * 10) / 10, 1, unit);
    }
  };
  const items = a.records.map((r) => {
    const when = r.t !== null && r.value !== null
      ? `<a href="${e(recordHref(base, ctx.query, r.t))}" title="${e(t("ov.recordTitle"))}">${e(r.detail)}</a>`
      : `<span class="muted">${e(r.detail)}</span>`;
    return `<div class="record"><dt>${e(r.label)}</dt><dd><data class="record-value" value="${e(r.value ?? "")}">${e(value(r))}</data><span class="record-when">${when}</span></dd></div>`;
  });
  return section("records", t("ov.sec.records"), `<div class="card"><dl class="records-list">${items.join("")}</dl></div>`);
}

function qualitySection(a: UserAnalysis): string {
  const q = a.quality;
  const id = a.user.id;
  const items: string[] = [];
  if (q.untrustedClock > 0)
    items.push(callout("warn", t("ov.q.untrusted"), `<p>${e(t("ov.q.untrustedBody", { count: t("ov.readingsCount", { n: q.untrustedClock }) }))} <a href="/users/${id}/readings">${e(t("ov.q.reviewReadings"))}</a></p>`));
  const flagged = q.outliers.reduce((n, o) => n + o.count, 0);
  if (flagged > 0)
    items.push(callout("info", t("ov.q.outliers"), `<p>${e(t("ov.q.outliersBody", { list: q.outliers.map((o) => `${o.label}: ${o.count}`).join(", ") }))} <a href="/users/${id}/readings?outliers=1">${e(t("ov.q.showFlagged"))}</a></p>`));
  if (q.duplicates > 0) items.push(callout("info", t("ov.q.duplicates"), `<p>${e(t("ov.q.duplicatesBody", { count: t("ov.readingsCount", { n: q.duplicates }) }))}</p>`));
  if (q.zoneAssumed > 0) items.push(callout("info", t("ov.q.noZone"), `<p>${e(t("ov.q.noZoneBody", { count: t("ov.readingsCount", { n: q.zoneAssumed }) }))}</p>`));
  if (q.futureTimestamps > 0) items.push(callout("warn", t("ov.q.future"), `<p>${e(t("ov.q.futureBody", { count: t("ov.readingsCount", { n: q.futureTimestamps }) }))}</p>`));
  if (q.gaps.length > 0)
    items.push(callout("info", t("ov.q.gaps"), `<p>${e(t("ov.q.gapsBody", { count: t("ov.gaps", { n: q.gaps.length }), list: q.gaps.slice(-5).map((g) => t("ov.q.gapItem", { from: formatDate(g.from, "UTC", "short"), to: formatDate(g.to, "UTC", "medium"), days: g.days })).join("; ") }))}</p>`));
  const body = items.length ? items.join("") : note(t("ov.q.none"));
  return section("quality", t("ov.sec.quality"), `<details class="quality-details"${items.length ? " open" : ""}><summary>${e(items.length ? t("ov.q.toCheck", { count: t("ov.things", { n: items.length }) }) : t("ov.q.allClear"))}</summary><div class="quality-list">${body}</div></details>`);
}

function metricsSection(a: UserAnalysis, ctx: OverviewCtx): string {
  if (!a.metrics.length) return section("metrics", t("ov.sec.metrics"), note(t("ov.noOtherMetrics")));
  const current = ctx.query.get("metric");
  const cards = a.metrics.map((m) => {
    const st = m.stats;
    const dlt = change30d(m);
    const latest = st ? formatMetric(st.latest.v, m.type, a.unit) : "–";
    const dir = dlt === null ? null : dlt > 0 ? "up" : dlt < 0 ? "down" : "flat";
    const afterTitle = `<p class="metric-now"><data class="metric-latest" value="${e(st?.latest.v ?? "")}">${e(latest)}</data>${dlt !== null && dir ? `<span class="metric-delta" data-direction="${dir}">${e(formatDelta(dlt, m.type, a.unit))} <span class="delta-ref">${e(t("delta.30d"))}</span></span>` : ""}</p>`;
    const unitLabel = m.unit === "kg" ? unitText(a.unit) : m.unit;
    return figure({
      id: `metric-${m.type}`, title: m.label, unitLabel: unitLabel || undefined, summary: m.summary, island: "timeseries",
      height: 180, tableHtml: metricTable(m), fallbackSvg: sparkFallback(m),
    }, { attrs: { "data-metric": String(m.type), "data-compact": true }, afterTitle, figureAttrs: current === String(m.type) ? " data-current" : "" });
  });
  return section("metrics", t("ov.sec.metrics"), `<div class="chart-grid metric-grid">${cards.join("")}</div>`);
}

function footer(a: UserAnalysis, ctx: OverviewCtx): string {
  const id = a.user.id;
  return `<footer class="overview-footer"><div class="overview-footer-links">${link(`/users/${id}/readings`, t("ov.rawReadings"), { variant: "quiet", chevron: true })}${link(csvHref(a, ctx), t("ov.downloadCsv"), { variant: "quiet", chevron: true })}</div><details class="definitions"><summary>${e(t("ov.howCalculated"))}</summary><dl class="definition-list"><dt>${e(t("ov.defTrendTitle"))}</dt><dd>${e(t("ov.defTrendBody"))}</dd><dt>${e(t("ov.defComparableTitle"))}</dt><dd>${e(t("ov.defComparableBody", { from: hh(MORNING.from), to: hh(MORNING.to), pct: Math.round(COMPARABLE_SHARE * 100), min: MIN_READINGS }))}</dd></dl></details></footer>`;
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function overviewView(a: UserAnalysis, ctx: OverviewCtx): string {
  const id = a.user.id;
  const sections: { id: string; label: string }[] = [
    { id: "summary", label: t("ov.sec.summary") },
    { id: "trend", label: t("ov.sec.trend") },
    { id: "progress", label: t("ov.sec.progress") },
    ...(a.composition ? [{ id: "composition", label: t("ov.sec.composition") }] : []),
    { id: "habits", label: t("ov.sec.habits") },
    { id: "patterns", label: t("ov.sec.patterns") },
    { id: "records", label: t("ov.sec.records") },
    { id: "quality", label: t("ov.sec.quality") },
    { id: "metrics", label: t("ov.sec.metrics") },
  ];
  const header = `<header class="page-header overview-header"><div class="page-header-text">${link("/", t("ov.backDashboard"), { variant: "back" })}<div class="overview-title"><h1 class="page-title">${e(a.user.name)}</h1>${userSwitcher(a, ctx)}</div><p class="page-subtitle">${e(subtitle(a))}</p></div><div class="page-actions">${buttonLink(csvHref(a, ctx), t("ov.downloadCsv"), { variant: "ghost" })}${link(`/users/${id}/readings`, t("ov.rawReadings"), { variant: "quiet", chevron: true })}</div></header>`;
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
