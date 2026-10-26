import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const ctx = loadVodHelpers();
const AGORA = Date.parse("2026-10-25T18:00:00-03:00"); // domingo, 18h em Brasília (ms)
const sec = (iso) => Date.parse(iso) / 1000;
const jogo = (id, esporte, inicioIso, fimIso, extra = {}) => ({
  id, esporte, competicao: "X", casa: { nome: "A", escudo: "" }, fora: { nome: "B", escudo: "" },
  inicio: sec(inicioIso), fim: sec(fimIso), canais: [], provaveis: [], ...extra,
});

test("jogosDiaBrt e jogosHoraBrt usam o horário de Brasília, não o do aparelho", () => {
  assert.equal(ctx.jogosDiaBrt(sec("2026-10-26T01:30:00Z")), "2026-10-25");
  assert.equal(ctx.jogosDiaBrt(sec("2026-10-26T03:00:00Z")), "2026-10-26");
  assert.equal(ctx.jogosHoraBrt(sec("2026-10-27T00:15:00Z")), "21:15");
  assert.equal(ctx.jogosHoraBrt(sec("2026-10-26T22:30:00Z")), "19:30");
});

test("jogosAoVivo: do início até o fim; jogosVisivel: some 10 minutos depois do fim", () => {
  const j = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00");
  assert.equal(ctx.jogosAoVivo(j, Date.parse("2026-10-25T18:59:59-03:00")), false);
  assert.equal(ctx.jogosAoVivo(j, Date.parse("2026-10-25T19:00:00-03:00")), true);
  assert.equal(ctx.jogosAoVivo(j, Date.parse("2026-10-25T21:00:00-03:00")), false);
  assert.equal(ctx.jogosVisivel(j, Date.parse("2026-10-25T21:09:00-03:00")), true);
  assert.equal(ctx.jogosVisivel(j, Date.parse("2026-10-25T21:11:00-03:00")), false);
});

test("jogosSecoes: futebol em ao vivo, hoje e amanhã; terminados e depois de amanhã ficam de fora", () => {
  const jogos = [
    jogo("vivo", "futebol", "2026-10-25T17:00:00-03:00", "2026-10-25T19:00:00-03:00"),
    jogo("hoje-noite", "futebol", "2026-10-25T21:00:00-03:00", "2026-10-25T23:00:00-03:00"),
    jogo("amanha", "futebol", "2026-10-26T17:00:00-03:00", "2026-10-26T19:00:00-03:00"),
    jogo("depois", "futebol", "2026-10-27T17:00:00-03:00", "2026-10-27T19:00:00-03:00"),
    jogo("acabou-ha-5", "futebol", "2026-10-25T15:00:00-03:00", "2026-10-25T17:55:00-03:00"),
    jogo("acabou-ha-11", "futebol", "2026-10-25T15:00:00-03:00", "2026-10-25T17:49:00-03:00"),
    jogo("virou-a-noite", "futebol", "2026-10-24T22:00:00-03:00", "2026-10-25T19:30:00-03:00"), // começou ontem e ainda está no ar
  ];
  const s = ctx.jogosSecoes(jogos, AGORA);
  assert.deepEqual(s.aoVivo.map((j) => j.id), ["virou-a-noite", "vivo"]);
  assert.deepEqual(s.hoje.map((j) => j.id), ["acabou-ha-5", "hoje-noite"]);
  assert.deepEqual(s.amanha.map((j) => j.id), ["amanha"]);
  assert.deepEqual(s.outros, []);
});

test("jogosSecoes: outros esportes agrupados na ordem NFL, College Football, NBA, NHL e demais, com o dia de cada jogo", () => {
  const jogos = [
    jogo("nba1", "nba", "2026-10-26T20:00:00-03:00", "2026-10-26T22:30:00-03:00"),
    jogo("nfl-hoje", "nfl", "2026-10-25T21:15:00-03:00", "2026-10-26T00:45:00-03:00"),
    jogo("nfl-amanha", "nfl", "2026-10-26T21:15:00-03:00", "2026-10-27T00:45:00-03:00"),
    jogo("ncaaf1", "ncaaf", "2026-10-25T20:00:00-03:00", "2026-10-25T23:30:00-03:00"),
    jogo("nhl1", "nhl", "2026-10-25T22:00:00-03:00", "2026-10-26T00:30:00-03:00"),
    jogo("volei1", "volei", "2026-10-26T10:00:00-03:00", "2026-10-26T12:00:00-03:00"),
    jogo("nba-vivo", "nba", "2026-10-25T17:30:00-03:00", "2026-10-25T20:00:00-03:00"),
  ];
  const s = ctx.jogosSecoes(jogos, AGORA);
  assert.deepEqual(s.outros.map((g) => g.esporte), ["nfl", "ncaaf", "nba", "nhl", "volei"]);
  assert.deepEqual(s.outros.map((g) => g.rotulo), ["NFL", "College Football", "NBA", "NHL", "Vôlei"]);
  const nfl = s.outros[0].itens;
  assert.deepEqual(nfl.map((i) => [i.jogo.id, i.dia]), [["nfl-hoje", "hoje"], ["nfl-amanha", "amanha"]]);
  const nba = s.outros[2].itens;
  assert.deepEqual(nba.map((i) => [i.jogo.id, i.aoVivo]), [["nba-vivo", true], ["nba1", false]]);
});

