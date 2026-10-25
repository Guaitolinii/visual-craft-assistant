// Testes: categoria "Séries Livres": lista PRÓPRIA (sint_embeds_series_url), separada dos Filmes Livres.
// Cada item da lista de séries é um episódio; os episódios são agrupados em um cartão por série.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { loadOtt, fakeStorage, plain } from "../ott/loadOtt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Episódio com atributos: #EXTINF (id, capa, série, temporada, episódio) + link
const ep = (id, serie, t, e, titulo, url, capa = `https://exemplo.test/${id}.jpg`) =>
  `#EXTINF:-1 tvg-id="${id}" tvg-logo="${capa}" tvg-serie="${serie}" tvg-season="${t}" tvg-episode="${e}",${titulo}\n${url}`;

// ── Leitura da lista de séries ──
test("série: um cartão por série, com capa do primeiro episódio que tem capa, e flags de lista livre", () => {
  const ctx = loadVodHelpers();
  const { series, episodes } = ctx.embedsParseSeries(["#EXTM3U",
    ep("a1", "Dark", 1, 1, "Segredos", "https://fonte.test/embed/dark/1/1", ""),
    ep("a2", "Dark", 1, 2, "Mentiras", "https://fonte.test/embed/dark/1/2", "https://exemplo.test/dark.jpg"),
    ep("b1", "Chernobyl", 1, 1, "1:23:45", "https://fonte.test/embed/ch/1/1"),
  ].join("\n"));
  assert.deepEqual(series.map(s => s.series_id), ["livs-dark", "livs-chernobyl"]);
  const dark = series[0];
  assert.equal(dark.name, "Dark");
  assert.equal(dark.stream_icon, "https://exemplo.test/dark.jpg");
  assert.equal(dark.category_name, "Séries Livres");
  assert.equal(dark.is_livre, true);
  assert.equal(episodes["livs-dark"].length, 2);
});

test("episódios: ordenados por temporada e número; repetido vale o primeiro; embed e link direto no formato do modal", () => {
  const ctx = loadVodHelpers();
  const { episodes } = ctx.embedsParseSeries(["#EXTM3U",
    ep("x3", "Série X", 2, 1, "Volta", "https://fonte.test/embed/x/2/1"),
    ep("x2", "Série X", 1, 2, "Segundo", "https://cdn.test/x/s01e02.mp4"),
    ep("x1", "Série X", 1, 1, "Primeiro", "https://fonte.test/embed/x/1/1"),
    ep("x1b", "Série X", 1, 1, "Repetido", "https://fonte.test/embed/x/1/1-outro"),
  ].join("\n"));
  const lista = episodes["livs-serie-x"];
  assert.deepEqual(lista.map(e => `${e.season}x${e.episode_num}:${e.title}`), ["1x1:Primeiro", "1x2:Segundo", "2x1:Volta"]);
  assert.equal(lista[0].embed_url, "https://fonte.test/embed/x/1/1");
  assert.equal(lista[0].direct_url, undefined);
  assert.equal(lista[1].direct_url, "https://cdn.test/x/s01e02.mp4");
  assert.equal(lista[1].container_extension, "mp4");
  assert.equal(lista[1].embed_url, undefined);
  assert.equal(lista[0].id, "lie-x1", "id do episódio com prefixo próprio (nunca colide com o de filme)");
});

test("item da lista de séries sem série/temporada/episódio é descartado (não vira cartão nem filme)", () => {
  const ctx = loadVodHelpers();
  const { series, episodes } = ctx.embedsParseSeries(["#EXTM3U",
    '#EXTINF:-1 tvg-id="solto", Um filme perdido\nhttps://fonte.test/embed/solto',
    '#EXTINF:-1 tvg-id="meio" tvg-serie="Lost" tvg-season="1", Sem episódio\nhttps://fonte.test/embed/meio',
    ep("ok", "Lost", 1, 1, "Piloto", "https://fonte.test/embed/lost/1/1"),
  ].join("\n"));
  assert.deepEqual(series.map(s => s.series_id), ["livs-lost"]);
  assert.deepEqual(Object.keys(episodes), ["livs-lost"]);
  assert.equal(episodes["livs-lost"].length, 1);
});

