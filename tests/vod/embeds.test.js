// Testes: categoria "Filmes Livres" (embeds oficiais): leitura da lista, tipo de reprodução, HTML do iframe,
// configuração da conta e ligações no sintoniza-link.html. Spec: docs/superpowers/specs/2026-10-24-filmes-livres-embed-design.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { loadOtt, fakeStorage, plain } from "../ott/loadOtt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Um item da lista: #EXTINF (id, capa, gênero, nome) + linha do link
const par = (id, nome, url) => `#EXTINF:-1 tvg-id="${id}" tvg-logo="https://exemplo.test/${id}.jpg" group-title="Terror", ${nome}\n${url}`;

// ── Leitura da lista ──
test("embedsParseM3u: link https de página vira item de embed", () => {
  const ctx = loadVodHelpers();
  const items = ctx.embedsParseM3u("#EXTM3U\n" + par("nosferatu", "Nosferatu (1922)", "https://fonte.test/embed/nosferatu"));
  assert.deepEqual(items, [{
    stream_id: "liv-nosferatu",
    name: "Nosferatu",
    stream_icon: "https://exemplo.test/nosferatu.jpg",
    category_name: "Filmes Livres",
    genre: "Terror",
    year: "1922",
    embed_url: "https://fonte.test/embed/nosferatu",
    is_livre: true,
  }]);
});

test("embedsParseM3u: link https com extensão de vídeo vira item de link direto (player nativo)", () => {
  const ctx = loadVodHelpers();
  const items = ctx.embedsParseM3u(par("a", "Filme A (2000)", "https://cdn.test/a.mp4?x=1") + "\n" + par("b", "Filme B (2001)", "https://cdn.test/b.m3u8"));
  assert.equal(items.length, 2);
  assert.equal(items[0].direct_url, "https://cdn.test/a.mp4?x=1");
  assert.equal(items[0].container_extension, "mp4");
  assert.equal(items[0].is_livre, true);
  assert.equal(items[0].embed_url, undefined);
  assert.equal(items[1].container_extension, "m3u8");
});

test("embedsParseM3u: sem lista de domínios — qualquer https (outros hosts, portas, subdomínios) entra", () => {
  const ctx = loadVodHelpers();
  const items = ctx.embedsParseM3u([
    par("a", "A (2000)", "https://um.test/embed/1"),
    par("b", "B (2000)", "https://outro-site.example:8443/player?id=2"),
    par("c", "C (2000)", "https://sub.dominio.novo.test/filme/3#t=5"),
  ].join("\n"));
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.embed_url), [
    "https://um.test/embed/1",
    "https://outro-site.example:8443/player?id=2",
    "https://sub.dominio.novo.test/filme/3#t=5",
  ]);
});

test("embedsParseM3u: descarta http://, javascript:, data:, link com espaço ou aspas e link sem host", () => {
  const ctx = loadVodHelpers();
  const ruins = [
    "http://inseguro.test/embed/1",
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
    "https://com espaco.test/x",
    'https://aspas.test/x"onload="alert(1)',
    "https://",
    "//sem-esquema.test/x",
  ];
  const lista = ruins.map((u, i) => par("r" + i, "Ruim " + i + " (2000)", u)).join("\n");
  assert.deepEqual(ctx.embedsParseM3u(lista), []);
});

test("embedsParseM3u: tvg-id inválido ou ausente e duplicados são descartados, mantendo o primeiro", () => {
  const ctx = loadVodHelpers();
  const lista = [
    par("ok", "Primeiro (2000)", "https://fonte.test/embed/1"),
    par("ok", "Repetido (2001)", "https://fonte.test/embed/2"),
    par("id com espaço", "Id ruim (2002)", "https://fonte.test/embed/3"),
    `#EXTINF:-1 tvg-logo="https://exemplo.test/x.jpg", Sem id (2003)\nhttps://fonte.test/embed/4`,
  ].join("\n");
  const items = ctx.embedsParseM3u(lista);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Primeiro");
});

