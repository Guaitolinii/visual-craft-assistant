import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { loadOtt, fakeStorage, plain } from "../ott/loadOtt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// ── 1. legendadosDirectExt ──
test("legendadosDirectExt: aceita apenas URLs https de arquivos de mídia diretos", () => {
  const ctx = loadVodHelpers();
  // Casos especificados
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/a.m3u8?x=1"), "m3u8");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/a.MP4"), "mp4");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/pagina"), "");
  assert.equal(ctx.legendadosDirectExt("http://exemplo.test/a.mp4"), "");
  assert.equal(ctx.legendadosDirectExt(""), "");
  assert.equal(ctx.legendadosDirectExt(null), "");
  assert.equal(ctx.legendadosDirectExt(undefined), "");

  // Outras extensões suportadas
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/filme.mkv"), "mkv");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/video.ts"), "ts");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/video.m4v"), "m4v");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/stream.webm"), "webm");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/trailer.mov#t=10"), "mov");

  // Rejeições de segurança e protocolos inválidos
  assert.equal(ctx.legendadosDirectExt("javascript:alert(1)"), "");
  assert.equal(ctx.legendadosDirectExt("data:video/mp4;base64,AAAA"), "");
  assert.equal(ctx.legendadosDirectExt("ftp://exemplo.test/a.mp4"), "");
  assert.equal(ctx.legendadosDirectExt("https://exemplo.test/a.mp4/player.html"), "");
});

// ── 2. legendadosEnabled ──
test("legendadosEnabled: true somente se sint_legendados_url começar com http:// ou https://", () => {
  const ctx = loadVodHelpers();
  // Chave ausente
  assert.equal(ctx.legendadosEnabled(fakeStorage({})), false);
  // Chave vazia ou só espaços
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_legendados_url: "" })), false);
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_legendados_url: "   " })), false);
  // Esquemas inseguros / inválidos
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_legendados_url: "javascript:alert(1)" })), false);
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_legendados_url: "ftp://exemplo.test/leg.m3u" })), false);
  // Válidos
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_legendados_url: "https://exemplo.test/y.m3u" })), true);
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_legendados_url: "http://exemplo.test/y.m3u" })), true);
  // Storage nulo ou quebrado
  assert.equal(ctx.legendadosEnabled(null), false);
  assert.equal(ctx.legendadosEnabled(undefined), false);
});

// ── 3. legendadosParseM3u ──
test("legendadosParseM3u: tvg-id com caracteres fora de [A-Za-z0-9_.-] ou longo demais é descartado", () => {
  const ctx = loadVodHelpers();
  const mk = (id) => `#EXTINF:-1 tvg-id="${id}" tvg-name="X",X\nhttps://exemplo.test/x.mp4`;
  assert.deepEqual(ctx.legendadosParseM3u(mk("a b")), []);
  assert.deepEqual(ctx.legendadosParseM3u(mk("a&b")), []);
  assert.deepEqual(ctx.legendadosParseM3u(mk("<s>")), []);
  assert.deepEqual(ctx.legendadosParseM3u(mk("a".repeat(41))), []);
  assert.equal(ctx.legendadosParseM3u(mk("tt-1.2_3")).length, 1);
  assert.equal(ctx.legendadosParseM3u(mk("a".repeat(40))).length, 1);
});

test("legendadosParseM3u: entradas inválidas e não-string devolvem []", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.legendadosParseM3u(""), []);
  assert.deepEqual(ctx.legendadosParseM3u("   "), []);
  assert.deepEqual(ctx.legendadosParseM3u(null), []);
  assert.deepEqual(ctx.legendadosParseM3u(undefined), []);
  assert.deepEqual(ctx.legendadosParseM3u(12345), []);
  assert.deepEqual(ctx.legendadosParseM3u({}), []);
});

test("legendadosParseM3u: sem #EXTM3U mas com itens válidos ainda lê normalmente", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTINF:-1 tvg-id="101" tvg-name="Interestelar (2014)" tvg-logo="https://exemplo.test/logo.jpg" group-title="Ficção",Interestelar (2014)\nhttps://exemplo.test/inter.mp4`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    stream_id: "leg-101",
    name: "Interestelar",
    stream_icon: "https://exemplo.test/logo.jpg",
    category_name: "Legendados",
    genre: "Ficção",
    direct_url: "https://exemplo.test/inter.mp4",
    container_extension: "mp4",
    year: "2014",
    is_legendado: true,
  });
});

test("legendadosParseM3u: tolera BOM no início e quebras de linha \\r\\n", () => {
  const ctx = loadVodHelpers();
  const m3u = `\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-id="102" tvg-name="Matrix (1999)",Matrix (1999)\r\nhttps://exemplo.test/matrix.mkv\r\n`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].stream_id, "leg-102");
  assert.equal(items[0].name, "Matrix");
  assert.equal(items[0].year, "1999");
  assert.equal(items[0].container_extension, "mkv");
});

