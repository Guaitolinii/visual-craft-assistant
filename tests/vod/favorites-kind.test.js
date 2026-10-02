import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "./loadVodHelpers.js";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("o tipo de favorito inválido volta para canais", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.normalizeFavKind("vod"), "vod");
  assert.equal(ctx.normalizeFavKind("series"), "series");
  assert.equal(ctx.normalizeFavKind("channels"), "channels");
  assert.equal(ctx.normalizeFavKind("lixo"), "channels");
  assert.equal(ctx.normalizeFavKind(null), "channels");
});

test("rótulos em português", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.favKindLabel("channels"), "Canais");
  assert.equal(ctx.favKindLabel("vod"), "Filmes");
  assert.equal(ctx.favKindLabel("series"), "Séries");
});

test("busca nos favoritos de filmes e séries ignora acento e caixa", () => {
  const ctx = loadVodHelpers();
  const lista = [{ title: "Ação Total" }, { title: "Drama C" }, { title: "Amor à Vida" }];
  assert.deepEqual(ctx.filterMyListEntries(lista, "acao").map((e) => e.title), ["Ação Total"]);
  assert.deepEqual(ctx.filterMyListEntries(lista, "").length, 3);
  assert.deepEqual(ctx.filterMyListEntries(lista, "xyz"), []);
});

test("o seletor Canais/Filmes/Séries fica ao lado do título dos Favoritos", () => {
  assert.match(html, /<div class="section-controls">\s*<div class="fav-kind-tabs" id="fav-kind-tabs"/);
  for (const kind of ["channels", "vod", "series"]) assert.match(html, new RegExp(`data-fav-kind="${kind}"`));
});

test("o clique nos cartões de filme/série também funciona dentro da aba Favoritos", () => {
  assert.match(html, /getElementById\("channel-container"\)\.addEventListener\("click", onVodCardAreaClick\)/);
});
