import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };
const T0 = Date.parse("2026-10-03T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
// item da conta de teste: filme f:<n>, episódio e:<n>, canal c:<nome>
const I = (k, extra) => ({ k, tipo: k[0] === "c" ? "canal" : k[0] === "f" ? "filme" : "episodio", titulo: k, capa: "", meta: {}, pos: 100, dur: 6000, em: iso(T0), ...extra });
const keys = (l) => l.map((i) => i.k);

const FILME_LOCAL = { id: "resume-vod-5", type: "vod", title: "Filme X", cover: "https://x/p.jpg", url: "http://srv.falso/movie/usuario/senha/5.mkv", progress: 1234.7, duration: 6000.2, ts: T0, vodItem: { stream_id: 5, name: "Filme X", container_extension: "mkv", year: "2020" } };
const EP_LOCAL = { id: "resume-series-9", type: "series", title: "Série Y · S02E03", cover: "https://x/s.jpg", url: "http://srv.falso/series/usuario/senha/9.mp4?x=1", progress: 100, duration: 3000, ts: T0 - 1000, vodItem: { series_id: 2, name: "Série Y", cover: "https://x/s.jpg", releaseDate: "2019-05-10" } };

test("chaves do histórico iguais às da TV (só ids)", () => {
  const o = loadOtt();
  assert.equal(o.ottHistKeyMovie("123"), "f:123");
  assert.equal(o.ottHistKeyMovie(5), "f:5");
  assert.equal(o.ottHistKeyMovie("12;x"), null);
  assert.equal(o.ottHistKeyEpisode("9"), "e:9");
  assert.equal(o.ottHistKeyEpisode(""), null);
  assert.equal(o.ottHistKeyChannel("  Globo   SP "), "c:globo sp");
  assert.equal(o.ottHistKeyChannel("Cinéma Ação"), "c:cinema acao");
  assert.equal(o.ottHistKeyChannel("   "), null);
  assert.equal(o.ottHistKeyFromContinueId("resume-vod-5"), "f:5");
  assert.equal(o.ottHistKeyFromContinueId("resume-series-77"), "e:77");
  assert.equal(o.ottHistKeyFromContinueId("resume-vod-5;x"), null);
  assert.equal(o.ottHistKeyFromContinueId("qualquer"), null);
  assert.equal(o.ottHistKeyFromContinueId(null), null);
});

test("terminado: faltando menos de 60 s ou 97%; canal e duração desconhecida nunca terminam", () => {
  const o = loadOtt();
  // 100 min: 97% = 5820 s, dur-60 = 5940 s -> vale o que vier primeiro (97%)
  assert.equal(o.ottHistFinished({ tipo: "filme", pos: 5820, dur: 6000 }), true);
  assert.equal(o.ottHistFinished({ tipo: "filme", pos: 5819, dur: 6000 }), false);
  assert.equal(o.ottHistFinished({ tipo: "filme", pos: 5990, dur: 6000 }), true);
  // 10 min: dur-60 = 540 s vem antes de 97% (582 s)
  assert.equal(o.ottHistFinished({ tipo: "episodio", pos: 540, dur: 600 }), true);
  assert.equal(o.ottHistFinished({ tipo: "episodio", pos: 539, dur: 600 }), false);
  assert.equal(o.ottHistFinished({ tipo: "canal", pos: 0, dur: 0 }), false);
  assert.equal(o.ottHistFinished({ tipo: "filme", pos: 500, dur: 0 }), false);
  assert.equal(o.ottHistFinished(null), false);
});

test("continuar assistindo do aparelho vira itens da conta (só ids e metadados, nunca o link)", () => {
  const o = loadOtt();
  const itens = plain(o.ottHistItemsFromContinue({ "resume-vod-5": FILME_LOCAL, "resume-series-9": EP_LOCAL }));
  assert.deepEqual(itens, [
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "https://x/p.jpg", meta: { ext: "mkv", ano: 2020 }, pos: 1234, dur: 6000, em: iso(T0) },
    { k: "e:9", tipo: "episodio", titulo: "Série Y · S02E03", capa: "https://x/s.jpg", meta: { ext: "mp4", serieId: "2", serieTitulo: "Série Y", serieCapa: "https://x/s.jpg", temporada: 2, numero: 3, ano: 2019 }, pos: 100, dur: 3000, em: iso(T0 - 1000) },
  ]);
  assert.doesNotMatch(JSON.stringify(itens), /srv\.falso|usuario|senha/);
});

