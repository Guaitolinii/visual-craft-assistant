import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("computeDirectPlayRetryDelayMs backs off between the first and second retry", () => {
  const ctx = loadVodHelpers();
  const first = ctx.computeDirectPlayRetryDelayMs(1);
  const second = ctx.computeDirectPlayRetryDelayMs(2);
  assert.ok(first > 0 && first <= 1500, `expected first retry delay in (0, 1500], got ${first}`);
  assert.ok(second > first, `expected second retry delay to be longer than first, got ${second} vs ${first}`);
});
