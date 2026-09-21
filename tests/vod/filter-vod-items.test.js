import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("filterVodItemsByQuery matches case-insensitively on name", () => {
  const ctx = loadVodHelpers();
  const items = [{ name: "Vingadores: Ultimato" }, { name: "Duna" }, { name: "O Poderoso Chefão" }];
  const result = ctx.filterVodItemsByQuery(items, "duna");
  assert.deepEqual(result.map(i => i.name), ["Duna"]);
});

test("filterVodItemsByQuery returns everything for an empty query", () => {
  const ctx = loadVodHelpers();
  const items = [{ name: "A" }, { name: "B" }];
  assert.deepEqual(ctx.filterVodItemsByQuery(items, ""), items);
});

test("filterVodItemsByQuery returns an empty array when nothing matches", () => {
  const ctx = loadVodHelpers();
  const items = [{ name: "A" }];
  assert.deepEqual(ctx.filterVodItemsByQuery(items, "zzz"), []);
});
