/** Import of the Health Mate "data export" ZIP (weight.csv, other.csv, ...).
 * Parsing is pure; staging and committing use the same temporary table as
 * backup imports so the review step needs no new migration.
 */
import { t } from "./i18n/index.ts";
import { readZip } from "./zip.ts";
import { metricValue, validateMetricJson, type Measure } from "./metrics.ts";

export const EXPORT_FILES = [
  "weight.csv",
  "other.csv",
  "user.csv",
  "height.csv",
  "devices.csv",
] as const;
/** One weigh-in; `d` is the export's local wall-clock time "YYYY-MM-DD HH:MM:SS". */
export type ImportRow = { d: string; m: Measure[] };
export type ParsedExport = {
  rows: ImportRow[];
  firstname: string;
  /** YYYY-MM-DD or "" and 0 (male) / 1 (female), from user.csv. */
  birthDate: string;
  sex: number;
  latestKg: number;
  heightM: number | null;
  mac: string;
  zone: string;
  /** Rows of other.csv that have no YOW metric (e.g. percentages of water). */
  ignoredMetrics: string[];
};

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") out.push(row);
  return out;
}
function table(text: string | undefined): Record<string, string>[] {
  if (!text) return [];
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  return body.map((r) =>
    Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])),
  );
}
/** Exact decimal -> wire integer and exponent, so 91.23 never becomes 91.2299999. */
export function decimal(text: string): { value: number; unit: number } | null {
  const m = /^(-?)(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  const fraction = m[3] ?? "";
  return {
    value: Number(`${m[1]}${m[2]}${fraction}`),
    unit: fraction.length ? -fraction.length : 0,
  };
}
const DATE = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)$/;
const text = (b: Uint8Array | undefined) =>
  b ? new TextDecoder().decode(b) : undefined;

const COLUMNS: [string, number][] = [
  ["Weight (kg)", 1],
  ["Fat mass (kg)", 8],
  ["Bone mass (kg)", 88],
  ["Muscle mass (kg)", 76],
  ["Hydration (kg)", 77],
];
const OTHER: Record<string, number> = { FAT_PERCENT: 6, FAT_FREE_MASS: 5 };

export function parseExport(files: Map<string, Uint8Array>): ParsedExport {
  const weights = table(text(files.get("weight.csv")));
  if (
    !weights.length ||
    !("Weight (kg)" in weights[0]) ||
    !("Date" in weights[0])
  )
    throw new Error(
      "This does not look like a Withings data export (weight.csv with weight rows was not found)",
    );
  const extra = new Map<string, Measure[]>();
  const ignored = new Set<string>();
  for (const r of table(text(files.get("other.csv")))) {
    const type = OTHER[r.type];
    const v = decimal(r.value ?? "");
    if (!type || !v) {
      if (r.type) ignored.add(r.type);
      continue;
    }
    extra.set(r.date, [...(extra.get(r.date) ?? []), { type, ...v }]);
  }
  const byDate = new Map<string, ImportRow>();
  for (const r of weights) {
    if (!DATE.test(r.Date)) continue;
    const measures: Measure[] = [];
    for (const [column, type] of COLUMNS) {
      const v = decimal(r[column] ?? "");
      if (v) measures.push({ type, ...v });
    }
    if (!measures.some((m) => m.type === 1)) continue;
    measures.push(...(extra.get(r.Date) ?? []));
    byDate.set(r.Date, { d: r.Date, m: measures });
  }
  const profile = table(text(files.get("user.csv")))[0] ?? {};
  const height = table(text(files.get("height.csv"))).at(-1)?.["Height (m)"];
  const device = table(text(files.get("devices.csv")))[0] ?? {};
  const sorted = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
  const born = Number(profile.birthdate);
  const latest = sorted.at(-1)?.m.find((m) => m.type === 1);
  return {
    rows: sorted,
    firstname: profile.firstname ?? "",
    birthDate:
      profile.birthdate && Number.isFinite(born) && born > -2e9 && born < 4e9
        ? new Date(born * 1000).toISOString().slice(0, 10)
        : "",
    sex: /^f/i.test(profile.gender ?? "") ? 1 : 0,
    latestKg: latest ? metricValue(latest.value, latest.unit) : 0,
    heightM: height && Number.isFinite(Number(height)) ? Number(height) : null,
    mac: (device.mac ?? "").toLowerCase(),
    zone: device.timezone || "UTC",
    ignoredMetrics: [...ignored].sort(),
  };
}
export async function parseExportZip(bytes: Uint8Array): Promise<ParsedExport> {
  return parseExport(await readZip(bytes, EXPORT_FILES));
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
/** Suggest the YOW user for an export from the ZIP name (data_UWE_<id>.zip) and
 * the profile's first name. */
export function suggestUser(
  users: { id: number; name: string; short_name: string }[],
  fileName: string,
  firstname: string,
): { id: number; reason: string } | null {
  const token = fold(/^data_(.+)_\d+\.zip$/i.exec(fileName)?.[1] ?? "");
  const first = fold(firstname);
  for (const [want, reason] of [
    [first, t("import.reasonFirst")],
    [token, t("import.reasonFile")],
  ] as const) {
    if (!want) continue;
    const hit = users.find(
      (u) =>
        fold(u.name) === want ||
        fold(u.name.split(/\s+/)[0]) === want ||
        fold(u.short_name) === want ||
        (want.length >= 3 && fold(u.short_name) === want.slice(0, 3)),
    );
    if (hit) return { id: hit.id, reason };
  }
  return null;
}

function offsetAt(zone: string, t: number): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(t * 1000))
    .find((p) => p.type === "timeZoneName")?.value;
  if (label === "GMT" || label === "UTC") return 0;
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(label ?? "");
  if (!m) throw new Error("Unsupported time zone");
  return (
    (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60)
  );
}
/** Wall-clock time in `zone` to epoch seconds (DST-safe except the repeated hour). */
export function localToEpoch(local: string, zone: string): number {
  const m = DATE.exec(local);
  if (!m) throw new Error("Invalid date");
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  return guess - offsetAt(zone, guess - offsetAt(zone, guess));
}
export const validZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

