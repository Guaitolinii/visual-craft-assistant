// Marcação e ligação do pré-carregamento de Filmes e Séries (celular)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("o aquecimento em fatias e o indicador discreto existem", () => {
  assert.match(html, /function createWarmer\(/);
  assert.match(html, /id="warm-chip"/);
  assert.match(html, /Preparando filmes e séries/);
});

test("o indicador só anima opacity/transform e respeita movimento reduzido", () => {
  const css = html.match(/\.warm-chip \{[\s\S]*?\}/);
  assert.ok(css, "bloco .warm-chip");
  assert.match(css[0], /transition: transform 300ms, opacity 300ms;/);
  assert.doesNotMatch(css[0], /transition:[^;]*(top|left|width|height|margin)/);
  assert.match(html, /prefers-reduced-motion: reduce\) \{[\s\S]*?\.warm-dot \{ animation: none/);
});

test("o catálogo de Filmes/Séries reaproveita as respostas já pré-carregadas (sem requisição duplicada)", () => {
  const fn = html.match(/async function loadVodCatalog\([\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fn, "loadVodCatalog");
  assert.match(fn[0], /vodFetchCategories\(creds, isSeries\)/);
  assert.match(fn[0], /vodFetchCategoryItems\(creds, isSeries, cat\.category_id\)/);
  assert.doesNotMatch(fn[0], /fetch\(xtreamApiUrl/);
});

test("começa com a conta liberada (durante o seletor) e para ao desvincular", () => {
  assert.match(html, /function ottOnOk\(d\)[\s\S]*?vodWarmStart\(\)/);
  assert.match(html, /async function ottUnlink\(\)[\s\S]*?vodWarmCancel\(\)/);
});

test("a busca de Filmes/Séries usa a lista já achatada quando o catálogo terminou de carregar", () => {
  assert.match(html, /_vodCatalogCache\.flat = allItems/);
  assert.match(html, /_vodCatalogCache\.settled && _vodCatalogCache\.flat/);
});

test("entrada: o seletor cobre a tela já no <head> (por cima do Conectando...) e sai da frente de ativação/bloqueio/erro", () => {
  assert.match(html, /classList\.add\("profile-open","profile-early"\)/);
  assert.match(html, /html\.profile-early #profile-gate \{ z-index: 2147483500; \}/);
  assert.match(html, /html\.ott-open\.profile-early body > #profile-gate \{ visibility: visible; \}/);
  // só a tela "loading" deixa o seletor por cima; sem tela da conta ou ao fechar o seletor o modo cedo acaba
  assert.match(html, /function ottShowGate\(screen\)[\s\S]*?screen !== "loading"[\s\S]*?remove\("profile-early"\)/);
  assert.match(html, /function ottHideGate\(\)[\s\S]*?remove\("ott-open", "profile-early"\)/);
  assert.match(html, /function profileCloseGate\(\)[\s\S]*?remove\("profile-early"\)/);
  // o seletor é desenhado do cache logo que a página monta, sem esperar a rede
  assert.match(html, /function profileEarlyOpen\(\)/);
  assert.match(html, /profileWire\(\);\r?\n\s*profileEarlyOpen\(\);/);
});
