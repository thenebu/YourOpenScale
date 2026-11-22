/** Regenerates all logo/icon outputs from the SVG master tools/logo/yos-mark.svg (YourOpenScale mark).
 * Usage: node tools/generate_icons.mjs   (outputs are committed: web/public/icons/*, server/static/favicon*.png) */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = rel("../web/public/icons/");
const staticDir = rel("../server/static/");
const master = readFileSync(rel("./logo/yos-mark.svg"), "utf8");
const ACCENT = master.match(/id="plate"[^>]*fill="(#[0-9a-f]{6})"/i)[1];
const plate = master.match(/<rect id="plate"[^>]*\/>/)[0];
const glyph = master.match(/<g id="glyph">[\s\S]*?<\/g>/)[0];

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${inner}</svg>`;
const fullPlate = `<rect width="512" height="512" fill="${ACCENT}"/>`;
// Maskable / apple: full-bleed plate, glyph centred and kept inside the 80 % safe zone.
const scaled = (s) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${glyph}</g>`;

const any = svg(plate + glyph);
const png = (source, size) => new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();

mkdirSync(out, { recursive: true });
writeFileSync(out + "favicon.svg", any + "\n");
writeFileSync(out + "icon-192.png", png(any, 192));
writeFileSync(out + "icon-512.png", png(any, 512));
writeFileSync(out + "icon-maskable-512.png", png(svg(fullPlate + scaled(0.95)), 512));
writeFileSync(out + "apple-touch-icon-180.png", png(svg(fullPlate + scaled(1.05)), 180));
writeFileSync(staticDir + "favicon.png", png(any, 64));
writeFileSync(staticDir + "favicon-32.png", png(any, 32));
console.log("icons written to", out, "and", staticDir);
