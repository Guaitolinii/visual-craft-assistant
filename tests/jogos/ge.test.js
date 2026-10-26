import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairAgendaGe, jogosDoGe } from "../../scripts/jogos/ge.mjs";
import { carregarRegras } from "../../scripts/jogos/regras.mjs";
import { GE_HTML } from "./fixtures.js";

const regras = carregarRegras();

test("extrairAgendaGe: acha o JSON embutido mesmo com chaves dentro de strings e barras escapadas", () => {
  const agenda = extrairAgendaGe(GE_HTML);
  assert.deepEqual(Object.keys(agenda), ["2026-10-26"]);
  assert.equal(agenda["2026-10-26"].championshipsAgenda.length, 2);
  assert.equal(agenda["2026-10-26"].championshipsAgenda[0].championship.note, "texto com } chave");
});

test("extrairAgendaGe: erro claro quando a página muda", () => {
  assert.throws(() => extrairAgendaGe("<html></html>"), /window\.dataSportsSchedule/);
  assert.throws(() => extrairAgendaGe("window.dataSportsSchedule = { outra: 1 }"), /sport/);
  assert.throws(() => extrairAgendaGe('window.dataSportsSchedule = { sport: {"a": {'), /incompleto/);
});

test("jogosDoGe: horário de Brasília em epoch, times, escudos e id", () => {
  const jogos = jogosDoGe(extrairAgendaGe(GE_HTML), regras);
  assert.equal(jogos.length, 2);
  const j = jogos[0];
  assert.equal(j.fonte, "ge");
  assert.equal(j.idFonte, "346999");
  assert.equal(j.esporte, "futebol");
  assert.equal(j.competicao, "Campeonato Brasileiro");
  assert.equal(j.casa.nome, "Coritiba");
  assert.equal(j.casa.escudo, "https://s.sde.globo.com/media/cfc.png");
  assert.equal(j.fora.nome, "Grêmio");
  assert.equal(j.inicio, Date.parse("2026-10-26T22:30:00Z") / 1000); // 19h30 em Brasília
  assert.equal(j.fim, j.inicio + 2 * 3600);
});

test("jogosDoGe: marcas viram canais prováveis; Cartola e Disney+ são ignoradas", () => {
  const jogos = jogosDoGe(extrairAgendaGe(GE_HTML), regras);
  assert.deepEqual(jogos[0].provaveis, regras.marcas.premiere); // Premiere + Cartola
  assert.deepEqual(jogos[1].provaveis, ["sportv", "sportv 2", "sportv 3"]); // sportv + Disney+
  assert.deepEqual(jogos[0].canais, []);
});

test("jogosDoGe: evento sem times ou sem horário válido é ignorado; agenda torta devolve lista vazia", () => {
  const agenda = {
    "2026-10-26": { championshipsAgenda: [{
      championship: { name: "X" },
      future: [
        { match: { id: 1, startDate: "2026-10-26", startHour: "19:30:00" } },
        { match: { id: 2, startDate: "lixo", startHour: "19:30:00", firstContestant: { popularName: "A" }, secondContestant: { popularName: "B" } } },
      ],
    }] },
  };
  assert.deepEqual(jogosDoGe(agenda, regras), []);
  assert.deepEqual(jogosDoGe(null, regras), []);
  assert.deepEqual(jogosDoGe({ "2026-10-26": null }, regras), []);
});

test("F6: jogosDoGe tolera campeonatos, eventos e fontes de transmissão nulos sem lançar", () => {
  const agenda = {
    "2026-10-26": {
      championshipsAgenda: [
        null,
        {
          championship: { name: "Brasileirão" },
          future: [
            null,
            {
              match: {
                id: 999,
                startDate: "2026-10-26",
                startHour: "20:00:00",
                firstContestant: { popularName: "Palmeiras", badgePng: "https://globo.com/p.png" },
                secondContestant: { popularName: "Santos", badgePng: "https://globo.com/s.png" },
                liveWatchSources: [null, { name: "SporTV" }],
              },
            },
          ],
        },
      ],
    },
  };
  const r = jogosDoGe(agenda, regras);
  assert.equal(r.length, 1);
  assert.equal(r[0].idFonte, "999");
  assert.deepEqual(r[0].provaveis, ["sportv", "sportv 2", "sportv 3"]);
});

test("F7: jogosDoGe descarta escudo inseguro e limpa tags HTML de nomes", () => {
  const agenda = {
    "2026-10-26": {
      championshipsAgenda: [{
        championship: { name: "Brasileirão" },
        future: [{
          match: {
            id: 888,
            startDate: "2026-10-26",
            startHour: "20:00:00",
            firstContestant: { popularName: "<img src=x onerror=alert(1)>", badgePng: "javascript:alert(1)" },
            secondContestant: { popularName: "Time Visitante", badgePng: "https://globo.com/logo.png" },
          },
        }],
      }],
    },
  };
  const [j] = jogosDoGe(agenda, regras);
  assert.equal(j.casa.nome, "img src=x onerror=alert(1)");
  assert.equal(j.casa.escudo, "");
  assert.equal(j.fora.escudo, "https://globo.com/logo.png");
});
