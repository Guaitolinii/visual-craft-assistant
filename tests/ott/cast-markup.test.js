import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a folha de escolha da TV e o botão do player existem", () => {
  for (const id of ["tv-sheet", "tv-sheet-title", "tv-sheet-list", "tv-sheet-cancel", "tv-cast-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
});

test("o botão do player só aparece com conta ativa (ott-mode)", () => {
  assert.match(html, /body:not\(\.ott-mode\) #tv-cast-btn \{ display: none; \}/);
});

test("há botão Assistir na TV no modal, nos episódios e nos canais", () => {
  assert.match(html, /id="vod-modal-tv"/);
  assert.match(html, /data-ep-tv=/);
  assert.match(html, /data-tv-channel-id=/);
  assert.match(html, /body:not\(\.ott-mode\) \.tv-only \{ display: none; \}/);
});

test("o botão da TV nunca fica dentro de outro botão (irmão do favorito e do episódio)", () => {
  // no episódio: o botão da TV vem depois do fechamento do .ep-btn
  assert.match(html, /<\/button>\$\{epTvBtn\}/);
  // nos cartões de filme/série não entra botão da TV (só no modal)
  const ini = html.indexOf("function vodCardHtml(");
  const card = html.slice(ini, html.indexOf("\nfunction ", ini + 10));
  assert.ok(ini > 0 && !/tv-only|data-tv/.test(card), "o cartão de filme/série não pode ter botão da TV");
});

test("na tela cheia o botão de TV substitui o de enquadramento", () => {
  assert.match(html, /id="fs-tv-btn"/);
  assert.doesNotMatch(html, /id="fs-fit-btn"/);
  assert.match(html, /function castCurrentToTv\(/);
  assert.doesNotMatch(html, /getElementById\("fs-fit-btn"\)/);
});
