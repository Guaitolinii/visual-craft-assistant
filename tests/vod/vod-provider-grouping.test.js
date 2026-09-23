// tests/vod/vod-provider-grouping.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("providerKeyForItem matches dedupeVodItemsByTitle's key shape", () => {
  const ctx = loadVodHelpers();
  const item = { name: "  Duna: Parte Dois ", year: "2024" };
  assert.equal(ctx.providerKeyForItem(item), "duna: parte dois|2024");
});

test("attachProviders adds streamingProviders without mutating the input", () => {
  const ctx = loadVodHelpers();
  const items = [{ name: "Barbie", year: "2023" }, { name: "Sem Match", year: "1999" }];
  const map = { "barbie|2023": ["netflix", "max"] };
  const result = ctx.attachProviders(items, map);
  assert.deepEqual(result[0].streamingProviders, ["netflix", "max"]);
  assert.deepEqual(result[1].streamingProviders, []);
  assert.equal(items[0].streamingProviders, undefined, "input item must not be mutated");
});

test("groupItemsByProvider orders groups by providerOrder and appends 'outros' last", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders(
    [
      { name: "A", year: "2020" },
      { name: "B", year: "2021" },
      { name: "C", year: "2022" },
    ],
    { "a|2020": ["max"], "b|2021": ["netflix"] }
  );
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.deepEqual(groups.map(g => g.providerId), ["netflix", "max", "outros"]);
  assert.deepEqual(groups.find(g => g.providerId === "outros").items.map(i => i.name), ["C"]);
});

test("groupItemsByProvider omits a provider with zero matches instead of an empty row", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders([{ name: "A", year: "2020" }], { "a|2020": ["netflix"] });
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.deepEqual(groups.map(g => g.providerId), ["netflix"]);
});

test("groupItemsByProvider lists a multi-provider title in every matching group", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders([{ name: "A", year: "2020" }], { "a|2020": ["netflix", "max"] });
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.equal(groups.find(g => g.providerId === "netflix").items.length, 1);
  assert.equal(groups.find(g => g.providerId === "max").items.length, 1);
});

test("groupItemsByProvider puts a title whose only providers are outside providerOrder in 'outros' instead of dropping it", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders(
    [{ name: "A", year: "2020" }, { name: "B", year: "2021" }],
    { "a|2020": ["netflix"], "b|2021": ["globoplay"] }
  );
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.deepEqual(groups.map(g => g.providerId), ["netflix", "outros"]);
  assert.deepEqual(groups.find(g => g.providerId === "outros").items.map(i => i.name), ["B"]);
});
