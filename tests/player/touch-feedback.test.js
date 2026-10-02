// O toque no Android não pode desenhar o retângulo padrão em volta dos botões redondos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("o toque não desenha o retângulo padrão do Android", () => {
  assert.match(html, /\*\s*\{\s*-webkit-tap-highlight-color:\s*transparent;\s*\}/);
});

test(":hover do .ctrl-btn só vale com mouse (não gruda depois do toque)", () => {
  assert.match(html, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.ctrl-btn:hover \{/);
  // só existe uma regra de :hover do .ctrl-btn e ela é a que está dentro do @media acima
  assert.equal((html.match(/\.ctrl-btn:hover \{/g) || []).length, 1);
});

test("os botões de pular 10 s são redondos de verdade", () => {
  assert.match(html, /#vod-skip-back-btn, #vod-skip-fwd-btn \{[^}]*border-radius: 999px/);
});

test("botões dão retorno ao toque pelo próprio formato (:active)", () => {
  assert.match(html, /\.ctrl-btn:active \{/);
});
