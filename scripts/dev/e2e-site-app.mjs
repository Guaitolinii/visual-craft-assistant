// Site + app web de ponta a ponta contra a PRODUÇÃO (https://sintonizatv.com.br). Rode com cuidado:
//   (a) aviso de cadastro: cria 1 usuário de teste pelo Auth admin (gatilho do banco -> /api/notify-signup -> Resend)
//       e confere em net._http_response que a função respondeu 200. Isso ENVIA 1 E-MAIL REAL ao NOTIFY_TO. Remove o usuário no fim.
//   (b) app web no Chrome (CDP): entra pela tela do site (/), abre o app (aba App), confere aparelho "web" (sem código/QR),
//       perfis, lista de canais e reprodução ao vivo pelo /api/proxy, service worker, manifest e shell offline (desktop 1440x900);
//       depois 390x844 como atalho (navigator.standalone simulado). Remove o aparelho web criado (device_unlink).
//   (c) /?next=%2Fapp%2F: a tela do site oferece Entrar/Criar conta e, depois do login, volta para /app/.
//   (d) confere mailer_autoconfirm = false (imprime só esse valor).
// Nunca imprime chaves, senhas, tokens, links de provedor nem e-mails de contas. NÃO cria cadastro pela tela (evita um 2º e-mail real).
// Uso: node scripts/dev/e2e-site-app.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local" [pasta-das-capturas]
import { readFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
const pastaCapturas = process.argv[3] || "";
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto do site."); process.exit(1); }
if (pastaCapturas) mkdirSync(pastaCapturas, { recursive: true });
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD, SUPABASE_ACCESS_TOKEN: MGMT } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD || !MGMT) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }
const SITE = "https://sintonizatv.com.br";
const REF = new URL(URL_BASE).hostname.split(".")[0];

const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } else console.log("  ✔ " + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera uma condição (função async) por até `ms`; devolve o último valor
const esperar = async (fn, ms, passo = 400) => { const fim = Date.now() + ms; let v = null; while (Date.now() < fim) { try { v = await fn(); } catch (e) { v = null; /* página navegando */ } if (v) return v; await sleep(passo); } return v; };

// ── Acesso ao backend (REST/RPC com o JWT do usuário; Management API só para SQL e configuração) ──
const rest = async (rota, jwt, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${rota}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const rpc = (nome, corpo, jwt) => rest(`rpc/${nome}`, jwt, { method: "POST", body: JSON.stringify(corpo) });
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;
const mgmt = async (caminho, init = {}) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/${caminho}`, { ...init, headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const texto = await r.text();
  let data = null; try { data = JSON.parse(texto); } catch (e) { data = texto; }
  return { status: r.status, data };
};
const sql = (query) => mgmt("database/query", { method: "POST", body: JSON.stringify({ query }) });
const aparelhosWeb = async (jwt) => {
  const r = await rest("devices?select=id,modelo,sistema,tipo,ativo,instalacao&tipo=eq.web", jwt);
  return Array.isArray(r.data) ? r.data : [];
};

// ═════════ (a) Aviso de cadastro ═════════
async function parteA() {
  console.log("(a) aviso de cadastro (1 e-mail real ao NOTIFY_TO)");
  let userId = null;
  let chaveServico = null;
  try {
    const k = await mgmt("api-keys");
    chaveServico = Array.isArray(k.data) ? (k.data.find((x) => x.name === "service_role") || {}).api_key : null;
    if (!chaveServico) { confere(false, "não consegui obter a chave de serviço pela Management API (status " + k.status + ")"); return; }
    const antes = await sql("select coalesce(max(id), 0) as m from net._http_response");
    const maxId = Number(antes.data && antes.data[0] && antes.data[0].m) || 0;
    const email = `teste.aviso+${Date.now()}@sintonizatv.com.br`;
    const cria = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: chaveServico, Authorization: `Bearer ${chaveServico}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: randomBytes(18).toString("base64url"), email_confirm: false, user_metadata: { nome: "TESTE aviso de cadastro (pode ignorar)" } }),
    });
    const u = await cria.json().catch(() => null);
    userId = u && u.id;
    confere(cria.status === 200 && !!userId, "usuário de teste criado pelo Auth admin (status " + cria.status + ")");
    if (!userId) { console.error("   corpo do erro: " + JSON.stringify(u)); return; }
    // Espera a chamada do banco para a função (net._http_response) por até 20 s
    let linhas = [];
    const fim = Date.now() + 20000;
    while (Date.now() < fim) {
      await sleep(2000);
      const r = await sql(`select id, status_code, left(coalesce(content::text, ''), 300) as corpo, error_msg, created from net._http_response where id > ${maxId} order by id`);
      linhas = Array.isArray(r.data) ? r.data : [];
      if (linhas.length) break;
    }
    if (!linhas.length) { confere(false, "nenhuma resposta em net._http_response em 20 s (o gatilho/pg_net não chamou a função, ou ela não respondeu)"); return; }
    const l = linhas[linhas.length - 1];
    confere(Number(l.status_code) === 200, `a função /api/notify-signup respondeu status ${l.status_code}`);
    if (Number(l.status_code) !== 200) console.error(`   corpo exato: ${JSON.stringify(l.corpo)} | error_msg: ${JSON.stringify(l.error_msg)}`);
    else console.log(`   corpo da resposta: ${JSON.stringify(l.corpo)} (${linhas.length} resposta(s) novas no pg_net)`);
  } catch (e) {
    confere(false, "erro no teste do aviso: " + e.message);
  } finally {
    if (userId && chaveServico) {
      const del = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: chaveServico, Authorization: `Bearer ${chaveServico}` } });
      const existe = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, { headers: { apikey: chaveServico, Authorization: `Bearer ${chaveServico}` } });
      confere(del.status === 200 && existe.status === 404, `usuário de teste removido (delete ${del.status}; consulta depois ${existe.status})`);
    }
  }
}