test("embedsParseM3u: entradas não-string ou vazias devolvem []", () => {
  const ctx = loadVodHelpers();
  for (const v of ["", "   ", null, undefined, 12345, {}]) assert.deepEqual(ctx.embedsParseM3u(v), []);
});

test("embedsParseM3u: teto de 5000 itens", () => {
  const ctx = loadVodHelpers();
  const partes = [];
  for (let i = 1; i <= 5001; i++) partes.push(`#EXTINF:-1 tvg-id="${i}", Filme ${i} (2000)\nhttps://fonte.test/embed/${i}`);
  const items = ctx.embedsParseM3u(partes.join("\n"));
  assert.equal(items.length, 5000);
  assert.equal(items[4999].stream_id, "liv-5000");
});

test("embedsParseM3u: sanitiza nome com HTML e logo malicioso", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTINF:-1 tvg-id="x" tvg-logo="javascript:alert(1)" group-title="G", <img src=x onerror=alert(1)> Filme (2000)\nhttps://fonte.test/embed/x`;
  const [item] = ctx.embedsParseM3u(m3u);
  assert.ok(item);
  assert.doesNotMatch(item.name, /[<>]/);
  assert.doesNotMatch(item.stream_icon, /javascript:/i);
});

// ── Chave da conta ──
test("embedsEnabled: true somente se sint_embeds_url começar com http:// ou https://", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.embedsEnabled(fakeStorage({})), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "" })), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "javascript:alert(1)" })), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "https://exemplo.test/livres.m3u" })), true);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "http://exemplo.test/livres.m3u" })), true);
  assert.equal(ctx.embedsEnabled(null), false);
  // a chave dos Legendados não liga os Filmes Livres (e vice-versa)
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_legendados_url: "https://exemplo.test/leg.m3u" })), false);
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_embeds_url: "https://exemplo.test/livres.m3u" })), false);
});

// ── Tipo de reprodução ──
test("vodItemPlayKind: embed, direct ou xtream; vodItemIsExtra: legendado ou livre", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.vodItemPlayKind({ embed_url: "https://fonte.test/embed/1", is_livre: true }), "embed");
  assert.equal(ctx.vodItemPlayKind({ direct_url: "https://cdn.test/a.mp4", is_livre: true }), "direct");
  assert.equal(ctx.vodItemPlayKind({ direct_url: "https://cdn.test/a.mp4", is_legendado: true }), "direct");
  assert.equal(ctx.vodItemPlayKind({ stream_id: 10, container_extension: "mkv" }), "xtream");
  assert.equal(ctx.vodItemPlayKind(null), "xtream");
  assert.equal(ctx.vodItemPlayKind(undefined), "xtream");
  assert.equal(ctx.vodItemIsExtra({ is_legendado: true }), true);
  assert.equal(ctx.vodItemIsExtra({ is_livre: true }), true);
  assert.equal(ctx.vodItemIsExtra({ stream_id: 10 }), false);
  assert.equal(ctx.vodItemIsExtra(null), false);
});

