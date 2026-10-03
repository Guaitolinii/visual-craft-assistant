// Pré-carregamento em fatias: roda em pedaços pequenos, falha de uma etapa não derruba as outras e pode ser cancelado
// (mesmo comportamento do createWarmer da TV)
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt } from "./loadOtt.js";

const agendar = (fn) => { setTimeout(fn, 0); };

test("executa as etapas na ordem, uma por fatia, e avisa o andamento", async () => {
  const o = loadOtt();
  const ordem = [];
  const andamento = [];
  const w = o.createWarmer({
    etapas: [
      { nome: "filmes", run: async () => { ordem.push("filmes"); } },
      { nome: "series", run: async () => { ordem.push("series"); } },
      { nome: "indice", run: async () => { ordem.push("indice"); } },
    ],
    agendar,
    onProgresso: (feitas, total) => andamento.push(feitas / total),
  });
  assert.equal(w.estado(), "parado");
  await w.iniciar();
  assert.deepEqual(ordem, ["filmes", "series", "indice"]);
  assert.equal(andamento[andamento.length - 1], 1);
  assert.equal(w.estado(), "pronto");
});

test("cada etapa roda numa fatia própria (nunca duas na mesma vez)", async () => {
  const o = loadOtt();
  let agendamentos = 0;
  const w = o.createWarmer({
    etapas: [{ nome: "a", run: async () => {} }, { nome: "b", run: async () => {} }],
    agendar: (fn) => { agendamentos++; setTimeout(fn, 0); },
  });
  await w.iniciar();
  assert.ok(agendamentos >= 2, "uma fatia por etapa: " + agendamentos);
});

test("falha numa etapa não derruba as outras e não trava", async () => {
  const o = loadOtt();
  const ordem = [];
  const w = o.createWarmer({
    etapas: [
      { nome: "a", run: async () => { throw new Error("rede"); } },
      { nome: "b", run: async () => { ordem.push("b"); } },
    ],
    agendar,
  });
  await w.iniciar();
  assert.deepEqual(ordem, ["b"]);
  assert.equal(w.estado(), "pronto");
});

test("cancelar para antes da próxima etapa", async () => {
  const o = loadOtt();
  const ordem = [];
  let w;
  w = o.createWarmer({
    etapas: [
      { nome: "a", run: async () => { ordem.push("a"); w.cancelar(); } },
      { nome: "b", run: async () => { ordem.push("b"); } },
    ],
    agendar,
  });
  await w.iniciar();
  assert.deepEqual(ordem, ["a"]);
  assert.equal(w.estado(), "cancelado");
});

test("chamar iniciar duas vezes não repete o trabalho", async () => {
  const o = loadOtt();
  let n = 0;
  const w = o.createWarmer({ etapas: [{ nome: "a", run: async () => { n++; } }], agendar });
  await Promise.all([w.iniciar(), w.iniciar()]);
  assert.equal(n, 1);
});
