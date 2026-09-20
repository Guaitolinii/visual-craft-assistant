import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("getContinueWatchingItems filters by type and sorts most-recent first", () => {
  const ctx = loadVodHelpers();
  const map = {
    a: { id: 'a', type: 'vod', ts: 100 },
    b: { id: 'b', type: 'series', ts: 200 },
    c: { id: 'c', type: 'vod', ts: 300 },
  };
  assert.deepEqual(
    ctx.getContinueWatchingItems(map, 'vod').map(i => i.id),
    ['c', 'a']
  );
});

test("getContinueWatchingItems returns an empty array when nothing matches the type", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.getContinueWatchingItems({}, 'vod'), []);
});