test("itens do aparelho: capa só http(s), título recortado, ids estranhos e tipos desconhecidos ficam de fora", () => {
  const o = loadOtt();
  const itens = plain(o.ottHistItemsFromContinue({
    a: { id: "resume-vod-1", type: "vod", title: "T".repeat(300), cover: "javascript:alert(1)", progress: 10, duration: 100, ts: T0, vodItem: { stream_id: 1 } },
    b: { id: "resume-vod-2;x", type: "vod", title: "Estranho", progress: 1, duration: 2, ts: T0 },
    c: { id: "resume-foo-3", type: "foo", title: "Tipo", progress: 1, duration: 2, ts: T0 },
    d: { id: "resume-vod-4", type: "vod", title: "Com ext salva", ext: "avi", progress: 1, duration: 2, ts: T0 - 5, vodItem: { stream_id: 4, container_extension: "mkv" } },
  }));
  assert.deepEqual(keys(itens), ["f:1", "f:4"]);
  assert.equal(itens[0].titulo.length, 120);
  assert.equal(itens[0].capa, "");
  assert.deepEqual(itens[0].meta, {});
  assert.equal(itens[1].meta.ext, "avi"); // a extensão guardada na entrada vale mais que a do item
});

test("o histórico local é limitado a 40 itens (os mais recentes)", () => {
  const o = loadOtt();
  const mapa = {};
  for (let n = 1; n <= 45; n++) mapa["resume-vod-" + n] = { id: "resume-vod-" + n, type: "vod", title: "F" + n, progress: 10, duration: 100, ts: T0 + n };
  const itens = plain(o.ottHistItemsFromContinue(mapa));
  assert.equal(itens.length, 40);
  assert.equal(itens[0].k, "f:45");
  assert.equal(itens[39].k, "f:6");
});

test("canais recentes viram itens da conta (nome normalizado; repetidos e em branco ficam de fora)", () => {
  const o = loadOtt();
  const itens = plain(o.ottHistItemsFromChannels([
    { nome: "Globo SP", grupo: "Abertos", ts: T0 },
    { nome: "   ", ts: T0 },
    { nome: "globo   sp", grupo: "Outro", ts: T0 - 5 },
    { nome: "ESPN", ts: T0 - 10 },
  ]));
  assert.deepEqual(itens, [
    { k: "c:globo sp", tipo: "canal", titulo: "Globo SP", capa: "", meta: { grupo: "Abertos" }, pos: 0, dur: 0, em: iso(T0) },
    { k: "c:espn", tipo: "canal", titulo: "ESPN", capa: "", meta: {}, pos: 0, dur: 0, em: iso(T0 - 10) },
  ]);
});

test("itens da conta viram entradas do continuar (sem link) e canais; terminados e inválidos ficam de fora", () => {
  const o = loadOtt();
  const r = plain(o.ottHistLocalFromItems([
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "https://x/p.jpg", meta: { ext: "mkv", ano: 2020 }, pos: 1234, dur: 6000, em: iso(T0) },
    { k: "e:9", tipo: "episodio", titulo: "qualquer", capa: "", meta: { ext: "mp4", serieId: "2", serieTitulo: "Série Y", serieCapa: "https://x/s.jpg", temporada: 2, numero: 3 }, pos: 100, dur: 3000, em: iso(T0 - 1000) },
    { k: "f:6", tipo: "filme", titulo: "Terminado", capa: "", meta: {}, pos: 5900, dur: 6000, em: iso(T0) },
    { k: "e:10", tipo: "episodio", titulo: "Sem série", capa: "", meta: {}, pos: 10, dur: 100, em: iso(T0) },
    { k: "c:globo sp", tipo: "canal", titulo: "Globo SP", capa: "", meta: { grupo: "Abertos" }, pos: 0, dur: 0, em: iso(T0 - 20) },
    { k: "f:1", tipo: "canal", titulo: "Chave e tipo não combinam", em: iso(T0) },
    { k: "x:1", tipo: "filme", titulo: "Chave estranha", em: iso(T0) },
  ]));
  assert.deepEqual(r.continuar, [
    { id: "resume-vod-5", type: "vod", title: "Filme X", cover: "https://x/p.jpg", progress: 1234, duration: 6000, ts: T0, ext: "mkv", vodItem: { stream_id: "5", name: "Filme X", stream_icon: "https://x/p.jpg", container_extension: "mkv", year: "2020" } },
    { id: "resume-series-9", type: "series", title: "Série Y · S02E03", cover: "https://x/s.jpg", progress: 100, duration: 3000, ts: T0 - 1000, ext: "mp4", vodItem: { series_id: "2", name: "Série Y", cover: "https://x/s.jpg" } },
    { id: "resume-series-10", type: "series", title: "Sem série", cover: "", progress: 10, duration: 100, ts: T0, ext: "", vodItem: null },
  ]);
  assert.deepEqual(r.canais, [{ nome: "Globo SP", grupo: "Abertos", ts: T0 - 20 }]);
});

