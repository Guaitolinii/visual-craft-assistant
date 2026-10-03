import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };
const I = (k) => ({ k, tipo: k[0] === "c" ? "canal" : k[0] === "f" ? "filme" : "serie", titulo: k, capa: "", ano: 0 });

test("nome normalizado e chaves iguais às da TV", () => {
  const o = loadOtt();
  assert.equal(o.ottNormName("  Globo   SP "), "globo sp");
  assert.equal(o.ottNormName("Cinéma Ação"), "cinema acao");
  assert.equal(o.ottNormName("A".repeat(200)).length, 120);
  assert.equal(o.ottFavKeyChannel("Globo SP"), "c:globo sp");
  assert.equal(o.ottFavKeyChannel("   "), null);
  assert.equal(o.ottFavKeyVod("123"), "f:123");
  assert.equal(o.ottFavKeySeries("9"), "s:9");
  assert.equal(o.ottFavKeyVod("12;x"), null);
});

test("favoritos locais viram itens da conta", () => {
  const o = loadOtt();
  const canais = plain(o.ottFavItemsFromChannels(["Globo SP", "  ", "ESPN"]));
  assert.deepEqual(canais.map((i) => i.k), ["c:globo sp", "c:espn"]);
  const lista = plain(o.ottFavItemsFromMyList([
    { type: "vod", id: 5, title: "Filme X", cover: "https://x/p.jpg", item: { stream_id: 5, name: "Filme X", year: "2020" } },
    { type: "series", id: 2, title: "Série Y", cover: "", item: { series_id: 2, name: "Série Y" } },
    { type: "vod", id: "", title: "Sem id", item: {} },
  ]));
  assert.deepEqual(lista, [
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "https://x/p.jpg", ano: 2020 },
    { k: "s:2", tipo: "serie", titulo: "Série Y", capa: "", ano: 0 },
  ]);
});

test("capa só entra se for http(s) e curta; título é recortado", () => {
  const o = loadOtt();
  const r = plain(o.ottFavItemsFromMyList([
    { type: "vod", id: 1, title: "T".repeat(300), cover: "javascript:alert(1)", item: { stream_id: 1 } },
    { type: "vod", id: 2, title: "B", cover: "https://x/" + "a".repeat(400), item: { stream_id: 2 } },
  ]));
  assert.equal(r[0].titulo.length, 120);
  assert.equal(r[0].capa, "");
  assert.equal(r[1].capa, "");
});

test("itens da conta viram favoritos locais (canais por nome; filmes e séries com item mínimo)", () => {
  const o = loadOtt();
  const r = plain(o.ottFavLocalFromItems([
    { k: "c:globo sp", tipo: "canal", titulo: "Globo SP", capa: "", ano: 0 },
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "https://x/p.jpg", ano: 2020 },
    { k: "s:2", tipo: "serie", titulo: "Série Y", capa: "", ano: 0 },
  ]));
  assert.deepEqual(r.canais, ["Globo SP"]);
  assert.equal(r.minhaLista.length, 2);
  assert.equal(r.minhaLista[0].type, "vod");
  assert.equal(r.minhaLista[0].id, "5");
  assert.equal(r.minhaLista[0].item.stream_id, "5");
  assert.equal(r.minhaLista[0].item.name, "Filme X");
  assert.equal(r.minhaLista[0].item.stream_icon, "https://x/p.jpg");
  assert.equal(r.minhaLista[1].type, "series");
  assert.equal(r.minhaLista[1].item.series_id, "2");
  assert.ok(r.minhaLista[0].ts > r.minhaLista[1].ts); // a ordem da conta (mais recente primeiro) vira o ts
});

