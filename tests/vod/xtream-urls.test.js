import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("buildVodStreamUrl builds the movie/ direct URL", () => {
  const ctx = loadVodHelpers();
  const creds = { base: "http://example-provider.test:80", username: "demo_user", password: "demo_pass" };
  assert.equal(
    ctx.buildVodStreamUrl(creds, "12345", "mp4"),
    "http://example-provider.test:80/movie/demo_user/demo_pass/12345.mp4"
  );
});

test("buildVodStreamUrl defaults the extension to mp4 when none is given", () => {
  const ctx = loadVodHelpers();
  const creds = { base: "http://example-provider.test:80", username: "demo_user", password: "demo_pass" };
  assert.equal(
    ctx.buildVodStreamUrl(creds, "12345", ""),
    "http://example-provider.test:80/movie/demo_user/demo_pass/12345.mp4"
  );
});

test("buildSeriesEpisodeUrl builds the series/ direct URL", () => {
  const ctx = loadVodHelpers();
  const creds = { base: "http://example-provider.test:80", username: "demo_user", password: "demo_pass" };
  assert.equal(
    ctx.buildSeriesEpisodeUrl(creds, "98765", "mkv"),
    "http://example-provider.test:80/series/demo_user/demo_pass/98765.mkv"
  );
});
