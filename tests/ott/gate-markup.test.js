import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a tela de ativação tem código, QR, botão de abrir a página, contagem e novo código", () => {
  for (const id of ["ott-gate", "ott-code", "ott-qr", "ott-open-panel", "ott-copy-code", "ott-timer", "ott-new-code", "ott-blocked-title", "ott-blocked-detail", "ott-retry", "ott-offline-msg"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  for (const screen of ["loading", "activation", "blocked", "offline", "device_blocked"]) {
    assert.match(html, new RegExp(`data-ott-screen="${screen}"`), `falta a tela ${screen}`);
  }
});

test("o botão abre a página de ativação fora do app (target=_blank, sem plugin novo)", () => {
  assert.match(html, /<a[^>]*id="ott-open-panel"[^>]*target="_blank"[^>]*rel="noopener"/);
});

test("a tela cobre o app logo ao abrir (sem piscar o app antes da conta)", () => {
  assert.match(html, /<script>\(function ?\(\) ?\{try\{var q=location\.search[^<]*ott-open[^<]*<\/script>/);
  assert.match(html, /html\.ott-open #ott-gate \{ display: flex; \}/);
});

test("o texto de encerramento é o mesmo da TV", () => {
  assert.match(html, /Seu período de acesso terminou/);
  assert.match(html, /Encerrado em/);
});

test("os scripts da conta vêm antes do script principal (o carregador de testes usa o último)", () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map((m) => m[1].trim());
  const idx = (id) => scripts.indexOf(`id="${id}"`);
  assert.ok(idx("qrcodegen") > idx("epg-helpers"), "qrcodegen depois do epg-helpers");
  assert.ok(idx("ott-core") > idx("qrcodegen"), "ott-core depois do qrcodegen");
  assert.equal(scripts[scripts.length - 1], "", "o último script embutido é o principal");
});

test("os botões da tela de ativação mostram que foram tocados", () => {
  assert.match(html, /\.ott-btn:active, \.ott-btn\.is-pressed \{ transform: scale\(\.97\)/);
  assert.match(html, /classList\.add\("is-pressed"\)/);
  assert.match(html, /Código copiado!/);
});
