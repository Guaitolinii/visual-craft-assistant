import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("parseXtreamCredentials extracts base/username/password from a valid Xtream M3U URL", () => {
  const ctx = loadVodHelpers();
  const result = ctx.parseXtreamCredentials("http://example-provider.test:80/get.php?username=demo_user&password=demo_pass&type=m3u_plus&output=ts");
  assert.deepEqual(result, { base: "http://example-provider.test:80", username: "demo_user", password: "demo_pass" });
});

test("parseXtreamCredentials returns null when username/password are missing", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.parseXtreamCredentials("http://127.0.0.1:8088/lista.m3u"), null);
});

test("parseXtreamCredentials returns null for an unparseable URL", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.parseXtreamCredentials("not a url"), null);
});
