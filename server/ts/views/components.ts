/** Server-rendered HTML helpers (WP-04). Pure: all text arguments are plain data and are escaped here. */
import { escapeHtml as e } from "../ui.ts";
import { icon } from "./icons.ts";

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
type Attrs = Record<string, string | number | boolean | undefined>;

const attrString = (attrs?: Attrs): string =>
  Object.entries(attrs ?? {})
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${e(k)}` : ` ${e(k)}="${e(v)}"`))
    .join("");
const cls = (...parts: (string | false | undefined | null)[]): string => parts.filter(Boolean).join(" ");

/** Marks a string as trusted HTML so dataTable()/kv() do not escape it. */
export class Raw {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
  toString(): string {
    return this.html;
  }
}
export const raw = (html: string): Raw => new Raw(html);
const cell = (v: string | Raw): string => (v instanceof Raw ? v.html : e(v));

export function link(
  href: string,
  text: string,
  opts: { variant?: "default" | "quiet" | "back"; chevron?: boolean } = {},
): string {
  const v = opts.variant ?? "default";
  const lead = v === "back" ? icon("chevron-left", { size: 16 }) : "";
  const trail = opts.chevron ? icon("chevron-right", { size: 16 }) : "";
  return `<a class="${cls("link", v === "quiet" && "link-quiet", v === "back" && "link-back")}" href="${e(href)}">${lead}${e(text)}${trail}</a>`;
}

type ButtonOpts = { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; type?: "button" | "submit" | "reset"; attrs?: Attrs };
const btnClass = (o: ButtonOpts): string => cls("btn", `btn-${o.variant ?? "primary"}`, o.size === "sm" && "btn-sm");

export function button(text: string, opts: ButtonOpts = {}): string {
  return `<button class="${btnClass(opts)}" type="${opts.type ?? "button"}"${attrString(opts.attrs)}>${e(text)}</button>`;
}
export function buttonLink(href: string, text: string, opts: ButtonOpts = {}): string {
  return `<a class="${btnClass(opts)}" href="${e(href)}"${attrString(opts.attrs)}>${e(text)}</a>`;
}

const TONE_ICON: Record<string, string> = { good: "check", warn: "alert-triangle", bad: "x-octagon", info: "info" };

export function badge(text: string, tone: Tone = "neutral", iconName?: string): string {
  const ic = iconName ? icon(iconName, { size: 12 }) : "";
  return `<span class="${cls("badge", tone !== "neutral" && `badge-${tone}`)}">${ic}${e(text)}</span>`;
}

export function segmented(
  label: string,
  items: { href: string; text: string; current: boolean; ariaLabel?: string }[],
): string {
  const links = items
    .map(
      (i) =>
        `<a href="${e(i.href)}"${i.current ? ' aria-current="page"' : ""}${i.ariaLabel ? ` aria-label="${e(i.ariaLabel)}"` : ""}>${e(i.text)}</a>`,
    )
    .join("");
  return `<nav class="segmented" aria-label="${e(label)}">${links}</nav>`;
}

/** Filter toggle rendered as a link: aria-current="true" when active (the pressed state of a link). */
export function chip(href: string, text: string, pressed: boolean): string {
  return `<a class="chip" href="${e(href)}"${pressed ? ' aria-current="true"' : ""}>${pressed ? icon("check", { size: 14 }) : ""}${e(text)}</a>`;
}

export type DeltaData = {
  text: string;
  direction: "up" | "down" | "flat";
  tone?: "good" | "bad" | "neutral";
  ref?: string;
};
const DELTA_ICON = { up: "arrow-up-right", down: "arrow-down-right", flat: "minus" } as const;

export function delta(d: DeltaData): string {
  const dir = d.direction in DELTA_ICON ? d.direction : "flat";
  const ref = d.ref ? ` <span class="delta-ref">${e(d.ref)}</span>` : "";
  return `<span class="delta" data-direction="${dir}" data-tone="${d.tone ?? "neutral"}">${icon(DELTA_ICON[dir], { size: 14 })}${e(d.text)}${ref}</span>`;
}

export function stat(opts: {
  label: string;
  value: string;
  rawValue?: string | number | null;
  unit?: string;
  delta?: DeltaData;
  size?: "lg" | "sm";
  href?: string;
  /** Trusted HTML (for example a sparkline SVG). */
  extra?: string;
}): string {
  const raw = opts.rawValue ?? opts.value;
  const inner =
    `<span class="stat-label">${e(opts.label)}</span>` +
    `<data class="stat-value" value="${e(raw)}">${e(opts.value)}${opts.unit ? `<span class="unit">${e(opts.unit)}</span>` : ""}</data>` +
    (opts.delta ? delta(opts.delta) : "") +
    (opts.extra ?? "");
  const c = cls("stat", opts.size === "sm" && "stat-sm", opts.href && "card-link");
  return opts.href ? `<a class="${c}" href="${e(opts.href)}">${inner}</a>` : `<div class="${c}">${inner}</div>`;
}

export function callout(tone: string, title: string, bodyHtml: string): string {
  const t = ["good", "warn", "bad", "info"].includes(tone) ? tone : "info";
  const role = t === "bad" || t === "warn" ? ' role="alert"' : ' role="status"';
  return `<div class="callout callout-${t}"${role}>${icon(TONE_ICON[t]!, { size: 20 })}<div class="callout-body">${title ? `<p class="callout-title">${e(title)}</p>` : ""}${bodyHtml}</div></div>`;
}

export function emptyState(opts: {
  icon?: string;
  title: string;
  body?: string;
  /** Trusted HTML, typically buttonLink(). */
  action?: string;
}): string {
  return `<div class="empty-state">${opts.icon ? `<span class="empty-icon">${icon(opts.icon, { size: 24 })}</span>` : ""}<p class="empty-title">${e(opts.title)}</p>${opts.body ? `<p class="empty-body">${e(opts.body)}</p>` : ""}${opts.action ?? ""}</div>`;
}

export function pageHeader(opts: {
  title: string;
  subtitle?: string;
  back?: { href: string; text: string };
  /** Trusted HTML. */
  actionsHtml?: string;
}): string {
  return `<header class="page-header"><div class="page-header-text">${opts.back ? link(opts.back.href, opts.back.text, { variant: "back" }) : ""}<h1 class="page-title">${e(opts.title)}</h1>${opts.subtitle ? `<p class="page-subtitle">${e(opts.subtitle)}</p>` : ""}</div>${opts.actionsHtml ? `<div class="page-actions">${opts.actionsHtml}</div>` : ""}</header>`;
}

export function card(opts: {
  title?: string;
  /** Trusted HTML title; wins over `title`. */
  titleHtml?: string;
  actionsHtml?: string;
  bodyHtml?: string;
  id?: string;
  className?: string;
}): string {
  const titleInner = opts.titleHtml ?? (opts.title ? e(opts.title) : "");
  const head =
    titleInner || opts.actionsHtml
      ? `<div class="card-header">${titleInner ? `<h2 class="card-title">${titleInner}</h2>` : ""}${opts.actionsHtml ? `<div class="card-actions">${opts.actionsHtml}</div>` : ""}</div>`
      : "";
  return `<section class="${cls("card", opts.className && e(opts.className))}"${opts.id ? ` id="${e(opts.id)}"` : ""}>${head}${opts.bodyHtml ?? ""}</section>`;
}

export function chartFigure(opts: {
  id: string;
  title: string;
  unitLabel?: string;
  summary: string;
  island: string;
  dataRef: string;
  height: number;
  /** Trusted HTML. */
  legendHtml?: string;
  tableHtml: string;
  fallbackSvg?: string;
}): string {
  const id = e(opts.id);
  return `<figure class="chart-card" id="${id}"><h3 class="chart-title" id="${id}-title">${e(opts.title)}${opts.unitLabel ? ` <span class="chart-unit">${e(opts.unitLabel)}</span>` : ""}</h3><p class="chart-summary" id="${id}-summary">${e(opts.summary)}</p><div class="chart-tools"></div><div class="chart" data-island="${e(opts.island)}" data-ref="${e(opts.dataRef)}" data-payload="${e(opts.dataRef)}" tabindex="0" role="group" aria-labelledby="${id}-title" aria-describedby="${id}-summary" style="--chart-h:${Math.round(Number(opts.height)) || 240}px">${opts.fallbackSvg ? `<div class="chart-fallback">${opts.fallbackSvg}</div>` : ""}</div>${opts.legendHtml ?? ""}<details class="chart-data"><summary>Show data table</summary><div class="table-wrap">${opts.tableHtml}</div></details></figure>`;
}

export function dataTable(
  headers: string[],
  rows: (string | Raw)[][],
  opts: { numericCols?: number[]; caption?: string } = {},
): string {
  const num = new Set(opts.numericCols ?? []);
  const c = (i: number) => (num.has(i) ? ' class="num"' : "");
  return `<table class="table">${opts.caption ? `<caption class="visually-hidden">${e(opts.caption)}</caption>` : ""}<thead><tr>${headers.map((h, i) => `<th scope="col"${c(i)}>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td${c(i)}>${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function kv(pairs: [string, string | Raw][]): string {
  return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${e(k)}</dt><dd>${cell(v)}</dd>`).join("")}</dl>`;
}
