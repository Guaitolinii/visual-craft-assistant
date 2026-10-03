import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a retomada consulta a conta e o envio pausa o celular", () => {
  assert.match(html, /async function resolveResumeWithAccount\(/);
  assert.match(html, /function pushProgressToAccount\(/);
  assert.match(html, /function pausePlayerForCast\(/);
  assert.match(html, /positionSec: currentCastPosition\(\)/);
});

test("o aviso (toast) aparece também em tela cheia", () => {
  assert.match(html, /\.toast \{[^}]*z-index: 10002/);
});