test("sem atributos: nome no formato 'Série S01E03 - Título' também vira episódio", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.embedsEpisodeInfo({ name: "Breaking Bad S01E03 - And the Bags in the River" }),
    { serie: "Breaking Bad", season: 1, episode: 3, title: "And the Bags in the River" });
  assert.deepEqual(ctx.embedsEpisodeInfo({ name: "The Wire s2e11" }),
    { serie: "The Wire", season: 2, episode: 11, title: "The Wire s2e11" });
  // atributos têm prioridade sobre o nome
  assert.deepEqual(ctx.embedsEpisodeInfo({ name: "Piloto", serie_nome: "Lost", temporada: "1", episodio: "1" }),
    { serie: "Lost", season: 1, episode: 1, title: "Piloto" });
  // nome sem série, ou temporada/episódio faltando: sem informação de episódio
  assert.equal(ctx.embedsEpisodeInfo({ name: "S01E01" }), null);
  assert.equal(ctx.embedsEpisodeInfo({ name: "Nosferatu" }), null);
  assert.equal(ctx.embedsEpisodeInfo({ name: "Piloto", serie_nome: "Lost", temporada: "1" }), null);
  assert.equal(ctx.embedsEpisodeInfo({ name: "Piloto", serie_nome: "Lost", temporada: "0", episodio: "1" }), null);
  assert.equal(ctx.embedsEpisodeInfo(null), null);
});

test("embedsSlug: sem acento, minúsculas, só a-z 0-9 e hífen, nunca vazio", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.embedsSlug("Round 6 — A Série!"), "round-6-a-serie");
  assert.equal(ctx.embedsSlug("Não Pare"), "nao-pare");
  assert.equal(ctx.embedsSlug("???"), "serie");
  assert.equal(ctx.embedsSlug("<img src=x onerror=alert(1)>"), "img-src-x-onerror-alert-1");
  assert.match(ctx.embedsSlug("a".repeat(100)), /^a{40}$/);
});

test("nome de série com HTML nunca chega perigoso ao cartão (id seguro, nome saneado)", () => {
  const ctx = loadVodHelpers();
  const { series } = ctx.embedsParseSeries("#EXTM3U\n" + ep("h1", "<b>Hack</b>\"'", 1, 1, "Ep", "https://fonte.test/e/1"));
  assert.match(series[0].series_id, /^livs-[a-z0-9-]+$/);
  assert.doesNotMatch(series[0].name, /[<>"]/);
});

test("lista dos filmes não é afetada: todo item continua filme, mesmo com atributos de série", () => {
  const ctx = loadVodHelpers();
  const filmes = ctx.embedsParseM3u("#EXTM3U\n" + ep("d1", "Dark", 1, 1, "Segredos", "https://fonte.test/embed/d/1/1"));
  assert.equal(filmes.length, 1);
  assert.equal(filmes[0].stream_id, "liv-d1");
  assert.equal(filmes[0].category_name, "Filmes Livres");
});

// ── Cartão, modal e fileira ──
test("vodItemIsLivreSerie: só o cartão de série da lista de embeds", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.vodItemIsLivreSerie({ series_id: "livs-dark", is_livre: true }), true);
  assert.equal(ctx.vodItemIsLivreSerie({ series_id: 123 }), false);
  assert.equal(ctx.vodItemIsLivreSerie({ series_id: "livs-dark" }), false);
  assert.equal(ctx.vodItemIsLivreSerie({ stream_id: "liv-x", is_livre: true }), false);
  assert.equal(ctx.vodItemIsLivreSerie(null), false);
});

test("livreEpisodeRowHtml: botão com data-ep-livre escapado e sem botões de baixar/TV", () => {
  const ctx = loadVodHelpers();
  const html = ctx.livreEpisodeRowHtml({ id: 'lie-a"b', season: 2, episode_num: 5, title: "Título <x>" });
  assert.match(html, /data-ep-livre="lie-a&quot;b"/);
  assert.match(html, /T2 E5 — Título &lt;x&gt;/);
  assert.doesNotMatch(html, /ep-dl-btn|ep-tv-btn/);
});

