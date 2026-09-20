import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("xtreamApiUrl builds a player_api.php URL with username/password/action", () => {
  const ctx = loadVodHelpers();
  const creds = { base: "http://example-provider.test:80", username: "demo_user", password: "demo_pass" };
  assert.equal(
    ctx.xtreamApiUrl(creds, "get_vod_categories"),
    "http://example-provider.test:80/player_api.php?username=demo_user&password=demo_pass&action=get_vod_categories"
  );
});

test("xtreamApiUrl appends extra params", () => {
  const ctx = loadVodHelpers();
  const creds = { base: "http://example-provider.test:80", username: "demo_user", password: "demo_pass" };
  assert.equal(
    ctx.xtreamApiUrl(creds, "get_vod_streams", { category_id: "5" }),
    "http://example-provider.test:80/player_api.php?username=demo_user&password=demo_pass&action=get_vod_streams&category_id=5"
  );
});
