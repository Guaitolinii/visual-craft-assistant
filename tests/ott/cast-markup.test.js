import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a folha de escolha da TV e o botão do player existem", () => {
  for (const id of ["tv-sheet", "tv-sheet-title", "tv-sheet-list", "tv-sheet-cancel", "tv-cast-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
});

test("o botão do player só aparece com conta ativa (ott-mode)", () => {
  assert.match(html, /body:not\(\.ott-mode\) #tv-cast-btn \{ display: none; \}/);
});
