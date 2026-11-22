import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WEB_APP_VERSION } from "../version.ts";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

test("WEB_APP_VERSION equals package.json version and is valid SemVer", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(WEB_APP_VERSION, pkg.version);
  assert.match(WEB_APP_VERSION, SEMVER);
});

import { bodyLimit } from "../app.ts";
import { test as limitTest } from "node:test";
import assert2 from "node:assert/strict";
limitTest("body limits: Withings export ZIPs (~10 MiB) are accepted, other posts stay small", () => {
  assert2.ok(bodyLimit("/import/withings") >= 16 * 1024 * 1024);
  assert2.equal(bodyLimit("/api/backup/import"), 10 * 1024 * 1024);
  assert2.equal(bodyLimit("/users/1/goal"), 256000);
});
