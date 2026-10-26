import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const yml = readFileSync(new URL("../../.github/workflows/jogos.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("agenda a cada 3 horas e permite rodar na mão", () => {
  assert.match(yml, /cron: "23 \*\/3 \* \* \*"/);
  assert.match(yml, /workflow_dispatch:/);
});

test("escreve só no conteúdo do repositório e nunca roda duas vezes ao mesmo tempo", () => {
  assert.match(yml, /permissions:\n  contents: write/);
  assert.match(yml, /concurrency:\n  group: jogos/);
});

test("trabalha na branch de dados e baixa o gerador da branch de código (CODE_REF)", () => {
  assert.match(yml, /ref: vod-data/);
  assert.match(yml, /CODE_REF: v24/);
  assert.match(yml, /git archive FETCH_HEAD scripts\/jogos \| tar -x -C \.gerador/);
});

test("gera com o guia da própria branch e commita SÓ o jogos.json", () => {
  assert.match(yml, /node \.gerador\/scripts\/jogos\/build\.mjs --epg epg-extra\.json --out jogos\.json/);
  assert.match(yml, /rm -rf \.gerador/);
  assert.match(yml, /git add jogos\.json/);
  assert.doesNotMatch(yml, /git add \.(\s|$)/);
});

test("a falha do gerador nunca é escondida (o último arquivo bom fica na branch)", () => {
  assert.doesNotMatch(yml, /continue-on-error/);
  assert.doesNotMatch(yml, /\|\| true/);
  assert.doesNotMatch(yml, /if: always\(\)/);
});
