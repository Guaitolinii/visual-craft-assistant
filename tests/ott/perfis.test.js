import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };
const P = (id, padrao = false) => ({ id, nome: id, avatar: "padrao", padrao });

test("normaliza a lista de perfis do servidor", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottPerfilNormalize({ status: "ok", perfis: [{ id: "a1", nome: "Ana", avatar: "pipoca", padrao: true }, { id: "", nome: "x" }, { id: "c3", nome: "Caio" }] })),
    [{ id: "a1", nome: "Ana", avatar: "pipoca", padrao: true }, { id: "c3", nome: "Caio", avatar: "padrao", padrao: false }]);
  assert.deepEqual(plain(o.ottPerfilNormalize(null)), []);
  assert.deepEqual(plain(o.ottPerfilNormalize({ status: "unknown_device" })), []);
});

test("perfil ativo: o último usado, senão o principal, senão o primeiro", () => {
  const o = loadOtt();
  const l = [P("a", true), P("b"), P("c")];
  assert.equal(o.ottPerfilPickActive(l, "c").id, "c");
  assert.equal(o.ottPerfilPickActive(l, "zzz").id, "a");
  assert.equal(o.ottPerfilPickActive([P("b"), P("c")], null).id, "b");
  assert.equal(o.ottPerfilPickActive([], "a"), null);
});

test("o seletor só aparece com 2 ou mais perfis; já escolhido nesta sessão não pergunta", () => {
  const o = loadOtt();
  assert.equal(o.ottPerfilDecide([P("a", true)], null, false).kind, "enter");
  assert.equal(o.ottPerfilDecide([P("a", true), P("b")], "b", false).kind, "pick");
  assert.equal(o.ottPerfilDecide([P("a", true), P("b")], "b", false).sugerido.id, "b");
  assert.equal(o.ottPerfilDecide([P("a", true), P("b")], "b", true).kind, "enter");
  assert.equal(o.ottPerfilDecide([P("a", true), P("b")], "b", true).perfil.id, "b");
  assert.equal(o.ottPerfilDecide([], null, false).kind, "none");
});

test("saudação por hora e nome válido", () => {
  const o = loadOtt();
  assert.equal(o.ottGreeting(4), "Boa noite");
  assert.equal(o.ottGreeting(5), "Bom dia");
  assert.equal(o.ottGreeting(11), "Bom dia");
  assert.equal(o.ottGreeting(12), "Boa tarde");
  assert.equal(o.ottGreeting(17), "Boa tarde");
  assert.equal(o.ottGreeting(18), "Boa noite");
  assert.equal(o.ottGreeting(23), "Boa noite");
  assert.equal(o.ottPerfilValidName("  Ana "), "Ana");
  assert.equal(o.ottPerfilValidName(""), null);
  assert.equal(o.ottPerfilValidName("   "), null);
  assert.equal(o.ottPerfilValidName("A".repeat(21)), null);
  assert.equal(o.ottPerfilValidName("A".repeat(20)), "A".repeat(20));
});

