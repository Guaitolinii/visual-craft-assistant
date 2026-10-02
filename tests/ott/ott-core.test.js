import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadOtt, plain, fakeStorage, fakeFetch, LINK_HTML_PATH } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };

test("configuração do backend: só https e com chave; endereço do painel tem padrão", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottParseConfig({ url: "https://x.supabase.co/", anonKey: " k ", panelUrl: "https://p.com/" })), { url: "https://x.supabase.co", anonKey: "k", panelUrl: "https://p.com" });
  assert.equal(plain(o.ottParseConfig({ url: "https://x.supabase.co", anonKey: "k" })).panelUrl, "https://sintonizatv.com.br");
  assert.equal(o.ottParseConfig({ url: "http://x.com", anonKey: "k" }), null);
  assert.equal(o.ottParseConfig({ url: "https://x.com" }), null);
  assert.equal(o.ottParseConfig(null), null);
});

test("busca a configuração no painel e guarda; sem internet usa a guardada", async () => {
  const o = loadOtt();
  const storage = fakeStorage();
  const online = fakeFetch(() => ({ body: { url: "https://x.supabase.co", anonKey: "k" } }));
  const a = plain(await o.ottLoadConfig(storage, online));
  assert.equal(a.url, "https://x.supabase.co");
  assert.ok(online.calls[0].url.endsWith("/app-config.json"));
  const offline = fakeFetch(() => { throw new Error("sem rede"); });
  assert.equal(plain(await o.ottLoadConfig(storage, offline)).anonKey, "k");
  assert.equal(await o.ottLoadConfig(fakeStorage(), offline), null);
});

test("detecta o aparelho: celular iPhone, Android ou navegador", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "ios")), { modelo: "iPhone", sistema: "iOS", tipo: "celular" });
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (iPad; CPU OS 17_0)", "")), { modelo: "iPad", sistema: "iOS", tipo: "celular" });
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)", "android")), { modelo: "Celular Android", sistema: "Android", tipo: "celular" });
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (Windows NT 10.0)", "")), { modelo: "Navegador", sistema: "Web", tipo: "celular" });
});

test("interpreta device_config sem confiar no formato", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "pending", code: "ABCD-1234", expires_at: "2026-10-02T10:00:00Z", poll_seconds: 5 })), { status: "pending", code: "ABCD-1234", expiresAt: "2026-10-02T10:00:00Z", pollSeconds: 5 });
  const ok = plain(o.ottParseDeviceConfig({ status: "ok", user: { nome: "Ana", status: "trial", trial_fim: "2026-10-09T00:00:00Z" }, playlists: [{ id: "1", nome: "Principal", url_m3u: "http://a/m3u", url_vod: "http://a/vod" }, { id: "2", url_m3u: "" }] }));
  assert.equal(ok.status, "ok");
  assert.equal(ok.playlists.length, 1);
  assert.equal(ok.account.trial_fim, "2026-10-09T00:00:00Z");
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "expired", trial_fim: "2026-10-01T00:00:00Z" })), { status: "expired", trialFim: "2026-10-01T00:00:00Z" });
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "unknown_device" })), { status: "unknown_device" });
  assert.deepEqual(plain(o.ottParseDeviceConfig(null)), { status: "invalid" });
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "pending" })), { status: "invalid" });
});

test("grava e limpa as listas nas chaves que o app já usa", () => {
  const o = loadOtt();
  const s = fakeStorage();
  assert.equal(o.ottApplyPlaylist(s, { url_m3u: "http://a/m3u", url_vod: "http://a/vod", url_epg: null }), true);
  assert.equal(s.getItem("sint_url"), "http://a/m3u");
  assert.equal(s.getItem("sint_mode"), "url");
  assert.equal(s.getItem("sint_vod_url"), "http://a/vod");
  assert.equal(s.getItem("sint_epg_url"), null);
  assert.equal(o.ottApplyPlaylist(s, { url_m3u: "http://a/m3u", url_vod: "http://a/vod", url_epg: null }), false); // nada mudou
  assert.equal(o.ottApplyPlaylist(s, null), true);
  assert.equal(s.getItem("sint_url"), null);
  assert.equal(s.getItem("sint_vod_url"), null);
});

test("as chaves de lista do ott-core são as mesmas do app (LS)", () => {
  const o = loadOtt();
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  const ls = html.match(/const LS = \{([^}]*)\}/)[1];
  const val = (name) => ls.match(new RegExp(`${name}:\\s*"([^"]+)"`))[1];
  const k = plain(o.OTT_LIST_KEYS);
  assert.equal(k.URL, val("URL"));
  assert.equal(k.MODE, val("MODE"));
  assert.equal(k.VOD, val("VOD_URL"));
  assert.equal(k.EPG, val("EPG_URL"));
  assert.equal(k.EPG_CACHE, val("EPG_CACHE"));
});

test("datas do Postgres com 6 casas de fração, dd/mm/aaaa e dias restantes", () => {
  const o = loadOtt();
  assert.equal(o.ottParseIsoMs("2026-10-09T15:12:45.123456+00:00"), Date.UTC(2026, 9, 9, 15, 12, 45, 123));
  assert.equal(o.ottParseIsoMs("lixo"), 0);
  assert.equal(o.ottFormatDateBr("2026-10-09T12:00:00Z"), "09/10/2026");
  assert.equal(o.ottFormatDateBr(""), "");
  const fim = "2026-10-09T12:00:00Z";
  assert.equal(o.ottDaysLeft(fim, Date.UTC(2026, 9, 2, 12, 0, 0)), 7);
  assert.equal(o.ottDaysLeft(fim, Date.UTC(2026, 9, 9, 6, 0, 0)), 1);
  assert.equal(o.ottDaysLeft(fim, Date.UTC(2026, 9, 12, 0, 0, 0)), 0);
  assert.equal(o.ottFormatCountdown(125000), "02:05");
});

