// Verifica no Chrome o "Acesso rápido" da aba Canais do app WEB no computador: fileira horizontal de cartões de canal
// (mesmo jeito das categorias de filmes) em vez da coluna lateral de 20 rem.
// Tudo FINGIDO e local, como scripts/dev/check-web-app.mjs: servidor em http://127.0.0.1:<porta>/app/ (nunca localhost),
// Supabase falso dentro da página (fetch trocado que RECUSA rede real) e Chrome que recusa qualquer requisição fora de 127.0.0.1.
// Nenhum aparelho real é criado e o backend real não é tocado.
//   1440x900 e 1920x1080: 17 favoritos -> fileira com rolagem horizontal, setas ao passar o mouse, roda do mouse, arrastar,
//   teclado (←/→/Home/End), clique reproduz, rolagem preservada no redesenho, seção com >= 90% da largura útil, play/TV/coração
//   estado vazio compacto em largura total; sem data-web-app volta a coluna antiga; 1000 px e 390x844 seguem sem o painel lateral
// Uso: node scripts/dev/check-web-quick-access.mjs [pasta-das-capturas]   (as capturas são opcionais e não devem ser commitadas)
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

// ── build do app web numa pasta temporária (offline se o cache das bibliotecas já existe) ──
const out = mkdtempSync(path.join(tmpdir(), "sint-check-qa-"));
const temCache = existsSync(path.join(RAIZ, ".web-cache", "lucide.min.js"));
await buildWeb({ outDir: out, offline: temCache });
const appDir = path.join(out, "app");