test("RPCs de perfil e o perfilId no progresso e no envio", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", perfis: [{ id: "a1", nome: "Ana", avatar: "pipoca", padrao: true }] } }));
  assert.equal((await o.ottPerfilList(cfg, "tok", f)).length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok" });
  const g = fakeFetch(() => ({ body: { status: "ok", perfil: { id: "n1", nome: "Bia", avatar: "claquete", padrao: false } } }));
  assert.deepEqual(plain(await o.ottPerfilSave(cfg, "tok", null, "Bia", "claquete", g)), { id: "n1", nome: "Bia", avatar: "claquete", padrao: false });
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: "tok", p_id: null, p_nome: "Bia", p_avatar: "claquete" });
  const d = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottPerfilDelete(cfg, "tok", "n1", d);
  assert.ok(d.calls[0].url.endsWith("/rpc/perfil_delete"));
  await assert.rejects(o.ottPerfilSave(cfg, "tok", null, "x", "y", fakeFetch(() => ({ status: 400, body: { message: "Limite de 5 perfis por conta." } }))), /Limite de 5/);
  // progresso por perfil: p_perfil só quando informado
  const id = "3f2b8c1e-9a77-4d0f-8a55-2b1c7e9d4a10";
  const p1 = fakeFetch(() => ({ body: { status: "ok", found: false } }));
  await o.ottProgressGet(cfg, "tok", "vod:1", p1, id);
  assert.deepEqual(JSON.parse(p1.calls[0].init.body), { p_token: "tok", p_key: "vod:1", p_perfil: id });
  const p2 = fakeFetch(() => ({ body: { status: "ok", found: false } }));
  await o.ottProgressGet(cfg, "tok", "vod:1", p2);
  assert.deepEqual(JSON.parse(p2.calls[0].init.body), { p_token: "tok", p_key: "vod:1" });
  const p3 = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressPut(cfg, "tok", "vod:1", "vod", 100.7, 6000, p3, id);
  assert.deepEqual(JSON.parse(p3.calls[0].init.body), { p_token: "tok", p_key: "vod:1", p_kind: "vod", p_position: 100, p_duration: 6000, p_perfil: id });
  const p4 = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressPut(cfg, "tok", "vod:1", "vod", 100, 6000, p4, "x';drop");
  assert.equal("p_perfil" in JSON.parse(p4.calls[0].init.body), false);
  const p5 = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressClear(cfg, "tok", "vod:1", p5, id);
  assert.deepEqual(JSON.parse(p5.calls[0].init.body), { p_token: "tok", p_key: "vod:1", p_perfil: id });
  // envio: perfilId só quando válido
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "F" }, { perfilId: id })), { streamId: "10", title: "F", year: 0, perfilId: id });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "F" }, { perfilId: "x';drop" })), { streamId: "10", title: "F", year: 0 });
  assert.deepEqual(plain(o.ottBuildCastPayload("episode", { series_id: 5, name: "S" }, { season: 1, episode: 2, perfilId: id })), { seriesId: "5", title: "S", season: 1, episode: 2, perfilId: id });
  assert.deepEqual(plain(o.ottBuildCastPayload("channel", { name: "Globo" }, { perfilId: id })), { name: "Globo", group: "" });
});

// ── Perfil principal escolhido pela pessoa (migração 0014): conta nova não ganha perfil sozinha ──
test("app novo pede p_auto_criar:false e conta sem perfil vem como status ok com lista vazia", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", perfis: [] } }));
  const r = await o.ottPerfilListFull(cfg, "tok", f, true);
  assert.deepEqual(plain(r), { status: "ok", perfis: [] });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok", p_auto_criar: false });
  assert.equal(f.calls.length, 1);
});

test("sem o pedido de não criar, a chamada é a de sempre (TV e apps antigos)", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", perfis: [{ id: "a1", nome: "Ana", avatar: "padrao", padrao: true }] } }));
  const r = await o.ottPerfilListFull(cfg, "tok", f);
  assert.equal(r.perfis.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok" });
});

test("servidor SEM a migração 0014 (404 na função): repete sem o parâmetro e segue como antes", async () => {
  const o = loadOtt();
  const f = fakeFetch((url, init) => {
    const corpo = JSON.parse(init.body);
    if ("p_auto_criar" in corpo) return { status: 404, body: { message: "Could not find the function public.perfil_list(p_auto_criar, p_token) in the schema cache" } };
    return { body: { status: "ok", perfis: [{ id: "a1", nome: "Ana", avatar: "padrao", padrao: true }] } };
  });
  const r = await o.ottPerfilListFull(cfg, "tok", f, true);
  assert.equal(r.status, "ok");
  assert.equal(r.perfis.length, 1);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { p_token: "tok" });
});

test("outros erros do servidor (não 404) não são escondidos pela repetição", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ status: 500, body: { message: "boom" } }));
  await assert.rejects(o.ottPerfilListFull(cfg, "tok", f, true), /boom/);
  assert.equal(f.calls.length, 1);
});

test("dispositivo desconhecido não vira 'conta sem perfil'", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "unknown_device" } }));
  assert.deepEqual(plain(await o.ottPerfilListFull(cfg, "tok", f, true)), { status: "unknown_device", perfis: [] });
});

test("ottPerfilList continua devolvendo só a lista", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", perfis: [{ id: "a1", nome: "Ana", avatar: "padrao", padrao: true }] } }));
  assert.equal((await o.ottPerfilList(cfg, "tok", f)).length, 1);
});
