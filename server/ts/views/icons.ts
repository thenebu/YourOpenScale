/*
 * Inline SVG icons. Paths are copied from Lucide (https://lucide.dev), ISC licence.
 * Copyright (c) for Lucide contributors; portions Copyright (c) 2013-2022 Cole Bemis (Feather, MIT).
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
 * hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
 */
const PATHS = {
  "chevron-right": ["m9 18 6-6-6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "arrow-up-right": ["M7 7h10v10", "M7 17 17 7"],
  "arrow-down-right": ["m7 7 10 10", "M17 7v10H7"],
  minus: ["M5 12h14"],
  check: ["M20 6 9 17l-5-5"],
  "alert-triangle": ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
  "x-octagon": [
    "m15 9-6 6",
    "m9 9 6 6",
    "M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z",
  ],
  info: ['<circle cx="12" cy="12" r="10"/>', "M12 16v-4", "M12 8h.01"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  copy: ['<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>', "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  pencil: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  scale: [
    "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",
    "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",
    "M7 21h10",
    "M12 3v18",
    "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2",
  ],
  calendar: ["M8 2v4", "M16 2v4", '<rect width="18" height="18" x="3" y="4" rx="2"/>', "M3 10h18"],
  sun: [
    '<circle cx="12" cy="12" r="4"/>',
    "M12 2v2",
    "M12 20v2",
    "m4.93 4.93 1.41 1.41",
    "m17.66 17.66 1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "m6.34 17.66-1.41 1.41",
    "m19.07 4.93-1.41 1.41",
  ],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  monitor: ['<rect width="20" height="14" x="2" y="3" rx="2"/>', "M8 21h8", "M12 17v4"],
  target: ['<circle cx="12" cy="12" r="10"/>', '<circle cx="12" cy="12" r="6"/>', '<circle cx="12" cy="12" r="2"/>'],
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof PATHS;

const attr = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Inline SVG icon. Decorative (aria-hidden) unless `label` is given. Unknown names return "". */
export function icon(name: string, opts: { size?: number; label?: string } = {}): string {
  if (!Object.hasOwn(PATHS, name)) return "";
  const size = Number.isFinite(opts.size) ? Number(opts.size) : 16;
  const a11y = opts.label ? `role="img" aria-label="${attr(opts.label)}"` : `aria-hidden="true"`;
  const body = PATHS[name as IconName].map((p) => (p.startsWith("<") ? p : `<path d="${p}"/>`)).join("");
  return `<svg class="icon icon-${name}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false" ${a11y}>${body}</svg>`;
}
