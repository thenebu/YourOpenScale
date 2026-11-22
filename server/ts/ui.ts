/** Small server-rendered views shared by the Worker and local Node entrypoint. */
import { scaleModel } from "./models.ts";
import { METRICS, storedMeasures, type Metric } from "./metrics.ts";
import { barChart, lineChart, sparkline, stats, type Point } from "./charts.ts";
import { MORNING, clock, type Habits } from "./habits.ts";
import type { StageMeta } from "./withings_import.ts";
import { timeZoneSelect } from "./integrated_ui.ts";
import { WEB_APP_VERSION } from "./version.ts";
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
  selections: Record<string, number> = {},
): string {
  if (metrics.length < 2) return "";
  const preserved = Object.entries(selections)
    .filter(([key]) => key !== name)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${e(key)}" value="${e(value)}">`,
    )
    .join("");
  return `<form method="get" class="metric-picker">${preserved}<label>Measurement<select name="${e(name)}" data-submit-on-change>${metrics.map((m) => option(m.type, m.label, selected)).join("")}</select></label><button class="secondary" type="submit">Show</button></form>`;
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
export function layout(
  title: string,
  body: string,
  csrf: string,
  loggedIn: boolean,
  notice = "",
  active = "",
): string {
  const links = [
    ["/", "Dashboard"],
    ["/readings", "Readings"],
    ["/scales", "Scales"],
    ["/users", "Users"],
    ["/sync", "Sync"],
    ["/settings", "Settings"],
    ["/firmware", "Firmware Bridge"],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${e(title)} · YourOwnWeigh</title><link rel="icon" href="/favicon.png" type="image/png">
    <meta name="csrf-token" content="${e(csrf)}"><link rel="stylesheet" href="/app.css?v=${WEB_APP_VERSION}"><script src="/app.js?v=${WEB_APP_VERSION}" defer></script></head><body>
    <nav><a class="brand" href="/" aria-label="YourOwnWeigh"><img src="/favicon.png" width="36" height="36" alt=""><strong>YOW</strong></a>${
      loggedIn
        ? links
            .map(
              ([url, label]) =>
                `<a href="${url}"${active === url ? ' aria-current="page"' : ""}>${label}</a>`,
            )
            .join("") +
          `<form action="/logout" method="post">${hidden(csrf)}<button>Sign Out</button></form>`
        : ""
    }</nav>
    ${notice ? `<p class="flash" role="status">${e(notice)}</p>` : ""}<main>${body}</main><footer class="site-footer"><span>YourOwnWeigh · Web App v${e(WEB_APP_VERSION)}</span><a href="https://github.com/TomAnthony/YourOwnWeigh" target="_blank" rel="noopener noreferrer">GitHub</a></footer></body></html>`;
}
export function setupPage(
  csrf: string,
  bootstrapRequired = false,
  unlocked = false,
): string {
  if (bootstrapRequired && !unlocked)
    return `<section><h1>Welcome To YourOwnWeigh</h1><p>Enter the bootstrap token shown by the setup command.</p><form method="post">${hidden(csrf)}<input type="hidden" name="step" value="bootstrap"><label>Bootstrap Token<input name="bootstrap_token" type="password" required autocomplete="off"></label><button>Continue</button></form></section>`;
  return `<section><h1>Set Your Password</h1><p>Protect your dashboard and Sync API. Passwords must contain at least eight characters.</p><form method="post">${hidden(csrf)}<input type="hidden" name="step" value="password"><label>Admin Password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm Admin Password<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label>
    <label><input type="checkbox" name="separate_sync" value="1" data-toggle="setup-sync-fields"> Set Alternative Password For Sync API</label><div id="setup-sync-fields" hidden><label>Sync API Password<input name="sync_password" type="password" minlength="8" autocomplete="new-password"></label><label>Confirm Sync API Password<input name="sync_confirm" type="password" minlength="8" autocomplete="new-password"></label></div><button>Create Household</button></form></section>`;
}
export function loginPage(csrf: string): string {
  return `<section><h1>Sign In</h1><form method="post">${hidden(csrf)}<label>Admin Password<input name="password" type="password" required></label><button>Sign In</button></form></section>`;
}
function readingTime(row: Row): string {
  const trusted = row.time_quality === "trusted";
  return `${timeLabel(trusted ? row.meastime : row.first_received_at)}${trusted ? "" : '<span class="hint">Received Time; Device Date Unverified</span>'}`;
}
function healthSyncStatus(row: Row): string {
  if (!row.user_id || row.weight_value == null)
    return '<span class="muted">—</span>';
  const acknowledgedAt = Number(row.health_sync_acknowledged_at);
  if (!Number.isFinite(acknowledgedAt) || acknowledgedAt <= 0)
    return '<span class="muted">Not Acknowledged</span>';
  return `<span class="badge">Acknowledged</span><time class="hint" datetime="${new Date(acknowledgedAt * 1000).toISOString()}">${timeLabel(acknowledgedAt)}</time>`;
}
/** Metrics shown as overview tiles on the dashboard (when they have values in
 * range); the rest live on the user page. */
export const DASHBOARD_METRICS: readonly number[] = [1, 6, 8, 76, 77, 88, 11];
export const RANGES = [
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "all", label: "All", days: 0 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const signed = (value: number, suffix: string) =>
  `${value < 0 ? "−" : "+"}${number.format(Math.abs(Math.round(value * 100) / 100))}${suffix}`;
/** Plot scale and plain-text formatters for a metric in the chosen weight unit. */
function plotFor(type: number, unit: string) {
  const metric = METRICS.find((m) => m.type === type)!;
  if (metric.unit === "kg") {
    // Stones are plotted as decimal stones; text and deltas stay in st/lb.
    const scale = unit === "lb" ? KG_TO_LB : unit === "st" ? KG_TO_LB / 14 : 1;
    const deltaUnit = unit === "kg" ? "kg" : "lb";
    return {
      scale,
      unit: unit === "st" ? "st" : unit,
      text: (v: number) => kgText(v / scale, unit),
      axis: (v: number) => number.format(v),
      delta: (v: number) =>
        signed((v / scale) * (unit === "kg" ? 1 : KG_TO_LB), ` ${deltaUnit}`),
    };
  }
  const suffix = metric.unit === "index" ? "" : ` ${metric.unit}`;
  return {
    scale: 1,
    unit: metric.unit === "index" ? "" : metric.unit,
    text: (v: number) => `${number.format(v)}${suffix}`,
    axis: (v: number) => number.format(v),
    delta: (v: number) => signed(v, suffix),
  };
}
const scalePoints = (points: Point[], scale: number) =>
  scale === 1 ? points : points.map((p) => ({ t: p.t, v: p.v * scale }));
type DashboardCard = {
  user: Row;
  readings: Row[];
  metrics?: Metric[];
  metric?: number;
  range?: RangeKey;
  /** Raw (native unit, oldest first) series for each observed metric in range. */
  series?: Record<number, Point[]>;
  from?: number;
  to?: number;
};
function dashboardCard(
  card: DashboardCard,
  unit: string,
  href: (user: number, change: Record<string, string>) => string,
): string {
  const {
    user,
    readings,
    metrics = [METRICS[0]],
    metric = 1,
    range = "90d",
    series = {},
    from = 0,
    to = 1,
  } = card;
  const rangeInfo = RANGES.find((r) => r.key === range)!;
  const plot = plotFor(metric, unit);
  const raw = series[metric] ?? [];
  const points = scalePoints(raw, plot.scale);
  const s = stats(points);
  const heading = metricTitle(metric);
  const rangeSwitch = `<div class="range-switch" role="group" aria-label="Time range">${RANGES.map(
    (r) =>
      `<a href="${e(href(user.id, { [`range_${user.id}`]: r.key }))}"${r.key === range ? ' aria-current="true"' : ""}>${r.label}</a>`,
  ).join("")}</div>`;
  const chart = points.length
    ? lineChart(points, {
        from,
        to,
        label: `${heading} over ${rangeInfo.days ? `the last ${rangeInfo.label}` : "all time"}`,
        text: plot.text,
        axis: plot.axis,
      })
    : `<p class="empty">No ${e(heading)} readings in this range.</p>`;
  const summary = s
    ? `<dl class="chart-stats">${points.length > 1 ? `<div><dt>Change</dt><dd>${e(plot.delta(s.last - s.first))}</dd></div>` : ""}<div><dt>Average</dt><dd>${e(plot.text(s.avg))}</dd></div><div><dt>Min</dt><dd>${e(plot.text(s.min))}</dd></div><div><dt>Max</dt><dd>${e(plot.text(s.max))}</dd></div></dl>`
    : "";
  const tiles: string[] = metrics
    .filter(
      (m) =>
        DASHBOARD_METRICS.includes(m.type) &&
        (m.type === 1 || (series[m.type]?.length ?? 0) > 0),
    )
    .map((m) => {
      const p = plotFor(m.type, unit);
      const pts = scalePoints(series[m.type] ?? [], p.scale);
      const st = stats(pts);
      return `<a class="tile" href="${e(href(user.id, { [`metric_${user.id}`]: String(m.type) }))}"${m.type === metric ? ' aria-current="true"' : ""}><span class="tile-label">${e(m.label)}</span><strong class="tile-value">${st ? e(p.text(st.last)) : "—"}</strong><span class="tile-delta">${st && pts.length > 1 ? e(p.delta(st.last - st.first)) : "&nbsp;"}</span>${sparkline(pts, from, to)}</a>`;
    });
  const height = n(user.height_cm) / 100;
  const weights = series[1] ?? [];
  if (height > 0 && weights.length) {
    const bmi = weights.map((p) => ({ t: p.t, v: p.v / (height * height) }));
    const st = stats(bmi)!;
    tiles.push(
      `<div class="tile static"><span class="tile-label">BMI</span><strong class="tile-value">${number.format(Math.round(st.last * 10) / 10)}</strong><span class="tile-delta">${bmi.length > 1 ? e(signed(st.last - st.first, "")) : "&nbsp;"}</span>${sparkline(bmi, from, to)}</div>`,
    );
  }
  return `<section class="card" id="user-${e(user.id)}"><div class="section-heading"><div>
    <h2><a href="/users/${e(user.id)}/readings">${e(user.name)}</a></h2></div><a href="/users/${e(user.id)}/overview">Details →</a></div>
    ${
      readings.length
        ? `<p class="metric">${metricLabel(readings[0], metric, unit)}</p>${rangeSwitch}<h3>${e(heading)}${plot.unit ? ` <span class="hint">${e(plot.unit)}</span>` : ""}</h3>${chart}${summary}
    <div class="tiles">${tiles.join("")}</div>
    <h3>Recent ${e(heading)} Readings</h3><div class="wide"><table><thead><tr><th>When</th><th>${e(heading)}</th><th>Scale</th></tr></thead><tbody>
    ${readings.map((r) => `<tr data-reading-id="${e(r.id)}"><td>${readingTime(r)}</td><td>${metricLabel(r, metric, unit)}</td><td>${e(r.scale_label)}</td></tr>`).join("")}</tbody></table></div>`
        : '<p class="empty">No readings recorded yet.</p>'
    }</section>`;
}
export function dashboardPage(cards: DashboardCard[], unit: string): string {
  // Every link keeps all users' current selections and jumps back to the card.
  const selections: Record<string, string> = {};
  for (const { user, metric = 1, range = "90d" } of cards) {
    selections[`metric_${user.id}`] = String(metric);
    selections[`range_${user.id}`] = range;
  }
  const href = (user: number, change: Record<string, string>) =>
    `/?${new URLSearchParams({ ...selections, ...change })}#user-${user}`;
  return `<section class="page-heading"><div><h1>Dashboard</h1></div><a class="button secondary" href="/readings">View All Readings</a></section>
  ${
    cards.length
      ? `<div class="cards">${cards.map((card) => dashboardCard(card, unit, href)).join("")}</div>`
      : '<section><p class="empty">No users have been added yet.</p><a class="button" href="/firmware">Add Your First Scale</a></section>'
  }`;
}
const rangeLinks = (base: string, range: RangeKey) =>
  `<div class="range-switch" role="group" aria-label="Time range">${RANGES.map(
    (r) =>
      `<a href="${e(`${base}?range=${r.key}`)}"${r.key === range ? ' aria-current="true"' : ""}>${r.label}</a>`,
  ).join("")}</div>`;
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
function habitsHint(h: Habits): string {
  const window = `${String(MORNING.from).padStart(2, "0")}:00–${String(MORNING.to).padStart(2, "0")}:00`;
  const pct = Math.round(h.morningShare * 100);
  const zone = h.zoneAssumed
    ? " The scale has no time zone set, so UTC was assumed."
    : "";
  if (h.verdict === "unknown")
    return `<p class="hint-box">Not enough weigh-ins in this range to judge when you weigh yourself (${h.count}; at least 10 needed).${zone}</p>`;
  if (h.verdict === "comparable")
    return `<p class="hint-box good"><strong>Comparable readings.</strong> ${pct}% of your weigh-ins are between ${window}, so changes in weight are likely real rather than time-of-day swings.${zone}</p>`;
  return `<p class="hint-box warn"><strong>Mixed weigh-in times.</strong> Only ${pct}% of your weigh-ins are between ${window}; the typical time is ${clock(h.medianMinutes)}. Body weight moves by a kilogram or more over a day, so weighing at a similar time (ideally mornings, before eating) makes the trend more reliable.${zone}</p>`;
}
export function userOverviewPage(data: {
  user: Row;
  unit: string;
  range: RangeKey;
  metrics: Metric[];
  series: Record<number, Point[]>;
  from: number;
  to: number;
  habits: Habits;
}): string {
  const { user, unit, range, metrics, series, from, to, habits } = data;
  const rangeInfo = RANGES.find((r) => r.key === range)!;
  const spanText = rangeInfo.days ? `the last ${rangeInfo.label}` : "all time";
  const base = `/users/${user.id}/overview`;
  const chartFor = (type: number, big: boolean) => {
    const plot = plotFor(type, unit);
    const pts = scalePoints(series[type] ?? [], plot.scale);
    const st = stats(pts);
    const title = metricTitle(type);
    const body = pts.length
      ? lineChart(pts, {
          from,
          to,
          label: `${title} over ${spanText}`,
          text: plot.text,
          axis: plot.axis,
          trend: big,
        })
      : `<p class="empty">No ${e(title)} readings in this range.</p>`;
    const summary = st
      ? `<dl class="chart-stats">${pts.length > 1 ? `<div><dt>Change</dt><dd>${e(plot.delta(st.last - st.first))}</dd></div>` : ""}<div><dt>Average</dt><dd>${e(plot.text(st.avg))}</dd></div><div><dt>Min</dt><dd>${e(plot.text(st.min))}</dd></div><div><dt>Max</dt><dd>${e(plot.text(st.max))}</dd></div></dl>`
      : "";
    return `<section class="card chart-card"><h2>${e(title)}${plot.unit ? ` <span class="hint">${e(plot.unit)}</span>` : ""}</h2>${body}${summary}</section>`;
  };
  const height = n(user.height_cm) / 100;
  const weights = series[1] ?? [];
  const bmiCard =
    height > 0 && weights.length
      ? (() => {
          const pts = weights.map((p) => ({
            t: p.t,
            v: p.v / (height * height),
          }));
          return `<section class="card chart-card"><h2>BMI</h2>${lineChart(pts, { from, to, label: `BMI over ${spanText}`, text: (v) => (Math.round(v * 10) / 10).toString(), axis: (v) => number.format(v) })}</section>`;
        })()
      : "";
  const others = metrics.filter(
    (m) => m.type !== 1 && (series[m.type]?.length ?? 0) > 0,
  );
  const hourBars = habits.hours.map((count, hour) => ({
    label: String(hour).padStart(2, "0"),
    value: count,
    highlight: hour >= MORNING.from && hour < MORNING.to,
  }));
  const weekdayBars = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
    (label, i) => ({ label, value: habits.weekdays[i] }),
  );
  const monthBars = habits.months.slice(-24).map((m) => ({
    label: new Intl.DateTimeFormat("en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`${m.key}-01T00:00:00Z`)),
    value: m.count,
  }));
  return `<section class="page-heading"><div><a href="/">← Dashboard</a><h1>${e(user.name)}</h1></div><a class="button secondary" href="/users/${e(user.id)}/readings">All Readings</a></section>
  ${rangeLinks(base, range)}
  ${chartFor(1, true)}
  <section class="card habits"><h2>When You Weigh Yourself</h2>${habitsHint(habits)}
    <dl class="chart-stats"><div><dt>Weigh-ins</dt><dd>${habits.count}</dd></div><div><dt>Days with a weigh-in</dt><dd>${habits.days}</dd></div><div><dt>Per week</dt><dd>${number.format(Math.round(habits.perWeek * 10) / 10)}</dd></div><div><dt>Typical time</dt><dd>${habits.count ? clock(habits.medianMinutes) : "—"}</dd></div><div><dt>Longest pause</dt><dd>${plural(habits.longestGapDays, "day")}</dd></div></dl>
    ${habits.count ? `<h3>Time Of Day <span class="hint">highlighted: morning ${String(MORNING.from).padStart(2, "0")}:00–${String(MORNING.to).padStart(2, "0")}:00</span></h3>${barChart(hourBars, { label: "Weigh-ins by hour of day", unit: "weigh-ins", every: 2 })}<h3>Weekday</h3>${barChart(weekdayBars, { label: "Weigh-ins by weekday", unit: "weigh-ins" })}<h3>Per Month</h3>${barChart(monthBars, { label: "Weigh-ins per month", unit: "weigh-ins", every: Math.ceil(monthBars.length / 12) })}` : ""}
  </section>
  <div class="chart-grid">${bmiCard}${others.map((m) => chartFor(m.type, false)).join("")}</div>`;
}
export function readingsPage(
  readings: Row[],
  users: Row[],
  unit: string,
  csrf: string,
  metrics: Metric[] = [METRICS[0]],
  metric = 1,
): string {
  return `<section><h1>Readings</h1>${metricPicker(metrics, metric)}
    ${
      readings.length
        ? `<div class="wide"><table><thead><tr><th>When</th><th>${e(metricTitle(metric))}</th><th>User</th><th>Scale</th>${metric === 1 ? "<th>Health Sync</th>" : ""}<th>Actions</th></tr></thead><tbody>
    ${readings
      .map(
        (r) =>
          `<tr data-reading-id="${e(r.id)}"><td>${readingTime(r)}</td><td>${metricLabel(r, metric, unit)}</td><td>${r.user_id ? `<a href="/users/${e(r.user_id)}/readings">${e(r.user_name)}</a>` : '<span class="badge warn">Unassigned</span>'}</td><td>${e(r.scale_label)}</td>${metric === 1 ? `<td>${healthSyncStatus(r)}</td>` : ""}<td>${
            r.user_id
              ? "—"
              : `<div class="actions">${users.length ? `<form class="inline-form" action="/readings/${e(r.id)}/assign" method="post">${hidden(csrf)}<label class="hint">Assign To</label><select name="user_id" required><option value="">Choose User</option>${users.map((u) => option(u.id, u.name, "")).join("")}</select><button>Assign</button></form>` : ""}
      <form action="/readings/${e(r.id)}/delete" method="post" data-confirm="Delete this unassigned reading permanently?">${hidden(csrf)}<button class="danger">Delete</button></form></div>`
          }</td></tr>`,
      )
      .join("")}
    </tbody></table></div>`
        : '<p class="empty">No readings recorded yet.</p>'
    }</section>`;
}
export function userReadingsPage(
  user: Row,
  readings: Row[],
  unit: string,
  metrics: Metric[] = [METRICS[0]],
  metric = 1,
): string {
  return `<section><a href="/">← Dashboard</a><h1>${e(user.name)} Readings</h1>${metricPicker(metrics, metric)}
    ${
      readings.length
        ? `<div class="wide"><table><thead><tr><th>When</th><th>${e(metricTitle(metric))}</th><th>Scale</th><th>Attribution</th>${metric === 1 ? "<th>Health Sync</th>" : ""}</tr></thead><tbody>${readings
            .map(
              (r) =>
                `<tr><td>${readingTime(r)}</td><td>${metricLabel(r, metric, unit)}</td><td>${e(r.scale_label)}</td><td>${e(r.attribution)}</td>${metric === 1 ? `<td>${healthSyncStatus(r)}</td>` : ""}</tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<p class="empty">No readings recorded for this user.</p>'
    }</section>`;
}
function userFields(
  user: Row | null,
  scales: Row[],
  members: Set<number>,
): string {
  return `<div class="device-grid"><label>Name<input name="name" value="${e(user?.name)}" required></label><label>Short Name<input name="short_name" value="${e(user?.short_name)}" maxlength="3" required></label>
    <label>Height (cm)<input name="height_cm" type="number" step="1" value="${e(user?.height_cm)}" required></label>
    <label>Date of Birth<input name="birth_date" type="date" value="${e(user?.birth_date)}"></label>
    <label>Approximate Age (if DOB unknown)<input name="age_years" type="number" step="0.1" value="${e(user?.age_years)}"></label>
    <label>Sex<select name="sex">${option(0, "Male", user?.sex ?? 0)}${option(1, "Female", user?.sex ?? 0)}</select></label>
    <label>Recognition Weight (kg)<input name="reference_weight_kg" type="number" step="any" value="${e(user?.reference_weight_kg)}" title="Updated from the latest assigned weigh-in and sent on the scale’s next Wi-Fi sync." required></label></div>
    <fieldset><legend>Scales</legend>${scales.map((s) => `<label><input type="checkbox" name="scales" value="${e(s.id)}"${members.has(s.id) ? " checked" : ""}> ${e(s.label)}</label>`).join("")}</fieldset>`;
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
  return `<section><div class="page-heading"><div><h1>Users</h1></div><div class="actions"><a class="button secondary" href="/import/withings">Import Withings Data Export</a><button type="button" class="secondary" data-open-dialog="import-users-dialog">Import From Withings</button><button type="button" data-open-dialog="add-user-dialog">Add User</button></div></div>
    ${
      preview
        ? `<dialog id="import-preview-dialog" data-auto-open><button class="dialog-close" type="button" data-close-dialog>×</button><h2>Import Users From ${e(preview.scale.label)}</h2><p>${preview.settingsStatus === "configured" || scaleModel(preview.scale.model)?.classicGates ? "Device settings are ready." : "Device settings import is incomplete; use Finish Device Import on Scales to retry."} Existing users are retained.</p>
      <form action="/users/import-withings/confirm" method="post">${hidden(csrf)}<input type="hidden" name="scale_id" value="${e(preview.scale.id)}"><input type="hidden" name="capture_digest" value="${e(preview.digest)}">
      ${preview.users.length ? preview.users.map((u) => `<label><input type="checkbox" name="user_ids" value="${e(u.id)}" checked> ${e(u.fn || u.sn)} · ${e(u.sn)} · ID ${e(u.id)}</label>`).join("") : "<p>All users are already in this household.</p>"}
      <div class="dialog-actions"><button>Import Selected Users</button><button type="button" class="secondary" data-close-dialog>Later</button></div></form></dialog>`
        : ""
    }
    ${
      users.length
        ? `<div class="wide"><table><thead><tr><th>Name</th><th>Short Name</th><th>Height</th><th>Age / DOB</th><th>Sex</th><th>Scales</th><th>Status</th><th></th></tr></thead><tbody>
    ${users
      .map(
        (
          u,
        ) => `<tr><td>${e(u.name)}</td><td>${e(u.short_name)}</td><td>${Math.round(n(u.height_cm))} cm</td><td>${e(u.birth_date || u.age_years)}</td><td>${u.sex === 0 ? "Male" : "Female"}</td>
      <td>${scales
        .filter((s) => memberships.get(u.id)?.has(s.id))
        .map((s) => e(s.label))
        .join(
          ", ",
        )}</td><td>${u.active ? "Active" : "Retired"}</td><td><button type="button" class="secondary" data-open-dialog="edit-user-${e(u.id)}">Edit</button></td></tr>`,
      )
      .join("")}</tbody></table></div>`
        : '<p class="empty">No users have been added yet.</p>'
    }</section>
    <dialog id="import-users-dialog"${importScaleId ? " data-auto-open" : ""}><button type="button" class="dialog-close" data-close-dialog>×</button><h2>Import From Withings</h2>
      <p>Read the selected scale’s existing users and settings over verified HTTPS. New users are shown for selection; existing local users are preserved.</p>
      ${fetchMode ? `<form action="/users/fetch-withings" method="post">${hidden(csrf)}<label>Scale<select name="scale_id" required><option value="">Choose Scale</option>${scales.map((s) => option(s.id, s.label, importScaleId ?? "")).join("")}</select></label><button>Fetch From Withings</button></form>` : "<p>Withings import is unavailable on this server.</p>"}</dialog>
    <dialog id="add-user-dialog"><button type="button" class="dialog-close" data-close-dialog>×</button><h2>Add User</h2><form action="/users" method="post">${hidden(csrf)}${userFields(null, scales, new Set())}<button>Save User</button></form></dialog>
    ${users
      .map(
        (
          u,
        ) => `<dialog id="edit-user-${e(u.id)}"><button type="button" class="dialog-close" data-close-dialog>×</button><h2>Edit ${e(u.name)}</h2>
      <form action="/users/${e(u.id)}" method="post">${hidden(csrf)}${userFields(u, scales, memberships.get(u.id) ?? new Set())}<div class="dialog-actions"><button>Save User</button></div></form>
      <div class="dialog-actions"><form action="/users/${e(u.id)}" method="post">${hidden(csrf)}<input type="hidden" name="purpose" value="retire"><button class="secondary">Retire User</button></form>
      <form action="/users/${e(u.id)}/delete" method="post" data-confirm="Delete this user locally? Their readings will become unassigned.">${hidden(csrf)}<button class="danger">Delete User</button></form></div></dialog>`,
      )
      .join("")}`;
}

export function withingsImportPage(csrf: string): string {
  return `<section><a href="/users">← Users</a><h1>Import Withings Data Export</h1>
    <p>Upload the ZIP you get from Withings (Health Mate app: Settings → Account → Download your data, or account.withings.com). Weight, fat, bone, muscle and water measurements are imported; nothing is changed until you have reviewed the preview. Steps, sleep, heart rate and location data in the export are ignored.</p>
    <form action="/import/withings" method="post" enctype="multipart/form-data">${hidden(csrf)}<label>Export ZIP<input type="file" name="export" accept=".zip,application/zip" required></label><button>Preview Import</button></form></section>`;
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
  const day = (d: string) => e(d.slice(0, 10));
  const needs = !scales.length
    ? '<p class="hint-box warn">Add a scale first; every reading belongs to a scale. <a href="/scales">Go to Scales</a></p>'
    : "";
  const name = meta.firstname.trim();
  const short = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  return `<section><a href="/import/withings">← Choose Another File</a><h1>Review Withings Import</h1>
    <dl><dt>File</dt><dd>${e(meta.fileName)}</dd><dt>Weigh-ins</dt><dd>${meta.count} (${day(meta.first)} to ${day(meta.last)}), ${meta.withComposition} with body composition</dd>
    <dt>Latest</dt><dd>${e(meta.last)} (local time in the export)</dd>${meta.heightM ? `<dt>Height in export</dt><dd>${Math.round(meta.heightM * 100)} cm</dd>` : ""}
    ${meta.ignoredMetrics.length ? `<dt>Not imported</dt><dd>${e(meta.ignoredMetrics.join(", "))} (no matching YOW metric)</dd>` : ""}</dl>
    ${needs}
    ${
      scales.length
        ? `<form action="/import/withings/commit" method="post">${hidden(csrf)}<input type="hidden" name="import_id" value="${e(id)}">
    <label>Assign To User<select name="user_id" required>${users.map((u) => option(u.id, `${u.name} (${u.short_name})`, suggestion?.id)).join("")}${option("new", "Create New User From Export", suggestion ? "" : "new")}</select></label>
    ${suggestion ? `<p class="hint">Suggested from the ${e(suggestion.reason)}. Check this before importing.</p>` : '<p class="hint">No existing user matched the name in the export, so a new one is proposed below.</p>'}
    <fieldset><legend>New User (Only Used When &quot;Create New User&quot; Is Chosen)</legend><div class="device-grid"><label>Name<input name="name" value="${e(name)}" maxlength="100"></label><label>Short Name<input name="short_name" value="${e(short)}" maxlength="3"></label><label>Height (cm)<input name="height_cm" type="number" step="1" value="${meta.heightM ? Math.round(meta.heightM * 100) : ""}"></label><label>Date of Birth<input name="birth_date" type="date" value="${e(meta.birthDate)}"></label><label>Sex<select name="sex">${option(0, "Male", meta.sex)}${option(1, "Female", meta.sex)}</select></label><label>Recognition Weight (kg)<input name="reference_weight_kg" type="number" step="any" value="${meta.latestKg ? e(meta.latestKg) : ""}"></label></div><p class="hint">The new user is not added to any scale; enable that under Users when you want the scale to recognise them.</p></fieldset>
    <label>Attribute To Scale<select name="scale_id" required>${scales.map((sc) => option(sc.id, `${sc.label}${sc.mac ? ` · ${sc.mac}` : ""}`, scaleMatch)).join("")}</select></label>
    <p class="hint">${scaleMatch ? "Preselected: its address matches the device in the export." : "Only used to label the imported readings."}</p>
    <label>Time Zone Of The Export Times${timeZoneSelect("time_zone", meta.zone)}</label>
    <p class="hint">Withings writes local times. Using the device's time zone (${e(meta.zone)}) keeps morning weigh-ins in the morning.</p>
    <label><input type="checkbox" name="confirmed" value="1" required> I Have Reviewed This Import</label>
    <p class="hint">Weigh-ins already stored for this user within three minutes are skipped, so importing twice is safe.</p>
    <div class="dialog-actions"><button>Import ${meta.count} Weigh-Ins</button><a href="/import/withings">Cancel</a></div></form>`
        : ""
    }</section>`;
}
