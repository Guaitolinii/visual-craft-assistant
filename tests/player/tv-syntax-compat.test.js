// tests/player/tv-syntax-compat.test.js
//
// Garante que o(s) bloco(s) <script> inline de sintoniza-tv.html continuam
// aceitos por um parser JS configurado para o TETO REAL de sintaxe desta TV
// (ver docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md,
// seção 1.1): um SyntaxError em QUALQUER lugar do bloco impede o bloco
// INTEIRO de rodar, mesmo que o trecho quebrado nunca seja chamado -
// foi exatamente isso que quebrou o boot em 24/09/2026.
//
// IMPORTANTE: isto pega erros de SINTAXE (parse-time). NÃO pega APIs de
// runtime que talvez não existam no motor real da TV (ex.: Promise.allSettled,
// Array.prototype.flat/flatMap, AbortSignal.timeout) - para isso não existe
// atalho automatizado; a Tarefa 3 trata disso caso a caso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TV_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html");

// Teto real observado ao vivo nesta TV: aceita async/await (ES2017)
// mas REJEITA spread de objeto `{...obj}` (ES2018) e optional chaining `?.` (ES2020).
// Usamos ecmaVersion 2017 como o teto seguro.
const MAX_SAFE_ECMA_VERSION = 2017;

function extractInlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

test("todo bloco <script> inline de sintoniza-tv.html tem sintaxe aceita até ES2017 (teto real da TV)", () => {
  const html = readFileSync(TV_HTML_PATH, "utf8");
  const scripts = extractInlineScripts(html);
  assert.ok(scripts.length > 0, "nenhum bloco <script> inline encontrado - o teste não estaria testando nada");

  for (let i = 0; i < scripts.length; i++) {
    assert.doesNotThrow(
      () => acorn.parse(scripts[i], { ecmaVersion: MAX_SAFE_ECMA_VERSION, sourceType: "script", allowReturnOutsideFunction: true }),
      `bloco <script> #${i} tem sintaxe além de ES${MAX_SAFE_ECMA_VERSION} (?., ??, ??=, ||=, &&=, .at(), campos privados #x, grupos de regex nomeados/lookbehind, etc.) - isso quebra a TV inteira, não só o trecho`
    );
  }
});

test("nenhum bloco usa optional chaining (?.) ou nullish coalescing (??) mesmo em comentário-morto do editor", () => {
  const html = readFileSync(TV_HTML_PATH, "utf8");
  for (const src of extractInlineScripts(html)) {
    assert.doesNotMatch(src, /[)\]}\w]\?\./, "encontrado '?.' (optional chaining) - não suportado nesta TV");
    assert.doesNotMatch(src, /\?\?[^.]/, "encontrado '??' (nullish coalescing) - não suportado nesta TV");
  }
});
