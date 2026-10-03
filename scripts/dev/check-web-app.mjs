// Verifica no Chrome o app WEB (sintonizatv.com.br/app) gerado pelo build (scripts/build-web.mjs).
// Tudo FINGIDO e local: servidor em http://127.0.0.1:<porta>/app/ (nunca localhost: lá isNativeApp() é true) que também
// simula o /api/proxy do site (mesmo contrato da Task W3), um Supabase falso dentro da página (fetch trocado) e o Chrome
// com TODA requisição que não seja para 127.0.0.1 RECUSADA. Nenhum aparelho real é criado e o backend real não é tocado.
//   (a) sem sessão do site -> redireciona para /?next=%2Fapp%2F (sem chamar o backend)
//   (b) com sessão -> web_device_register com o Bearer do USUÁRIO (não a chave anon) e SEM tela de código/QR
//   (c) tudo do provedor (lista M3U, player_api.php, vídeo/HLS) sai por /api/proxy com t=<token do aparelho>
//   (d) 1440x900: grade com colunas, setas nos carrosséis, roda do mouse, volume e atalhos de teclado
//   (e) 390x844 como atalho (navigator.standalone: este Chrome não emula display-mode): faixa da barra de status, tela cheia por CSS, sem volume
//   (f) service worker registrado, shell servido do cache offline, e nada de /api/ ou backend no cache
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

function m3u() {
  const grupos = ["Notícias", "Esportes", "Filmes"];
  let t = "#EXTM3U\n";
  for (let i = 1; i <= 18; i++) t += `#EXTINF:-1 tvg-id="" tvg-name="Canal ${i}" tvg-logo="" group-title="${grupos[i % 3]}",Canal ${String(i).padStart(2, "0")}\nhttp://provedor.test/live/u/p/${i}.m3u8\n`;
  return t;
}
function respostaApi(action, categoria) {
  if (action === "get_vod_categories") return [{ category_id: "11", category_name: "Ação" }, { category_id: "12", category_name: "Drama" }];
  if (action === "get_vod_streams") return Array.from({ length: 24 }, (_, i) => ({ stream_id: Number(categoria) * 100 + i, name: `Filme ${categoria}-${i + 1}`, stream_icon: "", container_extension: "mp4", added: String(1700000000 + i), rating: "7" }));
  return [];
}
function proxy(req, res, url) {
  const u = url.searchParams.get("u"), t = url.searchParams.get("t"), k = url.searchParams.get("k");
  proxyLog.push({ method: req.method, u, t, k });
  const json = (status, corpo, tipo = "application/json") => { res.writeHead(status, { "Content-Type": tipo, "Cache-Control": "no-store" }); res.end(req.method === "HEAD" ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo)); };
  if (!t || t !== TOKEN) return json(401, { erro: "sessão inválida" });
  let alvo;
  try { alvo = new URL(u); } catch (e) { return json(400, { erro: "destino inválido" }); }
  if (alvo.hostname !== "provedor.test") return json(502, { erro: "o provedor não respondeu" });
  if (alvo.pathname === "/get.php") return json(200, m3u(), "audio/x-mpegurl");
  if (alvo.pathname === "/player_api.php") return json(200, respostaApi(alvo.searchParams.get("action"), alvo.searchParams.get("category_id")));
  if (alvo.pathname.endsWith(".m3u8")) {
    const seg = `/api/proxy?u=${encodeURIComponent("http://provedor.test/live/seg1.ts")}&t=${t}&k=hls`;
    return json(200, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\n${seg}\n`, "application/vnd.apple.mpegurl");
  }
  return json(404, { erro: "não encontrado" });
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
function preScript({ sessao, standalone = false }) {
  const src = `(() => {
    ${standalone ? 'Object.defineProperty(navigator, "standalone", { get: () => true });' : ""}
    if (!localStorage.getItem("__seeded")) {
      ${sessao ? `localStorage.setItem("sintoniza_painel_sessao", ${JSON.stringify(JSON.stringify(sessao))});` : ""}
      localStorage.setItem("__log", "[]");
      localStorage.setItem("__seeded", "1");
    }
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      url = String(url);
      const u = new URL(url, location.href);
      if (u.origin === location.origin) return realFetch(url, init);
      if (u.hostname === "falso.supabase.co") {
        const h = (init && init.headers) || {};
        const body = init && init.body ? JSON.parse(init.body) : {};
        const nome = u.pathname.indexOf("/rpc/") >= 0 ? u.pathname.split("/rpc/")[1] : u.pathname;
        const log = JSON.parse(localStorage.getItem("__log") || "[]");
        log.push({ nome, body, auth: h.Authorization || "", apikey: h.apikey || "" });
        localStorage.setItem("__log", JSON.stringify(log));
        if (nome === "web_device_register") return J({ status: "ok", device_token: ${JSON.stringify(TOKEN)} });
        if (nome === "device_config") {
          if (body.p_token !== ${JSON.stringify(TOKEN)}) return J({ status: "unknown_device" });
          return J({ status: "ok", user: { nome: "Ana Teste", status: "active", acesso_fim: "2030-01-01T00:00:00Z" },
            playlists: [{ id: "1", nome: "Principal", url_m3u: ${JSON.stringify(M3U_URL)}, url_vod: ${JSON.stringify(VOD_URL)}, url_epg: null }] });
        }
        if (nome === "perfil_list") return J({ status: "ok", perfis: [${JSON.stringify(PERFIL)}] });
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

    // carrosséis: setas e roda do mouse (Filmes)
    await page.eval(`document.getElementById("nav-vod-movies").click()`);
    const rows = await espera(page, `document.querySelectorAll(".vod-row .vod-card").length > 6`, 15000);
    confere(rows, "o catálogo de filmes carregou pelo proxy");
    await page.sleep(500);
    const pos = await page.eval(`(() => { const c = document.querySelector(".vod-carousel"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), right: Math.round(r.right) }; })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y });
    await page.sleep(500);
    const arrow = await page.eval(`(() => { const a = document.querySelector(".web-arrow-next"); if (!a) return null; const r = a.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), op: getComputedStyle(a).opacity }; })()`);
    confere(arrow && arrow.op === "1", "seta 'avançar' aparece ao passar o mouse na fileira");
    await captura(page, "desktop-1440-filmes.png");
    if (arrow) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: arrow.x, y: arrow.y });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: arrow.x, y: arrow.y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: arrow.x, y: arrow.y, button: "left", clickCount: 1 });
      await page.sleep(900);
      const s1 = await page.eval(`document.querySelector(".vod-carousel").scrollLeft`);
      confere(s1 > 100, "clicar na seta rola a fileira (scrollLeft " + s1 + ")");
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: pos.x, y: pos.y, deltaX: 0, deltaY: 100 });
      await page.sleep(500);
      const s2 = await page.eval(`document.querySelector(".vod-carousel").scrollLeft`);
      confere(s2 > s1, "a roda do mouse rola a fileira na horizontal (" + s1 + " -> " + s2 + ")");
    }
    const prevOff = await page.eval(`!!document.querySelector(".web-arrow-prev:not(.is-off)")`);
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
} finally {
  servidor.close();
}

if (falhas.length) {
  console.error(`✖ ${falhas.length} verificação(ões) falharam`);
  process.exit(1);
}
console.log("✔ ok");
process.exit(0);
