import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, "..", "..", "sintoniza-link.html"), "utf8");

function buttonHtml(id) {
  const match = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`));
  assert.ok(match, `botão ${id} não encontrado`);
  return match[0];
}

test("player não tem mais volume, barra ao vivo nem telemetria", () => {
  for (const id of ["mute-btn", "vol-slider", "live-bar", "live-label", "progress-fill", "debug-toggle-btn", "player-debug-overlay", "pref-vol"]) {
    assert.ok(!html.includes(`id="${id}"`), `id="${id}" ainda existe no HTML`);
  }
});

test("tela cheia tem linha do tempo, ±10s, girar, bloquear e sair", () => {
  for (const id of ["fs-ui", "fs-seek-bar", "fs-skip-back-btn", "fs-skip-fwd-btn", "fs-play-btn", "fs-rotate-btn", "fs-fit-btn", "fs-lock-btn", "fs-exit-btn", "fs-lock-shield", "fs-unlock-btn"]) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" não existe`);
  }
  assert.match(html, /Toque no cadeado para desbloquear/);
});

test("botões de ±10s desenham o número 10 dentro do próprio ícone", () => {
  for (const id of ["vod-skip-back-btn", "vod-skip-fwd-btn"]) {
    assert.match(buttonHtml(id), /<svg[\s\S]*<text[^>]*>10<\/text>[\s\S]*<\/svg>/);
  }
});

test("mini-player some enquanto o menu das 3 listras está aberto", () => {
  assert.match(html, /body\.sidebar-open #player-screen\.mini-player\s*\{[^}]*display:\s*none/);
  assert.match(html, /document\.body\.classList\.add\("sidebar-open"\)/);
  assert.match(html, /document\.body\.classList\.remove\("sidebar-open"\)/);
});

test("mini-player tem um x para fechar", () => {
  assert.ok(html.includes('id="mini-close-btn"'), "botão x do mini-player não existe");
  assert.match(html, /#player-screen\.mini-player \.mini-close-btn\s*\{[^}]*display:\s*flex/);
  assert.match(html, /function closeMiniPlayer\(\)/);
});

test("sem avisos técnicos de buffer/reconexão na tela", () => {
  for (const text of ["Blindagem ativa", "Conexão demorando", "Canal instável — reconectando", "Recarregando sinal de"]) {
    assert.ok(!html.includes(text), `aviso técnico "${text}" ainda existe`);
  }
});
