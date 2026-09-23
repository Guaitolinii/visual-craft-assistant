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

test("botões de ±10s desenham o número 10 dentro do próprio ícone", () => {
  for (const id of ["vod-skip-back-btn", "vod-skip-fwd-btn"]) {
    assert.match(buttonHtml(id), /<svg[\s\S]*<text[^>]*>10<\/text>[\s\S]*<\/svg>/);
  }
});
