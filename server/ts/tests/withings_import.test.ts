import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { LocalSqlite } from "../sqlite.ts";
import { handleApp, type AppEnv } from "../app.ts";
import { readZip } from "../zip.ts";
import {
  decimal,
  localToEpoch,
  parseCsv,
  parseExport,
  suggestUser,
} from "../withings_import.ts";

/** Build a ZIP with deflate and stored entries (synthetic data only). */
function zip(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let n = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const stored = n++ % 2 === 1;
    const data = stored ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(stored ? 0 : 8, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(head, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(n, 8);
  end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}
const EXPORT = {
  "weight.csv":
    'Date,"Weight (kg)","Fat mass (kg)","Bone mass (kg)","Muscle mass (kg)","Hydration (kg)",Comments\n' +
    '"2026-11-21 07:33:01",91.23,18.66,3.58,68.98,48.06,\n' +
    '"2026-11-20 06:54:40",91.97,,,,,\n' +
    '"2026-11-19 06:43:51",,,,,,\n',
  "other.csv":
    'type,date,value,unit,position\nFAT_PERCENT,"2026-11-21 07:33:01",20,\nWATER_PERCENT,"2026-11-21 07:33:01",52,\n',
  "user.csv":
    "firstname,lastname,birthdate,gender,creation_date\nUwe,Test,1,male,2\n",
  "height.csv": 'Date,"Height (m)",Comments\n"2021-11-24 16:38:32",1.91,\n',
  "devices.csv":
    "mac,serial,latitude,longitude,battery_level,last_used_date,manual_geoloc,timezone,association_date\n00:24:E4:00:00:09,SN,0,0,100,1,1,Europe/Berlin,x\n",
  "raw_hr_hr.csv": "ignored,huge\n",
};

test("zip reader inflates and stores entries and ignores the rest", async () => {
  const out = await readZip(zip(EXPORT), [
    "weight.csv",
    "other.csv",
    "user.csv",
  ]);
  assert.deepEqual([...out.keys()].sort(), [
    "other.csv",
    "user.csv",
    "weight.csv",
  ]);
  assert.match(new TextDecoder().decode(out.get("weight.csv")), /91\.23/);
  await assert.rejects(
    readZip(new Uint8Array(40), ["weight.csv"]),
    /not a ZIP/,
  );
  await assert.rejects(readZip(zip(EXPORT), ["weight.csv"], 10), /too large/);
});

test("csv parsing handles quotes, BOM and CRLF; decimals stay exact", () => {
  assert.deepEqual(parseCsv('﻿a,"b,c"\r\n"d""e",f\r\n'), [
    ["a", "b,c"],
    ['d"e', "f"],
  ]);
  assert.deepEqual(decimal("91.23"), { value: 9123, unit: -2 });
  assert.deepEqual(decimal("20"), { value: 20, unit: 0 });
  assert.equal(decimal("1e3"), null);
});

test("export parsing maps columns to YOW metrics and skips empty weigh-ins", async () => {
  const parsed = parseExport(
    await readZip(zip(EXPORT), [
      "weight.csv",
      "other.csv",
      "user.csv",
      "height.csv",
      "devices.csv",
    ]),
  );
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(
    parsed.rows[1].m.map((m) => m.type),
    [1, 8, 88, 76, 77, 6],
  );
  assert.deepEqual(parsed.rows[0].m, [{ type: 1, value: 9197, unit: -2 }]);
  assert.equal(parsed.zone, "Europe/Berlin");
  assert.equal(parsed.mac, "00:24:e4:00:00:09");
  assert.equal(parsed.heightM, 1.91);
  assert.deepEqual(parsed.ignoredMetrics, ["WATER_PERCENT"]);
  assert.throws(() => parseExport(new Map()), /does not look like/);
});

test("local export times convert with the zone, including DST", () => {
  assert.equal(
    localToEpoch("2026-01-15 07:00:00", "Europe/Berlin"),
    Date.UTC(2026, 0, 15, 6) / 1000,
  );
  assert.equal(
    localToEpoch("2026-07-15 07:00:00", "Europe/Berlin"),
    Date.UTC(2026, 6, 15, 5) / 1000,
  );
  assert.equal(
    localToEpoch("2026-07-15 07:00:00", "UTC"),
    Date.UTC(2026, 6, 15, 7) / 1000,
  );
});

test("user suggestion uses the first name, then the file name", () => {
  const users = [
    { id: 1, name: "Uwe Schüßler", short_name: "UWE" },
    { id: 2, name: "Sam", short_name: "SAM" },
  ];
  assert.deepEqual(suggestUser(users, "data_X_1.zip", "Uwe"), {
    id: 1,
    reason: "first name in the export",
  });
  assert.deepEqual(suggestUser(users, "data_SAM_1795330950.zip", ""), {
    id: 2,
    reason: "name in the file name",
  });
  assert.equal(suggestUser(users, "data_Zed_1.zip", "Zed"), null);
});

test("upload, review and import through the app is repeatable without duplicates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yow-import-"));
  const store = new LocalSqlite(join(dir, "t.sqlite3"));
  const env: AppEnv = {
    DB: store.asD1(),
    YOW_BOOTSTRAP_TOKEN: "dummy-test-bootstrap-token",
  } as AppEnv;
  let cookie = "";
  let csrf = "";
  const call = (path: string, init: RequestInit = {}) =>
    handleApp(
      new Request(`https://local.test${path}`, {
        ...init,
        headers: { Cookie: cookie, ...(init.headers ?? {}) },
      }),
      env,
    );
  try {
    const first = await call("/setup");
    cookie = first.headers.get("set-cookie")!.split(";")[0];
    csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await first.text())![1];
    const set = await call("/setup", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: csrf,
        bootstrap_token: "dummy-test-bootstrap-token",
        password: "password-123",
        confirm: "password-123",
      }).toString(),
    });
    cookie = set.headers.get("set-cookie")!.split(";")[0];
    const db = env.DB;
    await db
      .prepare(
        "INSERT INTO scales(label,model,mac,secret) VALUES('Bath','WBS13','00:24:e4:00:00:09','x')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO users(id,name,short_name,height_cm,age_years,sex,reference_weight_kg,created_at) VALUES(5,'Uwe','UWE',191,40,0,90,1)",
      )
      .run();
    const page = await (await call("/import/withings")).text();
    csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(page)![1];
    const upload = async () => {
      const form = new FormData();
      form.set("_csrf", csrf);
      form.set(
        "export",
        new File([zip(EXPORT) as BlobPart], "data_UWE_1795330950.zip"),
      );
      return (
        await call("/import/withings", { method: "POST", body: form })
      ).text();
    };
    const preview = await upload();
    assert.match(preview, /Review Withings Import/i);
    assert.match(preview, /<option value="5" selected>Uwe \(UWE\)/);
    assert.match(preview, /<option value="1" selected>Bath/);
    const id = /name="import_id" value="([^"]+)"/.exec(preview)![1];
    const commit = (importId: string) => {
      const form = new FormData();
      for (const [k, v] of Object.entries({
        _csrf: csrf,
        import_id: importId,
        user_id: "5",
        scale_id: "1",
        time_zone: "Europe/Berlin",
        confirmed: "1",
      }))
        form.set(k, v);
      return call("/import/withings/commit", { method: "POST", body: form });
    };
    const done = await commit(id);
    assert.equal(done.status, 303);
    const stored = await db
      .prepare(
        "SELECT meastime,weight_value,weight_unit,attribution,measures_json FROM readings WHERE user_id=5 ORDER BY meastime",
      )
      .all<any>();
    assert.equal(stored.results.length, 2);
    assert.equal(
      stored.results[1].meastime,
      Date.UTC(2026, 10, 21, 6, 33, 1) / 1000,
    );
    assert.equal(stored.results[1].weight_value, 9123);
    assert.equal(stored.results[1].attribution, "import");
    // The same file again: nothing new, and the staged preview is single-use.
    const again = await commit(
      /name="import_id" value="([^"]+)"/.exec(await upload())![1],
    );
    assert.equal(again.status, 303);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) c FROM readings").first<any>()).c,
      2,
    );
    assert.match(await (await commit(id)).text(), /expired/);
    // Imported readings show up in the history views.
    assert.match(
      await (await call("/users/5/overview?range=all")).text(),
      /91\.23 kg/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import can create the user from the export, and a bad profile creates nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yow-import-new-"));
  const store = new LocalSqlite(join(dir, "t.sqlite3"));
  const env = {
    DB: store.asD1(),
    YOW_BOOTSTRAP_TOKEN: "dummy-test-bootstrap-token",
  } as AppEnv;
  let cookie = "";
  const call = (path: string, init: RequestInit = {}) =>
    handleApp(
      new Request(`https://local.test${path}`, {
        ...init,
        headers: { Cookie: cookie, ...(init.headers ?? {}) },
      }),
      env,
    );
  try {
    const first = await call("/setup");
    cookie = first.headers.get("set-cookie")!.split(";")[0];
    let csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await first.text())![1];
    const set = await call("/setup", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: csrf,
        bootstrap_token: "dummy-test-bootstrap-token",
        password: "password-123",
        confirm: "password-123",
      }).toString(),
    });
    cookie = set.headers.get("set-cookie")!.split(";")[0];
    const db = env.DB;
    await db
      .prepare(
        "INSERT INTO scales(label,model,mac,secret) VALUES('Bath','WBS13','00:24:e4:00:00:09','x')",
      )
      .run();
    csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(
      await (await call("/import/withings")).text(),
    )![1];
    const upload = new FormData();
    upload.set("_csrf", csrf);
    upload.set("export", new File([zip(EXPORT) as BlobPart], "data_UWE_1.zip"));
    const preview = await (
      await call("/import/withings", { method: "POST", body: upload })
    ).text();
    // No user exists: "new" is preselected and the profile is prefilled.
    assert.match(preview, /<option value="new" selected>/);
    assert.match(preview, /name="name" value="Uwe"/);
    assert.match(preview, /name="short_name" value="UWE"/);
    assert.match(preview, /name="height_cm"[^>]*value="191"/);
    const id = /name="import_id" value="([^"]+)"/.exec(preview)![1];
    const commit = (extra: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries({
        _csrf: csrf,
        import_id: id,
        user_id: "new",
        scale_id: "1",
        time_zone: "Europe/Berlin",
        confirmed: "1",
        name: "Uwe",
        short_name: "UWE",
        height_cm: "191",
        birth_date: "1985-01-27",
        sex: "0",
        reference_weight_kg: "91.23",
        ...extra,
      }))
        form.set(k, v);
      return call("/import/withings/commit", { method: "POST", body: form });
    };
    const bad = await commit({ height_cm: "5" });
    assert.match(await bad.text(), /Invalid profile fields/);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) c FROM users").first<any>()).c,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) c FROM readings").first<any>()).c,
      0,
    );
    // The preview survives the failed attempt, so the form can be corrected.
    const ok = await commit({});
    assert.equal(ok.status, 303);
    const user = await db.prepare("SELECT * FROM users").first<any>();
    assert.equal(user.name, "Uwe");
    assert.equal(user.height_cm, 191);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) c FROM scale_users").first<any>()).c,
      0,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) c FROM readings WHERE user_id=?")
          .bind(user.id)
          .first<any>()
      ).c,
      2,
    );
    assert.match(
      ok.headers.get("location")!,
      new RegExp(`/users/${user.id}/overview`),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
