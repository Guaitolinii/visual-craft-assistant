// Marcação e ligação dos atalhos Canais/Filmes/Séries do Início vazio (celular)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("os três botões existem, abaixo do retângulo pontilhado, com o ícone da barra inferior", () => {
  const empty = html.indexOf('id="home-empty"');
  const cta = html.indexOf('id="home-cta"');
  assert.ok(empty > 0 && cta > empty, "o bloco de atalhos vem depois do 'Nada assistido ainda'");
  assert.match(html, /Comece por aqui/);
  assert.match(html, /Escolha algo para assistir agora/);
  // mesmos ícones lucide da barra inferior: Canais monitor-play, Filmes film, Séries tv
  assert.match(html, /id="home-cta-channels"[\s\S]*?data-lucide="monitor-play"/);
  assert.match(html, /id="home-cta-movies"[\s\S]*?data-lucide="film"/);
  assert.match(html, /id="home-cta-series"[\s\S]*?data-lucide="tv"/);
  for (const t of ["Canais", "Filmes", "Séries"]) assert.match(html, new RegExp(`<strong>${t}</strong><small>[^<]+</small>`));
});

test("os botões usam a mesma ação da barra inferior (setSection / openVodSection)", () => {
  const fn = html.match(/function wireHomeCta\(\) \{[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fn, "wireHomeCta");
  assert.match(fn[0], /setSection\("Todos os canais"\)/);
  assert.match(fn[0], /openVodSection\("movies"\)/);
  assert.match(fn[0], /openVodSection\("series"\)/);
  assert.match(fn[0], /is-pressed/);
});

test("só aparecem quando o Início está vazio (homeIsEmptyForProfile) e somem no re-render", () => {
  const fn = html.match(/function renderHomeLists\(\) \{[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fn, "renderHomeLists");
  assert.match(fn[0], /homeIsEmptyForProfile\(/);
  assert.match(fn[0], /getElementById\("home-cta"\)\.style\.display/);
});

test("toque: alvo >= 48 px, feedback :active/.is-pressed, sem destaque nativo, sem estourar a largura", () => {
  const css = html.match(/\.home-cta-btn \{[\s\S]*?\}/);
  assert.ok(css, "bloco .home-cta-btn");
  assert.match(css[0], /min-height: 4\.5rem;/); // 72 px
  assert.match(css[0], /-webkit-tap-highlight-color: transparent;/);
  assert.match(css[0], /min-width: 0;/);
  assert.match(html, /\.home-cta-btn:active, \.home-cta-btn\.is-pressed \{/);
  assert.match(html, /prefers-reduced-motion: reduce\) \{[\s\S]*?\.home-cta-btn/);
});
