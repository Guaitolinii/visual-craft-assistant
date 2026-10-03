// Início do perfil novo: só mostra os atalhos quando não há NADA assistido nem favoritado
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const vazio = { continueCount: 0, recentChannels: 0, favChannels: 0, myListCount: 0 };
const e = (o) => loadVodHelpers().homeIsEmptyForProfile({ ...vazio, ...o });

test("perfil novo (tudo zerado) é vazio", () => {
  assert.equal(e({}), true);
});

test("qualquer coisa assistida tira o estado vazio", () => {
  assert.equal(e({ continueCount: 1 }), false);
  assert.equal(e({ recentChannels: 2 }), false);
});

test("qualquer favorito tira o estado vazio (canal favorito ou Minha lista)", () => {
  assert.equal(e({ favChannels: 1 }), false);
  assert.equal(e({ myListCount: 3 }), false);
});

test("entradas ausentes, negativas ou inválidas contam como zero", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.homeIsEmptyForProfile({}), true);
  assert.equal(ctx.homeIsEmptyForProfile(), true);
  assert.equal(ctx.homeIsEmptyForProfile({ continueCount: -1, recentChannels: null, favChannels: "x", myListCount: NaN }), true);
  assert.equal(ctx.homeIsEmptyForProfile({ recentChannels: "2" }), false);
});
