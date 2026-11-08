import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "sintoniza-link.html"), "utf8");
const { epgProgressoAgora } = loadVodHelpers();
const MIN = 60000;

test("epgProgressoAgora: início, meio, fim e arredondamento", () => {
  const p = { start: 1000 * MIN, stop: 1060 * MIN };
  assert.equal(epgProgressoAgora(p, 1000 * MIN), 0);
  assert.equal(epgProgressoAgora(p, 1030 * MIN), 50);
  assert.equal(epgProgressoAgora(p, 1060 * MIN), 100);
  assert.equal(epgProgressoAgora(p, 1020 * MIN), 33);
});

test("epgProgressoAgora: fora do horário limita em 0 e 100", () => {
  const p = { start: 1000 * MIN, stop: 1060 * MIN };
  assert.equal(epgProgressoAgora(p, 900 * MIN), 0);
  assert.equal(epgProgressoAgora(p, 2000 * MIN), 100);
});

test("epgProgressoAgora: entradas inválidas devolvem 0 sem lançar erro", () => {
  assert.equal(epgProgressoAgora(null, 5), 0);
  assert.equal(epgProgressoAgora({}, 5), 0);
  assert.equal(epgProgressoAgora({ start: "1", stop: "2" }, 1), 0);
  assert.equal(epgProgressoAgora({ start: 10, stop: 10 }, 10), 0);
  assert.equal(epgProgressoAgora({ start: 10, stop: 5 }, 7), 0);
  assert.equal(epgProgressoAgora({ start: NaN, stop: 5 }, 3), 0);
  assert.equal(epgProgressoAgora({ start: 0, stop: Infinity }, 3), 0);
  assert.equal(epgProgressoAgora({ start: 0, stop: 10 }, NaN), 0);
  assert.equal(epgProgressoAgora({ start: 0, stop: 10 }, undefined), 0);
});

test("o cartão do Acesso rápido mostra o programa no ar com barra (ligação e CSS no HTML)", () => {
  assert.ok(html.includes("${quickAccessAgoraHtml(ch)}"), "o cartão chama quickAccessAgoraHtml");
  assert.ok(html.includes("escapeHtmlText(prog.title)"), "o título do programa é escapado");
  assert.ok(/\.qa-now\s*\{/.test(html) && /\.qa-bar\s*\{/.test(html), "CSS do programa e da barra");
});