test("regra de sincronização: primeira vez = união; o que só existe no aparelho sobe, do mais antigo ao mais novo", () => {
  const o = loadOtt();
  const p = plain(o.ottHistPlan({
    primeira: true,
    local: [I("f:1", { em: iso(T0 + 50) }), I("f:2", { em: iso(T0) }), I("f:4", { em: iso(T0 + 10) })],
    conta: [I("f:2", { em: iso(T0) }), I("f:3", { em: iso(T0 + 20) })],
    pendentes: [], removidos: [],
  }));
  assert.deepEqual(keys(p.resultado), ["f:1", "f:3", "f:4", "f:2"]); // mais recentes primeiro
  assert.deepEqual(keys(p.enviar), ["f:4", "f:1"]);                  // do mais antigo ao mais novo (a conta carimba a hora do envio)
  assert.deepEqual(p.remover, []);
});

test("depois da primeira vez a conta manda: o que saiu da conta some; só os pendentes ficam e sobem", () => {
  const o = loadOtt();
  const q = plain(o.ottHistPlan({ primeira: false, local: [I("f:1"), I("f:2")], conta: [I("f:2")], pendentes: [], removidos: [] }));
  assert.deepEqual(keys(q.resultado), ["f:2"]);
  assert.deepEqual(q.enviar, []);
  const r = plain(o.ottHistPlan({ primeira: false, local: [I("f:1"), I("f:2")], conta: [I("f:2")], pendentes: ["f:1"], removidos: [] }));
  assert.deepEqual(keys(r.enviar), ["f:1"]);
  assert.deepEqual(keys(r.resultado).sort(), ["f:1", "f:2"]);
});

test("conflito do mesmo item: vale o mais recente (em) entre o aparelho pendente e a conta", () => {
  const o = loadOtt();
  // pendente local mais novo: sobe e vence
  const a = plain(o.ottHistPlan({ primeira: false, local: [I("f:1", { pos: 900, em: iso(T0 + 60000) })], conta: [I("f:1", { pos: 100, em: iso(T0) })], pendentes: ["f:1"], removidos: [] }));
  assert.equal(a.resultado[0].pos, 900);
  assert.deepEqual(keys(a.enviar), ["f:1"]);
  // pendente local mais velho: a conta vence e nada sobe
  const b = plain(o.ottHistPlan({ primeira: false, local: [I("f:1", { pos: 900, em: iso(T0 - 60000) })], conta: [I("f:1", { pos: 100, em: iso(T0) })], pendentes: ["f:1"], removidos: [] }));
  assert.equal(b.resultado[0].pos, 100);
  assert.deepEqual(b.enviar, []);
  // não pendente: a conta manda mesmo que a hora do aparelho esteja adiantada
  const c = plain(o.ottHistPlan({ primeira: false, local: [I("f:1", { pos: 900, em: iso(T0 + 999999) })], conta: [I("f:1", { pos: 100, em: iso(T0) })], pendentes: [], removidos: [] }));
  assert.equal(c.resultado[0].pos, 100);
  assert.deepEqual(c.enviar, []);
});

test("removidos (remoções que falharam offline) saem da conta e não voltam", () => {
  const o = loadOtt();
  const p = plain(o.ottHistPlan({ primeira: false, local: [I("f:1")], conta: [I("f:1"), I("f:2"), I("f:3")], pendentes: [], removidos: ["f:2", "f:9"] }));
  assert.deepEqual(keys(p.resultado).sort(), ["f:1", "f:3"]);
  assert.deepEqual(p.remover, ["f:2"]); // só o que está mesmo na conta precisa ser apagado
  assert.deepEqual(p.enviar, []);
  // mesmo na primeira vez, um removido que ainda esteja no aparelho não sobe
  const q = plain(o.ottHistPlan({ primeira: true, local: [I("f:7")], conta: [], pendentes: [], removidos: ["f:7"] }));
  assert.deepEqual(q.resultado, []);
  assert.deepEqual(q.enviar, []);
});

