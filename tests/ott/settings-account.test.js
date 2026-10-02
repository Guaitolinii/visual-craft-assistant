import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("as Configurações têm o cartão da conta, só visível com conta ativa", () => {
  for (const id of ["ott-account-card", "ott-account-name", "ott-account-summary", "ott-account-panel", "ott-unlink-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  assert.match(html, /body:not\(\.ott-mode\) \.ott-only \{ display: none; \}/);
});

test("com conta ativa, as listas manuais (M3U, Xtream e guia) ficam escondidas", () => {
  assert.match(html, /body\.ott-mode \[data-manual-list\] \{ display: none !important; \}/);
  const marcados = html.match(/<div class="settings-card"[^>]*data-manual-list/g) || [];
  assert.equal(marcados.length, 3);
});