test("jogosSecoes: lista torta ou vazia devolve seções vazias", () => {
  for (const entrada of [null, undefined, [], "x"]) {
    const s = ctx.jogosSecoes(entrada, AGORA);
    assert.deepEqual([s.aoVivo, s.hoje, s.amanha, s.outros], [[], [], [], []]);
  }
});

test("jogosPesoVariante: HD antes de FHD, antes de SD, antes do resto", () => {
  assert.equal(ctx.jogosPesoVariante("SporTV HD"), 0);
  assert.equal(ctx.jogosPesoVariante("SporTV FHD"), 1);
  assert.equal(ctx.jogosPesoVariante("SporTV SD"), 2);
  assert.equal(ctx.jogosPesoVariante("SporTV"), 3);
  assert.equal(ctx.jogosPesoVariante("ESPN 4K"), 3);
  assert.equal(ctx.jogosPesoVariante(null), 3);
});

const CANAIS = [
  { id: 1, name: "SporTV HD" }, { id: 2, name: "SporTV FHD" }, { id: 3, name: "SporTV SD" },
  { id: 4, name: "ESPN 2 SD" }, { id: 5, name: "ESPN 2 FHD" },
  { id: 6, name: "Premiere 1 HD" }, { id: 7, name: "Premiere 3 FHD" },
  { id: 8, name: "Globo" }, { id: 9, name: "ESPN 6 HD" }, { id: 10 }, { id: 11, name: "" },
];

test("jogosCanaisDaConta: as versões do mesmo canal viram um só, na ordem HD, FHD, SD", () => {
  const r = ctx.jogosCanaisDaConta(jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { canais: ["sportv", "espn 2"] }), CANAIS);
  assert.deepEqual(r.confirmados.map((c) => c.id), [1, 5]); // SporTV HD e ESPN 2 FHD (melhor que SD)
  assert.deepEqual(r.provaveis, []);
});

test("jogosAcaoClique: um canal confirmado na lista toca direto", () => {
  const j = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { canais: ["sportv"] });
  const a = ctx.jogosAcaoClique(j, CANAIS);
  assert.equal(a.tipo, "tocar");
  assert.equal(a.canal.id, 1);
});

test("jogosAcaoClique: vários confirmados na lista abrem a escolha", () => {
  const j = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { canais: ["espn 2", "sportv"] });
  const a = ctx.jogosAcaoClique(j, CANAIS);
  assert.equal(a.tipo, "escolher");
  assert.deepEqual(a.canais.map((c) => c.id), [5, 1]);
});

test("jogosAcaoClique: confirmado que a conta não tem, mas há outro confirmado na lista, toca o que existe", () => {
  const j = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { canais: ["canal que nao existe", "globo"] });
  const a = ctx.jogosAcaoClique(j, CANAIS);
  assert.equal(a.tipo, "tocar");
  assert.equal(a.canal.id, 8);
});

test("jogosAcaoClique: sem canal confirmado, os prováveis que existem na lista abrem a escolha (mesmo que seja um só)", () => {
  const j = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { provaveis: ["premiere 1", "premiere 2", "premiere 3"] });
  const a = ctx.jogosAcaoClique(j, CANAIS);
  assert.equal(a.tipo, "escolher");
  assert.deepEqual(a.canais.map((c) => c.id), [6, 7]);
  const so1 = jogo("b", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { provaveis: ["premiere 2", "globo"] });
  const b = ctx.jogosAcaoClique(so1, CANAIS);
  assert.equal(b.tipo, "escolher");
  assert.deepEqual(b.canais.map((c) => c.id), [8]);
});

test("jogosAcaoClique: nenhum canal da conta casa, lista vazia ou canais sem nome: nada para tocar", () => {
  const j = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { canais: ["tnt sports"], provaveis: [] });
  assert.equal(ctx.jogosAcaoClique(j, CANAIS).tipo, "nenhum");
  assert.equal(ctx.jogosAcaoClique(j, []).tipo, "nenhum");
  assert.equal(ctx.jogosAcaoClique(j, null).tipo, "nenhum");
});

test("jogosValidar: aceita só o formato v1 e descarta jogo quebrado", () => {
  const bom = jogo("a", "futebol", "2026-10-25T19:00:00-03:00", "2026-10-25T21:00:00-03:00", { canais: ["espn"] });
  const r = ctx.jogosValidar({ v: 1, gerado: 1, jogos: [bom, { id: "x" }, null, { ...bom, id: 5 }, { ...bom, inicio: "x" }] });
  assert.deepEqual(r.jogos.map((j) => j.id), ["a"]);
  assert.equal(ctx.jogosValidar({ v: 2, jogos: [] }), null);
  assert.equal(ctx.jogosValidar({ v: 1, jogos: "x" }), null);
  assert.equal(ctx.jogosValidar(null), null);
});

test("jogosLerCache: devolve a cópia guardada se tiver menos de 24 h e estiver íntegra", () => {
  const dados = { v: 1, gerado: 1, jogos: [] };
  const agora = AGORA;
  const guarda = (ts, data) => JSON.stringify({ ts, data });
  assert.equal(ctx.jogosLerCache(guarda(agora - 3600000, dados), agora).ts, agora - 3600000);
  assert.equal(ctx.jogosLerCache(guarda(agora - 25 * 3600000, dados), agora), null);
  assert.equal(ctx.jogosLerCache("{lixo", agora), null);
  assert.equal(ctx.jogosLerCache(null, agora), null);
  assert.equal(ctx.jogosLerCache(guarda(agora, { v: 9, jogos: [] }), agora), null);
});