// ── Lista própria: ativação e link da conta ──
test("embedsSeriesEnabled: só com sint_embeds_series_url http(s); o link dos filmes não liga as séries (e vice-versa)", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.embedsSeriesEnabled(fakeStorage({})), false);
  assert.equal(ctx.embedsSeriesEnabled(fakeStorage({ sint_embeds_series_url: "javascript:alert(1)" })), false);
  assert.equal(ctx.embedsSeriesEnabled(fakeStorage({ sint_embeds_series_url: "https://exemplo.test/series.m3u" })), true);
  assert.equal(ctx.embedsSeriesEnabled(fakeStorage({ sint_embeds_url: "https://exemplo.test/livres.m3u" })), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_series_url: "https://exemplo.test/series.m3u" })), false);
});

test("conta: url_embeds_series chega ao armazenamento, sai ao ser removido e não mexe no guia nem nos filmes", () => {
  const o = loadOtt();
  assert.equal(plain(o.OTT_LIST_KEYS).EMBEDS_SERIES, "sint_embeds_series_url");
  const base = { id: "p1", nome: "Principal", url_m3u: "http://exemplo.test/m3u" };
  const cfg = plain(o.ottParseDeviceConfig({
    status: "ok", user: { nome: "N" },
    playlists: [
      { ...base, url_embeds: "https://exemplo.test/livres.m3u", url_embeds_series: "https://exemplo.test/series.m3u" },
      { ...base, url_embeds_series: "javascript:alert(1)" },
      { ...base, url_embeds_series: null },
    ],
  }));
  assert.equal(cfg.playlists[0].url_embeds_series, "https://exemplo.test/series.m3u");
  assert.equal(cfg.playlists[0].url_embeds, "https://exemplo.test/livres.m3u", "os dois links são independentes");
  assert.equal(cfg.playlists[1].url_embeds_series, null);
  assert.equal(cfg.playlists[2].url_embeds_series, null);

  const s = fakeStorage({});
  const pl = { url_m3u: "http://exemplo.test/m3u", url_vod: "http://exemplo.test/vod", url_epg: "http://exemplo.test/epg", url_embeds: "https://exemplo.test/livres.m3u", url_embeds_series: "https://exemplo.test/series.m3u" };
  assert.equal(o.ottApplyPlaylist(s, pl), true);
  assert.equal(s.getItem("sint_embeds_series_url"), "https://exemplo.test/series.m3u");
  assert.equal(s.getItem("sint_embeds_url"), "https://exemplo.test/livres.m3u");
  s.setItem("sint_epg_cache", "guia");
  // tirar só o link das séries: some a chave dela, a dos filmes fica, o guia não é invalidado
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_embeds_series: null }), true);
  assert.equal(s.getItem("sint_embeds_series_url"), null);
  assert.equal(s.getItem("sint_embeds_url"), "https://exemplo.test/livres.m3u");
  assert.equal(s.getItem("sint_epg_cache"), "guia");
});

test("troca de conta e ottWebWipeAccountData limpam sint_embeds_series_url", () => {
  const o = loadOtt();
  const s = fakeStorage({ sint_web_owner: "user-1", sint_embeds_series_url: "https://exemplo.test/series.m3u", sint_url: "http://exemplo.test/m3u" });
  o.ottWebWipeAccountData(s);
  assert.equal(s.getItem("sint_embeds_series_url"), null);
});

