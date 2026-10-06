// Verifica no Chrome o app WEB (sintonizatv.com.br/app) gerado pelo build (scripts/build-web.mjs).
// Tudo FINGIDO e local: servidor em http://127.0.0.1:<porta>/app/ (nunca localhost: lá isNativeApp() é true) que também
// simula o /api/proxy do site (mesmo contrato da Task W3), um Supabase falso dentro da página (fetch trocado) e o Chrome
// com TODA requisição que não seja para 127.0.0.1 RECUSADA. Nenhum aparelho real é criado e o backend real não é tocado.
//   (a) sem sessão do site -> redireciona para /?next=%2Fapp%2F (sem chamar o backend)
//   (b) com sessão -> web_device_register com o Bearer do USUÁRIO (não a chave anon) e SEM tela de código/QR
//   (c) provedor inalcançável direto (provedor.test: a página só alcança 127.0.0.1): lista M3U, player_api.php e HLS caem no /api/proxy
//       com t=<token do aparelho> (o app tenta o direto primeiro e só usa o proxy depois de falhar)
//   (d) 1440x900: grade com colunas, setas nos carrosséis, roda do mouse, volume e atalhos de teclado
//   (e) 390x844 como atalho (navigator.standalone: este Chrome não emula display-mode): faixa da barra de status, tela cheia por CSS, sem volume
//   (f) service worker registrado, shell servido do cache offline, e nada de /api/ ou backend no cache
//   (g) v16, direto primeiro: provedores locais REAIS em 127.0.0.1 (CORS liberado, sem CORS, segmento sem CORS, <video> que recusa Referer)
//       conferem rota direta (zero chamadas ao proxy), fallback, memória por host (d/p, validade) e os contadores window.__sintWeb.
//       O Chrome daqui roda a página em http://127.0.0.1, então "http numa página https vai direto ao proxy" fica só nos testes
//       de unidade (tests/vod/web-helpers.test.js e web-routed.test.js): aqui não há como servir a página em https.
// Uso: node scripts/dev/check-web-app.mjs [pasta-das-capturas]   (as capturas são opcionais e não devem ser commitadas)
import http from "node:http";
import vm from "node:vm";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPage } from "./cdp.mjs";
import { buildWeb } from "../build-web.mjs";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } else console.log("  ok: " + msg); };

const TOKEN = "d".repeat(64);
const JWT = "JWT_DO_USUARIO_FALSO";
const ANON = "chave-anon-falsa";
const PERFIL = { id: "aaaaaaaa-1111-4111-8111-111111111111", nome: "Ana", avatar: "padrao", padrao: true };
const M3U_URL = "http://provedor.test/get.php?username=u&password=p&type=m3u_plus";
const VOD_URL = "http://provedor.test:8080/get.php?username=u&password=p&type=m3u_plus";

// ── build do app web numa pasta temporária (offline se o cache das bibliotecas já existe) ──
const out = mkdtempSync(path.join(tmpdir(), "sint-check-web-"));
const temCache = existsSync(path.join(RAIZ, ".web-cache", "lucide.min.js"));
await buildWeb({ outDir: out, offline: temCache });
const appDir = path.join(out, "app");

// ── servidor local: /app/ estático + /app-config.json + /api/proxy simulado ──
const proxyLog = [];
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css", ".woff2": "font/woff2" };