test("limite de 40 itens: ficam os mais recentes e o que foi cortado não sobe", () => {
  const o = loadOtt();
  const local = [];
  for (let n = 1; n <= 45; n++) local.push(I("f:" + n, { em: iso(T0 + n * 1000) }));
  const p = plain(o.ottHistPlan({ primeira: true, local, conta: [], pendentes: [], removidos: [] }));
  assert.equal(p.resultado.length, 40);
  assert.equal(p.resultado[0].k, "f:45");
  assert.equal(p.enviar.length, 40);
  assert.equal(p.enviar.some((i) => i.k === "f:1"), false);
});

test("aplicar no continuar: mantém a entrada local (link, item completo), acrescenta o da conta e tira o que saiu ou terminou", () => {
  const o = loadOtt();
  const atual = {
    "resume-vod-5": { ...FILME_LOCAL },
    "resume-vod-7": { id: "resume-vod-7", type: "vod", title: "Saiu da conta", progress: 50, duration: 100, ts: T0, url: "http://srv.falso/movie/a/b/7.mp4" },
    "resume-vod-8": { id: "resume-vod-8", type: "vod", title: "Terminou na TV", progress: 50, duration: 6000, ts: T0 - 9000, url: "http://srv.falso/movie/a/b/8.mp4" },
    "resume-vod-9": { id: "resume-vod-9", type: "vod", title: "Pendente", progress: 20, duration: 100, ts: T0 },
    legado: { id: "qualquer-coisa", title: "Entrada antiga sem chave", ts: 1 },
  };
  const resultado = [
    I("f:5", { titulo: "Filme X", pos: 2000, dur: 6000, em: iso(T0 - 5000) }),                       // a conta é mais velha: o aparelho fica como está
    I("f:8", { pos: 5990, dur: 6000, em: iso(T0) }),                                                   // terminado na conta: sai do continuar
    I("e:3", { titulo: "Nova · S01E02", pos: 30, dur: 600, meta: { ext: "mp4", serieId: "1", serieTitulo: "Nova", temporada: 1, numero: 2 }, em: iso(T0 + 5000) }),
  ];
  const r = plain(o.ottHistApplyContinue(atual, resultado, ["f:9"]));
  assert.deepEqual(Object.keys(r.map).sort(), ["legado", "resume-series-3", "resume-vod-5", "resume-vod-9"]);
  assert.equal(r.map["resume-vod-5"].progress, 1234.7);
  assert.equal(r.map["resume-vod-5"].url, FILME_LOCAL.url);
  assert.equal(r.map["resume-series-3"].title, "Nova · S01E02");
  assert.equal(r.map["resume-series-3"].progress, 30);
  assert.equal(r.map["resume-series-3"].url, undefined); // o link só é montado na hora de abrir, com as credenciais de agora
  assert.equal(r.mudou, true);
});

test("aplicar no continuar: a conta mais nova atualiza só o minuto; nada mudou = não regrava", () => {
  const o = loadOtt();
  const atual = { "resume-vod-5": { ...FILME_LOCAL } };
  const nova = plain(o.ottHistApplyContinue(atual, [I("f:5", { titulo: "Filme X", pos: 3000, dur: 6000, em: iso(T0 + 60000) })], []));
  assert.equal(nova.map["resume-vod-5"].progress, 3000);
  assert.equal(nova.map["resume-vod-5"].duration, 6000);
  assert.equal(nova.map["resume-vod-5"].ts, T0 + 60000);
  assert.equal(nova.map["resume-vod-5"].url, FILME_LOCAL.url);
  assert.equal(nova.map["resume-vod-5"].vodItem.container_extension, "mkv");
  assert.equal(nova.mudou, true);
  const igual = plain(o.ottHistApplyContinue(atual, [I("f:5", { pos: 1234, dur: 6000, em: iso(T0) })], []));
  assert.equal(igual.mudou, false);
});

