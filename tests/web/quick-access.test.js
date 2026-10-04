// Acesso rápido (aba Canais) no app WEB do computador: vira uma fileira horizontal de cartões, igual às categorias de filmes.
// Aqui só marcação, CSS e funções puras; o comportamento no navegador está em scripts/dev/check-web-quick-access.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";
import { LINK_HTML_PATH } from "../ott/loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

// corpo de uma função do script principal (até a próxima função de nível zero)
function fnBody(nome) {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i > 0, "falta a função " + nome);
  const fim = html.slice(i).search(/\r?\n\}\r?\n/);
  return html.slice(i, i + fim + 3);
}

// Bloco de CSS entre os marcadores do Acesso rápido
function cssAcessoRapido() {
  const a = html.indexOf("/* ACESSO RÁPIDO (início) */");
  const b = html.indexOf("/* ACESSO RÁPIDO (fim) */");
  assert.ok(a > 0 && b > a, "marcadores do CSS do Acesso rápido");
  return html.slice(a, b);
}

const canal = (id, name) => ({ id, name, category: "Esportes" });

test("quickAccessInfo: com favoritos mostra todos eles e o contador no título pequeno", () => {
  const h = loadVodHelpers();
  const todos = Array.from({ length: 30 }, (_, i) => canal(i + 1, "Canal " + (i + 1)));
  const fav = new Set([2, 5, 9]);
  const r = h.quickAccessInfo(todos, (ch) => fav.has(ch.id));
  assert.equal(r.hasFavorites, true);
  assert.equal(r.eyebrow, "ACESSO RÁPIDO (3)");
  assert.equal(r.title, "Canais favoritos");
  assert.deepEqual(r.channels.map((c) => c.id), [2, 5, 9]);
});

test("quickAccessInfo: sem favoritos sugere os 10 primeiros canais; sem canais devolve lista vazia", () => {
  const h = loadVodHelpers();
  const todos = Array.from({ length: 30 }, (_, i) => canal(i + 1, "Canal " + (i + 1)));
  const r = h.quickAccessInfo(todos, () => false);
  assert.equal(r.hasFavorites, false);
  assert.equal(r.eyebrow, "SUGESTÕES");
  assert.equal(r.title, "Outros canais");
  assert.equal(r.channels.length, 10);
  assert.equal(r.channels[0].id, 1);
  const v = h.quickAccessInfo([], () => false);
  assert.deepEqual(v.channels, []);
});

test("carouselKeyTarget: setas andam um cartão sem dar a volta; Home/End vão às pontas; outras teclas não fazem nada", () => {
  const h = loadVodHelpers();
  assert.equal(h.carouselKeyTarget("ArrowRight", 0, 17), 1);
  assert.equal(h.carouselKeyTarget("ArrowRight", 16, 17), 16);
  assert.equal(h.carouselKeyTarget("ArrowLeft", 5, 17), 4);
  assert.equal(h.carouselKeyTarget("ArrowLeft", 0, 17), 0);
  assert.equal(h.carouselKeyTarget("Home", 9, 17), 0);
  assert.equal(h.carouselKeyTarget("End", 3, 17), 16);
  assert.equal(h.carouselKeyTarget("ArrowRight", -1, 17), 0, "foco fora dos cartões começa no primeiro");
  assert.equal(h.carouselKeyTarget("a", 3, 17), -1);
  assert.equal(h.carouselKeyTarget("ArrowRight", 0, 0), -1);
});