async function sha256(value: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const TTL = 900;
const now = () => Math.floor(Date.now() / 1000);
export type StageMeta = {
  kind: "withings";
  adminId: string;
  fileName: string;
  count: number;
  first: string;
  last: string;
  withComposition: number;
  heightM: number | null;
  mac: string;
  zone: string;
  firstname: string;
  birthDate: string;
  sex: number;
  latestKg: number;
  ignoredMetrics: string[];
};
export async function stageWithingsImport(
  db: D1Database,
  parsed: ParsedExport,
  fileName: string,
  adminId: string,
): Promise<{ id: string; meta: StageMeta }> {
  if (!parsed.rows.length) throw new Error("The export contains no weigh-ins");
  const id = crypto.randomUUID();
  const expires = now() + TTL;
  await db
    .prepare("DELETE FROM backup_staging_rows WHERE expires_at<?")
    .bind(now())
    .run();
  const meta: StageMeta = {
    kind: "withings",
    adminId,
    fileName,
    count: parsed.rows.length,
    first: parsed.rows[0].d,
    last: parsed.rows[parsed.rows.length - 1].d,
    withComposition: parsed.rows.filter((r) =>
      r.m.some((m) => m.type === 8 || m.type === 6),
    ).length,
    heightM: parsed.heightM,
    mac: parsed.mac,
    zone: parsed.zone,
    firstname: parsed.firstname,
    birthDate: parsed.birthDate,
    sex: parsed.sex,
    latestKg: parsed.latestKg,
    ignoredMetrics: parsed.ignoredMetrics,
  };
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < parsed.rows.length; i += 100)
    statements.push(
      db
        .prepare(
          "INSERT INTO backup_staging_rows(import_id,section,row_number,row_json,expires_at) VALUES(?,'withings',?,?,?)",
        )
        .bind(id, i, JSON.stringify(parsed.rows.slice(i, i + 100)), expires),
    );
  statements.push(
    db
      .prepare("INSERT INTO backup_staging_rows VALUES(?, '__meta__',0,?,?)")
      .bind(id, JSON.stringify(meta), expires),
  );
  try {
    for (let i = 0; i < statements.length; i += 10)
      await db.batch(statements.slice(i, i + 10));
  } catch (error) {
    await db
      .prepare("DELETE FROM backup_staging_rows WHERE import_id=?")
      .bind(id)
      .run();
    throw error;
  }
  return { id, meta };
}
export async function stagedMeta(
  db: D1Database,
  id: string,
  adminId: string,
): Promise<StageMeta> {
  const row = await db
    .prepare(
      "SELECT row_json FROM backup_staging_rows WHERE import_id=? AND section='__meta__' AND expires_at>=?",
    )
    .bind(id, now())
    .first<{ row_json: string }>();
  const meta = row ? (JSON.parse(row.row_json) as StageMeta) : null;
  if (!meta || meta.kind !== "withings" || meta.adminId !== adminId)
    throw new Error("This import preview has expired; upload the file again");
  return meta;
}

