/** Server-rendered HTML helpers (WP-04 replaces these minimal stubs). */
type Opts = Record<string, unknown>;

export function link(href: string, text: string, opts: Opts = {}): string {
  return `<a class="link" href="${href}">${text}</a>`;
}
export function button(text: string, opts: Opts = {}): string {
  return `<button class="btn">${text}</button>`;
}
export function buttonLink(href: string, text: string, opts: Opts = {}): string {
  return `<a class="btn" href="${href}">${text}</a>`;
}
export function badge(text: string, tone = "neutral", iconName?: string): string {
  return `<span class="badge">${text}</span>`;
}
export function segmented(label: string, items: { href: string; text: string; current: boolean; ariaLabel?: string }[]): string {
  return `<nav class="segmented" aria-label="${label}"></nav>`;
}
export function chip(href: string, text: string, pressed: boolean): string {
  return `<a class="chip" href="${href}">${text}</a>`;
}
export function stat(opts: Opts): string {
  return `<div class="stat"></div>`;
}
export function delta(d: Opts): string {
  return `<span class="delta"></span>`;
}
export function callout(tone: string, title: string, bodyHtml: string): string {
  return `<div class="callout">${bodyHtml}</div>`;
}
export function emptyState(opts: Opts): string {
  return `<div class="empty"></div>`;
}
export function pageHeader(opts: Opts): string {
  return `<header class="page-header"></header>`;
}
export function card(opts: Opts & { bodyHtml?: string }): string {
  return `<section class="card">${opts.bodyHtml ?? ""}</section>`;
}
export function chartFigure(opts: Opts): string {
  return `<figure class="chart-card"></figure>`;
}
export function dataTable(headers: string[], rows: string[][], opts: Opts = {}): string {
  return `<table class="table"></table>`;
}
export function kv(pairs: [string, string][]): string {
  return `<dl class="kv"></dl>`;
}
