// Busca no app WEB: ao clicar, só o cursor pisca; o anel laranja de foco dos campos não aparece dentro da caixa de busca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "../ott/loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("o anel de foco genérico do app web continua valendo para botões, links e selects", () => {
  assert.match(html, /html\[data-web-app\] :is\(button, a, input, select\):focus-visible \{ outline: 2px solid var\(--primary\)/);
});

test("o campo dentro de .search-box (canais e filmes) tira o anel, com especificidade maior que a regra genérica", () => {
  const generica = html.indexOf("html[data-web-app] :is(button, a, input, select):focus-visible");
  const busca = html.indexOf("html[data-web-app] .search-box input:focus-visible { outline: none; }");
  assert.ok(generica > 0 && busca > generica, "a regra da busca vem depois da genérica");
  // as duas caixas de busca usam a mesma classe
  assert.equal((html.match(/<label class="search-box"/g) || []).length, 2);
});