// ── HTML do iframe ──
test("embedFrameHtml: iframe com allow e allowfullscreen, URL escapada, SEM sandbox e SEM referrerpolicy (decisão do produto)", () => {
  const ctx = loadVodHelpers();
  const html = ctx.embedFrameHtml("https://fonte.test/embed/1?a=1&b=2");
  assert.match(html, /^<iframe /);
  assert.match(html, /src="https:\/\/fonte\.test\/embed\/1\?a=1&amp;b=2"/);
  assert.match(html, /allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"/);
  assert.match(html, /\ballowfullscreen\b/);
  assert.doesNotMatch(html, /sandbox/i);
  assert.doesNotMatch(html, /referrerpolicy/i);
  assert.match(html, /id="embed-frame"/);
});

test("embedFrameHtml: só https sem espaço nem aspas; qualquer outra coisa devolve string vazia", () => {
  const ctx = loadVodHelpers();
  for (const u of ["http://fonte.test/x", "javascript:alert(1)", "data:text/html,<b>", 'https://a.test/x"y', "https://a b.test/x", "", null, undefined, 42]) {
    assert.equal(ctx.embedFrameHtml(u), "", String(u));
  }
});

// ── Contrato da conta: url_embeds ──
test("OTT_LIST_KEYS.EMBEDS guarda o link em sint_embeds_url, ao lado de LEGENDADOS", () => {
  const o = loadOtt();
  assert.equal(plain(o.OTT_LIST_KEYS).EMBEDS, "sint_embeds_url");
  assert.equal(plain(o.OTT_LIST_KEYS).LEGENDADOS, "sint_legendados_url");
});

test("ottParseDeviceConfig: propaga url_embeds só se começar com http(s); url_legendados segue independente", () => {
  const o = loadOtt();
  const base = { id: "1", nome: "P", url_m3u: "http://exemplo.test/m3u" };
  const cfg = plain(o.ottParseDeviceConfig({
    status: "ok",
    playlists: [
      { ...base, url_embeds: "https://exemplo.test/livres.m3u", url_legendados: "https://exemplo.test/leg.m3u" },
      { ...base, url_embeds: "http://exemplo.test/livres.m3u" },
      { ...base, url_embeds: "javascript:alert(1)" },
      { ...base, url_embeds: "ftp://exemplo.test/livres.m3u" },
      { ...base, url_embeds: null },
      { ...base },
    ],
  }));
  assert.equal(cfg.playlists[0].url_embeds, "https://exemplo.test/livres.m3u");
  assert.equal(cfg.playlists[0].url_legendados, "https://exemplo.test/leg.m3u");
  assert.equal(cfg.playlists[1].url_embeds, "http://exemplo.test/livres.m3u");
  for (const i of [2, 3, 4, 5]) assert.equal(cfg.playlists[i].url_embeds, null, `lista ${i}`);
});

test("ottApplyPlaylist: grava e remove sint_embeds_url sem apagar o cache do guia (EPG)", () => {
  const o = loadOtt();
  const s = fakeStorage();
  const pl = { url_m3u: "http://exemplo.test/m3u", url_vod: "http://exemplo.test/vod", url_epg: "http://exemplo.test/epg", url_embeds: "https://exemplo.test/livres.m3u" };

  assert.equal(o.ottApplyPlaylist(s, pl), true);
  assert.equal(s.getItem("sint_embeds_url"), "https://exemplo.test/livres.m3u");

  s.setItem("sint_epg_cache", "cache-epg-valido");
  assert.equal(o.ottApplyPlaylist(s, pl), false, "chamada idêntica não muda nada");

  // trocar só o link dos Filmes Livres muda, mas o cache do guia fica
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_embeds: "https://exemplo.test/livres2.m3u" }), true);
  assert.equal(s.getItem("sint_embeds_url"), "https://exemplo.test/livres2.m3u");
  assert.equal(s.getItem("sint_epg_cache"), "cache-epg-valido");

  // sem url_embeds a chave some, também sem mexer no guia
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_embeds: null }), true);
  assert.equal(s.getItem("sint_embeds_url"), null);
  assert.equal(s.getItem("sint_epg_cache"), "cache-epg-valido");

  // trocar a lista de canais continua apagando o guia
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_m3u: "http://exemplo.test/m3u_novo", url_embeds: null }), true);
  assert.equal(s.getItem("sint_epg_cache"), null);

  // limpeza completa
  o.ottApplyPlaylist(s, pl);
  o.ottApplyPlaylist(s, null);
  assert.equal(s.getItem("sint_embeds_url"), null);
});

test("troca de conta e ottWebWipeAccountData limpam sint_embeds_url", () => {
  const o = loadOtt();
  const s = fakeStorage({ sint_web_owner: "user-1", sint_embeds_url: "https://exemplo.test/livres.m3u", sint_url: "http://exemplo.test/m3u" });
  o.ottWebWipeAccountData(s);
  assert.equal(s.getItem("sint_embeds_url"), null, "wipe de conta");

  s.setItem("sint_web_owner", "user-1");
  s.setItem("sint_embeds_url", "https://exemplo.test/livres.m3u");
  assert.equal(o.ottWebOwnerSwitch(s, "user-2"), true);
  assert.equal(s.getItem("sint_embeds_url"), null, "troca de dono");
});