// ── 18 canais; os 17 primeiros viram favoritos. Alguns sem logo (iniciais), os outros com logo SVG servido localmente ──
const NOMES = ["A&E Latin America Brazil", "Combate HD", "Paramount+ 2", "Premiere 1 HD", "ESPN 4 HD", "Canal 06 com um nome bem comprido para quebrar em duas linhas", "Globo News", "SporTV 2", "Telecine Premium", "HBO Max", "Discovery Channel", "Cartoon Network", "TNT Séries", "Band Sports", "Record News", "Fox Sports", "Canal 17", "Canal 18"];
const GRUPOS = ["Canais Gerais", "Esportes", "Filmes", "Notícias"];
const PORTA_REF = { v: 0 };
function m3u() {
  let t = "#EXTM3U\n";
  NOMES.forEach((nome, i) => {
    const logo = i % 4 === 3 ? "" : `http://127.0.0.1:${PORTA_REF.v}/logo/${i + 1}.svg`;
    t += `#EXTINF:-1 tvg-id="" tvg-name="${nome}" tvg-logo="${logo}" group-title="${GRUPOS[i % GRUPOS.length]}",${nome}\nhttp://127.0.0.1:${PORTA_REF.v}/live/u/p/${i + 1}.m3u8\n`;
  });
  return t;
}
const logoSvg = (n) => {
  const cor = ["#111", "#fff", "#f4c542", "#0b3d91", "#e8e8e8"][n % 5];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect x="10" y="30" width="180" height="60" rx="14" fill="${cor}"/><text x="100" y="72" font-family="Arial" font-weight="700" font-size="34" text-anchor="middle" fill="${cor === "#fff" || cor === "#e8e8e8" || cor === "#f4c542" ? "#111" : "#fff"}">CH ${n}</text></svg>`;
};
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css", ".woff2": "font/woff2" };
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/get.php") { res.writeHead(200, { "Content-Type": "audio/x-mpegurl", "Cache-Control": "no-store" }); return res.end(m3u()); }
  if (url.pathname === "/player_api.php") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("[]"); }
  if (url.pathname.startsWith("/logo/")) { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end(logoSvg(parseInt(url.pathname.slice(6), 10))); }
  if (url.pathname.endsWith(".m3u8")) { res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" }); return res.end("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\n/live/seg1.ts\n"); }
  if (url.pathname.endsWith(".ts")) { res.writeHead(200, { "Content-Type": "video/mp2t" }); return res.end(Buffer.alloc(188 * 20, 0x47)); }
  if (url.pathname === "/app-config.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ url: "https://falso.supabase.co", anonKey: ANON })); }
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
PORTA_REF.v = PORTA;
const URL_APP = `http://127.0.0.1:${PORTA}/app/`;

// ── Supabase falso dentro da página; qualquer outro host que não seja 127.0.0.1 é recusado ──
function preScript() {
  const sessao = { access_token: JWT, refresh_token: "refresh-falso", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "ana@exemplo.com" } };
  const src = `(() => {
    if (!localStorage.getItem("__seeded")) {
      localStorage.setItem("sintoniza_painel_sessao", ${JSON.stringify(JSON.stringify(sessao))});
      localStorage.setItem("__seeded", "1");
    }
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      url = String(url);
      const u = new URL(url, location.href);
      if (u.origin === location.origin || u.hostname === "127.0.0.1") return realFetch(url, init);
      if (u.hostname === "falso.supabase.co") {
        const body = init && init.body ? JSON.parse(init.body) : {};
        const nome = u.pathname.indexOf("/rpc/") >= 0 ? u.pathname.split("/rpc/")[1] : u.pathname;
        if (nome === "web_device_register") return J({ status: "ok", device_token: ${JSON.stringify(TOKEN)} });
        if (nome === "device_config") {
          if (body.p_token !== ${JSON.stringify(TOKEN)}) return J({ status: "unknown_device" });
          return J({ status: "ok", user: { nome: "Ana Teste", status: "active", acesso_fim: "2030-01-01T00:00:00Z" },
            playlists: [{ id: "1", nome: "Principal", url_m3u: "http://127.0.0.1:${PORTA}/get.php?username=u&password=p&type=m3u_plus", url_vod: null, url_epg: null }] });
        }
        if (nome === "perfil_list") return J({ status: "ok", perfis: [${JSON.stringify(PERFIL)}] });
        if (nome.indexOf("/auth") >= 0) return J({});
        return J({ status: "ok", itens: [], found: false, tvs: [] });
      }
      throw new TypeError("rede bloqueada no teste: " + url);
    };
  })();`;
  new vm.Script(src);
  return src;
}

const espera = async (page, expr, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await page.eval(expr)) return true; } catch (e) { /* página recarregando */ }
    await page.sleep(250);
  }
  return false;
};
const tecla = async (page, key, code, vk) => {
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
};
const mouse = (page, type, x, y, extra = {}) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
const captura = async (page, nome) => { if (pasta) await page.screenshot(path.join(pasta, nome)); };
const PRONTO = `typeof _state !== "undefined" && _state.channels && _state.channels.length > 0`;
const ROW = `document.querySelector("#now-list")`;
// centro da fileira (rola a página até ela) em coordenadas da janela
const centroDaFileira = (page) => page.eval(`(() => { const c = ${ROW}; c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);

async function abrirCanais(page) {
  const carregou = await espera(page, PRONTO, 25000);
  confere(carregou, "o app carrega os 18 canais");
  // 17 favoritos simulados (o app guarda o nome do canal); abre a aba Canais
  await page.eval(`(() => { setState({ favorites: ${JSON.stringify(NOMES.slice(0, 17))} }); setSection("Todos os canais"); })()`);
  await page.sleep(900);
}

const medidas = (page) => page.eval(`(() => {
  const shell = document.querySelector(".content-shell"), cs = getComputedStyle(shell);
  const util = shell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const on = document.querySelector(".on-now"), r = on.getBoundingClientRect();
  const row = ${ROW}, card = row.querySelector(".qa-card"), logo = card && card.querySelector(".vod-card-logo");
  const nome = card && card.querySelector(".qa-name");
  return {
    util: Math.round(util), secao: Math.round(r.width), display: getComputedStyle(on).display,
    colunas: getComputedStyle(document.getElementById("feature-layout")).gridTemplateColumns.split(" ").length,
    borda: getComputedStyle(on).borderTopWidth, vodRow: on.classList.contains("vod-row"),
    cartoes: row.querySelectorAll(".qa-card").length, classeFileira: row.className,
    sw: row.scrollWidth, cw: row.clientWidth, overflowX: getComputedStyle(row).overflowX,
    cartaoW: card ? Math.round(card.getBoundingClientRect().width) : 0,
    logoW: logo ? logo.getBoundingClientRect().width : 0, logoH: logo ? logo.getBoundingClientRect().height : 0,
    nomeH: nome ? nome.getBoundingClientRect().height : 0, nomeLinha: nome ? parseFloat(getComputedStyle(nome).lineHeight) : 0,
    esq: Math.round(row.getBoundingClientRect().left - shell.getBoundingClientRect().left)
  };
})()`);

try {
  // ═══ computador: 1440x900 e 1920x1080 ═══
  console.log("computador 1440x900 e 1920x1080");
  await withPage(URL_APP, { width: 1440, height: 900, desktop: true, blockExternal: true, preScript: preScript() }, async (page) => {
    await abrirCanais(page);
    const m = await medidas(page);
    confere(m.display === "block" && m.colunas === 1, "1440: o painel não é mais coluna lateral (grade de " + m.colunas + " coluna, display " + m.display + ")");
    confere(m.secao >= m.util * 0.9, "1440: a seção ocupa " + m.secao + " de " + m.util + " px úteis (" + Math.round(100 * m.secao / m.util) + "%)");
    confere(m.borda === "0px" && m.vodRow, "1440: sem moldura de cartão e a seção é uma .vod-row (setas/roda/arrastar das fileiras)");
    confere(m.cartoes === 17 && /vod-carousel/.test(m.classeFileira), "1440: " + m.cartoes + " cartões numa fileira .vod-carousel");
    confere(m.sw > m.cw + 50 && m.overflowX === "auto", "1440: a fileira rola na horizontal (scrollWidth " + m.sw + " > clientWidth " + m.cw + ")");
    confere(m.cartaoW === 168 && Math.abs(m.logoH / m.logoW - 1.5) < 0.01, "1440: cartão de " + m.cartaoW + " px com logo 2:3, igual aos pôsteres de filmes (" + m.logoW + "x" + Math.round(m.logoH) + ")");
    confere(m.nomeH <= m.nomeLinha * 2 + 1 && m.nomeH >= m.nomeLinha * 2 - 1, "1440: nome reservado e limitado a 2 linhas (" + Math.round(m.nomeH) + " px)");
    const tags = await page.eval(`({ hls: ${ROW}.querySelectorAll(".tag-hls").length, cat: ${ROW}.querySelector(".qa-cat").textContent, btn: ${ROW}.querySelectorAll("button.qa-main").length, emBotao: !!${ROW}.querySelector("button button"), aria: ${ROW}.querySelector(".qa-main").getAttribute("aria-label") })`);
    confere(tags.hls === 17 && tags.cat === "Canais Gerais" && tags.btn === 17 && !tags.emBotao, "1440: selo HLS e categoria em cada cartão; botões focáveis sem botão dentro de botão (" + tags.aria + ")");
    const tit = await page.eval(`({ eb: document.getElementById("on-now-eyebrow").textContent, h: document.getElementById("on-now-title").textContent, ico: !!document.querySelector(".on-now-header .on-now-icon") })`);
    confere(tit.eb === "ACESSO RÁPIDO (17)" && tit.h === "Canais favoritos" && tit.ico, "1440: cabeçalho \"" + tit.eb + " · " + tit.h + "\" com o ícone de claquete");
    await page.eval(`window.scrollTo(0, 0)`);
    await page.sleep(300);
    await captura(page, "qa-1440-inicio.png");

    // setas ao passar o mouse + roda + arrastar + teclado
    const c = await centroDaFileira(page);
    await mouse(page, "mouseMoved", c.x, c.y, { button: "none", clickCount: 0 });
    await page.sleep(500);
    const seta = await page.eval(`(() => { const a = document.querySelector(".on-now .web-arrow-next"); if (!a) return null; const r = a.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), op: getComputedStyle(a).opacity, prev: getComputedStyle(document.querySelector(".on-now .web-arrow-prev")).opacity }; })()`);
    confere(seta && seta.op === "1" && seta.prev === "0", "1440: seta 'avançar' aparece ao passar o mouse e a 'voltar' fica oculta no começo");
    await captura(page, "qa-1440-hover.png");
    if (seta) {
      await mouse(page, "mouseMoved", seta.x, seta.y, { button: "none", clickCount: 0 });
      await mouse(page, "mousePressed", seta.x, seta.y);
      await mouse(page, "mouseReleased", seta.x, seta.y);
      await page.sleep(900);
      const s1 = await page.eval(`${ROW}.scrollLeft`);
      confere(s1 > 100, "1440: clicar na seta rola a fileira (scrollLeft " + s1 + ")");
      await mouse(page, "mouseMoved", c.x, c.y, { button: "none", clickCount: 0 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: c.x, y: c.y, deltaX: 0, deltaY: 100 });
      await page.sleep(600);
      const s2 = await page.eval(`${ROW}.scrollLeft`);
      confere(s2 > s1, "1440: a roda do mouse rola a fileira na horizontal (" + s1 + " -> " + s2 + ")");
      confere(await page.eval(`!document.querySelector(".on-now .web-arrow-prev").classList.contains("is-off")`), "1440: depois de rolar, a seta 'voltar' aparece");
      // arrastar com o mouse para a esquerda (conteúdo anda para a direita)
      await page.eval(`${ROW}.style.scrollBehavior = "auto"`);
      await page.eval(`${ROW}.scrollLeft = 0`);
      await page.sleep(300);
      const sel0 = await page.eval(`_state.selected ? _state.selected.id : null`);
      await mouse(page, "mouseMoved", c.x, c.y, { button: "none", clickCount: 0 });
      await mouse(page, "mousePressed", c.x, c.y);
      for (let k = 1; k <= 10; k++) await mouse(page, "mouseMoved", c.x - k * 30, c.y, { buttons: 1 });
      await mouse(page, "mouseReleased", c.x - 300, c.y);
      await page.sleep(500);
      const d = await page.eval(`({ sl: ${ROW}.scrollLeft, sel: _state.selected ? _state.selected.id : null, arrastando: ${ROW}.classList.contains("is-dragging") })`);
      confere(d.sl > 150 && !d.arrastando, "1440: arrastar com o mouse rola a fileira (scrollLeft " + d.sl + ")");
      confere(d.sel === sel0, "1440: soltar depois de arrastar não reproduz nenhum canal (o clique é engolido)");
    }

    // teclado: foco no 1º cartão, → / ← / End / Home
    await page.eval(`${ROW}.scrollLeft = 0; ${ROW}.querySelector(".qa-main").focus()`);
    const id = (i) => `document.activeElement && document.activeElement.dataset.channelId`;
    const primeiro = await page.eval(id());
    await tecla(page, "ArrowRight", "ArrowRight", 39);
    await page.sleep(150);
    const segundo = await page.eval(id());
    await tecla(page, "ArrowLeft", "ArrowLeft", 37);
    await page.sleep(150);
    const volta = await page.eval(id());
    confere(segundo && segundo !== primeiro && volta === primeiro, "teclado: → foca o próximo cartão e ← volta (" + primeiro + " → " + segundo + " → " + volta + ")");
    await tecla(page, "End", "End", 35);
    await page.sleep(900);
    const fim = await page.eval(`({ id: document.activeElement.dataset.channelId, ult: ${ROW}.querySelectorAll(".qa-main")[16].dataset.channelId, sl: ${ROW}.scrollLeft })`);
    confere(fim.id === fim.ult && fim.sl > 100, "teclado: End vai ao último cartão e a fileira acompanha (scrollLeft " + fim.sl + ")");
    await tecla(page, "Home", "Home", 36);
    await page.sleep(900);
    confere(await page.eval(`document.activeElement.dataset.channelId === "${primeiro}" && ${ROW}.scrollLeft < 5`), "teclado: Home volta ao primeiro cartão");

    // cartão: hover mostra play, TV e coração
    await page.eval(`${ROW}.scrollLeft = 0`);
    await page.sleep(300);
    const cartao = await page.eval(`(() => { const el = ${ROW}.querySelectorAll(".qa-card")[2]; const r = el.querySelector(".vod-card-logo").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await mouse(page, "mouseMoved", cartao.x, cartao.y, { button: "none", clickCount: 0 });
    await page.sleep(450);
    const hov = await page.eval(`(() => { const el = ${ROW}.querySelectorAll(".qa-card")[2]; return { play: getComputedStyle(el.querySelector(".qa-play")).opacity, fav: getComputedStyle(el.querySelector(".fav-btn")).opacity, favAtivo: el.querySelector(".fav-btn").classList.contains("fav-active"), tv: getComputedStyle(el.querySelector(".tv-btn")).display, tvOp: getComputedStyle(el.querySelector(".tv-btn")).opacity, ott: document.body.classList.contains("ott-mode") }; })()`);
    confere(hov.play === "1" && hov.fav === "1" && hov.favAtivo, "cartão: ao passar o mouse aparece o play e o coração (favorito) fica aceso");
    confere(hov.ott ? hov.tv === "flex" && hov.tvOp === "1" : hov.tv === "none", "cartão: botão de TV " + (hov.ott ? "aparece ao passar o mouse (conta ativa)" : "oculto sem conta ativa, como nos cartões da grade"));
    await captura(page, "qa-1440-cartao-hover.png");

    // clique reproduz; a rolagem sobrevive ao redesenho; fica marcado como "em reprodução"
    await page.eval(`${ROW}.style.scrollBehavior = "auto"; ${ROW}.scrollLeft = 420`);
    await page.sleep(300);
    const alvo = await page.eval(`(() => { const row = ${ROW}; const rr = row.getBoundingClientRect(); const el = Array.from(row.querySelectorAll(".qa-main")).find(b => { const r = b.getBoundingClientRect(); return r.left > rr.left + 40 && r.right < rr.right - 40; }); const r = el.querySelector(".vod-card-logo").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: el.dataset.channelId }; })()`);
    const antes = await page.eval(`${ROW}.scrollLeft`);
    await mouse(page, "mouseMoved", alvo.x, alvo.y, { button: "none", clickCount: 0 });
    await mouse(page, "mousePressed", alvo.x, alvo.y);
    await mouse(page, "mouseReleased", alvo.x, alvo.y);
    await page.sleep(900);
    const r2 = await page.eval(`({ sel: _state.selected && String(_state.selected.id), atual: ${ROW}.querySelector(".qa-card.is-current .qa-main") && ${ROW}.querySelector(".qa-card.is-current .qa-main").dataset.channelId, sl: ${ROW}.scrollLeft, player: !document.getElementById("player-screen").classList.contains("hidden") && getComputedStyle(document.getElementById("player-screen")).display !== "none" })`);
    confere(r2.sel === alvo.id && r2.player, "clicar no cartão reproduz o canal (selecionado " + r2.sel + ", player visível)");
    confere(r2.atual === alvo.id, "o cartão do canal em reprodução fica marcado (.is-current)");
    confere(Math.abs(r2.sl - antes) <= 2, "a rolagem da fileira não volta ao começo ao clicar (" + antes + " -> " + r2.sl + ")");
    const player = await page.eval(`(() => { const p = document.getElementById("player-screen").getBoundingClientRect(), o = document.querySelector(".on-now").getBoundingClientRect(); return { pw: Math.round(p.width), topo: p.top + scrollY, fileiraTopo: o.top + scrollY }; })()`);
    confere(player.topo < player.fileiraTopo, "o player grande continua no topo, acima da fileira");
    await page.eval(`window.scrollTo(0, 0)`);
    await page.sleep(500);
    await captura(page, "qa-1440-com-player.png");

    // coração remove dos favoritos
    const antesFav = await page.eval(`${ROW}.querySelectorAll(".qa-card").length`);
    await page.eval(`${ROW}.querySelectorAll(".fav-btn")[0].click()`);
    await page.sleep(400);
    confere(await page.eval(`${ROW}.querySelectorAll(".qa-card").length`) === antesFav - 1, "coração do cartão tira o canal dos favoritos (" + antesFav + " → " + (antesFav - 1) + ")");
    await page.eval(`setState({ favorites: ${JSON.stringify(NOMES.slice(0, 17))} })`);
    await page.sleep(300);

    // 1920x1080
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.sleep(600);
    await page.eval(`window.scrollTo(0, 0)`);
    await page.eval(`${ROW}.scrollLeft = 0`);
    await page.sleep(300);
    const g = await medidas(page);
    confere(g.secao >= g.util * 0.9 && g.colunas === 1, "1920: a seção ocupa " + g.secao + " de " + g.util + " px úteis (" + Math.round(100 * g.secao / g.util) + "%)");
    confere(g.sw > g.cw, "1920: a fileira ainda rola (scrollWidth " + g.sw + " > clientWidth " + g.cw + ")");
    await captura(page, "qa-1920-inicio.png");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.sleep(400);

    // estado vazio compacto, em largura total
    await page.eval(`(() => { window.__ch = _state.channels; _state.channels = []; renderOnNow(); })()`);
    await page.sleep(300);
    const v = await page.eval(`(() => { const e = document.querySelector(".on-now .empty-state"); const r = e && e.getBoundingClientRect(); const o = document.querySelector(".on-now").getBoundingClientRect(); return { tem: !!e, w: r && Math.round(r.width), ow: Math.round(o.width), h: r && Math.round(r.height), setas: document.querySelectorAll(".on-now .web-arrow").length }; })()`);
    confere(v.tem && v.w >= v.ow * 0.98 && v.h <= 160 && v.setas === 0, "sem canais/favoritos: estado vazio compacto em largura total (" + v.w + "x" + v.h + ", sem setas)");
    await page.eval(`document.querySelector(".on-now").scrollIntoView({ block: "center" })`);
    await page.sleep(300);
    await captura(page, "qa-1440-vazio.png");
    await page.eval(`(() => { _state.channels = window.__ch; renderOnNow(); })()`);
    await page.sleep(200);

    // sem o atributo data-web-app (como o app nativo): volta a coluna lateral e as linhas antigas
    await page.eval(`document.documentElement.removeAttribute("data-web-app"); renderOnNow();`);
    await page.sleep(300);
    const n = await page.eval(`(() => { const o = document.querySelector(".on-now"); return { w: Math.round(o.getBoundingClientRect().width), linhas: document.querySelectorAll(".now-row").length, cartoes: document.querySelectorAll(".qa-card").length, vodRow: o.classList.contains("vod-row"), cls: ${ROW}.className, cols: getComputedStyle(document.getElementById("feature-layout")).gridTemplateColumns.split(" ").length }; })()`);
    confere(n.w === 320 && n.cols === 2 && n.linhas === 17 && n.cartoes === 0 && !n.vodRow && n.cls === "now-list", "sem data-web-app: coluna de 20 rem e linhas antigas (.now-row x" + n.linhas + ", largura " + n.w + ")");
    confere(page.blocked.length === 0, "nenhuma requisição externa tentada (" + page.blocked.join(", ") + ")");
  });

  // ═══ 1920x1080 direto (captura limpa, sem player) ═══
  await withPage(URL_APP, { width: 1920, height: 1080, desktop: true, blockExternal: true, preScript: preScript() }, async (page) => {
    await abrirCanais(page);
    await page.eval(`window.scrollTo(0, 0)`);
    await page.sleep(400);
    await captura(page, "qa-1920-canais.png");
    const g = await medidas(page);
    confere(g.secao >= g.util * 0.9 && g.cartoes === 17, "1920 (página nova): seção com " + Math.round(100 * g.secao / g.util) + "% da largura útil e 17 cartões");
  });

  // ═══ 1000 px (entre 769 e 1100): segue sem painel lateral ═══
  await withPage(URL_APP, { width: 1000, height: 800, desktop: true, blockExternal: true, preScript: preScript() }, async (page) => {
    await abrirCanais(page);
    const o = await page.eval(`({ on: getComputedStyle(document.querySelector(".on-now")).display, cols: getComputedStyle(document.getElementById("feature-layout")).gridTemplateColumns.split(" ").length })`);
    confere(o.on === "none" && o.cols === 1, "1000 px: o painel do Acesso rápido continua oculto (como antes)");
    await captura(page, "qa-1000.png");
  });

  // ═══ celular 390x844: nada mudou ═══
  await withPage(URL_APP, { width: 390, height: 844, blockExternal: true, preScript: preScript() }, async (page) => {
    await abrirCanais(page);
    const o = await page.eval(`(() => { const g = document.querySelector(".channel-grid"); return { on: getComputedStyle(document.querySelector(".on-now")).display, cols: getComputedStyle(document.getElementById("feature-layout")).gridTemplateColumns.split(" ").length, grade: g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0, tabs: getComputedStyle(document.querySelector(".mobile-tabs")).display, larg: document.documentElement.scrollWidth }; })()`);
    confere(o.on === "none" && o.cols === 1, "390x844: o painel do Acesso rápido continua oculto");
    confere(o.grade <= 3 && o.larg <= 390, "390x844: grade de canais e largura da página como antes (" + o.grade + " col, " + o.larg + " px)");
    await captura(page, "qa-390.png");
  });
} finally {
  servidor.close();
}

if (falhas.length) { console.error("\n✖ " + falhas.length + " falha(s)"); process.exit(1); }
console.log("\n✔ ok");
process.exit(0);
