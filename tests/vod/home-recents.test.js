import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("getUnifiedRecentItems merges and sorts channels, movies, and series by timestamp", () => {
  const ctx = loadVodHelpers();
  
  const channelRecents = [
    { id: "ch1", type: "channel", ts: 150 },
    { id: "ch2", type: "channel", ts: 50 }
  ];
  
  const continueMap = {
    "vod_1": { id: "vod_1", type: "vod", ts: 200 },
    "series_1": { id: "series_1", type: "series", ts: 100 }
  };
  
  const result = ctx.getUnifiedRecentItems(channelRecents, continueMap, 10);
  
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(i => i.id), ["vod_1", "ch1", "series_1", "ch2"]);
});

test("getUnifiedRecentItems caps the results at the given limit", () => {
  const ctx = loadVodHelpers();
  
  const channelRecents = [
    { id: "ch1", type: "channel", ts: 150 },
    { id: "ch2", type: "channel", ts: 50 }
  ];
  
  const continueMap = {
    "vod_1": { id: "vod_1", type: "vod", ts: 200 },
    "series_1": { id: "series_1", type: "series", ts: 100 }
  };
  
  const result = ctx.getUnifiedRecentItems(channelRecents, continueMap, 2);
  
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(i => i.id), ["vod_1", "ch1"]);
});