test("aplicar nos canais recentes: a conta manda, os pendentes ficam, o que não é desta lista de canais não é tocado", () => {
  const o = loadOtt();
  const canais = [{ id: 1, name: "Globo SP" }, { id: 2, name: "SBT" }, { id: 3, name: "ESPN" }];
  const atuais = [{ id: 1, type: "channel", ts: T0 }, { id: 2, type: "channel", ts: T0 - 10 }, { id: 99, type: "channel", ts: T0 - 20 }];
  const resultado = [I("c:espn", { em: iso(T0 + 5) }), I("c:globo sp", { em: iso(T0) }), I("c:canal que nao existe aqui", { em: iso(T0) })];
  const r = plain(o.ottHistApplyChannels(atuais, resultado, canais, []));
  assert.deepEqual(r.recents.map((x) => x.id), [3, 1, 99]);   // ESPN entra, SBT sai, o 99 (fora da lista) fica como está
  assert.equal(r.recents[0].type, "channel");
  assert.equal(r.recents[0].ts, T0 + 5);
  assert.equal(r.mudou, true);
  const p = plain(o.ottHistApplyChannels(atuais, resultado, canais, ["c:sbt"]));
  assert.deepEqual(p.recents.map((x) => x.id), [3, 1, 2, 99]); // SBT é pendente: continua
  const igual = plain(o.ottHistApplyChannels([{ id: 3, type: "channel", ts: T0 + 5 }, { id: 1, type: "channel", ts: T0 }], [I("c:espn", { em: iso(T0 + 5) }), I("c:globo sp", { em: iso(T0) })], canais, []));
  assert.equal(igual.mudou, false);
});

test("RPCs do histórico: hist_list, hist_put e hist_remove", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", itens: [
    { k: "f:1", tipo: "filme", titulo: "X", capa: "", meta: { ext: "mp4" }, pos: 10, dur: 100, em: "2026-10-03T12:00:00.123456+00:00" },
    { k: "e:2", tipo: "episodio", titulo: "Y", capa: "javascript:x", meta: "{\"temporada\":1}", pos: "5", dur: "50", em: "2026-10-03T11:00:00Z" },
    { k: "lixo", tipo: "filme" },
    { k: "c:tv", tipo: "canal", titulo: "TV" },
  ] } }));
  const l = plain(await o.ottHistList(cfg, "tok", "p1", f));
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok", p_perfil: "p1" });
  assert.match(f.calls[0].url, /\/rpc\/hist_list$/);
  assert.deepEqual(keys(l), ["f:1", "e:2", "c:tv"]);
  assert.deepEqual(l[0], { k: "f:1", tipo: "filme", titulo: "X", capa: "", meta: { ext: "mp4" }, pos: 10, dur: 100, em: "2026-10-03T12:00:00.123456+00:00" });
  assert.equal(l[1].capa, "");
  assert.deepEqual(l[1].meta, { temporada: 1 });
  assert.equal(l[1].pos, 5);
  assert.equal(l[2].pos, 0);

  const g = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottHistPut(cfg, "tok", "p1", I("f:1", { titulo: "X", capa: "https://x/p.jpg", meta: { ext: "mp4" }, pos: 10.9, dur: 100.2 }), g);
  assert.match(g.calls[0].url, /\/rpc\/hist_put$/);
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: "tok", p_perfil: "p1", p_chave: "f:1", p_tipo: "filme", p_titulo: "X", p_capa: "https://x/p.jpg", p_meta: { ext: "mp4" }, p_pos: 10, p_dur: 100 });
  const h = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottHistRemove(cfg, "tok", "p1", "f:1", h);
  assert.match(h.calls[0].url, /\/rpc\/hist_remove$/);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { p_token: "tok", p_perfil: "p1", p_chave: "f:1" });
});

test("resposta que não é ok nunca vira lista vazia nem sucesso (senão a conta apagaria o histórico do aparelho)", async () => {
  const o = loadOtt();
  await assert.rejects(o.ottHistList(cfg, "tok", "p1", fakeFetch(() => ({ body: { status: "unknown_device" } }))));
  await assert.rejects(o.ottHistList(cfg, "tok", "p1", fakeFetch(() => ({ body: { status: "ok" } }))));
  await assert.rejects(o.ottHistPut(cfg, "tok", "p1", I("f:1"), fakeFetch(() => ({ body: { status: "unknown_device" } }))));
  await assert.rejects(o.ottHistRemove(cfg, "tok", "p1", "f:1", fakeFetch(() => ({ body: { status: "unknown_device" } }))));
  await assert.rejects(o.ottHistList(cfg, "tok", "p1", fakeFetch(() => ({ status: 404, body: { message: "Could not find the function" } }))));
});
