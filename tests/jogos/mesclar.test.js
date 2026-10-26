import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mesclarJogos, idDoJogo } from "../../scripts/jogos/mesclar.mjs";
import { janelaDias } from "../../scripts/jogos/tempo.mjs";

const ALIASES = JSON.parse(readFileSync(new URL("../../scripts/jogos/aliases-times.json", import.meta.url), "utf8"));
const AGORA = Date.parse("2026-10-25T18:00:00-03:00") / 1000;
const JANELA = janelaDias(AGORA, 3);
const t = (iso) => Date.parse(iso) / 1000;

const espn = (id, casa, fora, iso, extra = {}) => ({
  fonte: "espn", idFonte: id, esporte: "futebol", competicao: "LaLiga",
  casa: { nome: casa, escudo: "e1" }, fora: { nome: fora, escudo: "e2" },
  inicio: t(iso), fim: t(iso) + 7200, canais: [], provaveis: ["espn", "espn 2"], ...extra,
});
const guia = (canal, casa, fora, iso, extra = {}) => ({
  fonte: "guia", idFonte: "", esporte: "futebol", competicao: "Futebol",
  casa: { nome: casa, escudo: "" }, fora: { nome: fora, escudo: "" },
  inicio: t(iso), fim: t(iso) + 7000, canais: [canal], provaveis: [], ...extra,
});
const ge = (id, casa, fora, iso, provaveis) => ({
  fonte: "ge", idFonte: id, esporte: "futebol", competicao: "Campeonato Brasileiro",
  casa: { nome: casa, escudo: "g1" }, fora: { nome: fora, escudo: "g2" },
  inicio: t(iso), fim: t(iso) + 7200, canais: [], provaveis,
});

