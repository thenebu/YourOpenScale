#!/usr/bin/env node
// WCAG contrast check for web/src/styles/tokens.css (WP-03).
// Usage: node tools/check_contrast.mjs
// Exits 1 if a text pair is < 4.5:1 or a non-text pair is < 3.0:1 in either theme.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../web/src/styles/tokens.css", import.meta.url));
const css = readFileSync(file, "utf8");

function block(re, name) {
  const m = css.match(re);
  if (!m) throw new Error(`tokens.css: block not found: ${name}`);
  return m[1];
}
function vars(body) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = vars(block(/^:root\s*\{([\s\S]*?)^\}/m, ":root"));
const darkMedia = vars(
  block(/prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)^\s{2}\}/m, "dark media"),
);
const darkAttr = vars(block(/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m, "data-theme=dark"));
const themes = { light, dark: darkMedia };

let failed = 0;

// The two dark blocks must hold identical values.
for (const k of new Set([...Object.keys(darkMedia), ...Object.keys(darkAttr)])) {
  if (darkMedia[k] !== darkAttr[k]) {
    console.error(`FAIL dark blocks differ for ${k}: ${darkMedia[k]} vs ${darkAttr[k]}`);
    failed++;
  }
}

function rgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function lum([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, minimum, label]; 4.5 = text, 3.0 = non-text.
const T = 4.5;
const N = 3.0;
const pairs = [
  ["--color-text", "--color-bg", T],
  ["--color-text", "--color-surface", T],
  ["--color-text", "--color-surface-raised", T],
  ["--color-text", "--color-surface-sunken", T],
  ["--color-text-muted", "--color-surface", T],
  ["--color-text-muted", "--color-bg", T],
  ["--color-text-muted", "--color-surface-sunken", T],
  ["--color-text-subtle", "--color-surface", T],
  ["--color-text-subtle", "--color-bg", T],
  ["--color-accent", "--color-surface", T],
  ["--color-accent", "--color-bg", T],
  ["--color-on-accent", "--color-accent", T],
  ["--color-accent-soft-text", "--color-accent-soft", T],
  ["--color-link", "--color-surface", T],
  ["--color-link", "--color-bg", T],
  ["--color-good", "--color-good-bg", T],
  ["--color-good", "--color-surface", T],
  ["--color-warn", "--color-warn-bg", T],
  ["--color-warn", "--color-surface", T],
  ["--color-bad", "--color-bad-bg", T],
  ["--color-bad", "--color-surface", T],
  ["--color-info", "--color-info-bg", T],
  ["--color-info", "--color-surface", T],
  ["--chart-axis", "--color-surface", T],
  // Non-text (WCAG 1.4.11)
  ["--color-border-strong", "--color-surface", N],
  ["--color-focus", "--color-surface", N],
  ["--color-focus", "--color-bg", N],
  ["--chart-trend", "--color-surface", N],
];

for (const [name, vs] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    const a = vs[fg];
    const b = vs[bg];
    if (!a || !b || !/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) {
      console.error(`FAIL ${name}: cannot resolve ${fg} (${a}) / ${bg} (${b})`);
      failed++;
      continue;
    }
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}

if (failed) {
  console.error(`\n${failed} contrast check(s) failed`);
  process.exit(1);
}
console.log("\nAll contrast checks passed");
