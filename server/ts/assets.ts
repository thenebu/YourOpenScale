/** Resolves built web assets (web/dist, Vite manifest) to HTML tags and files. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type ManifestChunk = {
  file: string;
  name?: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
  assets?: string[];
};
type Manifest = Record<string, ManifestChunk>;

let manifest: Manifest | null | undefined;
let warned = false;

export function distDir(): string {
  return (
    process.env.YOW_WEB_DIST ??
    fileURLToPath(new URL("../../web/dist", import.meta.url))
  );
}

/** Test hook: forget the cached manifest so YOW_WEB_DIST is re-read. */
export function resetAssetCache(): void {
  manifest = undefined;
  warned = false;
}

function load(): Manifest | null {
  if (manifest !== undefined) return manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(distDir(), ".vite/manifest.json"), "utf8"),
    ) as Manifest;
  } catch {
    manifest = null;
    if (!warned) {
      warned = true;
      console.warn("assets: web/dist manifest not found; run `npm run web:build`");
    }
  }
  return manifest;
}

function entryChunk(m: Manifest, name: string): ManifestChunk | undefined {
  return (
    Object.values(m).find((c) => c.isEntry && c.name === name) ??
    Object.entries(m).find(
      ([k, c]) => c.isEntry && k.endsWith(`/entries/${name}.ts`),
    )?.[1]
  );
}

export function assetTags(entries: ("app" | "charts")[]): string {
  const m = load();
  if (!m) return "";
  const css = new Set<string>();
  const preload = new Set<string>();
  const scripts: string[] = [];
  for (const name of entries) {
    const entry = entryChunk(m, name);
    if (!entry) continue;
    const seen = new Set<ManifestChunk>();
    const walk = (chunk: ManifestChunk) => {
      if (seen.has(chunk)) return;
      seen.add(chunk);
      for (const f of chunk.css ?? []) css.add(f);
      for (const key of chunk.imports ?? []) {
        const dep = m[key];
        if (!dep) continue;
        preload.add(dep.file);
        walk(dep);
      }
    };
    walk(entry);
    scripts.push(entry.file);
  }
  const out: string[] = [];
  for (const f of css) out.push(`<link rel="stylesheet" href="/assets/${f}">`);
  for (const f of scripts) out.push(`<script type="module" src="/assets/${f}"></script>`);
  for (const f of preload)
    if (!scripts.includes(f)) out.push(`<link rel="modulepreload" href="/assets/${f}">`);
  return out.join("\n");
}

/** Absolute path of a built asset, or null for unsafe or unknown names. */
export function assetPath(name: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) return null;
  const path = join(distDir(), name);
  return existsSync(path) ? path : null;
}

/** Every hashed build file (JS, CSS, fonts) for the service worker precache; excludes sw.js itself. */
export function precacheFiles(): string[] {
  const m = load();
  if (!m) return [];
  const files = new Set<string>();
  for (const c of Object.values(m)) {
    files.add(c.file);
    for (const f of c.css ?? []) files.add(f);
    for (const f of c.assets ?? []) files.add(f);
  }
  files.delete("sw.js");
  return [...files].filter((f) => /^[A-Za-z0-9._-]+$/.test(f)).sort();
}
