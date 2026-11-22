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
