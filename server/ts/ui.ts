/** Small server-rendered views shared by the Worker and local Node entrypoint. */
import { scaleModel } from "./models.ts";
import { METRICS, storedMeasures, type Metric } from "./metrics.ts";
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
export const timeLabel = (value: unknown): string => {
  const date = new Date(n(value) * 1000);
  return Number.isFinite(date.valueOf()) && n(value) > 0
    ? e(
        new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date),
      )
    : "Unknown";
};
const KG_TO_LB = 2.2046226218487757;
function kgText(kg: number, unit: string): string {
  if (unit === "lb") return `${(kg * KG_TO_LB).toFixed(1)} lb`;
  if (unit === "st") {
    const tenths = Math.round(kg * KG_TO_LB * 10);
    return `${Math.floor(tenths / 140)} st ${((tenths % 140) / 10).toFixed(1)} lb`;
  }
  return `${kg.toFixed(2)} kg`;
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
  return `<form method="get" class="metric-picker">${preserved}<label>Measurement<select name="${e(name)}" data-submit-on-change>${metrics.map((m) => option(m.type, m.label, selected)).join("")}</select></label><button class="secondary no-js-only" type="submit">Show</button></form>`;
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
          : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(m.value * 10 ** m.unit)}${metric.unit === "index" ? "" : ` ${e(metric.unit)}`}`;
      return matches.length > 1
        ? `${value} (Position ${e(m.position ?? "Unspecified")})`
        : value;
    })
    .join("; ");
}
function metricTitle(type: number): string {
  return METRICS.find((m) => m.type === type)?.label ?? "Weight";
}
export type LayoutOpts = {
  users?: { id: number; name: string }[];
  unassigned?: number;
  theme?: "light" | "dark" | null;
  entries?: ("app" | "charts")[];
  /** Current path + query, used as the `back` target of the footer theme links. */
  back?: string;
};
const SECONDARY_LINKS: [string, string][] = [
  ["/users", "Users"],
  ["/scales", "Scales"],
  ["/sync", "Sync"],
  ["/settings", "Settings"],
  ["/firmware", "Firmware"],
];
function themeSwitch(current: "light" | "dark" | null, back: string): string {
  const item = (value: string, label: string, on: boolean) =>
    `<a href="/theme?set=${value}&amp;back=${encodeURIComponent(back)}" data-theme-set="${value}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="segmented" aria-label="Theme">${item("system", "System", !current)}${item("light", "Light", current === "light")}${item("dark", "Dark", current === "dark")}</nav>`;
}
function navMarkup(csrf: string, active: string, opts: LayoutOpts): string {
  const link = (url: string, label: string, extra = "") =>
    `<a class="nav-link" href="${url}"${active === url ? ' aria-current="page"' : ""}>${label}${extra}</a>`;
  const badge = opts.unassigned && opts.unassigned > 0 ? ` <span class="badge badge-warn" title="Unassigned readings">${e(opts.unassigned)}<span class="visually-hidden"> unassigned</span></span>` : "";
  const users = opts.users ?? [];
  const people = users.length >= 2
    ? `<details class="nav-dropdown"><summary class="nav-link"${active.startsWith("/users/") ? ' aria-current="page"' : ""}>People ${icon("chevron-down", { size: 14 })}</summary><div class="nav-popover">${users.map((u) => `<a href="/users/${e(u.id)}/overview">${e(u.name)}</a>`).join("")}</div></details>`
    : users.length === 1
      ? `<a class="nav-link" href="/users/${e(users[0].id)}/overview"${active.startsWith("/users/") ? ' aria-current="page"' : ""}>Overview</a>`
      : "";
  const sheetPeople = users.length >= 2
    ? `<p class="nav-sheet-heading">People</p>${users.map((u) => `<a class="nav-link" href="/users/${e(u.id)}/overview">${e(u.name)}</a>`).join("")}`
    : users.length === 1
      ? `<a class="nav-link" href="/users/${e(users[0].id)}/overview">Overview</a>`
      : "";
  const signOut = (cls: string) => `<form action="/logout" method="post" class="${cls}">${hidden(csrf)}<button class="btn btn-ghost btn-sm" type="submit">Sign out</button></form>`;
  const brand = `<a class="brand" href="/" aria-label="YourOwnWeigh"><img src="/favicon.png" width="28" height="28" alt=""><strong class="brand-full">YourOwnWeigh</strong><strong class="brand-short">YOW</strong></a>`;
  return `<nav class="app-nav" aria-label="Main"><div class="app-nav-inner">${brand}<div class="nav-links">${link("/", "Dashboard")}${people}${link("/readings", "Readings", badge)}<span class="nav-sep" aria-hidden="true">·</span>${SECONDARY_LINKS.map(([u, l]) => link(u, l)).join("")}</div>${signOut("nav-signout")}<details class="nav-menu"><summary class="btn btn-ghost btn-icon" aria-label="Menu">${icon("menu", { size: 20 })}</summary><div class="nav-sheet">${link("/", "Dashboard")}${sheetPeople}${link("/readings", "Readings", badge)}<hr>${SECONDARY_LINKS.map(([u, l]) => link(u, l)).join("")}<hr>${signOut("nav-sheet-signout")}</div></details></div></nav>`;
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
  const back = opts.back && opts.back.startsWith("/") && !opts.back.startsWith("//") ? opts.back : "/";
  const nav = loggedIn
    ? navMarkup(csrf, active, opts)
    : `<nav class="app-nav" aria-label="Main"><div class="app-nav-inner"><a class="brand" href="/" aria-label="YourOwnWeigh"><img src="/favicon.png" width="28" height="28" alt=""><strong class="brand-full">YourOwnWeigh</strong><strong class="brand-short">YOW</strong></a></div></nav>`;
  const flash = notice
    ? `<div class="flash-wrap"><div class="flash callout callout-info" role="status">${icon("info", { size: 20 })}<div>${e(notice)}</div><button type="button" class="btn btn-ghost btn-icon btn-sm flash-dismiss" data-dismiss aria-label="Dismiss notice">${icon("x", { size: 16 })}</button></div></div>`
    : "";
  return `<!doctype html><html lang="en"${opts.theme ? ` data-theme="${opts.theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${e(title)} · YourOwnWeigh</title><link rel="icon" href="/favicon.png" type="image/png">
    <meta name="csrf-token" content="${e(csrf)}"><script src="/app.js?v=${WEB_APP_VERSION}" defer></script>${assetTags(opts.entries ?? ["app"])}</head><body>
    ${nav}
    ${flash}<main>${body}</main><footer class="site-footer"><span>YourOwnWeigh · Web App v${e(WEB_APP_VERSION)}</span><a class="link link-quiet" href="https://github.com/TomAnthony/YourOwnWeigh" target="_blank" rel="noopener noreferrer">GitHub</a>${themeSwitch(opts.theme ?? null, back)}</footer></body></html>`;
}
const authShell = (inner: string): string =>
  `<div class="auth-page"><div class="auth-brand"><img src="/favicon.png" width="48" height="48" alt=""><strong>YourOwnWeigh</strong></div><section class="card auth-card">${inner}</section></div>`;
export function setupPage(
  csrf: string,
  bootstrapRequired = false,
  unlocked = false,
): string {
  if (bootstrapRequired && !unlocked)
    return authShell(`<h1 class="auth-title">Welcome to YourOwnWeigh</h1><p class="auth-lead">Enter the bootstrap token shown by the setup command.</p><form method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="step" value="bootstrap"><label>Bootstrap token<input name="bootstrap_token" type="password" required autocomplete="off"></label><button>Continue</button></form>`);
  return authShell(`<h1 class="auth-title">Set your password</h1><p class="auth-lead">Protect your dashboard and Sync API. Passwords must contain at least eight characters.</p><form method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="step" value="password"><label>Admin password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm admin password<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label>
    <label><input type="checkbox" name="separate_sync" value="1" data-toggle="setup-sync-fields"> Set an alternative password for the Sync API</label><div id="setup-sync-fields" class="form-stack" hidden><label>Sync API password<input name="sync_password" type="password" minlength="8" autocomplete="new-password"></label><label>Confirm Sync API password<input name="sync_confirm" type="password" minlength="8" autocomplete="new-password"></label></div><button>Create household</button></form>`);
}
export function loginPage(csrf: string): string {
  return authShell(`<h1 class="auth-title">Sign in</h1><form method="post" class="form-stack">${hidden(csrf)}<label>Admin password<input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form>`);
}

/** `/path?a=1&b=2`, skipping empty values. Used for the filter and pagination links. */
export function pageHref(path: string, params: Record<string, string | number | null | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}
const dateOnly = (value: unknown): string =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(n(value) * 1000));
const clockOnly = (value: unknown): string =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(n(value) * 1000));
function readingTime(row: Row): string {
  const trusted = row.time_quality === "trusted";
  const at = trusted ? row.meastime : row.first_received_at;
  if (!(n(at) > 0)) return "Unknown";
  return `<span class="when"><span class="when-date">${e(dateOnly(at))}</span> <span class="when-time">${e(clockOnly(at))}</span></span>${trusted ? "" : '<span class="hint">Received Time; Device Date Unverified</span>'}`;
}
function healthSyncStatus(row: Row): string {
  if (!row.user_id || row.weight_value == null)
    return '<span class="muted">—</span>';
  const acknowledgedAt = Number(row.health_sync_acknowledged_at);
  if (!Number.isFinite(acknowledgedAt) || acknowledgedAt <= 0)
    return '<span class="muted">Not Acknowledged</span>';
  return `<span class="badge">Acknowledged</span><time class="hint" datetime="${new Date(acknowledgedAt * 1000).toISOString()}">${timeLabel(acknowledgedAt)}</time>`;
}
const hasAck = (rows: Row[]): boolean => rows.some((r) => r.user_id && n(r.health_sync_acknowledged_at) > 0);

function pager(newer?: string, older?: string): string {
  if (!newer && !older) return "";
  const item = (href: string | undefined, text: string, rel: string, lead: string, trail: string) =>
    href
      ? `<a class="btn btn-secondary btn-sm" rel="${rel}" href="${e(href)}">${lead}${text}${trail}</a>`
      : `<span class="btn btn-secondary btn-sm" aria-disabled="true">${lead}${text}${trail}</span>`;
  return `<nav class="pager" aria-label="Pagination">${item(newer, "Newer", "prev", icon("chevron-left", { size: 16 }), "")}${item(older, "Older", "next", "", icon("chevron-right", { size: 16 }))}</nav>`;
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
        "Show readings of",
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
  const head = `<th scope="col">When</th><th scope="col" class="num">${e(metricTitle(metric))}</th><th scope="col">User</th><th scope="col">Scale</th>${ack ? '<th scope="col">Health Sync</th>' : ""}${anyUnassigned ? '<th scope="col">Actions</th>' : ""}`;
  const body = readings
    .map(
      (r) =>
        `<tr data-reading-id="${e(r.id)}"${r.user_id ? "" : ' class="row-unassigned"'}><td>${readingTime(r)}</td><td class="num">${metricLabel(r, metric, unit)}</td><td>${r.user_id ? `<a class="link" href="/users/${e(r.user_id)}/overview">${e(r.user_name)}</a>` : badge("Unassigned", "warn")}</td><td>${e(r.scale_label)}</td>${ack ? `<td>${healthSyncStatus(r)}</td>` : ""}${
          anyUnassigned
            ? `<td>${
                r.user_id
                  ? '<span class="muted">—</span>'
                  : `<div class="actions">${users.length ? `<form class="inline-form" action="/readings/${e(r.id)}/assign" method="post">${hidden(csrf)}<label class="visually-hidden" for="assign-${e(r.id)}">Assign to</label><select id="assign-${e(r.id)}" name="user_id" required><option value="">Assign to…</option>${users.map((u) => option(u.id, u.name, "")).join("")}</select><button class="btn-sm">Assign</button></form>` : ""}
      <form action="/readings/${e(r.id)}/delete" method="post" data-confirm="Delete this unassigned reading permanently?">${hidden(csrf)}<button class="danger btn-sm">Delete</button></form></div>`
              }</td>`
            : ""
        }</tr>`,
    )
    .join("");
  return `${pageHeader({ title: "Readings", subtitle: "All weigh-ins across the household" })}
    ${filterRow}
    ${
      readings.length
        ? `<div class="table-wrap readings-table"><table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${pager(nav.newer, nav.older)}`
        : emptyState({ icon: "scale", title: "No readings here", body: filter && filter.value !== "all" ? "Nothing matches this filter." : "Readings appear after a scale syncs." })
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
  const chipRow = chip(pageHref(base, { metric: metricParam, outliers: nav.outliersOnly ? null : 1 }), "Outliers only", !!nav.outliersOnly);
  const ack = metric === 1 && hasAck(readings);
  const flags = nav.flags ?? new Map<number, string>();
  const body = readings
    .map((r) => {
      const flag = flags.get(Number(r.id));
      return `<tr data-reading-id="${e(r.id)}"${flag ? ' class="row-flagged"' : ""}><td>${readingTime(r)}</td><td class="num">${metricLabel(r, metric, unit)}${flag ? ` <span class="badge badge-warn" title="Left out of the trend (${e(flag)})">Outlier</span>` : ""}</td><td>${e(r.scale_label)}</td><td>${e(r.attribution)}</td>${ack ? `<td>${healthSyncStatus(r)}</td>` : ""}</tr>`;
    })
    .join("");
  return `${pageHeader({ title: "Raw readings", subtitle: `Every stored reading for ${user.name}`, back: { href: `/users/${n(user.id)}/overview`, text: String(user.name) } })}
    <div class="filter-row">${picker}${chipRow}</div>
    ${
      readings.length
        ? `<div class="table-wrap readings-table"><table class="table"><thead><tr><th scope="col">When</th><th scope="col" class="num">${e(metricTitle(metric))}</th><th scope="col">Scale</th><th scope="col">Attribution</th>${ack ? '<th scope="col">Health Sync</th>' : ""}</tr></thead><tbody>${body}</tbody></table></div>${pager(nav.newer, nav.older)}`
        : emptyState({ icon: "scale", title: nav.outliersOnly ? "No flagged readings" : "No readings recorded for this user" })
    }`;
}
function userFields(
  user: Row | null,
  scales: Row[],
  members: Set<number>,
): string {
  return `<div class="device-grid"><label>Name<input name="name" value="${e(user?.name)}" required></label><label>Short name<input name="short_name" value="${e(user?.short_name)}" maxlength="3" required></label>
    <label>Height (cm)<input name="height_cm" type="number" step="1" value="${e(user?.height_cm)}" required></label>
    <label>Date of birth<input name="birth_date" type="date" value="${e(user?.birth_date)}"></label>
    <label>Approximate age (if DOB unknown)<input name="age_years" type="number" step="0.1" value="${e(user?.age_years)}"></label>
    <label>Sex<select name="sex">${option(0, "Male", user?.sex ?? 0)}${option(1, "Female", user?.sex ?? 0)}</select></label>
    <label>Recognition weight (kg)<input name="reference_weight_kg" type="number" step="any" value="${e(user?.reference_weight_kg)}" title="Updated from the latest assigned weigh-in and sent on the scale’s next Wi-Fi sync." required></label></div>
    <fieldset><legend>Scales</legend><div class="check-list">${scales.map((s) => `<label><input type="checkbox" name="scales" value="${e(s.id)}"${members.has(s.id) ? " checked" : ""}> ${e(s.label)}</label>`).join("")}</div></fieldset>`;
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
  const actions = `<details class="menu"><summary class="btn btn-secondary">Import ${icon("chevron-down", { size: 16 })}</summary><div class="menu-popover"><a href="/import/withings">From a Withings data export (ZIP)</a><button type="button" class="menu-item" data-open-dialog="import-users-dialog">From a Withings account (via scale)</button></div></details><button type="button" class="btn btn-primary" data-open-dialog="add-user-dialog">Add person</button>`;
  return `${pageHeader({ title: "Users", subtitle: "People who weigh in on your scales", actionsHtml: actions })}
    ${
      preview
        ? `<dialog id="import-preview-dialog" data-auto-open><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button><h2>Import users from ${e(preview.scale.label)}</h2><p>${preview.settingsStatus === "configured" || scaleModel(preview.scale.model)?.classicGates ? "Device settings are ready." : "Device settings import is incomplete; use Finish Device Import on Scales to retry."} Existing users are retained.</p>
      <form action="/users/import-withings/confirm" method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="scale_id" value="${e(preview.scale.id)}"><input type="hidden" name="capture_digest" value="${e(preview.digest)}">
      ${preview.users.length ? preview.users.map((u) => `<label><input type="checkbox" name="user_ids" value="${e(u.id)}" checked> ${e(u.fn || u.sn)} · ${e(u.sn)} · ID ${e(u.id)}</label>`).join("") : "<p>All users are already in this household.</p>"}
      <div class="dialog-actions"><button>Import selected users</button><button type="button" class="secondary" data-close-dialog>Later</button></div></form></dialog>`
        : ""
    }
    ${
      users.length
        ? `<section class="card users-card"><div class="table-wrap"><table class="table users-table"><thead><tr><th scope="col">Name</th><th scope="col">Short name</th><th scope="col">Height</th><th scope="col">Age / DOB</th><th scope="col">Sex</th><th scope="col">Scales</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
    ${users
      .map((u) => {
        const names = scales.filter((s) => memberships.get(u.id)?.has(s.id));
        return `<tr><td data-label="Name"><a class="link" href="/users/${e(u.id)}/overview">${e(u.name)}</a></td><td data-label="Short name">${e(u.short_name)}</td><td data-label="Height">${Math.round(n(u.height_cm))} cm</td><td data-label="Age / DOB">${e(u.birth_date || u.age_years) || "—"}</td><td data-label="Sex">${u.sex === 0 ? "Male" : "Female"}</td>
      <td data-label="Scales">${names.length ? `<span class="badge-list">${names.map((s) => badge(String(s.label))).join("")}</span>` : '<span class="muted">—</span>'}</td><td data-label="Status">${u.active ? badge("Active", "good") : badge("Retired")}</td><td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-open-dialog="edit-user-${e(u.id)}" aria-label="Edit ${e(u.name)}">${icon("pencil", { size: 16 })}Edit</button></td></tr>`;
      })
      .join("")}</tbody></table></div></section>`
        : emptyState({ icon: "scale", title: "No users have been added yet", body: "Add the first person to start assigning readings." })
    }
    <dialog id="import-users-dialog"${importScaleId ? " data-auto-open" : ""}><button type="button" class="dialog-close" data-close-dialog aria-label="Close">×</button><h2>Import from Withings</h2>
      <p>Read the selected scale’s existing users and settings over verified HTTPS. New users are shown for selection; existing local users are preserved.</p>
      ${fetchMode ? `<form action="/users/fetch-withings" method="post" class="form-stack">${hidden(csrf)}<label>Scale<select name="scale_id" required><option value="">Choose scale</option>${scales.map((s) => option(s.id, s.label, importScaleId ?? "")).join("")}</select></label><button>Fetch from Withings</button></form>` : "<p>Withings import is unavailable on this server.</p>"}</dialog>
    <dialog id="add-user-dialog"><button type="button" class="dialog-close" data-close-dialog aria-label="Close">×</button><h2>Add person</h2><form action="/users" method="post" class="form-stack">${hidden(csrf)}${userFields(null, scales, new Set())}<div class="dialog-actions"><button>Save user</button></div></form></dialog>
    ${users
      .map(
        (
          u,
        ) => `<dialog id="edit-user-${e(u.id)}"><button type="button" class="dialog-close" data-close-dialog aria-label="Close">×</button><h2>Edit ${e(u.name)}</h2>
      <form action="/users/${e(u.id)}" method="post" class="form-stack">${hidden(csrf)}${userFields(u, scales, memberships.get(u.id) ?? new Set())}<div class="dialog-actions"><button>Save user</button></div></form>
      <div class="dialog-actions"><form action="/users/${e(u.id)}" method="post">${hidden(csrf)}<input type="hidden" name="purpose" value="retire"><button class="secondary">Retire user</button></form>
      <form action="/users/${e(u.id)}/delete" method="post" data-confirm="Delete this user locally? Their readings will become unassigned.">${hidden(csrf)}<button class="danger">Delete user</button></form></div></dialog>`,
      )
      .join("")}`;
}

export function withingsImportPage(csrf: string): string {
  return `${pageHeader({ title: "Import Withings data export", subtitle: "Bring your history over from a Withings ZIP export", back: { href: "/users", text: "Users" } })}
    <section class="card import-card"><p class="prose">Upload the ZIP you get from Withings (Health Mate app: Settings → Account → Download your data, or account.withings.com). Weight, fat, bone, muscle and water measurements are imported; nothing is changed until you have reviewed the preview. Steps, sleep, heart rate and location data in the export are ignored.</p>
    <form action="/import/withings" method="post" enctype="multipart/form-data" class="form-stack">${hidden(csrf)}<label class="dropzone">${icon("upload", { size: 32 })}<span class="dropzone-title">Choose the ZIP from Withings or drop it here</span><span class="hint">Export ZIP, up to the size your server allows</span><input type="file" name="export" accept=".zip,application/zip" required></label><div class="form-actions"><button>Preview import</button></div></form></section>`;
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
  const day = (d: string) => d.slice(0, 10);
  const needs = !scales.length
    ? '<div class="callout callout-warn" role="alert">' + icon("alert-triangle", { size: 20 }) + '<div class="callout-body">Add a scale first; every reading belongs to a scale. <a href="/scales">Go to Scales</a></div></div>'
    : "";
  const name = meta.firstname.trim();
  const short = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const summary: [string, string][] = [
    ["File", meta.fileName],
    ["Weigh-ins", `${meta.count} (${day(meta.first)} to ${day(meta.last)}), ${meta.withComposition} with body composition`],
    ["Latest", `${meta.last} (local time in the export)`],
  ];
  if (meta.heightM) summary.push(["Height in export", `${Math.round(meta.heightM * 100)} cm`]);
  if (meta.ignoredMetrics.length) summary.push(["Not imported", `${meta.ignoredMetrics.join(", ")} (no matching YOW metric)`]);
  return `${pageHeader({ title: "Review Withings import", subtitle: "Check the details before anything is saved", back: { href: "/import/withings", text: "Choose another file" } })}
    ${card({ title: "Summary", bodyHtml: kv(summary) })}
    ${needs}
    ${
      scales.length
        ? `<form action="/import/withings/commit" method="post" class="form-stack import-form">${hidden(csrf)}<input type="hidden" name="import_id" value="${e(id)}">
    <section class="card form-stack"><h2 class="card-title">Where it goes</h2><label>Assign to user<select name="user_id" required>${users.map((u) => option(u.id, `${u.name} (${u.short_name})`, suggestion?.id)).join("")}${option("new", "Create new user from export", suggestion ? "" : "new")}</select></label>
    ${suggestion ? `<p class="hint">Suggested from the ${e(suggestion.reason)}. Check this before importing.</p>` : '<p class="hint">No existing user matched the name in the export, so a new one is proposed below.</p>'}
    <label>Attribute to scale<select name="scale_id" required>${scales.map((sc) => option(sc.id, `${sc.label}${sc.mac ? ` · ${sc.mac}` : ""}`, scaleMatch)).join("")}</select></label>
    <p class="hint">${scaleMatch ? "Preselected: its address matches the device in the export." : "Only used to label the imported readings."}</p>
    <label>Time zone of the export times${timeZoneSelect("time_zone", meta.zone)}</label>
    <p class="hint">Withings writes local times. Using the device's time zone (${e(meta.zone)}) keeps morning weigh-ins in the morning.</p></section>
    <fieldset><legend>New user (only used when “Create new user” is chosen)</legend><div class="device-grid"><label>Name<input name="name" value="${e(name)}" maxlength="100"></label><label>Short name<input name="short_name" value="${e(short)}" maxlength="3"></label><label>Height (cm)<input name="height_cm" type="number" step="1" value="${meta.heightM ? Math.round(meta.heightM * 100) : ""}"></label><label>Date of birth<input name="birth_date" type="date" value="${e(meta.birthDate)}"></label><label>Sex<select name="sex">${option(0, "Male", meta.sex)}${option(1, "Female", meta.sex)}</select></label><label>Recognition weight (kg)<input name="reference_weight_kg" type="number" step="any" value="${meta.latestKg ? e(meta.latestKg) : ""}"></label></div><p class="hint">The new user is not added to any scale; enable that under Users when you want the scale to recognise them.</p></fieldset>
    <label><input type="checkbox" name="confirmed" value="1" required> I have reviewed this import</label>
    <p class="hint">Weigh-ins already stored for this user within three minutes are skipped, so importing twice is safe.</p>
    <div class="form-actions"><button>Import ${meta.count} weigh-ins</button><a class="btn btn-ghost" href="/import/withings">Cancel</a></div></form>`
        : ""
    }`;
}
