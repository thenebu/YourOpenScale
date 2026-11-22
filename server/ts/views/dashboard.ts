/** Dashboard view (WP-11): one card per active user. Pure; `now` comes from the caller. */
import { formatDate, formatDelta, formatMass, formatMetric } from "../analysis/format.ts";
import type { DashboardSummary } from "../analysis/types.ts";
import { percent, t } from "../i18n/index.ts";
import { escapeHtml as e } from "../ui.ts";
import { badge, buttonLink, delta, emptyState, link, pageHeader, stat, type DeltaData } from "./components.ts";
import { icon } from "./icons.ts";
import { miniTrend } from "./spark.ts";

const STALE_DAYS = 7;

export type DashboardContext = {
  now: number;
  lastWeighIn: number | null;
  /** IANA zone for dates and times; UTC when omitted. */
  zone?: string | null;
};

function ago(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.minutesAgo", { n: m });
  const h = Math.round(s / 3600);
  if (h < 48) return t("time.hoursAgo", { n: h });
  return t("time.daysAgo", { n: Math.floor(s / 86400) });
}

function recency(s: DashboardSummary, zone: string | null): string {
  const d = s.daysSinceLast;
  if (d === null || !s.last) return "";
  if (d > STALE_DAYS) return badge(t("time.daysAgo", { n: d }), "warn");
  if (d === 0) return badge(zone ? t("time.todayAt", { time: formatDate(s.last.t, zone, "time") }) : t("time.today"));
  return badge(d === 1 ? t("time.yesterday") : t("time.daysAgo", { n: d }));
}

function initials(s: DashboardSummary["user"]): string {
  return (s.shortName || s.name).trim().slice(0, 2).toUpperCase();
}

/** Tone follows the goal direction only; without a goal every change is neutral. */
function deltaItem(v: number | null, ref: string, s: DashboardSummary): string {
  if (v === null || !Number.isFinite(v)) return delta({ text: "–", direction: "flat", ref });
  const text = formatDelta(v, 1, s.unit);
  if (/^0(\D|$)/.test(text)) return delta({ text, direction: "flat", ref });
  const direction: DeltaData["direction"] = v < 0 ? "down" : "up";
  let tone: DeltaData["tone"] = "neutral";
  if (s.goal && s.trendKg !== null && s.goal.kg !== s.trendKg) {
    const wantDown = s.goal.kg < s.trendKg;
    tone = (v < 0) === wantDown ? "good" : "bad";
  }
  return delta({ text, direction, tone, ref });
}

function hero(s: DashboardSummary): string {
  const shown = s.trendKg ?? s.last?.weightKg ?? null;
  if (shown === null) return "";
  const sub =
    s.trendKg !== null
      ? s.last?.weightKg != null
        ? t("dash.heroTrendLast", { mass: formatMass(s.last.weightKg, s.unit, { decimals: 1 }) })
        : t("dash.heroTrend")
      : t("dash.heroNoTrend");
  return `<data class="stat-value" value="${e(shown)}">${e(formatMass(shown, s.unit, { decimals: 1 }))}</data><p class="user-card-sub">${e(sub)}</p>`;
}

function progress(s: DashboardSummary): string {
  if (!s.goal || !s.progress) return "";
  const pct = Math.round(Math.min(1, Math.max(0, s.progress.fraction)) * 100);
  const label = t("dash.progress", { pct: percent(pct), start: formatMass(s.progress.startKg, s.unit, { decimals: 1 }), goal: formatMass(s.progress.goalKg, s.unit, { decimals: 1 }) });
  return `<progress class="progress" max="100" value="${pct}" aria-label="${e(label)}">${percent(pct)}</progress><p class="user-card-sub">${e(label)}</p>`;
}