test("legendadosParseM3u: descarta #EXTINF sem URL (próximo #EXTINF ou fim do arquivo)", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="103" tvg-name="Sem URL 1",Sem URL 1
#EXTINF:-1 tvg-id="104" tvg-name="Filme Bom (2020)",Filme Bom (2020)
https://exemplo.test/bom.mp4
#EXTINF:-1 tvg-id="105" tvg-name="Sem URL no Fim",Sem URL no Fim`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].stream_id, "leg-104");
});

test("legendadosParseM3u: descarta URLs http://, javascript:, data: e páginas sem extensão de mídia", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="1" tvg-name="Http Inseguro",Http Inseguro
http://exemplo.test/video.mp4
#EXTINF:-1 tvg-id="2" tvg-name="JS",JS
javascript:alert(1)
#EXTINF:-1 tvg-id="3" tvg-name="Data",Data
data:video/mp4;base64,AAAA
#EXTINF:-1 tvg-id="4" tvg-name="Pagina Embed",Pagina Embed
https://exemplo.test/embed/player.html
#EXTINF:-1 tvg-id="5" tvg-name="Valido (2022)",Valido (2022)
https://exemplo.test/video.mp4`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].stream_id, "leg-5");
});

test("legendadosParseM3u: aceita extensão com query e maiúsculas (.MP4?x=1)", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTINF:-1 tvg-id="200" tvg-name="Teste Query",Teste Query\nhttps://exemplo.test/filme.MP4?token=abc&exp=123`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].container_extension, "mp4");
  assert.equal(items[0].direct_url, "https://exemplo.test/filme.MP4?token=abc&exp=123");
});

test("legendadosParseM3u: descarta itens sem tvg-id", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="Sem ID",Sem ID
https://exemplo.test/filme1.mp4
#EXTINF:-1 tvg-id="" tvg-name="ID Vazio",ID Vazio
https://exemplo.test/filme2.mp4
#EXTINF:-1 tvg-id="ok-1" tvg-name="Com ID",Com ID
https://exemplo.test/filme3.mp4`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].stream_id, "leg-ok-1");
});

test("legendadosParseM3u: sanitiza nome com HTML (<img onerror=...>) e logo malicioso", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTINF:-1 tvg-id="sec1" tvg-name="<img onerror=alert(1)>Filme XSS" tvg-logo="javascript:alert(2)",Nome Sujo
https://exemplo.test/sec.mp4`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].name.includes("<"), false);
  assert.equal(items[0].name.includes(">"), false);
  assert.equal(items[0].stream_icon, "");
});

test("legendadosParseM3u: ano ausente devolve year: \"\"", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTINF:-1 tvg-id="ano0" tvg-name="Filme Sem Ano",Filme Sem Ano\nhttps://exemplo.test/sem_ano.mp4`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].year, "");
  assert.equal(items[0].name, "Filme Sem Ano");
});

test("legendadosParseM3u: título com vírgula (\"Eu, Robô (2004)\") extrai nome e ano corretamente", () => {
  const ctx = loadVodHelpers();
  // Com tvg-name
  const m3u1 = `#EXTINF:-1 tvg-id="robo1" tvg-name="Eu, Robô (2004)",Eu, Robô (2004)\nhttps://exemplo.test/robo.mp4`;
  const items1 = ctx.legendadosParseM3u(m3u1);
  assert.equal(items1.length, 1);
  assert.equal(items1[0].name, "Eu, Robô");
  assert.equal(items1[0].year, "2004");

  // Sem tvg-name (texto após atributos do #EXTINF)
  const m3u2 = `#EXTINF:-1 tvg-id="robo2",Eu, Robô (2004)\nhttps://exemplo.test/robo.mp4`;
  const items2 = ctx.legendadosParseM3u(m3u2);
  assert.equal(items2.length, 1);
  assert.equal(items2[0].name, "Eu, Robô");
  assert.equal(items2[0].year, "2004");
});

test("legendadosParseM3u: duplicados pelo mesmo stream_id preservam apenas a primeira ocorrência", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="dup1" tvg-name="Primeira Versao (2020)",Primeira
https://exemplo.test/dup1.mp4
#EXTINF:-1 tvg-id="dup1" tvg-name="Segunda Versao (2021)",Segunda
https://exemplo.test/dup2.mp4`;
  const items = ctx.legendadosParseM3u(m3u);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Primeira Versao");
  assert.equal(items[0].year, "2020");
  assert.equal(items[0].direct_url, "https://exemplo.test/dup1.mp4");
});