function m3u(base = "http://provedor.test") {
  const grupos = ["Notícias", "Esportes", "Filmes"];
  let t = "#EXTM3U\n";
  for (let i = 1; i <= 18; i++) t += `#EXTINF:-1 tvg-id="" tvg-name="Canal ${i}" tvg-logo="" group-title="${grupos[i % 3]}",Canal ${String(i).padStart(2, "0")}\n${base}/live/u/p/${i}.m3u8\n`;
  return t;
}
function respostaApi(action, categoria) {
  if (action === "get_vod_categories") return [{ category_id: "11", category_name: "Ação" }, { category_id: "12", category_name: "Drama" }];
  if (action === "get_vod_streams") return Array.from({ length: 24 }, (_, i) => ({ stream_id: Number(categoria) * 100 + i, name: `Filme ${categoria}-${i + 1}`, stream_icon: "", container_extension: "mp4", added: String(1700000000 + i), rating: "7" }));
  return [];
}
// WAV de 1 s em silêncio: o <video> do Chrome toca (serve de "filme" sem precisar de mp4 de verdade)
function wav() {
  const n = 8000, b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
}
const SEGMENTO = Buffer.alloc(188 * 20, 0x47);
// Conteúdo de um "provedor" (serve igual direto ou por trás do proxy simulado). hls: reescreve o segmento (só o proxy faz isso)
function conteudo(alvo, resp, hls, tokenDoProxy) {
  if (alvo.pathname === "/get.php") return resp(200, m3u(alvo.origin), "audio/x-mpegurl");
  if (alvo.pathname === "/player_api.php") return resp(200, respostaApi(alvo.searchParams.get("action"), alvo.searchParams.get("category_id")));
  if (alvo.pathname.endsWith(".m3u8")) {
    const seg = hls ? `/api/proxy?u=${encodeURIComponent(alvo.origin + "/live/seg1.ts")}&t=${tokenDoProxy}&k=hls` : alvo.origin + "/live/seg1.ts";
    return resp(200, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\n${seg}\n`, "application/vnd.apple.mpegurl");
  }
  if (alvo.pathname.endsWith(".ts")) return resp(200, SEGMENTO, "video/mp2t");
  if (alvo.pathname.startsWith("/movie/")) return resp(200, wav(), "audio/wav");
  return resp(404, { erro: "não encontrado" });
}
function proxy(req, res, url) {
  const u = url.searchParams.get("u"), t = url.searchParams.get("t"), k = url.searchParams.get("k");
  let host = "";
  try { host = new URL(u).host; } catch (e) { /* destino inválido */ }
  proxyLog.push({ method: req.method, u, t, k, host });
  const json = (status, corpo, tipo = "application/json") => { res.writeHead(status, { "Content-Type": tipo, "Cache-Control": "no-store" }); res.end(req.method === "HEAD" ? undefined : Buffer.isBuffer(corpo) || typeof corpo === "string" ? corpo : JSON.stringify(corpo)); };
  if (!t || t !== TOKEN) return json(401, { erro: "sessão inválida" });
  let alvo;
  try { alvo = new URL(u); } catch (e) { return json(400, { erro: "destino inválido" }); }
  if (alvo.hostname !== "provedor.test" && alvo.hostname !== "127.0.0.1") return json(502, { erro: "o provedor não respondeu" });
  return conteudo(alvo, json, true, t);
}

// ── provedores locais de verdade (127.0.0.1:<porta>): o Chrome aplica CORS entre a página e eles ──
// cors: tudo liberado | "sem": nenhum cabeçalho CORS | "sem-segmento": liberado menos os .ts | refererRecusa: /movie/ responde 403 se vier Referer
function criarProvedor({ cors, refererRecusa = false }) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    hits.push({ path: url.pathname, referer: req.headers.referer || "", method: req.method });
    const liberado = cors === true || (cors === "sem-segmento" && !url.pathname.endsWith(".ts"));
    const cab = liberado ? { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Type, Content-Length" } : {};
    if (req.method === "OPTIONS") { res.writeHead(204, { ...cab, "Access-Control-Allow-Headers": "*" }); return res.end(); }
    if (refererRecusa && url.pathname.startsWith("/movie/") && req.headers.referer) { res.writeHead(403, cab); return res.end("recusado"); }
    const resp = (status, corpo, tipo = "application/json") => { res.writeHead(status, { ...cab, "Content-Type": tipo, "Cache-Control": "no-store" }); res.end(req.method === "HEAD" ? undefined : Buffer.isBuffer(corpo) || typeof corpo === "string" ? corpo : JSON.stringify(corpo)); };
    conteudo(new URL(req.url, "http://127.0.0.1:" + srv.address().port), resp, false, "");
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, hits, porta: srv.address().port, host: "127.0.0.1:" + srv.address().port, base: "http://127.0.0.1:" + srv.address().port })));
}
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/proxy") return proxy(req, res, url);
  if (url.pathname === "/app-config.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ url: "https://falso.supabase.co", anonKey: ANON })); }
  if (url.pathname === "/" || url.pathname === "/conta") { res.writeHead(200, { "Content-Type": TIPOS[".html"] }); return res.end("<!doctype html><title>site</title><p>página do site (login/conta)</p>"); }
  if (url.pathname.startsWith("/app")) {
    let rel = url.pathname.replace(/^\/app\/?/, "");
    if (!rel) rel = "index.html";
    const arq = path.join(appDir, rel);
    if (!arq.startsWith(appDir) || !existsSync(arq) || statSync(arq).isDirectory()) { res.writeHead(404); return res.end("não encontrado"); }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream", "Cache-Control": "no-cache" });
    return res.end(readFileSync(arq));
  }
  res.writeHead(404);
  res.end("não encontrado");
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const PORTA = servidor.address().port;
const URL_APP = `http://127.0.0.1:${PORTA}/app/`;

// ── Supabase falso dentro da página (o estado do log fica no localStorage: sobrevive aos reloads do app) ──
// m3u/vod: endereços do provedor na conta (padrão provedor.test, inalcançável direto); memoria: sint_web_hosts já gravado
function preScript({ sessao, standalone = false, m3u: m3uUrl = M3U_URL, vod: vodUrl = VOD_URL, memoria = null, extra = null }) {
  const src = `(() => {
    ${standalone ? 'Object.defineProperty(navigator, "standalone", { get: () => true });' : ""}
    if (!localStorage.getItem("__seeded")) {
      ${sessao ? `localStorage.setItem("sintoniza_painel_sessao", ${JSON.stringify(JSON.stringify(sessao))});` : ""}
      ${memoria ? `localStorage.setItem("sint_web_hosts", ${JSON.stringify(JSON.stringify(memoria))});` : ""}
      ${extra ? Object.keys(extra).map((k) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(extra[k])});`).join("\n      ") : ""}
      localStorage.setItem("__log", "[]");
      localStorage.setItem("__seeded", "1");
    }
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      url = String(url);
      const u = new URL(url, location.href);
      if (u.origin === location.origin || u.hostname === "127.0.0.1") return realFetch(url, init); // 127.0.0.1: provedores locais de verdade (CORS real)
      if (u.hostname === "falso.supabase.co") {
        const h = (init && init.headers) || {};
        const body = init && init.body ? JSON.parse(init.body) : {};
        const nome = u.pathname.indexOf("/rpc/") >= 0 ? u.pathname.split("/rpc/")[1] : u.pathname;
        const log = JSON.parse(localStorage.getItem("__log") || "[]");
        log.push({ nome, body, auth: h.Authorization || "", apikey: h.apikey || "" });
        localStorage.setItem("__log", JSON.stringify(log));
        if (nome === "web_device_register") return J({ status: "ok", device_token: ${JSON.stringify(TOKEN)} });
        if (nome === "device_config") {
          // o aparelho do ADMIN continua válido no servidor (o "Sair" do site não o apaga): se o app o usar, entra como admin
          if (body.p_token === "e".repeat(64)) return J({ status: "ok", user: { nome: "Administrador", status: "active", acesso_fim: "2030-01-01T00:00:00Z" },
            playlists: [{ id: "9", nome: "Admin", url_m3u: ${JSON.stringify(m3uUrl)}, url_vod: ${JSON.stringify(vodUrl)}, url_epg: null }] });
          if (body.p_token !== ${JSON.stringify(TOKEN)}) return J({ status: "unknown_device" });
          return J({ status: "ok", user: { nome: "Ana Teste", status: "active", acesso_fim: "2030-01-01T00:00:00Z" },
            playlists: [{ id: "1", nome: "Principal", url_m3u: ${JSON.stringify(m3uUrl)}, url_vod: ${JSON.stringify(vodUrl)}, url_epg: null }] });
        }
        if (nome === "perfil_list") {
          // __semperfil: conta nova (migração 0014): com p_auto_criar:false o servidor devolve a lista como está, sem criar o principal
          if (localStorage.getItem("__semperfil") === "1" && body.p_auto_criar === false) return J({ status: "ok", perfis: JSON.parse(localStorage.getItem("__perfis") || "[]") });
          return J({ status: "ok", perfis: [${JSON.stringify(PERFIL)}] });
        }
        if (nome === "perfil_save" && localStorage.getItem("__semperfil") === "1") {
          const lista = JSON.parse(localStorage.getItem("__perfis") || "[]");
          const novo = { id: "cccccccc-3333-4333-8333-333333333333", nome: body.p_nome, avatar: body.p_avatar, padrao: lista.length === 0 };
          lista.push(novo); localStorage.setItem("__perfis", JSON.stringify(lista));
          return J({ status: "ok", perfil: novo });
        }
        if (nome.indexOf("/auth/") === 0 || nome.indexOf("/auth") >= 0) return J({});
        return J({ status: "ok", itens: [], found: false, tvs: [] });
      }
      throw new TypeError("rede bloqueada no teste: " + url);
    };
  })();`;
  new vm.Script(src); // valida a sintaxe antes de abrir o Chrome
  return src;
}
const sessaoOk = () => ({ access_token: JWT, refresh_token: "refresh-falso", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "ana@exemplo.com" } });

const espera = async (page, expr, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await page.eval(expr)) return true; } catch (e) { /* página recarregando */ }
    await page.sleep(250);
  }
  return false;
};
const tecla = async (page, key, code, vk) => {
  const texto = key.length === 1 ? { text: key } : {};
  await page.send("Input.dispatchKeyEvent", { type: texto.text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, ...texto });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
};
const log = (page) => page.eval(`JSON.parse(localStorage.getItem("__log") || "[]")`);
const captura = async (page, nome) => { if (pasta) await page.screenshot(path.join(pasta, nome)); };
const PRONTO = `typeof _state !== "undefined" && _state.channels && _state.channels.length > 0`;

try {
  // ── (a) sem sessão do site ──
  console.log("(a) sem sessão do site");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: null }) }, async (page) => {
    await espera(page, `location.pathname === "/"`, 8000);
    const loc = await page.eval(`location.pathname + location.search`);
    confere(loc === "/?next=%2Fapp%2F", "redireciona para /?next=%2Fapp%2F (ficou em " + loc + ")");
    confere((await log(page)).length === 0, "nenhuma chamada ao backend sem sessão");
    confere(page.blocked.length === 0, "nenhuma requisição externa tentada");
  });

  // ── (b)(c)(d) computador 1440x900 com sessão ──
  console.log("(b)(c)(d) computador 1440x900");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: sessaoOk() }) }, async (page) => {
    const carregou = await espera(page, PRONTO, 25000);
    confere(carregou, "o app carrega os canais pela conta (via proxy)");
    const chamadas = await log(page);
    const reg = chamadas.find((c) => c.nome === "web_device_register");
    confere(!!reg, "chamou web_device_register");
    confere(reg && reg.auth === "Bearer " + JWT, "web_device_register vai com o Bearer do USUÁRIO");
    confere(reg && reg.apikey === ANON && reg.auth !== "Bearer " + ANON, "e não com a chave anon como Bearer");
    confere(reg && /^[A-Za-z0-9-]{16,64}$/.test(reg.body.p_instalacao) && /Chrome/.test(reg.body.p_modelo), "envia o id da instalação e o modelo (" + (reg && reg.body.p_modelo) + ")");
    confere(!chamadas.some((c) => c.nome === "device_start"), "não pede código de ativação (device_start)");
    const tela = await page.eval(`({ aberta: document.documentElement.classList.contains("ott-open"), codigo: getComputedStyle(document.getElementById("ott-gate")).display, token: localStorage.getItem("sint_ott_token") })`);
    confere(!tela.aberta && tela.codigo === "none", "a tela de código/QR não aparece");
    confere(tela.token === TOKEN, "o token do aparelho web foi guardado");
    const ruins = proxyLog.filter((p) => p.t !== TOKEN);
    confere(proxyLog.length > 0 && ruins.length === 0, "todas as " + proxyLog.length + " requisições ao proxy levam t=<token do aparelho>");
    confere(proxyLog.some((p) => /\/get\.php/.test(p.u || "")), "a lista M3U saiu por /api/proxy");
    // sem pré-carregamento, o catálogo Xtream só é pedido quando se abre Filmes
    await page.eval(`document.getElementById("nav-vod-movies").click()`);
    for (let i = 0; i < 40 && !proxyLog.some((p) => /player_api\.php/.test(p.u || "")); i++) await page.sleep(500);
    confere(proxyLog.some((p) => /player_api\.php/.test(p.u || "")), "o player_api.php (Xtream) saiu por /api/proxy");
    confere(page.blocked.length === 0, "nenhuma requisição direta a provedor/CDN (bloqueadas: " + page.blocked.join(", ") + ")");

    // grade de canais
    await page.eval(`document.querySelector('.sidebar-nav .nav-item[data-section="Todos os canais"]').click()`);
    await page.sleep(600);
    const cols = (js) => page.eval(`getComputedStyle(document.querySelector(".channel-grid")).gridTemplateColumns.split(" ").length`);
    const c1440 = await cols();
    confere(c1440 >= 4, "1440 px: grade com " + c1440 + " colunas");
    await captura(page, "desktop-1440-canais.png");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.sleep(500);
    const c1920 = await cols();
    confere(c1920 > c1440, "1920 px: grade cresce para " + c1920 + " colunas (1440 tinha " + c1440 + ")");
    const largura = await page.eval(`Math.round(document.querySelector(".content-shell").getBoundingClientRect().width)`);
    confere(largura > 1472 - 4, "1920 px: área de conteúdo mais larga que 92rem (" + largura + " px)");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.sleep(500);

    // player: volume e atalhos
    await page.eval(`document.querySelector(".channel-card .card-main").click()`);
    const sel = await espera(page, `!!_state.selected`, 6000);
    confere(sel, "um canal foi selecionado");
    await page.sleep(1500);
    const vol = await page.eval(`getComputedStyle(document.getElementById("web-volume")).display`);
    confere(vol === "flex", "controle de volume visível no computador");
    const reqHls = proxyLog.some((p) => /\.m3u8/.test(p.u || "") && p.k === "hls");
    confere(reqHls, "o stream HLS pediu o manifesto por /api/proxy ... &k=hls");
    await page.eval(`window.scrollTo(0, 0)`);
    await page.sleep(400);
    await captura(page, "desktop-1440-player.png");
    await page.eval(`document.body.focus()`);
    await tecla(page, "m", "KeyM", 77);
    await page.sleep(200);
    confere(await page.eval(`document.getElementById("player-video").muted === true`), "tecla M silencia");
    await tecla(page, "ArrowDown", "ArrowDown", 40);
    await page.sleep(200);
    const v = await page.eval(`({ v: Math.round(document.getElementById("player-video").volume * 10) / 10, m: document.getElementById("player-video").muted })`);
    confere(v.v === 0.9 && v.m === false, "seta para baixo baixa o volume para 90% e desmuta (" + JSON.stringify(v) + ")");
    await tecla(page, "/", "Slash", 191);
    await page.sleep(200);
    confere(await page.eval(`["search-input", "vod-search-input"].includes(document.activeElement && document.activeElement.id)`), "tecla / foca a busca");
    await page.eval(`document.activeElement.blur()`);
    await tecla(page, "m", "KeyM", 77); // com foco fora de campo
    await page.eval(`(() => { const i = document.getElementById("search-input"); i.focus(); })()`);
    const antes = await page.eval(`document.getElementById("player-video").muted`);
    await tecla(page, "m", "KeyM", 77);
    confere(await page.eval(`document.getElementById("player-video").muted === ${antes}`), "digitar num campo não aciona atalhos");
    await page.eval(`document.activeElement.blur()`);

    // carrosséis: setas e roda do mouse (Filmes; #vod-view porque o Acesso rápido da aba Canais também é um .vod-carousel, só que oculto aqui)
    await page.eval(`document.getElementById("nav-vod-movies").click()`);
    const rows = await espera(page, `document.querySelectorAll(".vod-row .vod-card").length > 6`, 15000);
    confere(rows, "o catálogo de filmes carregou pelo proxy");
    await page.sleep(500);
    const pos = await page.eval(`(() => { const c = document.querySelector("#vod-view .vod-carousel"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y });
    await page.sleep(500);
    const arrow = await page.eval(`(() => { const a = document.querySelector("#vod-view .web-arrow-next"); if (!a) return null; const r = a.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), op: getComputedStyle(a).opacity }; })()`);
    confere(arrow && arrow.op === "1", "seta 'avançar' aparece ao passar o mouse na fileira");
    await captura(page, "desktop-1440-filmes.png");
    if (arrow) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: arrow.x, y: arrow.y });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: arrow.x, y: arrow.y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: arrow.x, y: arrow.y, button: "left", clickCount: 1 });
      await page.sleep(900);
      const s1 = await page.eval(`document.querySelector("#vod-view .vod-carousel").scrollLeft`);
      confere(s1 > 100, "clicar na seta rola a fileira (scrollLeft " + s1 + ")");
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: pos.x, y: pos.y, deltaX: 0, deltaY: 100 });
      await page.sleep(500);
      const s2 = await page.eval(`document.querySelector("#vod-view .vod-carousel").scrollLeft`);
      confere(s2 > s1, "a roda do mouse rola a fileira na horizontal (" + s1 + " -> " + s2 + ")");
    }
    const prevOff = await page.eval(`!!document.querySelector("#vod-view .web-arrow-prev:not(.is-off)")`);
    confere(prevOff, "depois de rolar, a seta 'voltar' passa a aparecer");
    confere(page.blocked.length === 0, "continua sem requisição externa (" + page.blocked.length + ")");
  });

  // ── (e) celular 390x844 como atalho (standalone) ──
  console.log("(e) celular 390x844 como atalho (standalone)");
  await withPage(URL_APP, {
    width: 390, height: 844, blockExternal: true, preScript: preScript({ sessao: sessaoOk(), standalone: true }),
    safeArea: { top: 47, bottom: 34 },
  }, async (page) => {
    const carregou = await espera(page, PRONTO, 25000);
    confere(carregou, "o app abre no celular com a conta do site");
    confere(await page.eval(`document.documentElement.classList.contains("web-standalone")`), "reconhece o modo atalho (navigator.standalone, como o atalho do iPhone)");
    const inset = await page.eval(`(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;padding-top:env(safe-area-inset-top)"; document.body.appendChild(d); const v = parseFloat(getComputedStyle(d).paddingTop); d.remove(); return v; })()`);
    const faixa = await page.eval(`(() => { const s = getComputedStyle(document.documentElement, "::before"); return { pos: s.position, h: parseFloat(s.height), bg: s.backgroundColor }; })()`);
    confere(faixa.pos === "fixed" && /rgb\(8, 8, 13\)/.test(faixa.bg), "faixa escura (#08080D) fixa no topo para a barra de status");
    if (inset > 0) {
      confere(faixa.h === inset, "a faixa tem a altura do recorte (" + inset + " px)");
      const pad = await page.eval(`parseFloat(getComputedStyle(document.querySelector(".topbar")).paddingTop)`);
      confere(pad >= inset, "a barra do topo respeita o recorte (padding-top " + pad + " px)");
    } else console.log("  (este Chrome não emula safe-area-inset: altura da faixa não conferida)");
    confere(await page.eval(`getComputedStyle(document.getElementById("web-volume")).display === "none"`), "sem controle de volume no celular (volume é o do aparelho)");
    await page.eval(`document.querySelector('.mobile-tab[data-section="Todos os canais"]').click()`);
    await page.sleep(700);
    await page.eval(`document.querySelector(".channel-card .card-main").click()`);
    await espera(page, `!!_state.selected`, 6000);
    await page.sleep(800);
    await page.eval(`toggleFullscreen()`);
    await page.sleep(500);
    const fs = await page.eval(`({ pseudo: document.getElementById("player-screen").classList.contains("pseudo-fullscreen"), real: !!document.fullscreenElement })`);
    confere(fs.pseudo && !fs.real, "tela cheia usa a de CSS (pseudo-fullscreen), não a Fullscreen API");
    await captura(page, "celular-390-standalone-tela-cheia.png");
    await page.eval(`toggleFullscreen()`);
    await page.sleep(500);
    await page.eval(`window.scrollTo(0, 0)`);
    await captura(page, "celular-390-standalone.png");
    confere(await page.eval(`document.getElementById("player-screen").classList.contains("pseudo-fullscreen") === false`), "sai da tela cheia");
    confere(page.blocked.length === 0, "nenhuma requisição externa (" + page.blocked.length + ")");
  });

  // ── (f) service worker ──
  console.log("(f) service worker e shell offline");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, preScript: preScript({ sessao: sessaoOk() }) }, async (page) => {
    await espera(page, PRONTO, 25000);
    const reg = await page.eval(`navigator.serviceWorker.ready.then(r => ({ url: r.active && r.active.scriptURL, scope: r.scope }))`);
    confere(reg && /\/app\/sw\.js$/.test(reg.url) && /\/app\/$/.test(reg.scope), "service worker registrado em /app/sw.js com escopo /app/");
    await page.send("Page.reload");
    await page.sleep(3000);
    const ctl = await page.eval(`!!navigator.serviceWorker.controller`);
    confere(ctl, "a página passa a ser controlada pelo service worker");
    const chaves = await page.eval(`caches.keys().then(async ks => { const o = {}; for (const k of ks) o[k] = (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname + (new URL(r.url).host === location.host ? "" : "@" + new URL(r.url).host)); return o; })`);
    const nomes = Object.keys(chaves);
    confere(nomes.length === 1 && /^sintoniza-web-[0-9a-f]{12}$/.test(nomes[0]), "um cache do shell (" + nomes.join(",") + ")");
    const itens = [].concat(...Object.values(chaves));
    confere(itens.includes("/app/") && itens.includes("/app/manifest.webmanifest") && itens.some((i) => i.startsWith("/app/vendor/")), "o shell (página, manifest, bibliotecas) está no cache");
    confere(!itens.some((i) => /\/api\/|\/auth\/|\/rest\/|@/.test(i)), "nada de /api/, /auth/, /rest/ nem de outra origem no cache");
    // segunda visita sem internet: o shell vem do cache
    await page.send("Network.enable");
    await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.send("Page.navigate", { url: URL_APP });
    await page.sleep(3500);
    const off = await page.eval(`({ web: document.documentElement.getAttribute("data-web-app"), titulo: document.title, ctl: !!navigator.serviceWorker.controller })`);
    confere(off.web === "1" && /Sintoniza/.test(off.titulo), "offline: a página abre do cache (" + off.titulo + ")");
    await captura(page, "desktop-offline-shell.png");
  });

  // ── (g) v16: direto primeiro, proxy só se falhar (provedores locais de verdade; cada cenário abre um Chrome novo) ──
  console.log("(g) direto primeiro, proxy só se falhar");
  const provs = [];
  const novoProv = async (o) => { const p = await criarProvedor(o); provs.push(p); return p; };
  const doProv = (p, re) => p.hits.filter((h) => re.test(h.path));
  const viaProxyDe = (p, re = /./) => proxyLog.filter((x) => x.host === p.host && re.test(x.u || ""));
  const contadores = async (page) => JSON.parse(await page.eval(`JSON.stringify(window.__sintWeb || null)`));
  // window.__sintWeb zera a cada reload (o app recarrega ao registrar o aparelho): os totais do cenário saem do console, que sobrevive
  const evWeb = (page, nome) => page.console.filter((l) => l.startsWith("debug: [web] " + nome + " ")).length;
  const memoriaDe = (page) => page.eval(`JSON.parse(localStorage.getItem("sint_web_hosts") || "{}")`);
  const esperaNode = async (page, fn, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await page.sleep(250); } return false; };
  const urlsDe = (p) => { const u = `${p.base}/get.php?username=u&password=p&type=m3u_plus`; return { m3u: u, vod: u }; };
  const cenario = (p, memoria, fn) => withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: sessaoOk(), ...urlsDe(p), memoria }) }, async (page) => {
    confere(await espera(page, PRONTO, 25000), "a lista de canais carregou");
    await fn(page);
    confere(page.blocked.length === 0, "nenhuma requisição externa (" + page.blocked.join(", ") + ")");
  });
  const abrirCanal = async (page) => {
    await page.eval(`document.querySelector('.sidebar-nav .nav-item[data-section="Todos os canais"]').click()`);
    await page.sleep(600);
    await page.eval(`document.querySelector(".channel-card .card-main").click()`);
    await espera(page, `!!_state.selected`, 6000);
  };
  const abrirFilmes = async (page) => {
    await page.eval(`document.getElementById("nav-vod-movies").click()`);
    return espera(page, `document.querySelectorAll(".vod-row .vod-card").length > 6`, 15000);
  };

  console.log("(g1) provedor com CORS liberado: tudo direto, zero chamadas ao proxy");
  const p1 = await novoProv({ cors: true });
  await cenario(p1, null, async (page) => {
    confere(doProv(p1, /get\.php/).length >= 1 && viaProxyDe(p1).length === 0, "a lista M3U foi direto ao provedor (proxy: " + viaProxyDe(p1).length + ")");
    let c = await contadores(page);
    confere(c && c.direto >= 1 && c.proxy === 0 && c.fallback === 0, "contadores: direto>=1, proxy=0, fallback=0 (" + JSON.stringify(c) + ")");
    confere((await memoriaDe(page))[p1.host]?.m === "d", "o host ficou marcado 'd' na memória");
    confere(await abrirFilmes(page), "o catálogo de filmes carregou");
    confere(doProv(p1, /player_api\.php/).length > 0 && viaProxyDe(p1).length === 0, "o player_api.php foi direto");
    await abrirCanal(page);
    confere(await esperaNode(page, () => doProv(p1, /\.m3u8/).length > 0 && doProv(p1, /\.ts$/).length > 0), "HLS direto: manifesto e segmento pedidos ao provedor");
    c = await contadores(page);
    confere(viaProxyDe(p1).length === 0 && c.proxy === 0 && c.direto >= 3, "no fim: zero chamadas ao proxy e contador direto>=3 (" + JSON.stringify(c) + ")");
  });

  console.log("(g2) provedor SEM CORS: cai no proxy uma vez e lembra 'p'");
  const p2 = await novoProv({ cors: false });
  await cenario(p2, null, async (page) => {
    confere(doProv(p2, /get\.php/).length === 1 && viaProxyDe(p2, /get\.php/).length >= 1, "lista M3U: 1 única tentativa direta (bloqueada pelo CORS) e depois só o proxy (" + viaProxyDe(p2, /get\.php/).length + " pelo proxy)");
    confere(evWeb(page, "fallback") === 1 && evWeb(page, "direto") === 0 && evWeb(page, "proxy") >= 1, "contadores: fallback=1, direto=0 (fallback " + evWeb(page, "fallback") + ", direto " + evWeb(page, "direto") + ", proxy " + evWeb(page, "proxy") + ")");
    confere((await memoriaDe(page))[p2.host]?.m === "p", "o host ficou marcado 'p'");
    confere(await abrirFilmes(page), "o catálogo carregou");
    confere(doProv(p2, /player_api\.php/).length === 0 && viaProxyDe(p2, /player_api\.php/).length > 0, "com 'p' o player_api.php vai direto ao proxy, sem tentar o direto de novo");
    await abrirCanal(page);
    confere(await esperaNode(page, () => viaProxyDe(p2, /\.m3u8/).some((x) => x.k === "hls")), "HLS pelo proxy com k=hls");
    confere(doProv(p2, /\.m3u8/).length === 0, "sem sondar o manifesto direto (memória 'p')");
  });

  console.log("(g3) HLS: manifesto com CORS mas segmento sem CORS: recomeça pelo proxy");
  const p3 = await novoProv({ cors: "sem-segmento" });
  await cenario(p3, null, async (page) => {
    await abrirCanal(page);
    confere(await esperaNode(page, () => viaProxyDe(p3, /\.ts/).some((x) => x.k === "hls")), "o segmento acabou saindo pelo proxy (k=hls)");
    confere(doProv(p3, /\.ts$/).length >= 1 && viaProxyDe(p3, /\.m3u8/).some((x) => x.k === "hls"), "houve tentativa direta (segmento bloqueado) e o manifesto foi refeito pelo proxy");
    const c = await contadores(page);
    confere(c && c.fallback >= 1, "contador fallback>=1 (" + JSON.stringify(c) + ")");
    confere((await memoriaDe(page))[p3.host]?.m === "p", "o host ficou marcado 'p'");
  });

  console.log("(g4) memória por host: 'p' vale 6 h, vencida tenta o direto; 'd' é respeitada");
  const p4 = await novoProv({ cors: true });
  await cenario(p4, { [p4.host]: { m: "p", t: Date.now() - 3600e3 } }, async (page) => {
    confere(doProv(p4, /get\.php/).length === 0 && viaProxyDe(p4, /get\.php/).length >= 1, "memória 'p' de 1 h: vai direto ao proxy, sem tentar o direto");
    confere(evWeb(page, "direto") === 0 && evWeb(page, "fallback") === 0 && evWeb(page, "proxy") >= 1, "contadores: nenhum direto, nenhum fallback (proxy " + evWeb(page, "proxy") + ")");
  });
  const p5 = await novoProv({ cors: true });
  await cenario(p5, { [p5.host]: { m: "p", t: Date.now() - 7 * 3600e3 } }, async (page) => {
    confere(doProv(p5, /get\.php/).length >= 1 && viaProxyDe(p5).length === 0, "memória 'p' de 7 h (vencida): tenta o direto de novo e funciona");
    const m = (await memoriaDe(page))[p5.host];
    confere(m && m.m === "d" && Date.now() - m.t < 60000, "e a memória passa para 'd' (" + JSON.stringify(m) + ")");
  });
  const p6 = await novoProv({ cors: false });
  await cenario(p6, { [p6.host]: { m: "d", t: Date.now() - 3600e3 } }, async (page) => {
    confere(doProv(p6, /get\.php/).length === 1 && viaProxyDe(p6, /get\.php/).length >= 1, "memória 'd' sem CORS: 1 tentativa direta e o resto pelo proxy (o aprendizado se corrige)");
    confere((await memoriaDe(page))[p6.host]?.m === "p", "a memória passa para 'p'");
  });

  console.log("(g5) filme em <video>: direto mesmo sem CORS (o <video> não exige CORS) e memória de mídia separada da de dados");
  const p7 = await novoProv({ cors: false });
  await cenario(p7, null, async (page) => {
    confere((await memoriaDe(page))[p7.host]?.m === "p", "dados: sem CORS, host 'p'");
    const antes = evWeb(page, "direto");
    await page.eval(`playStream(${JSON.stringify(p7.base + "/movie/u/p/1.mp4")})`);
    confere(await esperaNode(page, () => doProv(p7, /^\/movie\//).length > 0), "o <video> pediu o filme direto ao provedor");
    confere(await esperaNode(page, () => evWeb(page, "direto") === antes + 1, 10000) && viaProxyDe(p7, /\/movie\//).length === 0, "o vídeo tocou: contou 1 direto e nenhuma chamada ao proxy para o filme");
    confere(!(await memoriaDe(page))["v:" + p7.host], "a mídia direta não suja a memória");
  });

  console.log("(g6) filme em <video> que o provedor recusa direto (Referer): UMA troca para o proxy e memória 'v:' = p");
  const p8 = await novoProv({ cors: true, refererRecusa: true });
  await cenario(p8, null, async (page) => {
    await page.eval(`playStream(${JSON.stringify(p8.base + "/movie/u/p/1.mp4")})`);
    confere(await esperaNode(page, () => viaProxyDe(p8, /\/movie\//).length > 0), "depois da recusa direta o filme saiu pelo proxy");
    confere(doProv(p8, /^\/movie\//).length === 1, "foi 1 tentativa direta só (" + doProv(p8, /^\/movie\//).length + ")");
    await esperaNode(page, () => false, 1500); // dá tempo do play() do proxy resolver e gravar a memória
    confere(evWeb(page, "fallback") === 1 && evWeb(page, "proxy") >= 1, "contadores: fallback=1, proxy>=1 (fallback " + evWeb(page, "fallback") + ", proxy " + evWeb(page, "proxy") + ")");
    confere((await memoriaDe(page))["v:" + p8.host]?.m === "p", "o proxy tocou: a mídia do host ficou 'p'");
    const diretasAntes = doProv(p8, /^\/movie\//).length;
    await page.eval(`playStream(${JSON.stringify(p8.base + "/movie/u/p/2.mp4")})`);
    confere(await esperaNode(page, () => viaProxyDe(p8, /\/movie\/u\/p\/2/).length > 0), "o filme seguinte vai direto ao proxy");
    confere(doProv(p8, /^\/movie\//).length === diretasAntes, "sem nova tentativa direta");
  });
  provs.forEach((p) => p.srv.close());

  // ── (h) tela cheia REAL (Fullscreen API) no computador: não vira mini-player e volta ao sair ──
  console.log("(h) tela cheia real no computador (duplo clique, f, Esc/exitFullscreen)");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: sessaoOk() }) }, async (page) => {
    confere(await espera(page, PRONTO, 25000), "a lista de canais carregou");
    await page.eval(`document.querySelector('.sidebar-nav .nav-item[data-section="Todos os canais"]').click()`);
    await page.sleep(600);
    await page.eval(`document.querySelector(".channel-card .card-main").click()`);
    await espera(page, `!!_state.selected`, 6000);
    await page.sleep(1500);
    await page.eval(`window.scrollTo(0, 0)`);
    await page.sleep(400);
    const estado = () => page.eval(`(() => {
      const el = document.getElementById("player-screen");
      const ctr = el.querySelector(".player-controls");
      const r = ctr.getBoundingClientRect();
      const pr = el.getBoundingClientRect();
      return {
        fs: document.fullscreenElement ? document.fullscreenElement.id : null,
        mini: el.classList.contains("mini-player"), oculto: el.classList.contains("player-hidden"),
        ancora: document.getElementById("player-anchor").style.height,
        ctrl: getComputedStyle(ctr).display !== "none" && r.height > 0 && r.bottom <= innerHeight + 1,
        pos: getComputedStyle(el).position, w: Math.round(pr.width), h: Math.round(pr.height), top: Math.round(pr.top),
        icone: document.getElementById("fullscreen-btn").getAttribute("aria-label"),
        tocando: !document.getElementById("player-video").paused,
      };
    })()`);
    const duploClique = async () => {
      const pt = await page.eval(`(() => { const r = document.querySelector("#player-screen .player-media").getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.2), y: Math.round(r.top + r.height * 0.3) }; })()`);
      for (const n of [1, 2]) {
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: n });
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: n });
      }
    };
    let e = await estado();
    confere(!e.fs && !e.mini && e.pos !== "fixed", "antes: player grande no fluxo, sem tela cheia (" + JSON.stringify(e) + ")");
    for (let i = 1; i <= 3; i++) {
      await duploClique();
      await espera(page, `document.fullscreenElement && document.fullscreenElement.id === "player-screen"`, 4000);
      await page.sleep(700); // dá tempo do scroll/resize disparar o updateDocking
      e = await estado();
      confere(e.fs === "player-screen", "ciclo " + i + ": o duplo clique entra em tela cheia real (#player-screen)");
      confere(!e.mini && !e.oculto, "ciclo " + i + ": em tela cheia o player não vira mini-player (" + JSON.stringify(e) + ")");
      confere(e.ctrl, "ciclo " + i + ": os controles do player continuam visíveis na tela cheia");
      confere(e.w >= 1400 && e.h >= 850 && e.top === 0, "ciclo " + i + ": ocupa a janela inteira (" + e.w + "x" + e.h + ")");
      if (i === 1) await captura(page, "desktop-1440-tela-cheia-real.png");
      // sai: 1º ciclo pela API (como o Esc), 2º pelo duplo clique de novo, 3º pela tecla f
      if (i === 1) await page.eval(`document.exitFullscreen()`);
      else if (i === 2) await duploClique();
      else { await page.eval(`document.body.focus()`); await tecla(page, "f", "KeyF", 70); }
      await espera(page, `!document.fullscreenElement`, 4000);
      await page.sleep(900);
      e = await estado();
      confere(!e.fs && !e.mini && !e.oculto && e.ancora === "", "ciclo " + i + ": ao sair o player grande volta ao lugar, sem mini-player e com a âncora solta (" + JSON.stringify(e) + ")");
      // o stream de teste tem bytes falsos e o app o recarrega de vez em quando: espera um instante de "tocando" em vez de olhar um único quadro
      const tocou = await espera(page, `!document.getElementById("player-video").paused`, 6000);
      confere(e.top >= 0 && e.top < 400 && e.pos !== "fixed" && tocou, "ciclo " + i + ": no fluxo da página e o vídeo continua tocando (top " + e.top + ")");
      confere(e.icone === "Tela cheia", "ciclo " + i + ": o ícone do botão volta a 'Tela cheia'");
    }
    await captura(page, "desktop-1440-depois-da-tela-cheia.png");
    // o mini-player legítimo da rolagem segue funcionando fora da tela cheia
    const rolavel = await page.eval(`document.documentElement.scrollHeight > innerHeight + 700`);
    if (rolavel) {
      await page.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`);
      await page.sleep(700);
      e = await estado();
      confere(e.mini, "rolando a página com o player tocando, ele vira mini-player (fora da tela cheia)");
      await page.eval(`window.scrollTo(0, 0)`);
      await page.sleep(700);
      e = await estado();
      confere(!e.mini && e.ancora === "", "voltando ao topo o player grande reaparece");
      // rola, entra e sai da tela cheia com o player grande parcialmente visível: nada fica preso
      await page.eval(`window.scrollTo(0, 250)`);
      await page.sleep(500);
      await page.eval(`document.body.focus()`);
      await tecla(page, "f", "KeyF", 70);
      await espera(page, `document.fullscreenElement && document.fullscreenElement.id === "player-screen"`, 4000);
      await page.sleep(700);
      e = await estado();
      confere(e.fs === "player-screen" && !e.mini, "rolado 250 px: a tela cheia (tecla f) também não vira mini-player");
      await page.eval(`document.exitFullscreen()`);
      await espera(page, `!document.fullscreenElement`, 4000);
      await page.sleep(900);
      e = await estado();
      confere(!e.fs && !e.mini && e.ancora === "", "e ao sair o player grande segue no lugar (" + JSON.stringify(e) + ")");
      await page.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`);
      await page.sleep(700);
      confere((await estado()).mini, "depois do ciclo, rolar de novo ainda gera o mini-player");
    } else console.log("  (a página não rola o bastante neste tamanho: parte do mini-player por rolagem não conferida)");
    confere(page.blocked.length === 0, "nenhuma requisição externa (" + page.blocked.length + ")");
  });

  // ── (i) outra conta entra no mesmo navegador: nada da conta anterior (admin) pode aparecer ──
  console.log("(i) troca de conta no mesmo navegador (o 'Sair' do site não apaga os dados do app)");
  const ADMIN_PERFIL = "bbbbbbbb-2222-4222-8222-222222222222";
  const dadosDoAdmin = {
    sint_web_owner: "u-admin",
    sint_ott_token: "e".repeat(64), sint_ott_last_ok: String(Date.now()), sint_ott_account: JSON.stringify({ nome: "Administrador", status: "active" }),
    sint_profile_active: ADMIN_PERFIL, sint_profiles: JSON.stringify([{ id: ADMIN_PERFIL, nome: "Administrador", avatar: "padrao", padrao: true }]),
    sint_pbbbbbbbb_fav: JSON.stringify(["Canal do Admin"]), sint_pbbbbbbbb_recents: JSON.stringify(["Canal do Admin"]),
    sint_fav: JSON.stringify(["Canal antigo do Admin"]),
    sint_view: "list", // preferência do navegador: deve ficar
  };
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: sessaoOk(), extra: dadosDoAdmin }) }, async (page) => {
    confere(await espera(page, PRONTO, 25000), "(i) o app carregou os canais da conta NOVA");
    const ls = JSON.parse(await page.eval(`JSON.stringify({
      dono: localStorage.getItem("sint_web_owner"), token: localStorage.getItem("sint_ott_token"),
      conta: localStorage.getItem("sint_ott_account"), perfis: localStorage.getItem("sint_profiles"), ativo: localStorage.getItem("sint_profile_active"),
      favAdmin: localStorage.getItem("sint_pbbbbbbbb_fav"), recAdmin: localStorage.getItem("sint_pbbbbbbbb_recents"), favAntigo: localStorage.getItem("sint_fav"), view: localStorage.getItem("sint_view") })`));
    confere(ls.dono === "u1", "(i) o dono guardado passou a ser a conta nova (" + ls.dono + ")");
    confere(ls.token === TOKEN, "(i) o token é o do aparelho registrado AGORA, não o do admin");
    confere(!/Administrador/.test(ls.conta || "") && !/Administrador/.test(ls.perfis || ""), "(i) conta e perfis em cache não são os do admin");
    confere(ls.ativo !== ADMIN_PERFIL, "(i) o perfil ativo não é o do admin (" + ls.ativo + ")");
    confere(ls.favAdmin === null && ls.recAdmin === null && ls.favAntigo === null, "(i) favoritos e recentes do admin sumiram");
    confere(ls.view === "list", "(i) preferências do navegador ficaram (sint_view)");
    const reg = (await log(page)).find((c) => c.nome === "web_device_register");
    confere(!!reg && reg.auth === "Bearer " + JWT, "(i) o registro do aparelho usou a sessão da conta nova");
    confere(!(await log(page)).some((c) => c.nome === "device_config" && c.body && c.body.p_token === "e".repeat(64)), "(i) o aparelho do admin nunca foi consultado (o app não entrou como admin)");
    confere(!(await page.eval(`document.body.innerText`)).includes("Administrador"), "(i) a palavra 'Administrador' não aparece na tela");
    // outra aba troca o login do site: esta aba recarrega para refletir a conta certa
    const vigia = await page.eval(`JSON.stringify({ ligado: _web.watching === true, usuario: _webWatchedUser, saiu: _web.signedOut })`);
    confere(JSON.parse(vigia).ligado && JSON.parse(vigia).usuario === "u1", "(i) o vigia da sessão do site está ligado para a conta u1 (" + vigia + ")");
    await page.eval(`window.__marca = 1; window.dispatchEvent(new StorageEvent("storage", { key: "sintoniza_painel_sessao", newValue: JSON.stringify({ access_token: "x", refresh_token: "y", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "outro-usuario", email: "o@x.com" } }) }))`);
    await page.sleep(2500);
    confere(await page.eval(`window.__marca === undefined`), "(i) o login do site mudou em outra aba: o app recarregou");
    // a mesma conta renovando o token NÃO recarrega
    await espera(page, PRONTO, 25000);
    await page.eval(`window.__marca = 1; window.dispatchEvent(new StorageEvent("storage", { key: "sintoniza_painel_sessao", newValue: JSON.stringify({ access_token: "novo", refresh_token: "y", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "ana@exemplo.com" } }) }))`);
    await page.sleep(1500);
    confere(await page.eval(`window.__marca === 1`), "(i) a mesma conta renovando o token não recarrega o app");
  });

  // ── (j) o "Sair" do site apagou o login, mas o app ainda tem o aparelho da conta antiga: tem de voltar ao login, sem entrar ──
  console.log("(j) sem login do site, mas com aparelho antigo guardado no app");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: null, extra: dadosDoAdmin }) }, async (page) => {
    await espera(page, `location.pathname === "/"`, 8000);
    confere(await page.eval(`location.pathname + location.search`) === "/?next=%2Fapp%2F", "(j) redireciona para o login do site");
    const resto = await page.eval(`JSON.stringify({ token: localStorage.getItem("sint_ott_token"), perfis: localStorage.getItem("sint_profiles"), fav: localStorage.getItem("sint_pbbbbbbbb_fav") })`);
    confere(JSON.parse(resto).token === null && JSON.parse(resto).perfis === null && JSON.parse(resto).fav === null, "(j) os dados da conta antiga foram apagados (" + resto + ")");
    confere(!(await log(page)).some((c) => c.nome === "device_config"), "(j) o aparelho antigo não foi consultado no servidor");
  });

  // ── (k) conta nova: o app pede o nome e o avatar do perfil principal (o servidor não cria mais sozinho) ──
  console.log("(k) conta sem perfil: 'Crie seu perfil' com nome e avatar escolhidos pela pessoa");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript({ sessao: sessaoOk(), extra: { __semperfil: "1" } }) }, async (page) => {
    confere(await espera(page, `!document.getElementById("profile-editor").hidden`, 25000), "(k) o editor de perfil abre sozinho");
    const ed = JSON.parse(await page.eval(`JSON.stringify({ titulo: document.getElementById("profile-editor-title").textContent, topo: document.getElementById("profile-editor-eyebrow").textContent,
      cancelar: document.getElementById("profile-cancel-btn").hidden, nome: document.getElementById("profile-name-input").value, excluir: document.getElementById("profile-delete-btn").hidden,
      avatares: document.querySelectorAll("#profile-avatar-grid .pe-av").length, aberto: document.documentElement.classList.contains("profile-open") })`));
    confere(ed.titulo === "Crie seu perfil" && ed.topo === "Perfil principal", "(k) título 'Crie seu perfil' / 'Perfil principal' (" + ed.titulo + " / " + ed.topo + ")");
    confere(ed.cancelar === true && ed.excluir === true, "(k) sem Cancelar nem Excluir (o app precisa de um perfil)");
    confere(ed.nome === "", "(k) o nome começa VAZIO (não usa o nome do cadastro): '" + ed.nome + "'");
    confere(ed.avatares >= 12 && ed.aberto, "(k) os avatares aparecem (" + ed.avatares + ") e a tela cobre o app");
    let chamadas = await log(page);
    const lista = chamadas.find((c) => c.nome === "perfil_list");
    confere(!!lista && lista.body.p_auto_criar === false, "(k) o app pediu perfil_list com p_auto_criar:false");
    confere(!chamadas.some((c) => c.nome === "perfil_save"), "(k) nada foi criado antes de a pessoa escolher");
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.sleep(400);
    confere(await page.eval(`!document.getElementById("profile-editor").hidden`), "(k) Esc não fecha o editor do 1º perfil");
    await page.eval(`(() => { const i = document.getElementById("profile-name-input"); i.value = "Gustavo"; i.dispatchEvent(new Event("input", { bubbles: true })); document.querySelectorAll("#profile-avatar-grid .pe-av")[2].click(); })()`);
    const avEscolhido = await page.eval(`document.querySelector("#profile-avatar-grid .pe-av.is-selected").dataset.av`);
    await page.eval(`document.getElementById("profile-save-btn").click()`);
    confere(await espera(page, `typeof _state !== "undefined" && _state.channels && _state.channels.length > 0 && !document.documentElement.classList.contains("profile-open")`, 25000), "(k) depois de salvar o app abre com o perfil criado");
    chamadas = await log(page);
    const salvo = chamadas.find((c) => c.nome === "perfil_save");
    confere(!!salvo && salvo.body.p_id === null && salvo.body.p_nome === "Gustavo" && salvo.body.p_avatar === avEscolhido, "(k) perfil_save com o nome e o avatar escolhidos (" + JSON.stringify(salvo && salvo.body) + ")");
    const ls = JSON.parse(await page.eval(`JSON.stringify({ ativo: localStorage.getItem("sint_profile_active"), perfis: localStorage.getItem("sint_profiles") })`));
    confere(ls.ativo === "cccccccc-3333-4333-8333-333333333333" && /Gustavo/.test(ls.perfis || ""), "(k) o perfil criado ficou ativo e em cache");
  });
} finally {
  servidor.close();
}

if (falhas.length) {
  console.error(`✖ ${falhas.length} verificação(ões) falharam`);
  process.exit(1);
}
console.log("✔ ok");
process.exit(0);
