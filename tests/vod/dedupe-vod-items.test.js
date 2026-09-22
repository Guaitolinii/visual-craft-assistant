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

// get_series (séries) doesn't return "year"/"added" like get_vod_streams
// (filmes) does - it returns "releaseDate" (e.g. "2019-05-10") and
// "last_modified" instead. Without reading those fallback fields, series
// items would silently degrade to name-only dedup matching (losing the
// year safety guarantee) and always sort as undefined in "Novidades" (no
// real recency ordering at all).
test("dedupeVodItemsByTitle collapses series duplicates using releaseDate/last_modified fallback", () => {
  const ctx = loadVodHelpers();
  const items = [
    { series_id: 10, name: "Round 6", releaseDate: "2021-09-17", last_modified: "1572057190" },
    { series_id: 11, name: "Round 6", releaseDate: "2021-09-17", last_modified: "1789999490" },
  ];
  const result = ctx.dedupeVodItemsByTitle(items);
  assert.deepEqual(result.map(i => i.series_id), [11]);
});

test("dedupeVodItemsByTitle keeps same-name series with different releaseDate years as separate shows", () => {
  const ctx = loadVodHelpers();
  const items = [
    { series_id: 20, name: "The Office", releaseDate: "2005-03-24", last_modified: "100" },
    { series_id: 21, name: "The Office", releaseDate: "2001-07-09", last_modified: "200" },
  ];
  const result = ctx.dedupeVodItemsByTitle(items);
  assert.equal(result.length, 2);
});

test("selectNewestVodItems sorts series by last_modified descending when added is absent", () => {
  const ctx = loadVodHelpers();
  const items = [
    { series_id: 1, name: "A", releaseDate: "2020-01-01", last_modified: "100" },
    { series_id: 2, name: "B", releaseDate: "2021-01-01", last_modified: "300" },
    { series_id: 3, name: "C", releaseDate: "2022-01-01", last_modified: "200" },
  ];
  const result = ctx.selectNewestVodItems(items, 2);
  assert.deepEqual(result.map(i => i.series_id), [2, 3]);
});