/** Existing readings of the user within this many seconds count as the same weigh-in. */
const NEAR = 180;
export async function commitWithingsImport(
  db: D1Database,
  id: string,
  adminId: string,
  userId: number | (() => Promise<number>),
  scaleId: number,
  zone: string,
): Promise<{ inserted: number; existing: number; invalid: number }> {
  await stagedMeta(db, id, adminId);
  if (!validZone(zone)) throw new Error("Choose a valid time zone");
  const scale = await db
    .prepare("SELECT id FROM scales WHERE id=?")
    .bind(scaleId)
    .first();
  if (!scale) throw new Error("Choose an existing scale");
  // A new user is created only after everything else has been validated.
  if (typeof userId === "function") userId = await userId();
  const user = await db
    .prepare("SELECT id FROM users WHERE id=?")
    .bind(userId)
    .first();
  if (!user) throw new Error("Choose an existing user");
  const staged = await db
    .prepare(
      "SELECT row_json FROM backup_staging_rows WHERE import_id=? AND section='withings' ORDER BY row_number",
    )
    .bind(id)
    .all<{ row_json: string }>();
  const rows = staged.results.flatMap(
    (r) => JSON.parse(r.row_json) as ImportRow[],
  );
  const known = (
    await db
      .prepare(
        "SELECT CASE WHEN time_quality='trusted' THEN meastime ELSE first_received_at END AS t FROM readings WHERE user_id=? AND weight_value IS NOT NULL ORDER BY t",
      )
      .bind(userId)
      .all<{ t: number }>()
  ).results.map((r) => Number(r.t));
  const received = now();
  let inserted = 0;
  let existing = 0;
  let invalid = 0;
  const statements: D1PreparedStatement[] = [];
  const insert =
    "INSERT OR IGNORE INTO readings(scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,weight_value,weight_unit,measures_json,group_json,payload_hash,first_received_at,last_received_at) VALUES(?,?,'import','[]',0,?,'trusted',?,?,?,?,?,?,?)";
  let at = 0;
  for (const row of rows) {
    let t: number;
    let weight: Measure | undefined;
    try {
      t = localToEpoch(row.d, zone);
      weight = row.m.find((m) => m.type === 1);
      for (const m of row.m) metricValue(m.value, m.unit);
      const group = { meastime: t, measures: row.m, source: "withings_export" };
      validateMetricJson(group);
      if (!weight || t < 946684800 || t > received + 86400)
        throw new Error("range");
    } catch {
      invalid++;
      continue;
    }
    while (at < known.length && known[at] < t - NEAR) at++;
    if (at < known.length && known[at] <= t + NEAR) {
      existing++;
      continue;
    }
    const measures = JSON.stringify(row.m);
    statements.push(
      db.prepare(insert).bind(
        scaleId,
        userId,
        t,
        weight!.value,
        weight!.unit,
        measures,
        JSON.stringify({
          meastime: t,
          measures: row.m,
          source: "withings_export",
        }),
        await sha256(`withings-export|${userId}|${t}|${measures}`),
        received,
        received,
      ),
    );
  }
  for (let i = 0; i < statements.length; i += 25)
    for (const r of await db.batch(statements.slice(i, i + 25)))
      inserted += Number(r.meta?.changes ?? 0);
  await db
    .prepare("DELETE FROM backup_staging_rows WHERE import_id=?")
    .bind(id)
    .run();
  return {
    inserted,
    existing: existing + (statements.length - inserted),
    invalid,
  };
}