test("regra de sincronização: primeira = união; depois a conta manda, mantendo pendentes", () => {
  const o = loadOtt();
  const p = plain(o.ottFavPlan({ primeira: true, local: [I("f:1"), I("f:2")], conta: [I("f:2"), I("f:3")], pendentes: [] }));
  assert.deepEqual(p.resultado.map((i) => i.k).sort(), ["f:1", "f:2", "f:3"]);
  assert.deepEqual(p.enviar.map((i) => i.k), ["f:1"]);
  const q = plain(o.ottFavPlan({ primeira: false, local: [I("f:1"), I("f:2")], conta: [I("f:2")], pendentes: [] }));
  assert.deepEqual(q.resultado.map((i) => i.k), ["f:2"]);
  const r = plain(o.ottFavPlan({ primeira: false, local: [I("f:1"), I("f:2")], conta: [I("f:2")], pendentes: ["f:1"] }));
  assert.deepEqual(r.enviar.map((i) => i.k), ["f:1"]);
  assert.deepEqual(r.resultado.map((i) => i.k).sort(), ["f:1", "f:2"]);
});

test("aplicar o resultado: mantém o que o aparelho já tem (item completo, ts, nome original) e só acrescenta/remove o que mudou", () => {
  const o = loadOtt();
  const completo = { type: "vod", id: 5, title: "Filme X", cover: "https://x/p.jpg", ts: 111, item: { stream_id: 5, name: "Filme X", container_extension: "mkv" } };
  const velho = { type: "series", id: 7, title: "Saiu", cover: "", ts: 50, item: { series_id: 7 } };
  const r = plain(o.ottFavApply(
    ["ESPN", "Canal Velho", 12],
    [completo, velho],
    [
      { k: "c:espn", tipo: "canal", titulo: "ESPN", capa: "", ano: 0 },
      { k: "c:novo canal", tipo: "canal", titulo: "Novo Canal", capa: "", ano: 0 },
      { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "", ano: 0 },
      { k: "s:2", tipo: "serie", titulo: "Série Y", capa: "", ano: 0 },
    ],
    1000
  ));
  assert.deepEqual(r.canais, ["Novo Canal", "ESPN", 12]); // o número antigo (sem nome) fica como está
  assert.equal(r.mudouCanais, true);
  assert.equal(r.minhaLista.length, 2);
  assert.equal(r.minhaLista.find((e) => e.id === 5).item.container_extension, "mkv"); // intacto
  assert.equal(r.minhaLista.find((e) => e.id === 5).ts, 111);
  assert.equal(r.minhaLista.find((e) => String(e.id) === "2").type, "series");
  assert.equal(r.minhaLista.some((e) => e.id === 7), false); // removido em outro aparelho
  assert.equal(r.mudouLista, true);
  // nada mudou: não regrava
  const igual = plain(o.ottFavApply(["ESPN"], [completo], [
    { k: "c:espn", tipo: "canal", titulo: "ESPN", capa: "", ano: 0 },
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "", ano: 0 },
  ], 1000));
  assert.equal(igual.mudouCanais, false);
  assert.equal(igual.mudouLista, false);
});

test("RPCs de favoritos", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", itens: [{ k: "f:1", tipo: "filme", titulo: "X", capa: "", ano: 2020 }] } }));
  assert.deepEqual(plain(await o.ottFavList(cfg, "tok", "p1", f)), [{ k: "f:1", tipo: "filme", titulo: "X", capa: "", ano: 2020 }]);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok", p_perfil: "p1" });
  const g = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottFavSet(cfg, "tok", "p1", I("f:1"), true, g);
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: "tok", p_perfil: "p1", p_chave: "f:1", p_tipo: "filme", p_titulo: "f:1", p_capa: "", p_ano: 0, p_on: true });
  const h = fakeFetch(() => ({ body: { status: "ok", total: 1 } }));
  await o.ottFavMerge(cfg, "tok", "p1", Array.from({ length: 350 }, (_, n) => I("f:" + n)), h);
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[0].init.body).p_itens.length, 300);
});

test("resposta que não é ok nunca vira lista vazia (senão a conta apagaria os favoritos do aparelho)", async () => {
  const o = loadOtt();
  await assert.rejects(o.ottFavList(cfg, "tok", "p1", fakeFetch(() => ({ body: { status: "unknown_device" } }))));
  await assert.rejects(o.ottFavSet(cfg, "tok", "p1", I("f:1"), true, fakeFetch(() => ({ body: { status: "unknown_device" } }))));
  await assert.rejects(o.ottFavMerge(cfg, "tok", "p1", [I("f:1")], fakeFetch(() => ({ status: 404, body: { message: "Could not find the function" } }))));
});