// ── Download ──
test("embedsSeriesLoad: pedidos simultâneos dividem um único download; episódios voltam pela série", async () => {
  const ctx = loadVodHelpers();
  let chamadas = 0;
  const lista = ["#EXTM3U",
    ep("d1", "Dark", 1, 1, "Segredos", "https://fonte.test/embed/d/1/1"),
    ep("d2", "Dark", 1, 2, "Mentiras", "https://fonte.test/embed/d/1/2"),
  ].join("\n");
  ctx.AbortController = AbortController; // o contexto isolado não traz o AbortController
  ctx.fetch = async () => { chamadas++; return { ok: true, text: async () => lista }; };
  const url = "https://gist.test/series-unica.m3u";
  const [a, b] = await Promise.all([
    vm.runInContext(`embedsSeriesFetch(${JSON.stringify(url)})`, ctx),
    vm.runInContext(`embedsEpisodesOf(${JSON.stringify(url)}, "livs-dark")`, ctx),
  ]);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
  assert.equal(chamadas, 1, "fileira e modal pedidos juntos dividem um único download");
  await vm.runInContext(`embedsSeriesFetch(${JSON.stringify(url)})`, ctx);
  assert.equal(chamadas, 1, "depois da primeira carga o cache atende");
  assert.deepEqual([...(await vm.runInContext(`embedsEpisodesOf(${JSON.stringify(url)}, "livs-nada")`, ctx))], []);
  // link vazio ou inválido: nada para mostrar e nenhuma requisição
  assert.deepEqual([...(await vm.runInContext(`embedsSeriesFetch("")`, ctx))], []);
  assert.deepEqual([...(await vm.runInContext(`embedsSeriesFetch("javascript:alert(1)")`, ctx))], []);
  assert.equal(chamadas, 1);
});

test("ligações: fileira Séries Livres (lista própria) na aba Séries, modal de episódios e clique do episódio", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  // carga em paralelo, só na aba Séries e só se a lista PRÓPRIA das séries estiver ligada (nunca a dos filmes)
  assert.match(html, /vodType === "series" && embedsSeriesEnabled\(localStorage\)\)[\s\S]*?embedsSeriesFetch\(localStorage\.getItem\("sint_embeds_series_url"\)\)\.then\(items => \{\s+if \(_vodCatalogCache\.vodType !== "series"\) return;/);
  assert.match(html, /itemsByCategory\["series-livres"\] = items/);
  assert.match(html, /categoryStatus\["series-livres"\] = "ok"/);
  // o carregamento dos filmes continua só com a lista dos filmes
  assert.match(html, /embedsFetch\(localStorage\.getItem\("sint_embeds_url"\)\)/);
  // fileira só em Séries, acima das fileiras do catálogo
  assert.match(html, /contType === "series" && serLivItems && serLivItems\.length\)\s*\? extraRowHtml\("series-livres", EMBEDS_SERIES_CATEGORY_NAME, serLivItems, contType\)/);
  assert.match(html, /const extrasHtml = legHtml \+ livHtml \+ serLivHtml;/);
  // modal: série livre usa a lista própria das séries, não o get_series_info do Xtream, e não tem baixar nem TV
  assert.match(html, /if \(vodItemIsLivreSerie\(item\)\) \{[\s\S]*?embedsEpisodesOf\(localStorage\.getItem\("sint_embeds_series_url"\), item\.series_id\)[\s\S]*?livreEpisodeRowHtml[\s\S]*?return;\s*\}\s*try \{\s*const res = await vodApiFetch\(xtreamApiUrl\(creds, "get_series_info"/);
  // clique do episódio livre vem antes do tratamento do episódio Xtream (que exige credenciais)
  assert.match(html, /const livreBtn = e\.target\.closest\("\[data-ep-livre\]"\);[\s\S]*?playLivreEpisode\(livreBtn\.dataset\.epLivre\);[\s\S]*?const btn = e\.target\.closest\("\.ep-btn"\)/);
  // embed abre a tela própria; link direto toca no player nativo sem credenciais
  assert.match(html, /function playLivreEpisode\(epId\)[\s\S]*?openEmbedScreen\(\{ name: title, embed_url: ep\.embed_url \}\)[\s\S]*?playVodSelection\(ep\.direct_url/);
  // o cartão abre sem credenciais Xtream (is_livre conta como lista extra)
  assert.match(html, /!creds && !vodItemIsExtra\(item\)/);
  // nada de ler a lista dos filmes para as séries
  assert.doesNotMatch(html, /embedsSeriesFetch\(localStorage\.getItem\("sint_embeds_url"\)\)/);
});
