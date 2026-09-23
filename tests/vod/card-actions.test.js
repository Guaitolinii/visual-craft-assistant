import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const ids = actions => actions.map(a => a.id);

test("canal recente: só remover", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "channel-recent", inMyList: false, canUseMyList: false })), ["recent-remove"]);
});

test("filme/série recente: Minha Lista + remover", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "continue", inMyList: false, canUseMyList: true })), ["mylist-add", "recent-remove"]);
  assert.deepEqual(ids(ctx.getCardActions({ kind: "continue", inMyList: true, canUseMyList: true })), ["mylist-remove", "recent-remove"]);
});

test("histórico antigo sem dados da série não oferece Minha Lista", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "continue", inMyList: false, canUseMyList: false })), ["recent-remove"]);
});

test("cartão do catálogo alterna a Minha Lista", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "vod", inMyList: false, canUseMyList: true })), ["mylist-add"]);
  assert.deepEqual(ids(ctx.getCardActions({ kind: "mylist", inMyList: true, canUseMyList: true })), ["mylist-remove"]);
});
