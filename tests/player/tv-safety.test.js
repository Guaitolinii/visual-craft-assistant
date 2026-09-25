// tests/player/tv-safety.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tv = readFileSync(path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html"), "utf8");

test("TV limpa nome/categoria/logo vindos da lista M3U", () => {
  assert.match(tv, /function sanitizeLabel\(/);
  assert.match(tv, /function sanitizeImageUrl\(/);
  assert.match(tv, /sanitizeLabel\(/);
});

test("tv-nav.js está carregado via <script src>", () => {
  assert.match(tv, /<script src="tv-nav\.js"><\/script>/);
});

test("TVNav.init( é chamado no script principal", () => {
  assert.match(tv, /TVNav\.init\(/);
});

test("não existe segunda implementação duplicada de getFocusableEls no inline", () => {
  // getFocusableEls existe como wrapper de compat, mas NÃO deve ter
  // a implementação original com querySelectorAll('button:not(:disabled)...')
  assert.doesNotMatch(tv, /querySelectorAll\(\s*['"]button:not\(:disabled\):not/);
});

test("não existe focusFirstFocusable com querySelector inline (só wrapper TVNav)", () => {
  // O wrapper agora chama TVNav.focusFirst(), não faz querySelector direto
  const matches = tv.match(/function focusFirstFocusable/g);
  assert.ok(matches, "focusFirstFocusable deve existir como wrapper de compat");
  assert.equal(matches.length, 1, "deve haver exatamente uma declaração de focusFirstFocusable");
});

test("não existe tela de onboarding bloqueante (id=tv-onboarding removido)", () => {
  assert.doesNotMatch(tv, /id="tv-onboarding"/);
});

test("existe tela de Configurações (id=tv-settings-scene)", () => {
  assert.match(tv, /id="tv-settings-scene"/);
});

test("existe item Configurações na sidebar (id=sb-settings)", () => {
  assert.match(tv, /id="sb-settings"/);
});

test("existe teclado on-screen (id=tv-osk)", () => {
  assert.match(tv, /id="tv-osk"/);
});

test("campos de URL usam data-osk-target para teclado on-screen", () => {
  assert.match(tv, /id="tv-m3u-url"[^>]*data-osk-target/);
  assert.match(tv, /id="tv-epg-url"[^>]*data-osk-target/);
  assert.match(tv, /id="tv-vod-url"[^>]*data-osk-target/);
});

test("não existe bloqueio de ArrowLeft/ArrowRight em inputs", () => {
  // O bug original: active.tagName === 'INPUT' && indexOf(...ArrowLeft/ArrowRight) === -1) return
  assert.doesNotMatch(tv, /tagName === 'INPUT' && \[.*ArrowDown.*ArrowUp.*\]\.indexOf/);
});

test("CSS não tem cursor: none em .tv-btn (deve ser cursor: pointer)", () => {
  // Lê o CSS separadamente
  const css = readFileSync(path.join(__dirname, "..", "..", "sintoniza-tv", "tv-styles.css"), "utf8");
  // .tv-btn deve ter cursor: pointer, não cursor: none
  assert.doesNotMatch(css, /\.tv-btn\s*\{[^}]*cursor:\s*none/);
  assert.match(css, /\.tv-btn\s*\{[^}]*cursor:\s*pointer/);
});

test("o app principal não tem style=display:none (boot direto na Home)", () => {
  assert.doesNotMatch(tv, /id="tv-app"\s*style="display:\s*none"/);
});

test("leitura de querystring (?lista=, ?epg=, ?vod=) está implementada", () => {
  assert.match(tv, /params\.get\('lista'\)/);
  assert.match(tv, /params\.get\('epg'\)/);
  assert.match(tv, /params\.get\('vod'\)/);
});

test("existe uma rede de segurança visível para erros não capturados (window.onerror mostra overlay na tela)", () => {
  assert.match(tv, /id="tv-fatal-error"/);
  assert.match(tv, /window\.addEventListener\(\s*['"]error['"]/);
  assert.match(tv, /window\.addEventListener\(\s*['"]unhandledrejection['"]/);
});

test("a rede de segurança é o PRIMEIRO <script> inline do documento (roda antes de qualquer outro código)", () => {
  const firstInlineScript = tv.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.match(firstInlineScript, /tv-fatal-error/);
});
