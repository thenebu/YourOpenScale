/** Regenerates the PWA icons from the SVG logo master below (redrawn from server/static/favicon.png).
 * Usage: node tools/generate_icons.mjs   (outputs are committed to web/public/icons/) */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const out = fileURLToPath(new URL("../web/public/icons/", import.meta.url));
const TEAL = "#087a76"; // --color-accent (light)
const CREAM = "#fdf8ec";
const YELLOW = "#f2d71a";

// Scale seen from above: display, two foot pads, two indicator dots, smile.
const glyph = `
  <rect x="170" y="62" width="172" height="72" rx="16" fill="${CREAM}"/>
  ${[0, 1, 2, 3, 4].map((i) => `<rect x="${190 + i * 30}" y="${82 + (i % 2) * 4}" width="14" height="${30 - (i % 2) * 8}" rx="4" fill="${TEAL}" transform="rotate(${(i - 2) * 4} ${197 + i * 30} 98)"/>`).join("")}
  <ellipse cx="127" cy="236" rx="64" ry="102" fill="${CREAM}"/>
  <ellipse cx="385" cy="236" rx="64" ry="102" fill="${CREAM}"/>
  <circle cx="100" cy="354" r="23" fill="${YELLOW}"/>
  <circle cx="412" cy="354" r="23" fill="${YELLOW}"/>
  <path d="M158 362 Q256 436 354 362" fill="none" stroke="${CREAM}" stroke-width="24" stroke-linecap="round"/>`;

const svg = (inner, plate) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${plate}${inner}</svg>`;
const roundedPlate = `<rect x="24" y="24" width="464" height="464" rx="128" fill="${TEAL}"/>`;
const fullPlate = `<rect width="512" height="512" fill="${TEAL}"/>`;
// Maskable / apple: full-bleed plate, glyph shrunk to stay inside the 80 % safe zone.
const shrunk = (s) => `<g transform="translate(256 256) scale(${s}) translate(-256 -250)">${glyph}</g>`;

const any = svg(glyph, roundedPlate);
const maskable = svg(shrunk(0.84), fullPlate);

const png = (source, size) =>
  new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();

mkdirSync(out, { recursive: true });
writeFileSync(out + "favicon.svg", any + "\n");
writeFileSync(out + "icon-192.png", png(any, 192));
writeFileSync(out + "icon-512.png", png(any, 512));
writeFileSync(out + "icon-maskable-512.png", png(maskable, 512));
writeFileSync(out + "apple-touch-icon-180.png", png(svg(shrunk(0.9), fullPlate), 180));
console.log("icons written to", out);
