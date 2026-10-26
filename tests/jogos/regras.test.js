import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarRegras, validarRegras, ESPORTES } from "../../scripts/jogos/regras.mjs";

const regras = carregarRegras();

test("regras.json carrega e passa na validação", () => {
  assert.doesNotThrow(() => validarRegras(regras));
});

test("as fontes (espn, ge, guia) existem e são booleanas; o ge está ligado", () => {
  for (const k of ["espn", "ge", "guia"]) assert.equal(typeof regras.fontes[k], "boolean");
  assert.equal(regras.fontes.ge, true);
});

test("NFL, College Football, NBA e NHL estão entre as competições, com o caminho certo da ESPN", () => {
  const por = (id) => regras.competicoes.find((c) => c.id === id);
  assert.equal(por("nfl").espn, "football/nfl");
  assert.equal(por("nfl").esporte, "nfl");
  assert.equal(por("ncaaf").espn, "football/college-football");
  assert.equal(por("ncaaf").consulta, "groups=80&limit=200");
  assert.equal(por("ncaaf").esporte, "ncaaf");
  assert.equal(por("nba").espn, "basketball/nba");
  assert.equal(por("nhl").espn, "hockey/nhl");
  assert.equal(por("bra.1").espn, "soccer/bra.1");
  assert.equal(por("bra.copa_do_brazil").espn, "soccer/bra.copa_do_brazil");
});

test("27 competições, ids únicos, esportes válidos e canais prováveis no estilo do guia (minúsculos, sem HD/FHD/SD)", () => {
  assert.equal(regras.competicoes.length, 27);
  const ids = regras.competicoes.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of regras.competicoes) {
    assert.ok(ESPORTES.includes(c.esporte), `${c.id}: esporte ${c.esporte}`);
    assert.match(c.espn, /^[a-z-]+\/[a-z0-9._-]+$/);
    assert.ok(c.nome && c.provaveis.length > 0, c.id);
    for (const canal of c.provaveis) {
      assert.equal(canal, canal.toLowerCase());
      assert.doesNotMatch(canal, /\b(hd|fhd|sd)\b/);
    }
  }
});

test("a classificação por palavras compila e põe NFL, NBA e College Football nos esportes certos", () => {
  const classificar = (prefixo) => {
    for (const r of regras.esportePorPalavra) if (new RegExp(r.padrao, "i").test(prefixo)) return r.esporte;
    return "outros";
  };
  assert.equal(classificar("NFL"), "nfl");
  assert.equal(classificar("NBA"), "nba");
  assert.equal(classificar("NHL"), "nhl");
  assert.equal(classificar("Futebol Americano Universitário"), "ncaaf");
  assert.equal(classificar("NBB"), "basquete");
  assert.equal(classificar("Paulista de Basquete"), "basquete");
  assert.equal(classificar("Supercopa Italiana de Vôlei"), "volei");
  assert.equal(classificar("Liga Evolución de Futsal"), "futsal");
  assert.equal(classificar("Copa do Brasil"), "futebol");
  assert.equal(classificar("Programa Qualquer"), "outros");
});

test("marcas do ge viram listas de canais; Disney+, Globoplay e Cartola não têm canal", () => {
  assert.deepEqual(regras.marcas.sportv, ["sportv", "sportv 2", "sportv 3"]);
  assert.equal(regras.marcas.premiere.length, 8);
  assert.equal(regras.marcas.premiere[0], "premiere 1");
  assert.equal(regras.marcas["disney+"], undefined);
  assert.equal(regras.marcas.cartola, undefined);
});

test("validarRegras recusa regras quebradas", () => {
  assert.throws(() => validarRegras({}), /fontes/);
  const ruim = JSON.parse(JSON.stringify(regras));
  ruim.competicoes[1].id = ruim.competicoes[0].id;
  assert.throws(() => validarRegras(ruim), /repetido/);
  const ruim2 = JSON.parse(JSON.stringify(regras));
  ruim2.competicoes[0].esporte = "curling";
  assert.throws(() => validarRegras(ruim2), /esporte/);
});