test("legendadosParseM3u: aguenta 2.000 itens em poucos ms", () => {
  const ctx = loadVodHelpers();
  const count = 2000;
  const lines = ["#EXTM3U"];
  for (let i = 1; i <= count; i++) {
    lines.push(`#EXTINF:-1 tvg-id="${i}" tvg-name="Filme de Teste ${i} (2024)" tvg-logo="https://exemplo.test/logo${i}.jpg" group-title="Ação",Filme de Teste ${i} (2024)`);
    lines.push(`https://exemplo.test/video_${i}.mp4`);
  }
  const bigM3u = lines.join("\n");

  const start = Date.now();
  const items = ctx.legendadosParseM3u(bigM3u);
  const elapsed = Date.now() - start;

  assert.equal(items.length, count);
  assert.equal(items[0].stream_id, "leg-1");
  assert.equal(items[count - 1].stream_id, `leg-${count}`);
  assert.ok(elapsed < 200, `Processamento demorou ${elapsed}ms (esperado < 200ms)`);
});

// ── 4. Contrato ott: ottParseDeviceConfig e ottApplyPlaylist ──
test("ottParseDeviceConfig: propaga url_legendados se começar com http(s) ou null", () => {
  const o = loadOtt();
  // Válido com https
  const cfg1 = plain(o.ottParseDeviceConfig({
    status: "ok",
    playlists: [{ id: "1", nome: "P", url_m3u: "http://exemplo.test/m3u", url_legendados: "https://exemplo.test/leg.m3u" }]
  }));
  assert.equal(cfg1.playlists[0].url_legendados, "https://exemplo.test/leg.m3u");

  // Válido com http
  const cfg2 = plain(o.ottParseDeviceConfig({
    status: "ok",
    playlists: [{ id: "1", nome: "P", url_m3u: "http://exemplo.test/m3u", url_legendados: "http://exemplo.test/leg.m3u" }]
  }));
  assert.equal(cfg2.playlists[0].url_legendados, "http://exemplo.test/leg.m3u");

  // Inválido (sem http/https, javascript, null, ausente)
  const cfg3 = plain(o.ottParseDeviceConfig({
    status: "ok",
    playlists: [
      { id: "1", nome: "P", url_m3u: "http://exemplo.test/m3u", url_legendados: "javascript:alert(1)" },
      { id: "2", nome: "P", url_m3u: "http://exemplo.test/m3u", url_legendados: "ftp://exemplo.test/leg.m3u" },
      { id: "3", nome: "P", url_m3u: "http://exemplo.test/m3u", url_legendados: null },
      { id: "4", nome: "P", url_m3u: "http://exemplo.test/m3u" }
    ]
  }));
  assert.equal(cfg3.playlists[0].url_legendados, null);
  assert.equal(cfg3.playlists[1].url_legendados, null);
  assert.equal(cfg3.playlists[2].url_legendados, null);
  assert.equal(cfg3.playlists[3].url_legendados, null);
});

test("ottApplyPlaylist: grava e remove sint_legendados_url e NÃO apaga cache EPG por causa dela", () => {
  const o = loadOtt();
  const s = fakeStorage();

  // Grava playlist com url_legendados
  const changed1 = o.ottApplyPlaylist(s, {
    url_m3u: "http://exemplo.test/m3u",
    url_vod: "http://exemplo.test/vod",
    url_epg: "http://exemplo.test/epg",
    url_legendados: "https://exemplo.test/leg.m3u"
  });
  assert.equal(changed1, true);
  assert.equal(s.getItem("sint_legendados_url"), "https://exemplo.test/leg.m3u");

  // Simula preenchimento de cache EPG
  s.setItem("sint_epg_cache", "cache-epg-valido");

  // Chamada idêntica: nada mudou
  const changed2 = o.ottApplyPlaylist(s, {
    url_m3u: "http://exemplo.test/m3u",
    url_vod: "http://exemplo.test/vod",
    url_epg: "http://exemplo.test/epg",
    url_legendados: "https://exemplo.test/leg.m3u"
  });
  assert.equal(changed2, false);
  assert.equal(s.getItem("sint_epg_cache"), "cache-epg-valido");

  // Altera APENAS url_legendados: mudou, MAS NÃO pode apagar sint_epg_cache
  const changed3 = o.ottApplyPlaylist(s, {
    url_m3u: "http://exemplo.test/m3u",
    url_vod: "http://exemplo.test/vod",
    url_epg: "http://exemplo.test/epg",
    url_legendados: "https://exemplo.test/leg_nova.m3u"
  });
  assert.equal(changed3, true);
  assert.equal(s.getItem("sint_legendados_url"), "https://exemplo.test/leg_nova.m3u");
  assert.equal(s.getItem("sint_epg_cache"), "cache-epg-valido", "sint_epg_cache não deve ser apagado ao alterar url_legendados");

  // Altera url_m3u: agora sim deve apagar sint_epg_cache
  const changed4 = o.ottApplyPlaylist(s, {
    url_m3u: "http://exemplo.test/m3u_novo",
    url_vod: "http://exemplo.test/vod",
    url_epg: "http://exemplo.test/epg",
    url_legendados: "https://exemplo.test/leg_nova.m3u"
  });
  assert.equal(changed4, true);
  assert.equal(s.getItem("sint_epg_cache"), null, "sint_epg_cache deve ser apagado ao alterar url_m3u");

  // Limpeza completa ottApplyPlaylist(s, null)
  const changed5 = o.ottApplyPlaylist(s, null);
  assert.equal(changed5, true);
  assert.equal(s.getItem("sint_legendados_url"), null);
  assert.equal(s.getItem("sint_url"), null);
  assert.equal(s.getItem("sint_vod_url"), null);
});

