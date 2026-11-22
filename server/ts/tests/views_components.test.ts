import assert from "node:assert/strict";
import test from "node:test";
import {
  badge, button, buttonLink, callout, card, chartFigure, chip, dataTable, delta, emptyState, kv, link, pageHeader, raw,
  segmented, stat,
} from "../views/components.ts";
import { icon } from "../views/icons.ts";

const evil = `<img src=x onerror="alert(1)">`;

test("icon: decorative by default, labelled on request, unknown is empty", () => {
  const a = icon("check");
  assert.match(a, /class="icon icon-check"/);
  assert.match(a, /aria-hidden="true"/);
  assert.match(a, /focusable="false"/);
  assert.match(a, /stroke="currentColor"/);
  assert.match(a, /stroke-width="1.75"/);
  assert.match(a, /width="16" height="16"/);
  const b = icon("info", { size: 24, label: `Say "hi"` });
  assert.match(b, /role="img" aria-label="Say &#34;hi&#34;"/);
  assert.doesNotMatch(b, /aria-hidden/);
  assert.equal(icon("nope"), "");
  for (const n of ["chevron-right", "chevron-left", "chevron-down", "arrow-up-right", "arrow-down-right", "minus", "alert-triangle", "x-octagon", "download", "copy", "menu", "x", "pencil", "scale", "calendar", "sun", "moon", "monitor", "target", "upload"])
    assert.match(icon(n), /<svg[^>]*>.+<\/svg>/, n);
});

