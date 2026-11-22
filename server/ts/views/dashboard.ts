/** Dashboard view (WP-11): one card per active user. Pure; `now` comes from the caller. */
import { formatDate, formatDelta, formatMass, formatMetric } from "../analysis/format.ts";
import type { DashboardSummary } from "../analysis/types.ts";
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
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(s / 3600);
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function recency(s: DashboardSummary, zone: string | null): string {
  const d = s.daysSinceLast;
  if (d === null || !s.last) return "";
  if (d > STALE_DAYS) return badge(`${d} days ago`, "warn");
  if (d === 0) return badge(zone ? `Today ${formatDate(s.last.t, zone, "time")}` : "Today");
  return badge(d === 1 ? "Yesterday" : `${d} days ago`);
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
      ? `Trend${s.last?.weightKg != null ? ` · last reading ${formatMass(s.last.weightKg, s.unit, { decimals: 1 })}` : ""}`
      : "Last reading · not enough data for a trend";
  return `<data class="stat-value" value="${e(shown)}">${e(formatMass(shown, s.unit, { decimals: 1 }))}</data><p class="user-card-sub">${e(sub)}</p>`;
}

function progress(s: DashboardSummary): string {
  if (!s.goal || !s.progress) return "";
  const pct = Math.round(Math.min(1, Math.max(0, s.progress.fraction)) * 100);
  const label = `${pct}% of the way from ${formatMass(s.progress.startKg, s.unit, { decimals: 1 })} to ${formatMass(s.progress.goalKg, s.unit, { decimals: 1 })}`;
  return `<progress class="progress" max="100" value="${pct}" aria-label="${e(label)}">${pct}%</progress><p class="user-card-sub">${e(label)}</p>`;
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
          : { text, direction: flat ? "flat" : d < 0 ? "down" : "up", ref: "30 d" },
    });
  });
  return `<div class="stat-grid">${items.join("")}</div>`;
}

function consistency(s: DashboardSummary): string {
  const c = s.consistency;
  const parts = [`${c.daysLast7} of last 7 days`];
  if (c.morningShare90 !== null) parts.push(`${Math.round(c.morningShare90 * 100)}% mornings`);
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
      title: "No weigh-ins yet",
      body: `Step on a scale that knows ${s.user.name}, or import a Withings export`,
      action: link("/import/withings", "Import a Withings export", { chevron: true }),
    })}</div></section>`;
  }

  const deltas = `<div class="user-card-deltas">${deltaItem(s.deltas.d7, "7 d", s)}${deltaItem(s.deltas.d30, "30 d", s)}${deltaItem(s.deltas.d90, "90 d", s)}</div>`;
  const mini = miniTrend({ ...s.mini });
  const footer = `<div class="card-footer"><span>${e(consistency(s))}</span>${link(href, "Open analysis", { chevron: true })}</div>`;
  const rows = [header, hero(s), deltas, mini, `<p class="user-card-rate">${e(s.rateText)}</p>`, progress(s), chips(s), footer];
  const cls = ["uc-head", "uc-hero", "uc-deltas", "uc-mini", "uc-rate", "uc-progress", "uc-chips", "uc-foot"];
  return `<section class="card user-card" aria-label="${e(s.user.name)}">${rows.map((r, i) => `<div class="${cls[i]}">${r}</div>`).join("")}</section>`;
}

export function dashboardView(summaries: DashboardSummary[], ctx: DashboardContext): string {
  const zone = ctx.zone ?? null;
  const day = formatDate(ctx.now, zone ?? "UTC", "long");
  const sub = ctx.lastWeighIn === null ? `${day} · no weigh-ins yet` : `${day} · last weigh-in ${ago(ctx.now - ctx.lastWeighIn)}`;
  const header = pageHeader({
    title: "Today",
    subtitle: sub,
    actionsHtml: buttonLink("/readings", "Readings", { variant: "ghost", size: "sm" }),
  });
  if (!summaries.length) {
    return `${header}${emptyState({
      icon: "scale",
      title: "Add your first person",
      body: "Add the people who use the scale, then connect it so their weigh-ins show up here.",
      action: `${buttonLink("/users", "Add your first person")} ${buttonLink("/firmware", "Connect a scale", { variant: "secondary" })}`,
    })}`;
  }
  return `${header}<div class="user-cards">${summaries.map((s) => userCard(s, zone)).join("")}</div>`;
}

