import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("toggleMyListEntry adiciona no começo e remove se já existir", () => {
  const ctx = loadVodHelpers();
  const a = { type: "vod", id: 1, title: "A" };
  const b = { type: "series", id: 7, title: "B" };
  let list = ctx.toggleMyListEntry([], a, 100);
  list = ctx.toggleMyListEntry(list, b, 200);
  assert.deepEqual(list.map(e => `${e.type}-${e.id}`), ["series-7", "vod-1"]);
  list = ctx.toggleMyListEntry(list, { type: "vod", id: "1" }, 300); // id em texto também casa
  assert.deepEqual(list.map(e => `${e.type}-${e.id}`), ["series-7"]);
});

test("isInMyList diferencia filme de série com o mesmo id", () => {
  const ctx = loadVodHelpers();
  const list = [{ type: "vod", id: 5, ts: 1 }];
  assert.equal(ctx.isInMyList(list, "vod", "5"), true);
  assert.equal(ctx.isInMyList(list, "series", 5), false);
});

test("getMyListItems filtra por tipo e ordena do mais recente", () => {
  const ctx = loadVodHelpers();
  const list = [{ type: "vod", id: 1, ts: 1 }, { type: "series", id: 2, ts: 3 }, { type: "vod", id: 3, ts: 2 }];
  assert.deepEqual(ctx.getMyListItems(list, "vod").map(e => e.id), [3, 1]);
  assert.deepEqual(ctx.getMyListItems(list, null).map(e => e.id), [2, 3, 1]);
});

test("buildMyListEntry monta a entrada a partir do item cru da API", () => {
  const ctx = loadVodHelpers();
  const serie = ctx.buildMyListEntry({ series_id: 9, name: "Dark", cover: "c.jpg", cast: "x" }, "series");
  assert.deepEqual(serie, { type: "series", id: 9, title: "Dark", cover: "c.jpg", item: { series_id: 9, name: "Dark", cover: "c.jpg" } });
  const filme = ctx.buildMyListEntry({ stream_id: 4, name: "Duna", stream_icon: "d.jpg", container_extension: "mp4" }, "vod");
  assert.equal(filme.id, 4);
  assert.equal(filme.cover, "d.jpg");
});