test("tolerância sem internet: 48 h desde a última validação", () => {
  const o = loadOtt();
  const agora = 1_000_000_000_000;
  assert.equal(o.ottWithinGrace(agora - 47 * 3600e3, agora, o.OTT_OFFLINE_GRACE_MS), true);
  assert.equal(o.ottWithinGrace(agora - 49 * 3600e3, agora, o.OTT_OFFLINE_GRACE_MS), false);
  assert.equal(o.ottWithinGrace(0, agora, o.OTT_OFFLINE_GRACE_MS), false);
});

test("chamada RPC: cabeçalhos, corpo, erro do servidor e rede", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { ok: true } }));
  assert.deepEqual(plain(await o.ottCallRpc(cfg, "device_config", { p_token: "t" }, f)), { ok: true });
  assert.equal(f.calls[0].url, "https://x.supabase.co/rest/v1/rpc/device_config");
  assert.equal(f.calls[0].init.headers.apikey, "chave");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer chave");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "t" });
  const erro = fakeFetch(() => ({ status: 400, body: { message: "Código inválido" } }));
  await assert.rejects(o.ottCallRpc(cfg, "x", {}, erro), /Código inválido/);
  const rede = fakeFetch(() => { throw new Error("falhou"); });
  await assert.rejects(o.ottCallRpc(cfg, "x", {}, rede), /Sem conexão/);
});

test("device_start do celular manda modelo, sistema e tipo 'celular'", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { device_token: "tok", code: "ABCD-1234", expires_at: "2026-10-02T10:15:00Z", poll_seconds: 5 } }));
  const r = plain(await o.ottDeviceStart(cfg, { modelo: "iPhone", sistema: "iOS", tipo: "celular" }, f));
  assert.deepEqual(r, { token: "tok", code: "ABCD-1234", expiresAt: "2026-10-02T10:15:00Z", pollSeconds: 5 });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_modelo: "iPhone", p_sistema: "iOS", p_tipo: "celular" });
  const vazio = fakeFetch(() => ({ body: {} }));
  await assert.rejects(o.ottDeviceStart(cfg, { modelo: "x", sistema: "y", tipo: "celular" }, vazio), /inesperada/);
});

test("decisão da tela a partir da resposta do servidor", () => {
  const o = loadOtt();
  const agora = 1_000_000_000_000;
  const d = (args) => plain(o.ottDecide({ lastOkMs: 0, nowMs: agora, ...args }));
  assert.equal(d({ config: { status: "ok", account: { nome: "Ana" }, playlists: [] } }).screen, "ok");
  assert.deepEqual(d({ config: { status: "pending", code: "ABCD-1234", expiresAt: "x", pollSeconds: 5 } }), { screen: "activation", code: "ABCD-1234", expiresAt: "x", pollSeconds: 5 });
  assert.deepEqual(d({ config: { status: "expired", trialFim: "2026-10-01T00:00:00Z" } }), { screen: "blocked", kind: "expired", trialFim: "2026-10-01T00:00:00Z" });
  assert.equal(d({ config: { status: "blocked", trialFim: null } }).kind, "blocked");
  assert.equal(d({ config: { status: "unknown_device" } }).screen, "restart");
  assert.equal(d({ config: { status: "device_blocked" } }).screen, "device_blocked");
  assert.equal(d({ config: { status: "invalid" } }).screen, "offline");
  // sem internet: dentro de 48 h do último ok segue funcionando; depois mostra "sem conexão"
  assert.deepEqual(d({ error: "rede", lastOkMs: agora - 3600e3 }), { screen: "ok", offline: true });
  assert.equal(d({ error: "rede", lastOkMs: agora - 72 * 3600e3 }).screen, "offline");
  assert.equal(d({ error: "rede", lastOkMs: 0 }).screen, "offline");
});

test("resumo da conta: teste de 7 dias, assinatura e prazo", () => {
  const o = loadOtt();
  const agora = Date.UTC(2026, 9, 2, 12, 0, 0);
  assert.deepEqual(plain(o.ottAccountSummary({ nome: "Ana", status: "trial", trial_fim: "2026-10-09T12:00:00Z" }, agora)), { tone: "ok", text: "Teste gratuito: restam 7 dias (até 09/10/2026)" });
  assert.equal(plain(o.ottAccountSummary({ nome: "Ana", status: "trial", trial_fim: "2026-10-03T12:00:00Z" }, agora)).text, "Teste gratuito: resta 1 dia (até 03/10/2026)");
  assert.equal(plain(o.ottAccountSummary({ nome: "Ana", status: "active", acesso_fim: null }, agora)).text, "Assinatura ativa (sem prazo)");
  assert.equal(plain(o.ottAccountSummary({ nome: "Ana", status: "active", acesso_fim: "2026-12-01T12:00:00Z" }, agora)).text, "Assinatura ativa até 01/12/2026");
});
