/** Small server-rendered views shared by the Worker and local Node entrypoint. */
import { scaleModel } from "./models.ts";
import { LOCALES, currentDatePrefs, currentLocale, intlTag, t, type Locale } from "./i18n/index.ts";
import { formatDate, formatDateTime, formatMass } from "./analysis/format.ts";
import { METRICS, metricLabelText, storedMeasures, type Metric } from "./metrics.ts";
import type { StageMeta } from "./withings_import.ts";
import { timeZoneSelect } from "./integrated_ui.ts";
import { WEB_APP_VERSION } from "./version.ts";
import { assetTags } from "./assets.ts";
import { icon } from "./views/icons.ts";
import { badge, card, chip, emptyState, kv, pageHeader, segmented } from "./views/components.ts";
type Row = Record<string, any>;
export const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const e = escapeHtml;
const n = (value: unknown) => Number(value ?? 0);
export const hidden = (csrf: string) =>
  `<input type="hidden" name="_csrf" value="${e(csrf)}">`;
const option = (value: string | number, label: string, selected: unknown) =>
  `<option value="${e(value)}"${String(value) === String(selected) ? " selected" : ""}>${e(label)}</option>`;
/** Zone used for server-rendered reading times: the process zone, as before the format preference existed. */
const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const timeLabel = (value: unknown): string => {
  const date = new Date(n(value) * 1000);
  return Number.isFinite(date.valueOf()) && n(value) > 0 ? e(formatDateTime(n(value), localZone())) : t("common.unknown");
};
/** A stored YYYY-MM-DD day as display text (other values pass through). */
export const dayText = (value: unknown): string => {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? formatDate(Date.parse(`${text}T12:00:00Z`) / 1000, "UTC", "medium") : text;
};
function kgText(kg: number, unit: string): string {
  return formatMass(kg, unit === "lb" || unit === "st" ? unit : "kg");
}
export function weightLabel(row: Row, unit: string): string {
  if (row.weight_value == null || row.weight_unit == null) return "—";
  return kgText(n(row.weight_value) * 10 ** n(row.weight_unit), unit);
}
function metricPicker(
  metrics: Metric[],
  selected: number,
  name = "metric",
  selections: Record<string, string | number> = {},
): string {
  if (metrics.length < 2) return "";
  const preserved = Object.entries(selections)
    .filter(([key]) => key !== name)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${e(key)}" value="${e(value)}">`,
    )
    .join("");
  return `<form method="get" class="metric-picker">${preserved}<label>${e(t("readings.measurement"))}<select name="${e(name)}" data-submit-on-change>${metrics.map((m) => option(m.type, m.label, selected)).join("")}</select></label><button class="secondary no-js-only" type="submit">${e(t("common.show"))}</button></form>`;
}
function metricLabel(row: Row, type: number, weightUnit: string): string {
  if (type === 1) return weightLabel(row, weightUnit);
  const matches = storedMeasures(row).filter((m) => m.type === type);
  if (!matches.length) return "—";
  const metric = METRICS.find((v) => v.type === type)!;
  return matches
    .map((m) => {
      const value =
        metric.unit === "kg"
          ? weightLabel(
              { weight_value: m.value, weight_unit: m.unit },
              weightUnit,
            )
          : `${new Intl.NumberFormat(intlTag(currentLocale()), { maximumFractionDigits: 2 }).format(m.value * 10 ** m.unit)}${metric.unit === "index" ? "" : ` ${e(metric.unit === "years" ? t("unit.years") : metric.unit)}`}`;
      return matches.length > 1
        ? `${value} (${e(t("readings.position", { position: m.position ?? t("readings.positionUnspecified") }))})`
        : value;
    })
    .join("; ");
}
function metricTitle(type: number): string {
  return metricLabelText(type);
}
export type LayoutOpts = {
  users?: { id: number; name: string }[];
  unassigned?: number;
  theme?: "light" | "dark" | null;
  entries?: ("app" | "charts")[];
  /** Current path + query, used as the `back` target of the footer theme and language links. */
  back?: string;
};
const manageGroups = (): { title: string; links: [string, string][] }[] => [
  { title: t("nav.group.peopleData"), links: [["/users", t("nav.users")], ["/import/withings", t("nav.import")]] },
  { title: t("nav.group.devices"), links: [["/scales", t("nav.scales")], ["/firmware", t("nav.firmware")], ["/sync", t("nav.sync")]] },
  { title: t("nav.group.system"), links: [["/settings", t("nav.settings")]] },
];
function themeSwitch(current: "light" | "dark" | null, back: string): string {
  const item = (value: string, label: string, on: boolean) =>
    `<a href="/theme?set=${value}&amp;back=${encodeURIComponent(back)}" data-theme-set="${value}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="segmented" aria-label="${e(t("theme.label"))}">${item("system", t("theme.system"), !current)}${item("light", t("theme.light"), current === "light")}${item("dark", t("theme.dark"), current === "dark")}</nav>`;
}
/** "EN | DE" switch: plain links to /lang (works without JS); the labels carry their own language. */
function langSwitch(current: Locale, back: string): string {
  const item = (value: Locale) =>
    `<a href="/lang?set=${value}&amp;back=${encodeURIComponent(back)}" data-lang-set="${value}" lang="${value}" hreflang="${value}" aria-label="${e(t(`lang.${value}`))}"${value === current ? ' aria-current="page"' : ""}>${value.toUpperCase()}</a>`;
  return `<nav class="segmented" aria-label="${e(t("lang.label"))}">${LOCALES.map(item).join("")}</nav>`;
}
function navMarkup(csrf: string, active: string, opts: LayoutOpts): string {
  const link = (url: string, label: string, extra = "") =>
    `<a class="nav-link" href="${url}"${active === url ? ' aria-current="page"' : ""}>${label}${extra}</a>`;
  const badge = opts.unassigned && opts.unassigned > 0 ? ` <span class="badge badge-warn" title="${e(t("nav.unassignedTitle"))}">${e(opts.unassigned)}<span class="visually-hidden"> ${e(t("nav.unassignedHidden"))}</span></span>` : "";
  const users = opts.users ?? [];
  const people = users.length >= 2
    ? `<details class="nav-dropdown"><summary class="nav-link"${active.startsWith("/users/") ? ' aria-current="page"' : ""}>${e(t("nav.people"))} ${icon("chevron-down", { size: 14 })}</summary><div class="nav-popover">${users.map((u) => `<a href="/users/${e(u.id)}/overview">${e(u.name)}</a>`).join("")}</div></details>`
    : users.length === 1
      ? `<a class="nav-link" href="/users/${e(users[0].id)}/overview"${active.startsWith("/users/") ? ' aria-current="page"' : ""}>${e(t("nav.overview"))}</a>`
      : "";
  const sheetPeople = users.length >= 2
    ? `<p class="nav-sheet-heading">${e(t("nav.overviews"))}</p>${users.map((u) => `<a class="nav-link" href="/users/${e(u.id)}/overview">${e(u.name)}</a>`).join("")}`
    : users.length === 1
      ? `<a class="nav-link" href="/users/${e(users[0].id)}/overview">${e(t("nav.overview"))}</a>`
      : "";
  const manageLink = (url: string, label: string) => `<a href="${url}"${active === url ? ' aria-current="page"' : ""}>${label}</a>`;
  const manageActive = manageGroups().some((g) => g.links.some(([u]) => active === u || (u === "/users" && active === "/users")));
  const manage = `<details class="nav-dropdown nav-manage"><summary class="nav-link"${manageActive ? ' aria-current="page"' : ""}>${e(t("nav.manage"))} ${icon("chevron-down", { size: 14 })}</summary><div class="nav-popover nav-popover-end">${manageGroups().map((g) => `<div class="nav-group" role="group" aria-label="${e(g.title)}"><p class="nav-group-title">${e(g.title)}</p>${g.links.map(([u, l]) => manageLink(u, l)).join("")}</div>`).join("")}</div></details>`;
  const sheetManage = manageGroups().map((g) => `<p class="nav-sheet-heading">${e(g.title)}</p>${g.links.map(([u, l]) => link(u, l)).join("")}`).join("");
  const signOut = (cls: string) => `<form action="/logout" method="post" class="${cls}">${hidden(csrf)}<button class="btn btn-ghost btn-sm" type="submit">${e(t("nav.signOut"))}</button></form>`;
  const brand = `<a class="brand" href="/" aria-label="YourOpenScale"><img src="/favicon.png" width="28" height="28" alt=""><strong class="brand-full">YourOpenScale</strong><strong class="brand-short">YOS</strong></a>`;
  return `<nav class="app-nav" aria-label="${e(t("nav.main"))}"><div class="app-nav-inner">${brand}<div class="nav-links">${link("/", t("nav.dashboard"))}${people}${link("/readings", t("nav.readings"), badge)}${manage}</div>${signOut("nav-signout")}<details class="nav-menu"><summary class="btn btn-ghost btn-icon" aria-label="${e(t("nav.menu"))}">${icon("menu", { size: 20 })}</summary><div class="nav-sheet">${link("/", t("nav.dashboard"))}${sheetPeople}${link("/readings", t("nav.readings"), badge)}<hr>${sheetManage}<hr>${signOut("nav-sheet-signout")}</div></details></div></nav>`;
}
/* WP-16: PWA head tags (manifest, theme colours from tokens, apple tags). */
const PWA_HEAD = `<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1a1c2b" media="(prefers-color-scheme: dark)"><link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="YOS"><meta name="apple-mobile-web-app-status-bar-style" content="default">`;
/** Same-origin relative path only (open-redirect guard); the one-shot `notice` flash param is dropped. */
function safeBack(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  const q = raw.indexOf("?");
  if (q < 0) return raw;
  const params = new URLSearchParams(raw.slice(q + 1));
  params.delete("notice");
  const rest = params.toString();
  return rest ? `${raw.slice(0, q)}?${rest}` : raw.slice(0, q);
}

