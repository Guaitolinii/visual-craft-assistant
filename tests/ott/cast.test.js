import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };

test("monta o conteúdo do envio por tipo, sem links de stream", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottBuildCastPayload("channel", { name: "Globo SP", category: "Abertos", url: "http://segredo/x" })), { name: "Globo SP", group: "Abertos" });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "Filme X", year: "2023" })), { streamId: "10", title: "Filme X", year: 2023 });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 11, title: "Filme Y", releaseDate: "2019-05-01" })), { streamId: "11", title: "Filme Y", year: 2019 });
  assert.deepEqual(plain(o.ottBuildCastPayload("episode", { series_id: 7, name: "Série Y" }, { season: "2", episode: "5" })), { seriesId: "7", title: "Série Y", season: 2, episode: 5 });
  assert.equal(o.ottBuildCastPayload("channel", { name: "" }), null);
  assert.equal(o.ottBuildCastPayload("hack", { name: "x" }), null);
  const longo = plain(o.ottBuildCastPayload("channel", { name: "A".repeat(500), category: "B".repeat(500) }));
  assert.equal(longo.name.length, 120);
  assert.equal(longo.group.length, 80);
});

test("lista as TVs da conta", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", tvs: [{ id: "a", modelo: "LG", online: true }, { id: "", modelo: "x" }, { id: "b", modelo: "", online: false }] } }));
  const tvs = plain(await o.ottCastTargets(cfg, "tok", f));
  assert.deepEqual(tvs, [{ id: "a", modelo: "LG", online: true }, { id: "b", modelo: "TV", online: false }]);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok" });
  const sem = fakeFetch(() => ({ body: { status: "unknown_device" } }));
  await assert.rejects(o.ottCastTargets(cfg, "tok", sem), /não está ativado/i);
});

test("envia o comando e devolve o id", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", id: "cmd1", online: false } }));
  assert.deepEqual(plain(await o.ottCastSend(cfg, "tok", "tv1", "channel", { name: "Globo" }, f)), { id: "cmd1", online: false });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok", p_to: "tv1", p_kind: "channel", p_payload: { name: "Globo" } });
  const bloq = fakeFetch(() => ({ body: { status: "blocked" } }));
  await assert.rejects(o.ottCastSend(cfg, "tok", "tv1", "channel", { name: "x" }, bloq), /acesso/i);
  const erro = fakeFetch(() => ({ status: 400, body: { message: "TV não encontrada na sua conta." } }));
  await assert.rejects(o.ottCastSend(cfg, "tok", "tv1", "channel", { name: "x" }, erro), /TV não encontrada/);
});

test("consulta o estado do envio e traduz para o usuário", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", estado: "played", motivo: "" } }));
  assert.deepEqual(plain(await o.ottCastStatus(cfg, "tok", "cmd1", f)), { estado: "played", motivo: "" });
  assert.equal(o.ottCastStatusText("pending", ""), "Enviando para a TV...");
  assert.equal(o.ottCastStatusText("delivered", ""), "A TV recebeu, abrindo...");
  assert.equal(o.ottCastStatusText("played", ""), "Tocando na TV");
  assert.equal(o.ottCastStatusText("failed", "Canal não encontrado na lista desta TV."), "Canal não encontrado na lista desta TV.");
  assert.equal(o.ottCastStatusText("failed", ""), "A TV não conseguiu abrir este conteúdo.");
  assert.equal(o.ottCastStatusText("expired", ""), "A TV não respondeu. Confira se ela está ligada com o Sintoniza aberto.");
  assert.equal(o.ottCastIsFinal("played"), true);
  assert.equal(o.ottCastIsFinal("delivered"), false);
});