function chips(s: DashboardSummary): string {
  if (!s.chips.length) return "";
  const items = s.chips.slice(0, 4).map((c) => {
    const type = c.type ?? -1;
    const d = c.delta30;
    const text = d === null ? null : formatDelta(d, type, s.unit);
    const flat = text !== null && /^0(\D|$)/.test(text);
    return stat({
      label: c.label,
      value: formatMetric(c.value, type, s.unit),
      rawValue: c.value,
      size: "sm",
      href: `/users/${s.user.id}/overview?metric=${type}#composition`,
      delta:
        d === null || text === null
          ? undefined
          : { text, direction: flat ? "flat" : d < 0 ? "down" : "up", ref: t("delta.30d") },
    });
  });
  return `<div class="stat-grid">${items.join("")}</div>`;
}

function consistency(s: DashboardSummary): string {
  const c = s.consistency;
  const parts = [t("dash.last7", { n: c.daysLast7 })];
  if (c.morningShare90 !== null) parts.push(t("dash.mornings", { pct: percent(Math.round(c.morningShare90 * 100)) }));
  return parts.join(" · ");
}

function userCard(s: DashboardSummary, zone: string | null): string {
  const id = s.user.id;
  const href = `/users/${id}/overview`;
  const header =
    `<div class="user-card-head"><span class="avatar" aria-hidden="true">${e(initials(s.user))}</span>` +
    `<a class="card-title-link" href="${href}">${e(s.user.name)}${icon("chevron-right", { size: 16 })}</a>${recency(s, zone)}</div>`;

  if (!s.last) {
    return `<section class="card user-card user-card-empty" aria-label="${e(s.user.name)}"><div class="uc-head">${header}</div><div class="user-card-empty-body">${emptyState({
      icon: "scale",
      title: t("dash.noWeighIns"),
      body: t("dash.noWeighInsBody", { name: s.user.name }),
      action: link("/import/withings", t("dash.importExport"), { chevron: true }),
    })}</div></section>`;
  }

  const deltas = `<div class="user-card-deltas">${deltaItem(s.deltas.d7, t("delta.7d"), s)}${deltaItem(s.deltas.d30, t("delta.30d"), s)}${deltaItem(s.deltas.d90, t("delta.90d"), s)}</div>`;
  const mini = miniTrend({ ...s.mini });
  const footer = `<div class="card-footer"><span>${e(consistency(s))}</span>${link(href, t("dash.openAnalysis"), { chevron: true })}</div>`;
  const rows = [header, hero(s), deltas, mini, `<p class="user-card-rate">${e(s.rateText)}</p>`, progress(s), chips(s), footer];
  const cls = ["uc-head", "uc-hero", "uc-deltas", "uc-mini", "uc-rate", "uc-progress", "uc-chips", "uc-foot"];
  return `<section class="card user-card" aria-label="${e(s.user.name)}">${rows.map((r, i) => `<div class="${cls[i]}">${r}</div>`).join("")}</section>`;
}

export function dashboardView(summaries: DashboardSummary[], ctx: DashboardContext): string {
  const zone = ctx.zone ?? null;
  const day = formatDate(ctx.now, zone ?? "UTC", "long");
  const sub = ctx.lastWeighIn === null ? t("dash.subtitleNone", { day }) : t("dash.subtitleLast", { day, ago: ago(ctx.now - ctx.lastWeighIn) });
  const header = pageHeader({
    title: t("dash.title"),
    subtitle: sub,
    actionsHtml: buttonLink("/readings", t("nav.readings"), { variant: "ghost", size: "sm" }),
  });
  if (!summaries.length) {
    return `${header}${emptyState({
      icon: "scale",
      title: t("dash.addFirst"),
      body: t("dash.addFirstBody"),
      action: `${buttonLink("/users", t("dash.addFirst"))} ${buttonLink("/firmware", t("dash.connectScale"), { variant: "secondary" })}`,
    })}`;
  }
  return `${header}<div class="user-cards">${summaries.map((s) => userCard(s, zone)).join("")}</div>`;
}

