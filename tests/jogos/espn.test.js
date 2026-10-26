import { test } from "node:test";
import assert from "node:assert/strict";
import { urlEspn, parseEspn, buscarEspn } from "../../scripts/jogos/espn.mjs";
import { ESPN_LALIGA, ESPN_NFL } from "./fixtures.js";

const DURACAO = { futebol: 2, nfl: 3.5, ncaaf: 3.5, nba: 2.5, nhl: 2.5, volei: 2, futsal: 2, basquete: 2.5, lutas: 4, outros: 2.5 };
const LALIGA = { id: "esp.1", espn: "soccer/esp.1", nome: "LaLiga", esporte: "futebol", provaveis: ["espn", "espn 2"] };
const NFL = { id: "nfl", espn: "football/nfl", nome: "NFL", esporte: "nfl", provaveis: ["espn 2"] };
const NCAAF = { id: "ncaaf", espn: "football/college-football", consulta: "groups=80&limit=200", nome: "College Football", esporte: "ncaaf", provaveis: ["espn 6"] };

test("urlEspn: uma data por consulta e a consulta extra da competição", () => {
  assert.equal(urlEspn(LALIGA, "2026-10-26"),
    "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261026");
  assert.equal(urlEspn(NCAAF, "2026-10-24"),
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261024&groups=80&limit=200");
});

test("parseEspn: jogo de futebol com casa/fora, escudos, início em epoch e fim pela duração do esporte", () => {
  const [j] = parseEspn(ESPN_LALIGA, LALIGA, DURACAO);
  assert.equal(j.fonte, "espn");
  assert.equal(j.idFonte, "401882828");
  assert.equal(j.esporte, "futebol");
  assert.equal(j.competicao, "LaLiga");
  assert.deepEqual(j.casa, { nome: "Sevilla", escudo: "https://a.espncdn.com/i/teamlogos/soccer/500/243.png" });
  assert.equal(j.fora.nome, "Osasuna");
  assert.equal(j.inicio, Date.parse("2026-10-26T20:00:00Z") / 1000);
  assert.equal(j.fim, j.inicio + 2 * 3600);
  assert.deepEqual(j.canais, []);
  assert.deepEqual(j.provaveis, ["espn", "espn 2"]);
});

test("parseEspn: NFL usa 3,5 h e os nomes completos em inglês; os canais prováveis são uma cópia", () => {
  const [j] = parseEspn(ESPN_NFL, NFL, DURACAO);
  assert.equal(j.esporte, "nfl");
  assert.equal(j.casa.nome, "Philadelphia Eagles");
  assert.equal(j.fora.nome, "Dallas Cowboys");
  assert.equal(j.fim - j.inicio, 3.5 * 3600);
  j.provaveis.push("x");
  assert.deepEqual(NFL.provaveis, ["espn 2"]);
});

test("parseEspn: ignora evento sem id, sem data válida, sem dois lados ou sem nome de time; resposta torta devolve lista vazia", () => {
  const base = ESPN_LALIGA.events[0];
  const lixo = {
    events: [
      { ...base, id: undefined },
      { ...base, id: "2", date: "não é data" },
      { ...base, id: "3", competitions: [{ competitors: [base.competitions[0].competitors[0]] }] },
      { ...base, id: "4", competitions: [{ competitors: [{ homeAway: "home", team: {} }, base.competitions[0].competitors[1]] }] },
    ],
  };
  assert.deepEqual(parseEspn(lixo, LALIGA, DURACAO), []);
  assert.deepEqual(parseEspn(null, LALIGA, DURACAO), []);
  assert.deepEqual(parseEspn({ events: "x" }, LALIGA, DURACAO), []);
});

test("buscarEspn: consulta cada competição em cada dia, junta, tira repetidos e segue depois de uma falha", async () => {
  const chamadas = [];
  const fetchFn = async (url) => {
    chamadas.push(url);
    if (url.includes("nfl") && url.includes("20261026")) return { ok: false, status: 500, json: async () => ({}) };
    if (url.includes("esp.1")) return { ok: true, json: async () => ESPN_LALIGA }; // devolve o mesmo jogo em dois dias
    return { ok: true, json: async () => ESPN_NFL };
  };
  const avisos = [];
  const r = await buscarEspn({
    competicoes: [LALIGA, NFL], dias: ["2026-10-25", "2026-10-26"], fetchFn, duracaoHoras: DURACAO, avisar: (m) => avisos.push(m),
  });
  assert.equal(chamadas.length, 4);
  assert.equal(r.ok, 3);
  assert.equal(r.falhas, 1);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /nfl/);
  assert.equal(r.jogos.length, 2); // 1 de LaLiga e 1 de NFL, sem repetição pelo idFonte
});

test("F6: parseEspn tolera elementos nulos em events e competitors sem lançar", () => {
  const base = ESPN_LALIGA.events[0];
  const comNulos = {
    events: [
      null,
      { ...base, id: "com-comp-nulo", competitions: [{ competitors: [null, base.competitions[0].competitors[0], base.competitions[0].competitors[1]] }] },
    ],
  };
  const res = parseEspn(comNulos, LALIGA, DURACAO);
  assert.equal(res.length, 1);
  assert.equal(res[0].idFonte, "com-comp-nulo");
});

test("F7: parseEspn descarta escudo inseguro e limpa tags HTML de nomes", () => {
  const base = ESPN_LALIGA.events[0];
  const xss = {
    events: [{
      ...base,
      id: "xss-espn",
      competitions: [{
        competitors: [
          { homeAway: "home", team: { displayName: "<img src=x onerror=alert(1)>", logo: "javascript:alert(1)" } },
          { homeAway: "away", team: { displayName: "Time Visitante", logo: "https://a.espncdn.com/logo.png" } },
        ],
      }],
    }],
  };
  const [j] = parseEspn(xss, LALIGA, DURACAO);
  assert.equal(j.casa.nome, "img src=x onerror=alert(1)");
  assert.equal(j.casa.escudo, "");
  assert.equal(j.fora.escudo, "https://a.espncdn.com/logo.png");
});
