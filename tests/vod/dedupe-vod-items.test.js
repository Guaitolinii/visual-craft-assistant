import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("dedupeVodItemsByTitle collapses same name + same year down to the most recently added copy", () => {
  const ctx = loadVodHelpers();
  const items = [
    { stream_id: 30438, name: "Rainhas do Crime", year: "2019", added: "1572057190" },
    { stream_id: 398545, name: "Rainhas do Crime", year: "2019", added: "1789999490" },
  ];
  const result = ctx.dedupeVodItemsByTitle(items);
  assert.deepEqual(result.map(i => i.stream_id), [398545]);
});

test("dedupeVodItemsByTitle keeps same-name items with different years as separate films", () => {
  const ctx = loadVodHelpers();
  const items = [
    { stream_id: 395290, name: "O Guarda-Costas", year: "2004", added: "1788551773" },
    { stream_id: 339942, name: "O Guarda-Costas", year: "1992", added: "1755271173" },
  ];
  const result = ctx.dedupeVodItemsByTitle(items);
  assert.equal(result.length, 2);
});

test("dedupeVodItemsByTitle never merges differently-named sequels (e.g. Harry Potter installments)", () => {
  const ctx = loadVodHelpers();
  const items = [
    { stream_id: 1, name: "Harry Potter e a Pedra Filosofal", year: "2001", added: "100" },
    { stream_id: 2, name: "Harry Potter e a Câmara Secreta", year: "2002", added: "200" },
  ];
  const result = ctx.dedupeVodItemsByTitle(items);
  assert.equal(result.length, 2);
});

test("selectNewestVodItems sorts by added descending and caps at the given limit", () => {
  const ctx = loadVodHelpers();
  const items = [
    { stream_id: 1, name: "A", added: "100" },
    { stream_id: 2, name: "B", added: "300" },
    { stream_id: 3, name: "C", added: "200" },
  ];
  const result = ctx.selectNewestVodItems(items, 2);
  assert.deepEqual(result.map(i => i.stream_id), [2, 3]);
});
