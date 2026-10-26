import { test } from "node:test";
import assert from "node:assert/strict";
import { diaBrt, inicioDoDiaBrt, somarDias, janelaDias, epochDeBrt, aaaammdd } from "../../scripts/jogos/tempo.mjs";

const AGORA = Date.parse("2026-10-25T18:00:00-03:00") / 1000; // domingo, 18h em Brasília

test("diaBrt: o dia é o de Brasília (UTC-3), não o de UTC", () => {
  assert.equal(diaBrt(Date.parse("2026-10-26T01:30:00Z") / 1000), "2026-10-25"); // 22h30 de domingo em Brasília
  assert.equal(diaBrt(Date.parse("2026-10-26T03:00:00Z") / 1000), "2026-10-26"); // meia-noite em Brasília
  assert.equal(diaBrt(Date.parse("2026-10-26T02:59:59Z") / 1000), "2026-10-25");
});

test("inicioDoDiaBrt: meia-noite de Brasília é 03:00 UTC", () => {
  assert.equal(inicioDoDiaBrt("2026-10-25"), Date.parse("2026-10-25T03:00:00Z") / 1000);
});

test("somarDias: soma e subtrai dias, inclusive virando o mês", () => {
  assert.equal(somarDias("2026-10-31", 1), "2026-11-01");
  assert.equal(somarDias("2026-11-01", -1), "2026-10-31");
  assert.equal(somarDias("2026-10-25", 0), "2026-10-25");
});

test("janelaDias: três dias a partir de hoje em Brasília, com início e fim em epoch", () => {
  const j = janelaDias(AGORA, 3);
  assert.deepEqual(j.dias, ["2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.equal(j.inicio, inicioDoDiaBrt("2026-10-25"));
  assert.equal(j.fim, inicioDoDiaBrt("2026-10-28"));
});

test("epochDeBrt: data e hora de Brasília viram epoch (com ou sem segundos)", () => {
  const esperado = Date.parse("2026-10-26T22:30:00Z") / 1000;
  assert.equal(epochDeBrt("2026-10-26", "19:30:00"), esperado);
  assert.equal(epochDeBrt("2026-10-26", "19:30"), esperado);
  assert.ok(Number.isNaN(epochDeBrt("lixo", "19:30")));
});

test("aaaammdd: tira os hífens", () => {
  assert.equal(aaaammdd("2026-10-25"), "20261025");
});
