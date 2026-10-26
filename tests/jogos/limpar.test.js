import { test } from "node:test";
import assert from "node:assert/strict";
import { limparTexto, urlSegura } from "../../scripts/jogos/limpar.mjs";

test("limparTexto: remove caracteres de controle, < e >, colapsa espaços e corta no max", () => {
  assert.equal(limparTexto("<img src=x onerror=alert(1)>"), "img src=x onerror=alert(1)");
  assert.equal(limparTexto("  Botafogo \u0000\u001f  SP  "), "Botafogo SP");
  const longo = "a".repeat(200);
  assert.equal(limparTexto(longo).length, 80);
  assert.equal(limparTexto(longo, 50).length, 50);
  assert.equal(limparTexto(null), "");
  assert.equal(limparTexto(undefined), "");
});

test("urlSegura: só aceita https:// até 300 caracteres sem espaços, aspas ou < >", () => {
  assert.equal(urlSegura("https://a.espncdn.com/x.png"), "https://a.espncdn.com/x.png");
  assert.equal(urlSegura("javascript:alert(1)"), "");
  assert.equal(urlSegura("http://x/y.png"), "");
  assert.equal(urlSegura("//x/y.png"), "");
  assert.equal(urlSegura("data:image/png;base64,AAAA"), "");
  assert.equal(urlSegura("https://x.com/\"evil\""), "");
  assert.equal(urlSegura("https://x.com/<evil>"), "");
  assert.equal(urlSegura("https://" + "a".repeat(301)), "");
  assert.equal(urlSegura(null), "");
});