test("link variants and escaping", () => {
  assert.equal(link("/a?x=1&y=2", "Go"), `<a class="link" href="/a?x=1&amp;y=2">Go</a>`);
  assert.match(link("/", "Raw", { variant: "quiet" }), /class="link link-quiet"/);
  assert.match(link("/", "Back", { variant: "back" }), /link-back" href="\/"><svg class="icon icon-chevron-left"/);
  assert.match(link("/", "More", { chevron: true }), /icon-chevron-right/);
  assert.doesNotMatch(link("/", evil), /<img/);
});

test("buttons", () => {
  assert.equal(button("Save"), `<button class="btn btn-primary" type="button">Save</button>`);
  const b = button(evil, { variant: "danger", size: "sm", type: "submit", attrs: { "data-x": `a"b`, disabled: true } });
  assert.match(b, /class="btn btn-danger btn-sm" type="submit" data-x="a&quot;b" disabled>/);
  assert.doesNotMatch(b, /<img/);
  assert.equal(buttonLink("/x", "Open", { variant: "secondary" }), `<a class="btn btn-secondary" href="/x">Open</a>`);
});

test("badge, chip, segmented", () => {
  assert.equal(badge("OK"), `<span class="badge">OK</span>`);
  assert.match(badge("3", "warn", "alert-triangle"), /badge badge-warn"><svg class="icon icon-alert-triangle"[^>]*width="12"/);
  assert.match(chip("/f", "Morning", true), /aria-current="true"[^>]*><svg[^>]*icon-check/);
  assert.doesNotMatch(chip("/f", "Morning", false), /aria-current|icon-check/);
  const s = segmented("Time range", [
    { href: "?r=30", text: "30 d", current: false, ariaLabel: "Last 30 days" },
    { href: "?r=90", text: "90 d", current: true },
  ]);
  assert.match(s, /^<nav class="segmented" aria-label="Time range">/);
  assert.match(s, /<a href="\?r=30" aria-label="Last 30 days">30 d<\/a>/);
  assert.match(s, /<a href="\?r=90" aria-current="page">90 d<\/a>/);
  assert.equal((s.match(/aria-current/g) ?? []).length, 1);
});

test("stat and delta keep the raw value and escape text", () => {
  const s = stat({
    label: "Body fat", value: "21.1", rawValue: 21.08123, unit: "%",
    delta: { text: "−0.4 pp", direction: "down", tone: "neutral", ref: "30 d" },
    extra: `<svg class="spark"></svg>`,
  });
  assert.match(s, /<data class="stat-value" value="21.08123">21.1<span class="unit">%<\/span><\/data>/);
  assert.match(s, /data-direction="down" data-tone="neutral"/);
  assert.match(s, /icon-arrow-down-right/);
  assert.match(s, /<span class="delta-ref">30 d<\/span>/);
  assert.match(s, /<svg class="spark">/);
  assert.match(s, /^<div class="stat">/);
  assert.match(stat({ label: "A", value: "1", href: "/u/1", size: "sm" }), /^<a class="stat stat-sm card-link" href="\/u\/1">/);
  assert.doesNotMatch(stat({ label: evil, value: evil }), /<img/);
  assert.match(delta({ text: "0.0", direction: "flat" }), /data-tone="neutral">.*icon-minus/);
  assert.match(delta({ text: "+1", direction: "up", tone: "bad" }), /icon-arrow-up-right/);
});

test("callout maps tone to icon and role", () => {
  const c = callout("warn", "Heads up", "<p>Body</p>");
  assert.match(c, /class="callout callout-warn" role="alert"/);
  assert.match(c, /icon-alert-triangle/);
  assert.match(c, /<p class="callout-title">Heads up<\/p><p>Body<\/p>/);
  assert.match(callout("good", "", "x"), /role="status"[^>]*><svg[^>]*icon-check/);
  assert.doesNotMatch(callout("good", "", "x"), /callout-title/);
  assert.match(callout("bad", evil, ""), /icon-x-octagon/);
  assert.doesNotMatch(callout("bad", evil, ""), /<img/);
});

test("emptyState, pageHeader, card", () => {
  const e = emptyState({ icon: "scale", title: "No data", body: "Weigh in", action: buttonLink("/", "Go") });
  assert.match(e, /class="empty-state"><span class="empty-icon"><svg[^>]*icon-scale/);
  assert.match(e, /<p class="empty-title">No data<\/p><p class="empty-body">Weigh in<\/p><a class="btn/);
  const h = pageHeader({ title: "Users", subtitle: "All", back: { href: "/", text: "Home" }, actionsHtml: "<b>x</b>" });
  assert.match(h, /^<header class="page-header">/);
  assert.match(h, /link-back" href="\/">.*Home/);
  assert.match(h, /<h1 class="page-title">Users<\/h1><p class="page-subtitle">All<\/p>/);
  assert.match(h, /<div class="page-actions"><b>x<\/b><\/div>/);
  assert.doesNotMatch(pageHeader({ title: "T" }), /page-actions|page-subtitle|link-back/);
  const c = card({ title: "T&C", actionsHtml: "<i>a</i>", bodyHtml: "<p>b</p>", id: "x", className: "wide" });
  assert.match(c, /^<section class="card wide" id="x">/);
  assert.match(c, /<h2 class="card-title">T&amp;C<\/h2>/);
  assert.match(c, /card-actions"><i>a<\/i>/);
  assert.equal(card({ bodyHtml: "z" }), `<section class="card">z</section>`);
  assert.match(card({ titleHtml: "<em>t</em>" }), /card-title"><em>t<\/em>/);
});

test("chartFigure wires aria and the island contract", () => {
  const f = chartFigure({
    id: "wt", title: `Weight "kg"`, unitLabel: "kg", summary: "Down a bit.", island: "timeseries", dataRef: "payload-1",
    height: 320, legendHtml: `<ul class="chart-legend"></ul>`, tableHtml: dataTable(["D"], [["x"]]), fallbackSvg: "<svg></svg>",
  });
  assert.match(f, /^<figure class="chart-card" id="wt">/);
  assert.match(f, /<h3 class="chart-title" id="wt-title">Weight &quot;kg&quot; <span class="chart-unit">kg<\/span><\/h3>/);
  assert.match(f, /<p class="chart-summary" id="wt-summary">Down a bit.<\/p>/);
  assert.match(f, /data-island="timeseries" data-ref="payload-1" data-payload="payload-1" tabindex="0" role="group" aria-labelledby="wt-title" aria-describedby="wt-summary" style="--chart-h:320px"/);
  assert.match(f, /<div class="chart-fallback"><svg><\/svg><\/div>/);
  assert.match(f, /<details class="chart-data"><summary>Show data table<\/summary><div class="table-wrap"><table class="table">/);
});

test("dataTable marks numeric columns and escapes unless raw()", () => {
  const t = dataTable(["Name", "kg"], [[evil, "81.4"], [raw("<b>ok</b>"), "80"]], { numericCols: [1], caption: "Cap" });
  assert.match(t, /<th scope="col">Name<\/th><th scope="col" class="num">kg<\/th>/);
  assert.match(t, /<td class="num">81.4<\/td>/);
  assert.doesNotMatch(t, /<img/);
  assert.match(t, /<td><b>ok<\/b><\/td>/);
  assert.match(t, /<caption class="visually-hidden">Cap<\/caption>/);
});

test("kv", () => {
  assert.equal(kv([["A", "1"], [evil, raw("<code>x</code>")]]).includes("<img"), false);
  assert.equal(kv([["A", "1"]]), `<dl class="kv"><dt>A</dt><dd>1</dd></dl>`);
  assert.match(kv([["K", raw("<code>x</code>")]]), /<dd><code>x<\/code><\/dd>/);
});