test("renderOnNow: no app web desenha a fileira (vod-carousel) de cartões <article> com botões focáveis", () => {
  const f = fnBody("renderOnNow");
  assert.match(f, /quickAccessInfo\(/);
  assert.match(f, /data-web-app/, "o modo fileira só liga com o atributo do build web");
  assert.match(f, /isWebApp\(\)/);
  assert.match(f, /vod-carousel/);
  assert.match(f, /classList\.toggle\("vod-row"/, "a seção vira .vod-row para ganhar setas, roda e arrastar das fileiras de filmes");
  const card = fnBody("quickAccessCardHtml");
  assert.match(card, /<article class="vod-card qa-card/);
  assert.match(card, /<button type="button" class="qa-main" data-channel-id=/);
  assert.match(card, /data-fav-id=/);
  assert.match(card, /data-tv-channel-id=/);
  assert.match(card, /tag-hls/);
  assert.match(card, /class="qa-name"/);
  assert.match(card, /aria-label="Assistir /);
  assert.match(card, /escapeHtmlText\(ch\.name\)/);
});

test("renderOnNow: o app nativo/celular segue com as linhas antigas (.now-row) e a coluna lateral", () => {
  const f = fnBody("renderOnNow");
  assert.match(f, /class="now-row /);
  assert.match(f, /list\.className = channelsToShow\.length \? "now-list vod-carousel" : "now-list"/);
  assert.match(f, /list\.className = "now-list";/);
  // a coluna e o modo antigo continuam no CSS base
  assert.match(html, /\.feature-layout \{\s*display: grid; grid-template-columns: minmax\(0, 1fr\) 20rem;/);
  assert.match(html, /@media \(max-width: 1100px\) \{[^@]*\.feature-layout \{ grid-template-columns: 1fr; \}\s*\.on-now \{ display: none; \}/);
});

test("renderOnNow: a rolagem e o foco da fileira sobrevivem ao redesenho", () => {
  const f = fnBody("renderOnNow");
  assert.match(f, /scrollLeft/);
  assert.match(f, /activeElement/);
});

test("renderOnNow: os cartões ligam reproduzir, favoritar e TV; sem favoritos mostra o estado vazio compacto", () => {
  const f = fnBody("renderOnNow");
  assert.match(f, /selectChannel\(/);
  assert.match(f, /toggleFav\(/);
  assert.match(f, /castToTv\("channel"/);
  assert.match(f, /empty-state is-compact/);
});

test("CSS do Acesso rápido: todas as regras vêm atrás de html[data-web-app] e só no computador (min-width: 1101px)", () => {
  const css = cssAcessoRapido();
  assert.match(css, /@media \(min-width: 1101px\) \{/);
  // toda regra (seletor antes de "{") começa com html[data-web-app]
  const semMedia = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  const seletores = [...semMedia.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(seletores.length > 10, "tem regras");
  for (const s of seletores) {
    for (const parte of s.split(",")) assert.match(parte.trim(), /^html\[data-web-app\]/, "sem prefixo web: " + parte.trim());
  }
});

test("CSS do Acesso rápido: a coluna lateral sai (grade de uma coluna, painel sem moldura) e o cartão segue o ritmo do .vod-card", () => {
  const css = cssAcessoRapido();
  assert.match(css, /html\[data-web-app\] \.feature-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /html\[data-web-app\] \.feature-layout \.player-stage \{ display: none; \}/);
  assert.match(css, /html\[data-web-app\] \.on-now \{[^}]*max-height: none[^}]*overflow: visible/);
  assert.match(css, /html\[data-web-app\] \.on-now \.now-list\.vod-carousel/);
  assert.match(css, /html\[data-web-app\] \.qa-card \.vod-card-logo/);
  assert.match(css, /html\[data-web-app\] \.qa-play/);
  assert.match(css, /html\[data-web-app\] \.qa-name \{[^}]*-webkit-line-clamp: 2/);
  // sem coluna fixa de 20rem em lugar nenhum do bloco web
  assert.doesNotMatch(css, /20rem/);
});

test("o bloco do Acesso rápido vem antes da faixa 769–1100 px, que continua sem painel lateral", () => {
  const a = html.indexOf("/* ACESSO RÁPIDO (fim) */");
  const faixa = html.indexOf("@media (min-width: 769px) and (max-width: 1100px)");
  assert.ok(a > 0 && faixa > a);
  assert.match(html, /@media \(max-width: 1100px\) \{[^@]*\.on-now \{ display: none; \}/);
});

test("teclado e mouse nas fileiras só são ligados pelo app web (webWire)", () => {
  const w = fnBody("webWire");
  assert.match(w, /pointerdown/);
  assert.match(w, /dragstart/);
  const k = fnBody("webOnKey");
  assert.match(k, /webCarouselKey\(ev\)/);
  // a seta dentro da fileira vem antes da ação de pular do player
  assert.ok(k.indexOf("webCarouselKey(ev)") < k.indexOf("webKeyAction(ev)"));
  assert.match(fnBody("webCarouselKey"), /carouselKeyTarget\(/);
});
