import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarTitulo, jogosDoGuia } from "../../scripts/jogos/guia.mjs";
import { carregarRegras } from "../../scripts/jogos/regras.mjs";
import { EPG_AMOSTRA } from "./fixtures.js";

const regras = carregarRegras();

test("interpretarTitulo: futebol sem prefixo, tirando o '- Ao Vivo'", () => {
  assert.deepEqual(interpretarTitulo("Undinese x Milan - Ao Vivo", regras),
    { esporte: "futebol", competicao: "Futebol", casa: "Undinese", fora: "Milan" });
});

test("interpretarTitulo: NFL, NBA, College Football, vôlei, futsal e basquete pelo prefixo", () => {
  const r = (t) => interpretarTitulo(t, regras);
  assert.deepEqual(r("NFL: Los Angeles Rams x Las Vegas Raiders - Ao Vivo"),
    { esporte: "nfl", competicao: "NFL", casa: "Los Angeles Rams", fora: "Las Vegas Raiders" });
  assert.equal(r("NBA: San Antonio Spurs x Dallas Mavericks - Ao Vivo").esporte, "nba");
  assert.equal(r("NHL: Montreal Canadiens x Winnipeg Jets - Ao Vivo").esporte, "nhl");
  const c = r("Futebol Americano Universitário: Houston x Utah - Ao Vivo");
  assert.equal(c.esporte, "ncaaf");
  assert.equal(c.competicao, "College Football");
  assert.equal(r("Supercopa Italiana de Vôlei: Conegliano x Scandicci").esporte, "volei");
  assert.equal(r("Liga Evolución de Futsal: Brasil x Venezuela").esporte, "futsal");
  assert.equal(r("Liga Evolución de Futsal: Brasil x Venezuela").competicao, "Liga Evolución de Futsal");
  assert.equal(r("Paulista de Basquete: Franca x Mogi").esporte, "basquete");
});

test("interpretarTitulo: reprise (VT), estúdio, chamadas e títulos sem confronto não são jogo", () => {
  const r = (t) => interpretarTitulo(t, regras);
  assert.equal(r("VT - Independiente x Boca Juniors"), null);
  assert.equal(r("VT - NFL: Los Angeles Rams x Las Vegas Raiders"), null);
  assert.equal(r("Melhores momentos: Flamengo x Palmeiras"), null);
  assert.equal(r("Sportscenter Abre o Jogo - Ao Vivo"), null);
  assert.equal(r("Programação Combate"), null);
  assert.equal(r("Com o PREMIERE dá jogo!"), null);
  assert.equal(r("ESPN FIlmes: Saban"), null);
  assert.equal(r(""), null);
  assert.equal(r(null), null);
});

test("jogosDoGuia: um jogo por programa, com o canal do guia e o fim do próprio guia", () => {
  const jogos = jogosDoGuia(EPG_AMOSTRA, regras);
  const por = (canal) => jogos.filter((j) => j.canais[0] === canal);
  assert.equal(por("espn").length, 1); // só o "Osasuna x Sevilla"; a reprise e o estúdio ficam de fora
  assert.equal(por("espn 2").length, 1);
  assert.equal(por("espn 3").length, 2);
  assert.equal(por("espn 6").length, 1);
  assert.equal(por("band sports").length, 2);
  assert.equal(por("premiere 3").length, 0);
  const nfl = por("espn 2")[0];
  assert.equal(nfl.fonte, "guia");
  assert.equal(nfl.esporte, "nfl");
  assert.equal(nfl.inicio, Date.parse("2026-10-27T00:15:00Z") / 1000);
  assert.equal(nfl.fim, Date.parse("2026-10-27T03:30:00Z") / 1000);
  assert.deepEqual(nfl.provaveis, []);
});

test("jogosDoGuia: guia vazio ou torto devolve lista vazia", () => {
  assert.deepEqual(jogosDoGuia(null, regras), []);
  assert.deepEqual(jogosDoGuia({ canais: null }, regras), []);
  assert.deepEqual(jogosDoGuia({ canais: { espn: "x" } }, regras), []);
});

test("jogosDoGuia: canais que não são de esporte são ignorados", () => {
  const epg = {
    canais: {
      "adult swim": [[1000, 2000, "Spy X Family", "anime"]],
      "hbo 2": [[1000, 2000, "Godzilla x Kong", "filme"]],
      "futura": [[1000, 2000, "Manual De Sobrevivência Para O Século X X I", ""]],
    },
  };
  assert.deepEqual(jogosDoGuia(epg, regras), []);
});

test("jogosDoGuia: esporte classificado sem prefixo por vôlei ou futebol padrão", () => {
  const epg = {
    canais: {
      "sportv 2": [[1000, 2000, "Norde Vôlei x Campinas", ""]],
      "sportv": [[1000, 2000, "Flamengo x Atlético-MG", ""]],
    },
  };
  const jogos = jogosDoGuia(epg, regras);
  assert.equal(jogos.length, 2);
  assert.equal(jogos[0].esporte, "volei");
  assert.equal(jogos[1].esporte, "futebol");
});

test("interpretarTitulo: sem prefixo classifica esporte pela descrição quando informado", () => {
  const comDesc = interpretarTitulo("Time A x Time B", regras, "Superliga de Vôlei masculino");
  assert.equal(comDesc.esporte, "volei");
  const semDesc = interpretarTitulo("Time A x Time B", regras);
  assert.equal(semDesc.esporte, "futebol");
});

test("F4: Universitario x Alianza Lima (sem prefixo) é futebol, não ncaaf", () => {
  const j = interpretarTitulo("Universitario x Alianza Lima - Ao Vivo", regras);
  assert.equal(j.esporte, "futebol");
  const c = interpretarTitulo("Futebol Americano Universitário: Houston x Utah - Ao Vivo", regras);
  assert.equal(c.esporte, "ncaaf");
});

test("F5: prefixos de futebol desconhecidos são classificados como futebol", () => {
  assert.equal(interpretarTitulo("Brasileirão: Flamengo x Palmeiras", regras).esporte, "futebol");
  assert.equal(interpretarTitulo("Premier League: Arsenal x Chelsea", regras).esporte, "futebol");
  assert.equal(interpretarTitulo("Serie A: Napoli x Roma", regras).esporte, "futebol");
});