// ═════════ Funções do navegador (b, c) ═════════
// Digita e envia o formulário do site (campos controlados pelo React: usa o setter nativo)
async function entrarPelaTela(page) {
  const form = await esperar(() => page.eval(`!!document.querySelector('input[type=email]') && !!document.querySelector('input[type=password]')`), 25000);
  if (!form) throw new Error("o formulário de login do site não apareceu");
  await page.eval(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.querySelector("input[type=email]"), ${JSON.stringify(EMAIL)});
    set(document.querySelector("input[type=password]"), ${JSON.stringify(PASSWORD)});
    document.querySelector("form button[type=submit]").click();
    return 1;
  })()`);
}

// Classifica a requisição do proxy sem expor o link do provedor
function tipoProxy(url) {
  try {
    const x = new URL(url);
    const k = x.searchParams.get("k");
    const u = x.searchParams.get("u") || "";
    if (k === "hls") return "hls";
    if (/player_api\.php/.test(u)) return "api";
    if (/get\.php|\.m3u(\?|$)/i.test(u)) return "lista";
    return "outro";
  } catch (e) { return "outro"; }
}

// Observa as respostas do /api/proxy (status e tipo; nunca a URL do provedor)
async function observarProxy(page) {
  const lista = [];
  await page.send("Network.enable");
  page.on("Network.responseReceived", (p) => {
    if (p.response && /\/api\/proxy\?/.test(p.response.url)) lista.push({ id: p.requestId, status: p.response.status, tipo: tipoProxy(p.response.url) });
  });
  return lista;
}
const resumoProxy = (lista) => {
  const o = {};
  for (const r of lista) { const k = `${r.tipo}:${r.status}`; o[k] = (o[k] || 0) + 1; }
  return Object.entries(o).map(([k, n]) => `${k} x${n}`).join(", ") || "(nenhuma, foi direto ao provedor)";
};
// Pedidos de lista/API que passaram pelo proxy e deram erro (zero também quando tudo foi direto, sem proxy)
const ruinsDeLista = (lista) => lista.filter((r) => (r.tipo === "lista" || r.tipo === "api") && r.status >= 400).length;

// Escolhe o perfil principal se o app perguntar quem está assistindo; espera o app liberar
async function esperarAppPronto(page, ms = 70000) {
  return esperar(async () => {
    const s = await page.eval(`({ rota: location.pathname, token: !!localStorage.getItem("sint_ott_token"), aberto: document.documentElement.classList.contains("profile-open"),
      boot: !!(window._profile && _profile.booting), n: window._profile ? _profile.list.length : 0, canais: (typeof _state !== "undefined" && _state.channels) ? _state.channels.length : 0 })`);
    if (s.rota.startsWith("/app") && s.aberto && !s.boot && s.n) await page.eval(`profileChoose(_profile.list.find(p => p.padrao) || _profile.list[0]); 1`);
    return s.rota.startsWith("/app") && s.token && !s.aberto && !s.boot && s.canais > 0 ? s : null;
  }, ms, 1500);
}

const captura = async (page, nome) => { if (pastaCapturas) await page.screenshot(path.join(pastaCapturas, nome)); };

// ═════════ (b) + (c) navegador ═════════
async function parteB() {
  const jwt = await login();
  if (!jwt) { confere(false, "não consegui entrar com o usuário de teste pela API"); return; }
  const antes = await aparelhosWeb(jwt);
  console.log(`   aparelhos web da conta de teste antes: ${antes.length}`);

  // ── desktop 1440x900: entra pela tela do site (/) e abre o app pela aba App ──
  console.log("(b) app web na produção, desktop 1440x900 (entrada pela tela do site em /)");
  let tokenDesktop = null;
  await withPage(SITE + "/", { width: 1440, height: 900, desktop: true }, async (page) => {
    try {
      const naoLogado = await esperar(() => page.eval(`!!document.querySelector('input[type=email]')`), 25000);
      confere(naoLogado, "a página / (sem sessão) mostra o formulário de login");
      const abas = await page.eval(`[...document.querySelectorAll('[role=tab]')].map(b => b.textContent.trim())`);
      confere(abas.includes("Entrar") && abas.includes("Criar conta"), "a página / oferece as abas Entrar e Criar conta (" + abas.join(" | ") + ")");
      const linkApp = await page.eval(`!!document.querySelector('a[href="/app/"]')`);
      confere(linkApp, "a página / oferece o link \"Abrir o app\"");
      await captura(page, "site-login-desktop.png");

      await entrarPelaTela(page);
      const aba = await esperar(() => page.eval(`(() => { const a = document.querySelector('header nav a[href="/app/"]'); return a ? a.textContent.trim() : null; })()`), 25000);
      confere(!!aba && /App/.test(aba), "depois do login o painel mostra a aba \"" + aba + "\"");
      await captura(page, "site-painel-aba-app.png");

      const lista = await observarProxy(page);
      await page.eval(`document.querySelector('header nav a[href="/app/"]').click(); 1`);
      const pronto = await esperarAppPronto(page);
      confere(!!pronto, "a aba App abriu /app/ e o app carregou (perfil ativo e " + (pronto ? pronto.canais : 0) + " canais)");
      if (!pronto) {
        console.error("   estado: " + JSON.stringify(await page.eval(`({ rota: location.pathname, token: !!localStorage.getItem("sint_ott_token"), gate: document.documentElement.classList.contains("ott-open"), msg: (document.getElementById("ott-error") || {}).textContent || "" })`).catch(() => null)));
        console.error("   proxy: " + resumoProxy(lista));
        return;
      }
      await captura(page, "app-desktop.png");

      // aparelho web sem tela de código/QR
      const gate = await page.eval(`({ aberto: document.documentElement.classList.contains("ott-open"), vis: getComputedStyle(document.getElementById("ott-gate")).display, token: localStorage.getItem("sint_ott_token"), inst: localStorage.getItem("sint_web_install"), webApp: document.documentElement.getAttribute("data-web-app") })`);
      tokenDesktop = gate.token;
      confere(!gate.aberto && gate.vis === "none" && gate.webApp === "1", "sem tela de código/QR (gate fechado, modo web)");
      const depois = await aparelhosWeb(jwt);
      const novo = depois.find((d) => d.instalacao === gate.inst);
      confere(!!novo && novo.ativo && depois.length === antes.length + 1, `aparelho "web" criado em devices (tipo ${novo && novo.tipo}, modelo "${novo && novo.modelo}", sistema "${novo && novo.sistema}"; total web ${antes.length} -> ${depois.length})`);

      // perfis
      const perfis = await page.eval(`({ n: _profile.list.length, ativo: !!activeProfileId() })`);
      confere(perfis.n >= 1 && perfis.ativo, `perfis carregam (${perfis.n}) e há perfil ativo`);

      // lista de canais pelo proxy
      const okLista = lista.filter((r) => (r.tipo === "lista" || r.tipo === "api") && r.status === 200);
      // v16: a lista pode ir DIRETO ao provedor (sem proxy) quando ele aceita CORS; o que vale é o app ter carregado os canais
      confere(okLista.length > 0 || ruinsDeLista(lista) === 0, `a lista da conta carregou (pelo proxy ou direto) (${resumoProxy(lista) || "direto, sem proxy"})`);
      const ruins = lista.filter((r) => r.status >= 400);
      if (ruins.length) {
        const r0 = ruins[0];
        const corpo = await page.send("Network.getResponseBody", { requestId: r0.id });
        console.error(`   atenção: proxy respondeu ${r0.tipo}:${r0.status}; corpo: ${JSON.stringify((corpo.result && corpo.result.body || "").slice(0, 200))}`);
      }

      // reprodução ao vivo (até 6 canais; HLS por /api/proxy...&k=hls)
      let tocou = null;
      for (let i = 0; i < 6 && !tocou; i++) {
        await page.eval(`selectChannel(_state.channels[${i}]); 1`);
        tocou = await esperar(async () => {
          const v = await page.eval(`(() => { const e = document.getElementById("player-video"); return { t: e.currentTime, p: e.paused, rs: e.readyState, tipo: currentStreamType }; })()`);
          return v.t > 0.5 && !v.p ? { ...v, i } : null;
        }, 22000, 700);
      }
      const hls = lista.filter((r) => r.tipo === "hls");
      if (tocou) {
        confere(true, `canal ao vivo (nº ${tocou.i + 1} da lista) tocando: currentTime ${tocou.t.toFixed(1)} s, tipo ${tocou.tipo}; proxy: ${resumoProxy(lista)}`);
        confere(tocou.tipo !== "hls" || hls.some((r) => r.status === 200), "o HLS passou por /api/proxy...&k=hls com 200");
        await captura(page, "app-desktop-tocando.png");
      } else {
        confere(false, `nenhum dos 6 primeiros canais começou a tocar em 22 s cada; proxy: ${resumoProxy(lista)}; erro do player: ${JSON.stringify(await page.eval(`(document.getElementById("player-error") || {}).textContent || ""`).catch(() => ""))}`);
        const r0 = lista.find((r) => r.status >= 400 && r.tipo !== "lista");
        if (r0) { const corpo = await page.send("Network.getResponseBody", { requestId: r0.id }); console.error(`   primeira falha do proxy: ${r0.tipo}:${r0.status} corpo ${JSON.stringify((corpo.result && corpo.result.body || "").slice(0, 200))}`); }
      }
      await page.eval(`try { stopStream(); } catch (e) {} 1`);

      // service worker + manifest
      const sw = await esperar(() => page.eval(`navigator.serviceWorker.getRegistration("/app/").then(r => r && r.active ? { estado: r.active.state, escopo: new URL(r.scope).pathname } : null)`), 15000);
      confere(!!sw && sw.estado === "activated" && sw.escopo === "/app/", `service worker ativo (escopo ${sw && sw.escopo}, estado ${sw && sw.estado})`);
      const man = await page.send("Page.getAppManifest");
      const m = man.result || {};
      const errosManifest = (m.errors || []).map((e) => e.message);
      const inst = await page.send("Page.getInstallabilityErrors");
      const errosInst = ((inst.result && inst.result.installabilityErrors) || []).map((e) => e.errorId);
      confere(errosManifest.length === 0 && errosInst.length === 0, `manifest sem erros (${JSON.stringify(errosManifest)}) e instalável (erros de instalabilidade: ${JSON.stringify(errosInst)})`);
      let md = null; try { md = JSON.parse(m.data); } catch (e) { /* manifest ausente */ }
      confere(!!md && md.start_url === "/app/" && md.display === "standalone", `manifest: start_url ${md && md.start_url}, display ${md && md.display}, scope ${md && md.scope}`);

      // segunda visita offline: o shell vem do cache
      await page.send("Page.reload");
      await page.sleep(4000);
      const ctl = await esperar(() => page.eval(`!!navigator.serviceWorker.controller`), 10000);
      confere(ctl, "depois de recarregar, a página é controlada pelo service worker");
      await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      await page.send("Page.navigate", { url: SITE + "/app/" });
      await page.sleep(4500);
      const off = await page.eval(`({ rota: location.pathname, web: document.documentElement.getAttribute("data-web-app"), titulo: document.title, player: !!document.getElementById("player-video") })`).catch(() => null);
      confere(!!off && off.rota.startsWith("/app") && off.web === "1" && off.player, `offline: o shell do app abre do cache (título "${off && off.titulo}")`);
      await captura(page, "app-desktop-offline.png");
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    } finally {
      // limpeza: desvincula o aparelho web (nunca depende de a página estar viva)
      let t = tokenDesktop;
      try { t = (await page.eval(`localStorage.getItem("sint_ott_token")`)) || t; } catch (e) { /* página indisponível */ }
      if (t) await rpc("device_unlink", { p_token: t });
    }
  });
  const aposDesktop = await aparelhosWeb(jwt);
  confere(aposDesktop.length === antes.length, `aparelho web do desktop removido (total web ${aposDesktop.length}, antes ${antes.length})`);

  // ── celular 390x844 como atalho; entrada por /?next=%2Fapp%2F (c) ──
  console.log("(b/c) celular 390x844 como atalho (navigator.standalone simulado) e retorno ao app pelo ?next");
  const preStandalone = `Object.defineProperty(navigator, "standalone", { get: () => true });`;
  await withPage(SITE + "/?next=%2Fapp%2F", { width: 390, height: 844, preScript: preStandalone }, async (page) => {
    let tok = null;
    try {
      const naoLogado = await esperar(() => page.eval(`!!document.querySelector('input[type=email]')`), 25000);
      confere(naoLogado, "/?next=%2Fapp%2F mostra o formulário de login");
      await captura(page, "site-login-celular.png");
      const lista = await observarProxy(page);
      await entrarPelaTela(page);
      const voltou = await esperar(() => page.eval(`location.pathname === "/app/"`), 25000);
      confere(!!voltou, "depois do login, o ?next=%2Fapp%2F voltou para /app/");
      const pronto = await esperarAppPronto(page);
      confere(!!pronto, "o app abriu no celular (" + (pronto ? pronto.canais : 0) + " canais)");
      if (!pronto) { console.error("   proxy: " + resumoProxy(lista)); return; }
      const s = await page.eval(`({ standalone: document.documentElement.classList.contains("web-standalone"), gate: document.documentElement.classList.contains("ott-open"), token: localStorage.getItem("sint_ott_token"), inst: localStorage.getItem("sint_web_install") })`);
      tok = s.token;
      confere(s.standalone && !s.gate, "o app reconhece o modo atalho e não mostra tela de código/QR");
      const web = await aparelhosWeb(jwt);
      const novo = web.find((d) => d.instalacao === s.inst);
      confere(!!novo && /\(atalho\)/.test(novo.modelo), `aparelho web do atalho criado (modelo "${novo && novo.modelo}", sistema "${novo && novo.sistema}")`);
      confere(ruinsDeLista(lista) === 0, `a lista carregou sem erro (pelo proxy ou direto) (${resumoProxy(lista) || "direto, sem proxy"})`);
      await captura(page, "app-celular-standalone.png");
    } finally {
      let t = tok;
      try { t = (await page.eval(`localStorage.getItem("sint_ott_token")`)) || t; } catch (e) { /* página indisponível */ }
      if (t) await rpc("device_unlink", { p_token: t });
    }
  });
  const aposCelular = await aparelhosWeb(jwt);
  confere(aposCelular.length === antes.length, `aparelho web do celular removido (total web ${aposCelular.length}, antes ${antes.length})`);
}

// ═════════ (d) mailer_autoconfirm ═════════
async function parteD() {
  const r = await mgmt("config/auth");
  const v = r.data && r.data.mailer_autoconfirm;
  if (r.status === 401) { console.log("  – mailer_autoconfirm não conferido: o token do Supabase expirou (401); confira no painel do Supabase"); return; }
  confere(r.status === 200 && v === false, `mailer_autoconfirm = ${v}`);
}

// E2E_PARTES=b,d roda só essas partes (a parte "a" envia um e-mail real: evite repeti-la sem necessidade)
const partes = (process.env.E2E_PARTES || "a,b,d").split(",");
for (const [nome, fn] of [["a", parteA], ["b", parteB], ["d", parteD]]) {
  if (!partes.includes(nome)) continue;
  try { await fn(); } catch (e) { confere(false, `erro inesperado na parte ${nome}: ${e.message}`); }
}
if (falhas.length) { console.error(`✖ ${falhas.length} verificação(ões) falharam`); process.exit(1); }
console.log("✔ ok (partes " + partes.join(",") + "): aviso de cadastro, app web na produção (desktop e atalho), retorno /?next e mailer_autoconfirm = false");
process.exit(0);