test("troca de conta e ottWebWipeAccountData limpam sint_legendados_url", () => {
  const o = loadOtt();
  const s = fakeStorage({
    sint_web_owner: "user-1",
    sint_legendados_url: "https://exemplo.test/leg1.m3u",
    sint_url: "http://exemplo.test/m3u",
    sint_vod_url: "http://exemplo.test/vod"
  });

  // ottWebWipeAccountData
  o.ottWebWipeAccountData(s);
  assert.equal(s.getItem("sint_legendados_url"), null, "sint_legendados_url deve ser apagado no wipe de conta");

  // ottWebOwnerSwitch para novo usuário
  s.setItem("sint_web_owner", "user-1");
  s.setItem("sint_legendados_url", "https://exemplo.test/leg1.m3u");
  assert.equal(o.ottWebOwnerSwitch(s, "user-2"), true);
  assert.equal(s.getItem("sint_legendados_url"), null, "sint_legendados_url deve ser limpo na troca de dono");
});

// ── 5. Integrações na UI e Helpers ──
test("trimVodItem e buildMyListEntry suportam itens legendados com direct_url", () => {
  const ctx = loadVodHelpers();
  const legItem = {
    stream_id: "leg-500",
    name: "Filme Legendado",
    stream_icon: "https://exemplo.test/capa.jpg",
    category_name: "Legendados",
    genre: "Drama",
    direct_url: "https://exemplo.test/video.mp4",
    container_extension: "mp4",
    year: "2023",
    is_legendado: true
  };

  const trimmed = ctx.trimVodItem(legItem);
  assert.equal(trimmed.stream_id, "leg-500");
  assert.equal(trimmed.direct_url, "https://exemplo.test/video.mp4");
  assert.equal(trimmed.is_legendado, true);

  const myEntry = ctx.buildMyListEntry(legItem, "vod");
  assert.equal(myEntry.id, "leg-500");
  assert.equal(myEntry.type, "vod");
  assert.equal(myEntry.item.direct_url, "https://exemplo.test/video.mp4");
});

test("histResumeUrl: título legendado com url ou direct_url toca direto sem exigir credenciais Xtream", () => {
  const ctx = loadVodHelpers();
  // Item com item.url preenchido
  assert.equal(
    ctx.histResumeUrl({ id: "resume-vod-leg-1", type: "vod", url: "https://exemplo.test/direto.mp4" }, null),
    "https://exemplo.test/direto.mp4"
  );
  // Item com item.vodItem.direct_url preenchido
  assert.equal(
    ctx.histResumeUrl({ id: "resume-vod-leg-2", type: "vod", vodItem: { direct_url: "https://exemplo.test/direto2.mp4", is_legendado: true } }, null),
    "https://exemplo.test/direto2.mp4"
  );
});

test("ligações no sintoniza-link.html: categoria Legendados, modal e busca", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");

  // OTT_LIST_KEYS tem LEGENDADOS
  assert.match(html, /LEGENDADOS:\s*"sint_legendados_url"/);

  // loadVodCatalog inicia download paralelo com legendadosEnabled
  assert.match(html, /legendadosEnabled\(/);
  assert.match(html, /legendadosFetch\(/);

  // Categoria "legendados" no topo das fileiras
  assert.match(html, /extraRowHtml\("legendados"/);
  assert.match(html, /id="vod-carousel-\$\{catId\}"/);

  // openVodModal esconde Baixar e TV para itens extras e chama playVodSelection com direct_url (via vodItemPlayKind)
  assert.match(html, /vodItemPlayKind\(item\)[\s\S]*?playVodSelection\(\s*item\.direct_url/);
});