export function layout(
  title: string,
  body: string,
  csrf: string,
  loggedIn: boolean,
  notice = "",
  active = "",
  opts: LayoutOpts = {},
): string {
  const back = safeBack(opts.back);
  const nav = loggedIn
    ? navMarkup(csrf, active, opts)
    : `<nav class="app-nav" aria-label="${e(t("nav.main"))}"><div class="app-nav-inner"><a class="brand" href="/" aria-label="YourOpenScale"><img src="/favicon.png" width="28" height="28" alt=""><strong class="brand-full">YourOpenScale</strong><strong class="brand-short">YOS</strong></a></div></nav>`;
  const flash = notice
    ? `<div class="flash-wrap"><div class="flash callout callout-info" role="status">${icon("info", { size: 20 })}<div>${e(notice)}</div><button type="button" class="btn btn-ghost btn-icon btn-sm flash-dismiss" data-dismiss aria-label="${e(t("flash.dismiss"))}">${icon("x", { size: 16 })}</button></div></div>`
    : "";
  return `<!doctype html><html lang="${currentLocale()}" data-datefmt="${currentDatePrefs().date}" data-timefmt="${currentDatePrefs().time}"${opts.theme ? ` data-theme="${opts.theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <title>${e(title)} · YourOpenScale</title><link rel="icon" href="/favicon.png" type="image/png">${PWA_HEAD}
    <meta name="csrf-token" content="${e(csrf)}"><script src="/app.js?v=${WEB_APP_VERSION}" defer></script>${assetTags(opts.entries ?? ["app"])}</head><body>
    ${nav}
    ${flash}<main>${body}</main><footer class="site-footer"><span>YourOpenScale · v${e(WEB_APP_VERSION)}</span><a class="link link-quiet" href="https://github.com/TomAnthony/YourOwnWeigh" target="_blank" rel="noopener noreferrer">${e(t("footer.basedOn"))}</a>${langSwitch(currentLocale(), back)}${themeSwitch(opts.theme ?? null, back)}</footer></body></html>`;
}
const authShell = (inner: string): string =>
  `<div class="auth-page"><div class="auth-brand"><img src="/favicon.png" width="48" height="48" alt=""><strong>YourOpenScale</strong></div><section class="card auth-card">${inner}</section></div>`;
export function setupPage(
  csrf: string,
  bootstrapRequired = false,
  unlocked = false,
): string {
  if (bootstrapRequired && !unlocked)
    return authShell(`<h1 class="auth-title">${e(t("auth.welcome"))}</h1><p class="auth-lead">${e(t("auth.bootstrapLead"))}</p><form method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="step" value="bootstrap"><label>${e(t("auth.bootstrapToken"))}<input name="bootstrap_token" type="password" required autocomplete="off"></label><button>${e(t("auth.continue"))}</button></form>`);
  return authShell(`<h1 class="auth-title">${e(t("auth.setPassword"))}</h1><p class="auth-lead">${e(t("auth.setPasswordLead"))}</p><form method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="step" value="password"><label>${e(t("auth.adminPassword"))}<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>${e(t("auth.confirmAdminPassword"))}<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label>
    <label><input type="checkbox" name="separate_sync" value="1" data-toggle="setup-sync-fields"> ${e(t("auth.separateSync"))}</label><div id="setup-sync-fields" class="form-stack" hidden><label>${e(t("auth.syncPassword"))}<input name="sync_password" type="password" minlength="8" autocomplete="new-password"></label><label>${e(t("auth.confirmSyncPassword"))}<input name="sync_confirm" type="password" minlength="8" autocomplete="new-password"></label></div><button>${e(t("auth.createHousehold"))}</button></form>`);
}
export function loginPage(csrf: string): string {
  return authShell(`<h1 class="auth-title">${e(t("auth.signIn"))}</h1><form method="post" class="form-stack">${hidden(csrf)}<label>${e(t("auth.adminPassword"))}<input name="password" type="password" required autocomplete="current-password"></label><button>${e(t("auth.signIn"))}</button></form>`);
}

/** `/path?a=1&b=2`, skipping empty values. Used for the filter and pagination links. */
export function pageHref(path: string, params: Record<string, string | number | null | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}
const dateOnly = (value: unknown): string => formatDate(n(value), localZone(), "medium");
const clockOnly = (value: unknown): string => formatDate(n(value), localZone(), "time");
function readingTime(row: Row): string {
  const trusted = row.time_quality === "trusted";
  const at = trusted ? row.meastime : row.first_received_at;
  if (!(n(at) > 0)) return t("common.unknown");
  return `<time class="when" datetime="${new Date(n(at) * 1000).toISOString()}"><span class="when-date">${e(dateOnly(at))}</span> <span class="when-time">${e(clockOnly(at))}</span></time>${trusted ? "" : `<span class="hint">${e(t("readings.receivedTime"))}</span>`}`;
}
function healthSyncStatus(row: Row): string {
  if (!row.user_id || row.weight_value == null)
    return '<span class="muted">—</span>';
  const acknowledgedAt = Number(row.health_sync_acknowledged_at);
  if (!Number.isFinite(acknowledgedAt) || acknowledgedAt <= 0)
    return `<span class="muted">${e(t("readings.notAcknowledged"))}</span>`;
  return `<span class="badge">${e(t("readings.acknowledged"))}</span><time class="hint" datetime="${new Date(acknowledgedAt * 1000).toISOString()}">${timeLabel(acknowledgedAt)}</time>`;
}
const hasAck = (rows: Row[]): boolean => rows.some((r) => r.user_id && n(r.health_sync_acknowledged_at) > 0);

function pager(newer?: string, older?: string): string {
  if (!newer && !older) return "";
  const item = (href: string | undefined, text: string, rel: string, lead: string, trail: string) =>
    href
      ? `<a class="btn btn-secondary btn-sm" rel="${rel}" href="${e(href)}">${lead}${text}${trail}</a>`
      : `<span class="btn btn-secondary btn-sm" aria-disabled="true">${lead}${text}${trail}</span>`;
  return `<nav class="pager" aria-label="${e(t("pager.label"))}">${item(newer, e(t("pager.newer")), "prev", icon("chevron-left", { size: 16 }), "")}${item(older, e(t("pager.older")), "next", "", icon("chevron-right", { size: 16 }))}</nav>`;
}

export type ReadingsFilter = {
  /** Current value: "all", "unassigned" or a user id. */
  value: string;
  items: { value: string; label: string; count?: number }[];
};
export type ReadingsNav = { filter?: ReadingsFilter; newer?: string; older?: string };

export function readingsPage(
  readings: Row[],
  users: Row[],
  unit: string,
  csrf: string,
  metrics: Metric[] = [METRICS[0]],
  metric = 1,
  nav: ReadingsNav = {},
): string {
  const metricParam = metric === 1 ? null : metric;
  const filter = nav.filter;
  const segments = filter
    ? segmented(
        t("readings.showReadingsOf"),
        filter.items.map((i) => ({
          href: pageHref("/readings", { metric: metricParam, user: i.value === "all" ? null : i.value }),
          text: i.count !== undefined ? `${i.label} (${i.count})` : i.label,
          current: i.value === filter.value,
        })),
      )
    : "";
  const picker = metricPicker(metrics, metric, "metric", filter && filter.value !== "all" ? { user: filter.value } : {});
  const filterRow = picker || segments ? `<div class="filter-row">${picker}${segments}</div>` : "";
  const ack = metric === 1 && hasAck(readings);
  const anyUnassigned = readings.some((r) => !r.user_id);
  const head = `<th scope="col">${e(t("readings.when"))}</th><th scope="col" class="num">${e(metricTitle(metric))}</th><th scope="col">${e(t("readings.user"))}</th><th scope="col">${e(t("readings.scale"))}</th>${ack ? `<th scope="col">${e(t("readings.healthSync"))}</th>` : ""}${anyUnassigned ? `<th scope="col">${e(t("readings.actions"))}</th>` : ""}`;
  const body = readings
    .map(
      (r) =>
        `<tr data-reading-id="${e(r.id)}"${r.user_id ? "" : ' class="row-unassigned"'}><td>${readingTime(r)}</td><td class="num">${metricLabel(r, metric, unit)}</td><td>${r.user_id ? `<a class="link" href="/users/${e(r.user_id)}/overview">${e(r.user_name)}</a>` : badge(t("common.unassigned"), "warn")}</td><td>${e(r.scale_label)}</td>${ack ? `<td>${healthSyncStatus(r)}</td>` : ""}${
          anyUnassigned
            ? `<td>${
                r.user_id
                  ? '<span class="muted">—</span>'
                  : `<div class="actions">${users.length ? `<form class="inline-form" action="/readings/${e(r.id)}/assign" method="post">${hidden(csrf)}<label class="visually-hidden" for="assign-${e(r.id)}">${e(t("readings.assignTo"))}</label><select id="assign-${e(r.id)}" name="user_id" required><option value="">${e(t("readings.assignToPlaceholder"))}</option>${users.map((u) => option(u.id, u.name, "")).join("")}</select><button class="btn-sm">${e(t("common.assign"))}</button></form>` : ""}
      <form action="/readings/${e(r.id)}/delete" method="post" data-confirm="${e(t("readings.confirmDelete"))}">${hidden(csrf)}<button class="danger btn-sm">${e(t("common.delete"))}</button></form></div>`
              }</td>`
            : ""
        }</tr>`,
    )
    .join("");
  return `${pageHeader({ title: t("readings.title"), subtitle: t("readings.subtitle") })}
    ${filterRow}
    ${
      readings.length
        ? `<div class="table-wrap readings-table"><table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${pager(nav.newer, nav.older)}`
        : emptyState({ icon: "scale", title: t("readings.empty"), body: filter && filter.value !== "all" ? t("readings.emptyFilter") : t("readings.emptyHint") })
    }`;
}
export type UserReadingsNav = {
  flags?: Map<number, string>;
  outliersOnly?: boolean;
  newer?: string;
  older?: string;
};
export function userReadingsPage(
  user: Row,
  readings: Row[],
  unit: string,
  metrics: Metric[] = [METRICS[0]],
  metric = 1,
  nav: UserReadingsNav = {},
): string {
  const base = `/users/${n(user.id)}/readings`;
  const metricParam = metric === 1 ? null : metric;
  const picker = metricPicker(metrics, metric, "metric", nav.outliersOnly ? { outliers: 1 } : {});
  const chipRow = chip(pageHref(base, { metric: metricParam, outliers: nav.outliersOnly ? null : 1 }), t("readings.outliersOnly"), !!nav.outliersOnly);
  const ack = metric === 1 && hasAck(readings);
  const flags = nav.flags ?? new Map<number, string>();
  const body = readings
    .map((r) => {
      const flag = flags.get(Number(r.id));
      return `<tr data-reading-id="${e(r.id)}"${flag ? ' class="row-flagged"' : ""}><td>${readingTime(r)}</td><td class="num">${metricLabel(r, metric, unit)}${flag ? ` <span class="badge badge-warn" title="${e(t("readings.leftOut", { reason: flag }))}">${e(t("readings.outlier"))}</span>` : ""}</td><td>${e(r.scale_label)}</td><td>${e(r.attribution)}</td>${ack ? `<td>${healthSyncStatus(r)}</td>` : ""}</tr>`;
    })
    .join("");
  return `${pageHeader({ title: t("readings.rawTitle"), subtitle: t("readings.rawSubtitle", { name: String(user.name) }), back: { href: `/users/${n(user.id)}/overview`, text: String(user.name) } })}
    <div class="filter-row">${picker}${chipRow}</div>
    ${
      readings.length
        ? `<div class="table-wrap readings-table"><table class="table"><thead><tr><th scope="col">${e(t("readings.when"))}</th><th scope="col" class="num">${e(metricTitle(metric))}</th><th scope="col">${e(t("readings.scale"))}</th><th scope="col">${e(t("readings.attribution"))}</th>${ack ? `<th scope="col">${e(t("readings.healthSync"))}</th>` : ""}</tr></thead><tbody>${body}</tbody></table></div>${pager(nav.newer, nav.older)}`
        : emptyState({ icon: "scale", title: nav.outliersOnly ? t("readings.noFlagged") : t("readings.noneForUser") })
    }`;
}
function userFields(
  user: Row | null,
  scales: Row[],
  members: Set<number>,
): string {
  return `<div class="device-grid"><label>${e(t("users.name"))}<input name="name" value="${e(user?.name)}" required></label><label>${e(t("users.shortName"))}<input name="short_name" value="${e(user?.short_name)}" maxlength="3" required></label>
    <label>${e(t("users.heightCm"))}<input name="height_cm" type="number" step="1" value="${e(user?.height_cm)}" required></label>
    <label>${e(t("users.dob"))}<input name="birth_date" type="date" value="${e(user?.birth_date)}"></label>
    <label>${e(t("users.approxAge"))}<input name="age_years" type="number" step="0.1" value="${e(user?.age_years)}"></label>
    <label>${e(t("users.sex"))}<select name="sex">${option(0, t("common.male"), user?.sex ?? 0)}${option(1, t("common.female"), user?.sex ?? 0)}</select></label>
    <label>${e(t("users.recognitionWeight"))}<input name="reference_weight_kg" type="number" step="any" value="${e(user?.reference_weight_kg)}" title="${e(t("users.recognitionTitle"))}" required></label></div>
    <fieldset><legend>${e(t("users.scales"))}</legend><div class="check-list">${scales.map((s) => `<label><input type="checkbox" name="scales" value="${e(s.id)}"${members.has(s.id) ? " checked" : ""}> ${e(s.label)}</label>`).join("")}</div></fieldset>`;
}
export function usersPage(
  users: Row[],
  scales: Row[],
  memberships: Map<number, Set<number>>,
  csrf: string,
  preview?: {
    scale: Row;
    users: Row[];
    digest: string;
    settingsStatus: "available" | "configured" | "unavailable";
    settings?: {
      goff: number;
      dst: number;
      ngoff: number;
      featureMask: number;
      temperatureCode: number;
      weightCode: number;
      hasWeather: boolean;
    };
  },
  fetchMode?: "verified-tls" | "plaintext-http",
  importScaleId?: number,
): string {
  const actions = `<details class="menu"><summary class="btn btn-secondary">${e(t("users.import"))} ${icon("chevron-down", { size: 16 })}</summary><div class="menu-popover"><a href="/import/withings">${e(t("users.importZip"))}</a><button type="button" class="menu-item" data-open-dialog="import-users-dialog">${e(t("users.importAccount"))}</button></div></details><button type="button" class="btn btn-primary" data-open-dialog="add-user-dialog">${e(t("users.addPerson"))}</button>`;
  return `${pageHeader({ title: t("users.title"), subtitle: t("users.subtitle"), actionsHtml: actions })}
    ${
      preview
        ? `<dialog id="import-preview-dialog" data-auto-open><button class="dialog-close" type="button" data-close-dialog aria-label="${e(t("common.close"))}">×</button><h2>${e(t("users.importFrom", { scale: String(preview.scale.label) }))}</h2><p>${e(preview.settingsStatus === "configured" || scaleModel(preview.scale.model)?.classicGates ? t("users.settingsReady") : t("users.settingsIncomplete"))} ${e(t("users.existingRetained"))}</p>
      <form action="/users/import-withings/confirm" method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="scale_id" value="${e(preview.scale.id)}"><input type="hidden" name="capture_digest" value="${e(preview.digest)}">
      ${preview.users.length ? preview.users.map((u) => `<label><input type="checkbox" name="user_ids" value="${e(u.id)}" checked> ${e(u.fn || u.sn)} · ${e(u.sn)} · ID ${e(u.id)}</label>`).join("") : `<p>${e(t("users.allAlready"))}</p>`}
      <div class="dialog-actions"><button>${e(t("users.importSelected"))}</button><button type="button" class="secondary" data-close-dialog>${e(t("common.later"))}</button></div></form></dialog>`
        : ""
    }
    ${
      users.length
        ? `<section class="card users-card"><div class="table-wrap"><table class="table users-table"><thead><tr><th scope="col">${e(t("users.name"))}</th><th scope="col">${e(t("users.shortName"))}</th><th scope="col">${e(t("users.height"))}</th><th scope="col">${e(t("users.ageDob"))}</th><th scope="col">${e(t("users.sex"))}</th><th scope="col">${e(t("users.scales"))}</th><th scope="col">${e(t("users.status"))}</th><th scope="col"><span class="visually-hidden">${e(t("readings.actions"))}</span></th></tr></thead><tbody>
    ${users
      .map((u) => {
        const names = scales.filter((s) => memberships.get(u.id)?.has(s.id));
        return `<tr><td data-label="${e(t("users.name"))}"><a class="link" href="/users/${e(u.id)}/overview">${e(u.name)}</a></td><td data-label="${e(t("users.shortName"))}">${e(u.short_name)}</td><td data-label="${e(t("users.height"))}">${Math.round(n(u.height_cm))} cm</td><td data-label="${e(t("users.ageDob"))}">${e(dayText(u.birth_date) || u.age_years) || "—"}</td><td data-label="${e(t("users.sex"))}">${e(u.sex === 0 ? t("common.male") : t("common.female"))}</td>
      <td data-label="${e(t("users.scales"))}">${names.length ? `<span class="badge-list">${names.map((s) => badge(String(s.label))).join("")}</span>` : '<span class="muted">—</span>'}</td><td data-label="${e(t("users.status"))}">${u.active ? badge(t("common.active"), "good") : badge(t("common.retired"))}</td><td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-open-dialog="edit-user-${e(u.id)}" aria-label="${e(t("users.editName", { name: String(u.name) }))}">${icon("pencil", { size: 16 })}${e(t("common.edit"))}</button></td></tr>`;
      })
      .join("")}</tbody></table></div></section>`
        : emptyState({ icon: "scale", title: t("users.empty"), body: t("users.emptyHint") })
    }
    <dialog id="import-users-dialog"${importScaleId ? " data-auto-open" : ""}><button type="button" class="dialog-close" data-close-dialog aria-label="${e(t("common.close"))}">×</button><h2>${e(t("users.importWithings"))}</h2>
      <p>${e(t("users.importWithingsText"))}</p>
      ${fetchMode ? `<form action="/users/fetch-withings" method="post" class="form-stack">${hidden(csrf)}<label>${e(t("readings.scale"))}<select name="scale_id" required><option value="">${e(t("users.chooseScale"))}</option>${scales.map((s) => option(s.id, s.label, importScaleId ?? "")).join("")}</select></label><button>${e(t("users.fetch"))}</button></form>` : `<p>${e(t("users.importUnavailable"))}</p>`}</dialog>
    <dialog id="add-user-dialog"><button type="button" class="dialog-close" data-close-dialog aria-label="${e(t("common.close"))}">×</button><h2>${e(t("users.addPerson"))}</h2><form action="/users" method="post" class="form-stack">${hidden(csrf)}${userFields(null, scales, new Set())}<div class="dialog-actions"><button>${e(t("users.saveUser"))}</button></div></form></dialog>
    ${users
      .map(
        (
          u,
        ) => `<dialog id="edit-user-${e(u.id)}"><button type="button" class="dialog-close" data-close-dialog aria-label="${e(t("common.close"))}">×</button><h2>${e(t("users.edit", { name: String(u.name) }))}</h2>
      <form action="/users/${e(u.id)}" method="post" class="form-stack">${hidden(csrf)}${userFields(u, scales, memberships.get(u.id) ?? new Set())}<div class="dialog-actions"><button>${e(t("users.saveUser"))}</button></div></form>
      <div class="dialog-actions"><form action="/users/${e(u.id)}" method="post">${hidden(csrf)}<input type="hidden" name="purpose" value="retire"><button class="secondary">${e(t("users.retire"))}</button></form>
      <form action="/users/${e(u.id)}/delete" method="post" data-confirm="${e(t("users.confirmDelete"))}">${hidden(csrf)}<button class="danger">${e(t("users.delete"))}</button></form></div></dialog>`,
      )
      .join("")}`;
}

export function withingsImportPage(csrf: string): string {
  return `${pageHeader({ title: t("import.title"), subtitle: t("import.subtitle"), back: { href: "/users", text: t("nav.users") } })}
    <section class="card import-card"><p class="prose">${e(t("import.intro"))}</p>
    <form action="/import/withings" method="post" enctype="multipart/form-data" class="form-stack">${hidden(csrf)}<label class="dropzone">${icon("upload", { size: 32 })}<span class="dropzone-title">${e(t("import.dropTitle"))}</span><span class="hint">${e(t("import.dropHint"))}</span><input type="file" name="export" accept=".zip,application/zip" required></label><div class="form-actions"><button>${e(t("import.preview"))}</button></div></form></section>`;
}
export function withingsPreviewPage(
  csrf: string,
  id: string,
  meta: StageMeta,
  users: Row[],
  scales: Row[],
  suggestion: { id: number; reason: string } | null,
  scaleMatch: number | null,
): string {
  const day = (d: string) => dayText(d.slice(0, 10));
  const needs = !scales.length
    ? '<div class="callout callout-warn" role="alert">' + icon("alert-triangle", { size: 20 }) + '<div class="callout-body">' + e(t("import.needScale")) + ' <a href="/scales">' + e(t("import.goToScales")) + '</a></div></div>'
    : "";
  const name = meta.firstname.trim();
  const short = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const summary: [string, string][] = [
    [t("import.file"), meta.fileName],
    [t("import.weighIns"), t("import.weighInsValue", { count: meta.count, first: day(meta.first), last: day(meta.last), withComposition: meta.withComposition })],
    [t("import.latest"), t("import.latestValue", { last: meta.last })],
  ];
  if (meta.heightM) summary.push([t("import.heightInExport"), `${Math.round(meta.heightM * 100)} cm`]);
  if (meta.ignoredMetrics.length) summary.push([t("import.notImported"), t("import.notImportedValue", { metrics: meta.ignoredMetrics.join(", ") })]);
  return `${pageHeader({ title: t("import.reviewTitle"), subtitle: t("import.reviewSubtitle"), back: { href: "/import/withings", text: t("import.chooseAnother") } })}
    ${card({ title: t("import.summary"), bodyHtml: kv(summary) })}
    ${needs}
    ${
      scales.length
        ? `<form action="/import/withings/commit" method="post" class="form-stack import-form">${hidden(csrf)}<input type="hidden" name="import_id" value="${e(id)}">
    <section class="card form-stack"><h2 class="card-title">${e(t("import.whereItGoes"))}</h2><label>${e(t("import.assignToUser"))}<select name="user_id" required>${users.map((u) => option(u.id, `${u.name} (${u.short_name})`, suggestion?.id)).join("")}${option("new", t("import.createNew"), suggestion ? "" : "new")}</select></label>
    ${suggestion ? `<p class="hint">${e(t("import.suggested", { reason: suggestion.reason }))}</p>` : `<p class="hint">${e(t("import.noMatch"))}</p>`}
    <label>${e(t("import.attributeScale"))}<select name="scale_id" required>${scales.map((sc) => option(sc.id, `${sc.label}${sc.mac ? ` · ${sc.mac}` : ""}`, scaleMatch)).join("")}</select></label>
    <p class="hint">${e(scaleMatch ? t("import.scalePreselected") : t("import.scaleOnlyLabel"))}</p>
    <label>${e(t("import.timeZoneOf"))}${timeZoneSelect("time_zone", meta.zone)}</label>
    <p class="hint">${e(t("import.timeZoneHint", { zone: meta.zone }))}</p></section>
    <fieldset><legend>${e(t("import.newUserLegend"))}</legend><div class="device-grid"><label>${e(t("users.name"))}<input name="name" value="${e(name)}" maxlength="100"></label><label>${e(t("users.shortName"))}<input name="short_name" value="${e(short)}" maxlength="3"></label><label>${e(t("users.heightCm"))}<input name="height_cm" type="number" step="1" value="${meta.heightM ? Math.round(meta.heightM * 100) : ""}"></label><label>${e(t("users.dob"))}<input name="birth_date" type="date" value="${e(meta.birthDate)}"></label><label>${e(t("users.sex"))}<select name="sex">${option(0, t("common.male"), meta.sex)}${option(1, t("common.female"), meta.sex)}</select></label><label>${e(t("users.recognitionWeight"))}<input name="reference_weight_kg" type="number" step="any" value="${meta.latestKg ? e(meta.latestKg) : ""}"></label></div><p class="hint">${e(t("import.newUserHint"))}</p></fieldset>
    <label><input type="checkbox" name="confirmed" value="1" required> ${e(t("import.reviewed"))}</label>
    <p class="hint">${e(t("import.safeTwice"))}</p>
    <div class="form-actions"><button>${e(t("import.run", { count: meta.count }))}</button><a class="btn btn-ghost" href="/import/withings">${e(t("common.cancel"))}</a></div></form>`
        : ""
    }`;
}