test("jogo da ESPN que o guia confirma: o canal do guia vira confirmado e some a lista de prováveis", () => {
  const r = mesclarJogos({
    espn: [espn("1", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z")], ge: [],
    guia: [guia("espn", "Osasuna", "Sevilla", "2026-10-26T20:05:00Z")], aliases: ALIASES, janela: JANELA,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "espn-1");
  assert.deepEqual(r[0].canais, ["espn"]);
  assert.deepEqual(r[0].provaveis, []);
  assert.equal(r[0].casa.escudo, "e1");
});

test("o mesmo jogo em dois canais do guia soma os canais, sem repetir", () => {
  const r = mesclarJogos({
    espn: [espn("1", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z")], ge: [],
    guia: [
      guia("espn", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z"),
      guia("espn 3", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z"),
      guia("espn", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z"),
    ], aliases: ALIASES, janela: JANELA,
  });
  assert.deepEqual(r[0].canais, ["espn", "espn 3"]);
});

test("sem confirmação do guia, as marcas do ge trocam os prováveis da competição; ge sem marca de TV mantém os da competição", () => {
  const r = mesclarJogos({
    espn: [
      espn("a", "Coritiba", "Grêmio", "2026-10-26T22:30:00Z", { competicao: "Brasileirão Série A", provaveis: ["premiere 1", "globo"] }),
      espn("b", "Remo", "Paysandu", "2026-10-26T21:00:00Z", { competicao: "Brasileirão Série B", provaveis: ["sportv", "premiere 2"] }),
    ],
    ge: [
      ge("g1", "Coritiba", "Grêmio", "2026-10-26T22:30:00Z", ["premiere 1", "premiere 2"]),
      ge("g2", "Remo", "Paysandu", "2026-10-26T21:00:00Z", []),
    ],
    guia: [], aliases: ALIASES, janela: JANELA,
  });
  const a = r.find((j) => j.id === "espn-a");
  const b = r.find((j) => j.id === "espn-b");
  assert.deepEqual(a.provaveis, ["premiere 1", "premiere 2"]);
  assert.deepEqual(b.provaveis, ["sportv", "premiere 2"]);
  assert.equal(r.length, 2); // os jogos do ge casaram com os da ESPN
});

test("jogo que só o ge conhece e jogo que só o guia conhece entram; id do guia é estável", () => {
  const entrada = {
    espn: [], ge: [ge("g9", "Remo", "Paysandu", "2026-10-26T21:30:00Z", ["sportv"])],
    guia: [guia("espn 2", "Dallas Cowboys", "Philadelphia Eagles", "2026-10-27T00:15:00Z", { esporte: "nfl", competicao: "NFL" })],
    aliases: ALIASES, janela: JANELA,
  };
  const r = mesclarJogos(entrada);
  assert.equal(r.length, 2);
  assert.ok(r.some((j) => j.id === "ge-g9" && j.provaveis[0] === "sportv"));
  const nfl = r.find((j) => j.esporte === "nfl");
  assert.match(nfl.id, /^guia-[0-9a-f]{8}$/);
  assert.deepEqual(nfl.canais, ["espn 2"]);
  assert.equal(mesclarJogos(entrada).find((j) => j.esporte === "nfl").id, nfl.id);
});

test("só ficam os jogos da janela (hoje, amanhã e depois de amanhã em Brasília), em ordem de horário", () => {
  const r = mesclarJogos({
    espn: [
      espn("tarde", "A", "B", "2026-10-27T20:00:00Z"),
      espn("cedo", "C", "D", "2026-10-25T20:00:00Z"),
      espn("ontem", "E", "F", "2026-10-24T20:00:00Z"),   // 17h de sábado em Brasília (fim 19h): fora
      espn("depois", "G", "H", "2026-10-28T03:00:00Z"),  // meia-noite do quarto dia em Brasília: fora
    ], ge: [], guia: [], aliases: ALIASES, janela: JANELA,
  });
  assert.deepEqual(r.map((j) => j.id), ["espn-cedo", "espn-tarde"]);
});

test("F2: jogo que começou ontem e cruza a meia-noite de Brasília é mantido na janela", () => {
  // Jogo que começa às 22:15 do dia anterior e termina às 01:45 de hoje em Brasília (04:45Z)
  const nflCruza = {
    fonte: "espn", idFonte: "nfl-madrugada", esporte: "nfl", competicao: "NFL",
    casa: { nome: "Team A", escudo: "" }, fora: { nome: "Team B", escudo: "" },
    inicio: t("2026-10-26T01:15:00Z"), fim: t("2026-10-26T04:45:00Z"),
    canais: [], provaveis: ["espn 2"],
  };
  // Janela com agora às 00:23 de Brasília em 26/10 (03:23Z)
  const janela0023 = janelaDias(t("2026-10-26T03:23:00Z"), 3);
  const r = mesclarJogos({ espn: [nflCruza], ge: [], guia: [], aliases: ALIASES, janela: janela0023 });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "espn-nfl-madrugada");
});

test("F3 (a): quando há mais de um candidato no mesmo horário, casa com o melhor (maior pontuação)", () => {
  // ESPN tem Botafogo x Vasco da Gama e Botafogo SP x Santos no mesmo horário
  const j1 = espn("bota-vasco", "Botafogo", "Vasco da Gama", "2026-10-26T20:00:00Z");
  const j2 = espn("bota-santos", "Botafogo SP", "Santos", "2026-10-26T20:00:00Z");
  // Guia tem Botafogo-SP x Santos em sportv
  const g = guia("sportv", "Botafogo-SP", "Santos", "2026-10-26T20:00:00Z");

  const r = mesclarJogos({ espn: [j1, j2], ge: [], guia: [g], aliases: ALIASES, janela: JANELA });
  const resBotaVasco = r.find((j) => j.id === "espn-bota-vasco");
  const resBotaSantos = r.find((j) => j.id === "espn-bota-santos");
  assert.deepEqual(resBotaSantos.canais, ["sportv"]);
  assert.deepEqual(resBotaVasco.canais, []);
});

test("o arquivo final não carrega campos internos (fonte, idFonte)", () => {
  const [j] = mesclarJogos({ espn: [espn("1", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z")], ge: [], guia: [], aliases: ALIASES, janela: JANELA });
  assert.deepEqual(Object.keys(j).sort(), ["canais", "casa", "competicao", "esporte", "fim", "fora", "id", "inicio", "provaveis"]);
});

test("idDoJogo: ESPN e ge usam o id da fonte; guia usa um hash dos times e do horário", () => {
  assert.equal(idDoJogo({ fonte: "espn", idFonte: "7" }, ALIASES), "espn-7");
  assert.equal(idDoJogo({ fonte: "ge", idFonte: "9" }, ALIASES), "ge-9");
  const a = idDoJogo(guia("espn", "Sevilla", "Osasuna", "2026-10-26T20:00:00Z"), ALIASES);
  const b = idDoJogo(guia("espn 3", "Osasuna", "Sevilla", "2026-10-26T20:00:00Z"), ALIASES);
  assert.equal(a, b);
});

test("mescla com nomes em idiomas diferentes: um time igual no mesmo horário une os registros", () => {
  // Um jogo da ESPN Marseille x Le Havre AC e um jogo do ge Olympique de Marselha x Le Havre
  const r1 = mesclarJogos({
    espn: [espn("marseille-1", "Marseille", "Le Havre AC", "2026-10-26T19:15:00Z", { provaveis: ["espn", "espn 2"] })],
    ge: [ge("ge-marseille", "Olympique de Marselha", "Le Havre", "2026-10-26T19:15:00Z", ["sportv"])],
    guia: [],
    aliases: ALIASES,
    janela: JANELA,
  });
  assert.equal(r1.length, 1);
  assert.equal(r1[0].id, "espn-marseille-1");
  assert.deepEqual(r1[0].provaveis, ["sportv"]);

  // Um jogo da ESPN Stade Rennais x Strasbourg e um do guia Rennes x Strasbourg
  const r2 = mesclarJogos({
    espn: [espn("rennes-1", "Stade Rennais", "Strasbourg", "2026-10-26T19:15:00Z", { provaveis: ["espn"] })],
    ge: [],
    guia: [guia("espn 4", "Rennes", "Strasbourg", "2026-10-26T19:15:00Z")],
    aliases: ALIASES,
    janela: JANELA,
  });
  assert.equal(r2.length, 1);
  assert.equal(r2[0].id, "espn-rennes-1");
  assert.deepEqual(r2[0].canais, ["espn 4"]);

  // Dois jogos DIFERENTES no mesmo horário sem nenhum time em comum continuam sendo dois jogos
  const r3 = mesclarJogos({
    espn: [espn("j1", "Arsenal", "Chelsea", "2026-10-26T19:15:00Z")],
    ge: [ge("j2", "Liverpool", "Everton", "2026-10-26T19:15:00Z", ["espn"])],
    guia: [],
    aliases: ALIASES,
    janela: JANELA,
  });
  assert.equal(r3.length, 2);
  assert.deepEqual(r3.map((j) => j.id).sort(), ["espn-j1", "ge-j2"]);
});
