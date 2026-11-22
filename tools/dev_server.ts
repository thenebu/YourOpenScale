/** Synthetic seeded dev server: `npm run web:build && npm run dev`. No real data. */
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSqlite } from "../server/ts/sqlite.ts";
import { assets } from "../server/ts/local.ts";
import { handleApp, type AppEnv } from "../server/ts/app.ts";
import { synth } from "../server/ts/tests/fixtures/synthetic.ts";
import type { Reading } from "../server/ts/analysis/types.ts";

const port = Number(process.env.PORT ?? 8099);
const TOKEN = "dummy-test-bootstrap-token";

const store = new LocalSqlite(join(mkdtempSync(join(tmpdir(), "yow-dev-")), "dev.sqlite3"));
const env: AppEnv = { DB: store.asD1(), YOW_BOOTSTRAP_TOKEN: TOKEN, ALLOW_HTTP_SCALE: true, ASSETS: assets() };
const call = (path: string, method = "GET", form?: URLSearchParams, cookie = "") =>
  handleApp(
    new Request("https://local.test" + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form?.toString(),
    }),
    env,
  );

// Admin setup and auto-login session.
const setup = await call("/setup");
let cookie = setup.headers.get("set-cookie")!.split(";")[0];
const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await setup.text())![1];
const done = await call(
  "/setup",
  "POST",
  new URLSearchParams({ _csrf: csrf, bootstrap_token: TOKEN, password: "password-123", confirm: "password-123" }),
  cookie,
);
cookie = done.headers.get("set-cookie")?.split(";")[0] ?? cookie;

// Synthetic data only.
const d = env.DB;
const now = Math.floor(Date.now() / 1000);
const isoDay = (daysAgo: number) => new Date((now - daysAgo * 86400) * 1000).toISOString().slice(0, 10);
await d.prepare("INSERT INTO scales(label,model,mac,secret,time_zone) VALUES('Bathroom','WBS13','00:24:e4:00:00:01','x','Europe/Berlin')").run();
await d
  .prepare(
    "INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(1,'Alex','ALX',180,40,0,82,1),(2,'Sam','SAM',165,35,1,64,1),(3,'Kim','KIM',170,30,1,60,1)",
  )
  .run();
const ins = d.prepare(
  "INSERT INTO readings(scale_id,user_id,attribution,candidate_ids,attribstatus,meastime,time_quality,weight_value,weight_unit,measures_json,payload_hash,first_received_at,last_received_at) VALUES(1,?,?,'[]',0,?,'trusted',?,-3,?,?,?,?)",
);
let n = 0;
const insert = async (userId: number | null, r: Reading) => {
  const measures = Object.entries(r.values).map(([type, v]) => ({ type: Number(type), value: Math.round(v! * 1000), unit: -3 }));
  await ins
    .bind(userId, userId ? "assigned" : "unassigned", r.t, Math.round(r.values[1]! * 1000), JSON.stringify(measures), `dev-${++n}`, r.t, r.t)
    .run();
};
const zone = "Europe/Berlin";
for (const r of synth({
  seed: 11, days: 900, start: isoDay(899), base: 88, slopePerWeek: -0.06, noiseSd: 0.4, composition: true, zone,
  weekdayEffect: [0, -0.1, 0, 0.1, 0.2, 0.6, 0.4], eveningOffset: 0.8, eveningShare: 0.15,
  gaps: [[500, 544]], outliers: [{ day: 200, delta: 3.5 }, { day: 640, delta: -4 }, { day: 820, delta: 4.2 }],
}))
  await insert(1, r);
for (const r of synth({ seed: 22, days: 40, start: isoDay(39), base: 64, noiseSd: 0.3, zone })) await insert(2, r);
for (const r of synth({ seed: 33, days: 2, start: isoDay(1), base: 70, zone })) await insert(null, r);
await d
  .prepare("INSERT INTO settings(key,value) VALUES('goal:1',?)")
  .bind(JSON.stringify({ kg: 78, date: isoDay(-120), startKg: 88, startAt: now - 899 * 86400 }))
  .run();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const hasBody = chunks.length > 0 && req.method !== "GET" && req.method !== "HEAD";
  const headers: Record<string, string> = { Cookie: cookie };
  if (req.headers["content-type"]) headers["Content-Type"] = String(req.headers["content-type"]);
  const out = await handleApp(
    new Request("https://local.test" + req.url, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }),
    env,
  );
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`up http://127.0.0.1:${port}`));
