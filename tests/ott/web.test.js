// App no navegador (/app/): caminho, instalação, sessão do site, registro do aparelho web e proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadOtt, plain, fakeStorage, fakeFetch, LINK_HTML_PATH } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "ANON", panelUrl: "https://sintonizatv.com.br" };
const SESSAO = "sintoniza_painel_sessao";
const sessaoOk = (extra = {}) => ({ access_token: "ACESSO", refresh_token: "RENOVA", expires_at: 2000000, user: { id: "u1", email: "a@b.com" }, ...extra });

test("o caminho /app é o app web (e só fora do app nativo)", () => {
  const o = loadOtt();
  assert.equal(o.ottIsWebPath("/app/", false), true);
  assert.equal(o.ottIsWebPath("/app", false), true);
  assert.equal(o.ottIsWebPath("/app/index.html", false), true);
  assert.equal(o.ottIsWebPath("/app/", true), false); // nativo manda
  assert.equal(o.ottIsWebPath("/", false), false);
  assert.equal(o.ottIsWebPath("/conta", false), false);
  assert.equal(o.ottIsWebPath("/application/", false), false);
  assert.equal(o.ottIsWebPath(undefined, false), false);
});

test("id de instalação: gera uma vez, guarda e devolve sempre o mesmo", () => {
  const o = loadOtt();
  const s = fakeStorage();
  const a = o.ottWebInstallId(s);
  assert.match(a, /^[A-Za-z0-9-]{16,64}$/);
  assert.equal(s.data.sint_web_install, a);
  assert.equal(o.ottWebInstallId(s), a);
  // outro armazenamento = outra instalação
  assert.notEqual(o.ottWebInstallId(fakeStorage()), a);
});

test("id de instalação: usa o crypto do navegador quando existe e é um uuid v4", () => {
  const o = loadOtt();
  const crypto = { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = i * 7 + 3; return arr; } };
  const id = o.ottWebInstallId(fakeStorage(), crypto);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("id de instalação: valor guardado inválido é trocado por um novo; armazenamento quebrado ainda devolve um id", () => {
  const o = loadOtt();
  const s = fakeStorage({ sint_web_install: "curto" });
  const novo = o.ottWebInstallId(s);
  assert.notEqual(novo, "curto");
  assert.match(novo, /^[A-Za-z0-9-]{16,64}$/);
  const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem() {} };
  assert.match(o.ottWebInstallId(quebrado), /^[A-Za-z0-9-]{16,64}$/);
});

test("lê a sessão do site (mesmo formato do painel) e recusa lixo", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottWebParseSession(JSON.stringify(sessaoOk()))), sessaoOk());
  assert.equal(o.ottWebParseSession(null), null);
  assert.equal(o.ottWebParseSession(""), null);
  assert.equal(o.ottWebParseSession("{lixo"), null);
  assert.equal(o.ottWebParseSession(JSON.stringify({ access_token: "x" })), null);
  assert.equal(o.ottWebParseSession(JSON.stringify({ access_token: "x", refresh_token: "y", expires_at: "amanhã" })), null);
});

test("precisa renovar quando faltam menos de 60 s para vencer", () => {
  const o = loadOtt();
  const s = sessaoOk({ expires_at: 1000 }); // vence em 1000 s
  assert.equal(o.ottWebNeedsRefresh(s, 900 * 1000), false);   // faltam 100 s
  assert.equal(o.ottWebNeedsRefresh(s, 941 * 1000), true);    // faltam 59 s
  assert.equal(o.ottWebNeedsRefresh(s, 2000 * 1000), true);   // já venceu
  assert.equal(o.ottWebNeedsRefresh(null, 0), true);
});

test("sessão vencida: renova pelo refresh_token e grava no mesmo formato do painel", async () => {
  const o = loadOtt();
  const storage = fakeStorage({ [SESSAO]: JSON.stringify(sessaoOk({ expires_at: 10 })) });
  const f = fakeFetch(() => ({ body: { access_token: "NOVO", refresh_token: "NOVO2", expires_in: 3600, user: { id: "u1", email: "a@b.com" } } }));
  const nova = plain(await o.ottWebRefresh(cfg, sessaoOk({ expires_at: 10 }), f, storage, 5000000));
  assert.equal(nova.access_token, "NOVO");
  assert.equal(nova.refresh_token, "NOVO2");
  assert.equal(nova.expires_at, 5000 + 3600);
  assert.deepEqual(nova.user, { id: "u1", email: "a@b.com" });
  assert.deepEqual(JSON.parse(storage.data[SESSAO]), nova);
  const c = f.calls[0];
  assert.equal(c.url, "https://x.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.equal(c.init.method, "POST");
  assert.deepEqual(JSON.parse(c.init.body), { refresh_token: "RENOVA" });
  assert.equal(c.init.headers.apikey, "ANON");
});

test("renovação que falha devolve null (e limpa a sessão se o servidor recusou)", async () => {
  const o = loadOtt();
  const recusa = fakeStorage({ [SESSAO]: JSON.stringify(sessaoOk()) });
  assert.equal(await o.ottWebRefresh(cfg, sessaoOk(), fakeFetch(() => ({ status: 400, body: { msg: "Invalid Refresh Token" } })), recusa, 1), null);
  assert.equal(recusa.data[SESSAO], undefined);
  // sem rede: devolve null mas NÃO apaga a sessão (voltando a ter internet ela ainda serve)
  const semRede = fakeStorage({ [SESSAO]: JSON.stringify(sessaoOk()) });
  assert.equal(await o.ottWebRefresh(cfg, sessaoOk(), fakeFetch(() => { throw new Error("sem rede"); }), semRede, 1), null);
  assert.ok(semRede.data[SESSAO]);
  // resposta sem tokens
  assert.equal(await o.ottWebRefresh(cfg, sessaoOk(), fakeFetch(() => ({ body: { foo: 1 } })), fakeStorage(), 1), null);
});

test("registro do aparelho web: usa o Bearer do USUÁRIO (não a chave anon) e devolve o token", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", device_token: "t".repeat(64) } }));
  const inst = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const tok = await o.ottWebRegister(cfg, "JWT_DO_USUARIO", inst, { modelo: "Chrome no Windows", sistema: "Windows" }, f);
  assert.equal(tok, "t".repeat(64));
  const c = f.calls[0];
  assert.equal(c.url, "https://x.supabase.co/rest/v1/rpc/web_device_register");
  assert.equal(c.init.headers.Authorization, "Bearer JWT_DO_USUARIO");
  assert.equal(c.init.headers.apikey, "ANON");
  assert.deepEqual(JSON.parse(c.init.body), { p_instalacao: inst, p_modelo: "Chrome no Windows", p_sistema: "Windows" });
});

test("registro: id de instalação inválido nunca é enviado", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", device_token: "x" } }));
  for (const ruim of ["", "curto", "tem espaço tem espaço tem espaço", "a".repeat(65), null, undefined, "id/com/barras/barras/barras"]) {
    await assert.rejects(o.ottWebRegister(cfg, "JWT", ruim, { modelo: "m", sistema: "s" }, f), /Instalação inválida/);
  }
  assert.equal(f.calls.length, 0);
});

test("registro: erros do servidor viram Error em português com o tipo certo", async () => {
  const o = loadOtt();
  const inst = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const limite = fakeFetch(() => ({ status: 400, body: { message: "Limite de 5 navegador(es) atingido. Remova um aparelho web no painel." } }));
  await assert.rejects(o.ottWebRegister(cfg, "JWT", inst, {}, limite), (e) => /Limite de 5/.test(e.message) && e.kind === "business");
  const login = fakeFetch(() => ({ status: 403, body: { message: "Faça login para usar o app." } }));
  await assert.rejects(o.ottWebRegister(cfg, "JWT", inst, {}, login), (e) => e.kind === "login");
  const rede = fakeFetch(() => { throw new Error("sem rede"); });
  await assert.rejects(o.ottWebRegister(cfg, "JWT", inst, {}, rede), (e) => e.kind === "network");
  const estranha = fakeFetch(() => ({ body: { status: "ok" } }));
  await assert.rejects(o.ottWebRegister(cfg, "JWT", inst, {}, estranha), /Resposta inesperada/);
});

test("o ottCallRpc continua usando a chave anon quando não há bearer", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { ok: true } }));
  await o.ottCallRpc(cfg, "device_config", { p_token: "x" }, f);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer ANON");
});

test("sair: avisa o servidor com o token de acesso e nunca falha", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: {} }));
  await o.ottWebLogout(cfg, sessaoOk(), f);
  assert.equal(f.calls[0].url, "https://x.supabase.co/auth/v1/logout");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer ACESSO");
  await o.ottWebLogout(cfg, sessaoOk(), fakeFetch(() => { throw new Error("sem rede"); })); // não lança
  await o.ottWebLogout(cfg, null, f); // sem sessão: não faz nada
  assert.equal(f.calls.length, 1);
});

test("descreve o navegador e o sistema (e se é o atalho instalado)", () => {
  const o = loadOtt();
  const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  assert.deepEqual(plain(o.ottWebDevice(chromeWin, "Win32", false)), { modelo: "Chrome no Windows", sistema: "Windows", app: false });
  const edge = chromeWin + " Edg/130.0.0.0";
  assert.equal(plain(o.ottWebDevice(edge, "Win32")).modelo, "Edge no Windows");
  const ff = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
  assert.deepEqual(plain(o.ottWebDevice(ff, "Linux x86_64")), { modelo: "Firefox no Linux", sistema: "Linux", app: false });
  const safMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  assert.deepEqual(plain(o.ottWebDevice(safMac, "MacIntel")), { modelo: "Safari no macOS", sistema: "macOS", app: false });
  const safiPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  assert.deepEqual(plain(o.ottWebDevice(safiPhone, "iPhone", true)), { modelo: "Safari no iPhone (atalho)", sistema: "iOS", app: true });
  const chromeAnd = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  assert.deepEqual(plain(o.ottWebDevice(chromeAnd, "Linux armv81", false)), { modelo: "Chrome no Android", sistema: "Android", app: false });
  assert.equal(plain(o.ottWebDevice("", "")).modelo, "Navegador");
  assert.ok(plain(o.ottWebDevice(safiPhone, "iPhone", true)).modelo.length <= 80);
});

// Os mesmos casos de tests/proxy.test.ts do site (functions/_lib/proxy.js)
test("URL do proxy: igual à do servidor", () => {
  const o = loadOtt();
  assert.equal(o.ottWebProxy("https://x.com/a b?c=1&d=2", "tok", "hls"), "/api/proxy?u=" + encodeURIComponent("https://x.com/a b?c=1&d=2") + "&t=tok&k=hls");
  assert.equal(o.ottWebProxy("https://x.com/a", "tok"), "/api/proxy?u=" + encodeURIComponent("https://x.com/a") + "&t=tok");
});

test("o que passa pelo proxy: http(s) de provedor sim; própria origem, Supabase, GitHub, data e blob não", () => {
  const o = loadOtt();
  const own = ["https://sintonizatv.com.br", "https://x.supabase.co"];
  assert.equal(o.ottWebShouldProxy("http://provedor.com:8080/get.php?u=1", own), true);
  assert.equal(o.ottWebShouldProxy("https://cdn.provedor.com/live/a.m3u8", own), true);
  assert.equal(o.ottWebShouldProxy("https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz", own), true);
  assert.equal(o.ottWebShouldProxy("https://sintonizatv.com.br/app-config.json", own), false);
  assert.equal(o.ottWebShouldProxy("https://x.supabase.co/rest/v1/rpc/x", own), false);
  assert.equal(o.ottWebShouldProxy("https://outro.supabase.co/rest/v1/rpc/x", own), false);
  assert.equal(o.ottWebShouldProxy("https://raw.githubusercontent.com/a/b/c.json", own), false);
  assert.equal(o.ottWebShouldProxy("data:image/png;base64,AAAA", own), false);
  assert.equal(o.ottWebShouldProxy("blob:https://sintonizatv.com.br/abc", own), false);
  assert.equal(o.ottWebShouldProxy("/api/proxy?u=x&t=y", own), false); // já passou pelo proxy
  assert.equal(o.ottWebShouldProxy("lixo", own), false);
  assert.equal(o.ottWebShouldProxy("", own), false);
  assert.equal(o.ottWebShouldProxy("http://provedor.com/a"), true); // sem lista de origens
});

test("o seletor de perfis no app web volta depois de 12 h (e não antes)", () => {
  const o = loadOtt();
  const agora = 1000 * 3600 * 100;
  assert.equal(o.ottWebChosenValid(String(agora - 3600 * 1000), agora), true);
  assert.equal(o.ottWebChosenValid(String(agora - 11 * 3600 * 1000), agora), true);
  assert.equal(o.ottWebChosenValid(String(agora - 13 * 3600 * 1000), agora), false);
  assert.equal(o.ottWebChosenValid(null, agora), false);
  assert.equal(o.ottWebChosenValid("1", agora), false);
  assert.equal(o.ottWebChosenValid("abc", agora), false);
  assert.equal(o.ottWebChosenValid(String(agora + 3600 * 1000 * 5), agora), false); // relógio no futuro: não confia
});

test("as chaves do app web não colidem com as do app nativo", () => {
  const o = loadOtt();
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  assert.match(html, /sint_web_install/);
  assert.match(html, /sintoniza_painel_sessao/);
  assert.ok(o.OTT_KEYS.TOKEN === "sint_ott_token");
});

// ── Marcação e ligações do script principal (o app nativo não pode mudar) ──
const html = readFileSync(LINK_HTML_PATH, "utf8");
const fnBody = (nome) => {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i > 0, "falta a função " + nome);
  return html.slice(i, i + 2600);
};

test("isWebApp usa o caminho /app fora do app nativo e liga a conta (ottEnabled)", () => {
  assert.match(fnBody("isWebApp"), /ottIsWebPath\(location\.pathname, isNativeApp\(\)\)/);
  assert.match(fnBody("ottEnabled"), /isNativeApp\(\) \|\| isWebApp\(\) \|\| q\.has\("ott"\)/);
});

test("os dois scripts do head usam a mesma regra do app web e não quebram o que já existia", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  const scripts = [...head.matchAll(/<script>(\(function[^<]*)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) {
    assert.ok(s.includes("/^\\/app(\\/|$)/.test(location.pathname)"));
    assert.match(s, /window\.Capacitor/);
    assert.match(s, /noott/);
  }
  assert.match(scripts[0], /web-standalone/);
  assert.match(scripts[1], /sint_web_chosen/);
  assert.match(scripts[1], /sessionStorage\.getItem\("sint_profile_chosen"\)/); // o nativo segue com sessionStorage
});

test("sem token no app web não há tela de código: ottBeginActivation entrega ao webBoot", () => {
  assert.match(fnBody("ottBeginActivation"), /^function ottBeginActivation\(\) \{\r?\n  if \(isWebApp\(\)\) \{ webBoot\(\); return; \}/);
  const boot = fnBody("webBoot");
  assert.match(boot, /ottWebParseSession\(localStorage\.getItem\(OTT_WEB_KEYS\.SESSION\)\)/);
  assert.match(boot, /webGoLogin\(\)/);
  assert.match(boot, /ottWebRegister\(/);
  assert.doesNotMatch(boot, /ottDeviceStart|ottShowActivation/);
  assert.match(fnBody("webGoLogin"), /"\/\?next=" \+ encodeURIComponent\("\/app\/"\)/);
});

test("device_config unknown_device apaga o token e repete o webBoot (ottApplyDecision -> ottBeginActivation)", () => {
  assert.match(html, /else if \(d\.screen === "restart"\) \{ localStorage\.removeItem\(OTT_KEYS\.TOKEN\); ottBeginActivation\(\); \}/);
});

test("Sair no modo web: desvincula o aparelho, apaga a sessão e volta para o site", () => {
  assert.match(fnBody("ottUnlink"), /if \(isWebApp\(\)\) \{ webSignOut\(\); return; \}/);
  const out = fnBody("webSignOut");
  assert.match(out, /ottDeviceUnlink/);
  assert.match(out, /OTT_WEB_KEYS\.SESSION/);
  assert.match(out, /ottWebLogout/);
  assert.match(out, /OTT_WEB_KEYS\.SIGNED_OUT, "1"/);
  assert.match(out, /location\.replace\("\/"\)/);
  assert.match(html, /id="ott-unlink-btn"/); // o mesmo botão: vira "Sair" só no modo web
  assert.match(html, /getElementById\("ott-unlink-btn"\)\.textContent = "Sair"/);
});

test("conta e painel apontam para /conta (mesma origem) no app web", () => {
  assert.match(html, /accountLink\.href = "\/conta";/);
  assert.match(html, /panelLink\.href = isWebApp\(\) \? "\/conta" : _ott\.cfg\.panelUrl;/);
});

test("todo acesso a provedor no app web passa por webFetchRouted/webUrl (lista, Xtream, EPG, sondagens, vídeo, HLS e MPEG-TS)", () => {
  // dados: direto primeiro, proxy só se falhar (webFetchRouted); o nativo segue com proxyIfInsecure/fetch simples
  assert.match(html, /isWebApp\(\) \? await webFetchRouted\(url, \{ cache: "no-cache" \}\) : await fetch\(proxyIfInsecure\(url\), \{ cache: "no-cache" \}\)/);
  assert.match(html, /isWebApp\(\) \? await webFetchRouted\(epgUrl, \{ cache: "no-store" \}\) : await fetch\(proxyIfInsecure\(epgUrl\), \{ cache: "no-store" \}\)/);
  assert.match(html, /const proxied = web \? EPGSHARE01_URL : proxyForCors\(EPGSHARE01_URL\)/);
  assert.match(html, /routed \? await webFetchRouted\(url, \{ cache: "no-store" \}\) : await fetch\(url, \{ cache: "no-store" \}\)/);
  assert.equal((html.match(/await webFetchRouted\(url\);/g) || []).length, 2); // categorias e itens do catálogo
  assert.match(html, /await webFetchRouted\(xtreamApiUrl\(creds, "get_series_info"/);
  assert.match(html, /webFetchRouted\(hlsAlternative, probeInit, "hls", \{ directTimeoutMs: 2500 \}\)/);
  assert.match(html, /webFetchRouted\(url, headInit, undefined, \{ directTimeoutMs: 2500 \}\)/);
  assert.match(html, /webFetchRouted\(url, probeInit, undefined, \{ directTimeoutMs: 3000 \}\)/);
  // mídia e streams: o plano de rota decide direto x proxy
  assert.match(html, /const media = isWebApp\(\) \? webMediaSrc\(url, forceProxy === true\) : \{ src: url, direct: false \};/);
  assert.match(html, /await webHlsPlan\(streamInfo\.url\)/);
  assert.match(html, /webStreamPlan\(streamInfo\.url\)/);
  assert.match(html, /webMediaSrc\(streamInfo\.url, false, "hls"\)/);
  assert.match(html, /playUrl = proxyIfInsecure\(streamInfo\.url\);/); // o nativo continua como era
  // nenhum fetch/src de provedor chama webUrl direto fora do módulo de rotas
  assert.doesNotMatch(html, /fetch\(isWebApp\(\) \? webUrl\(/);
  assert.doesNotMatch(html, /fetch\(webUrl\(/);
  assert.doesNotMatch(html, /video\.src = isWebApp\(\) \? webUrl\(/);
});

test("v16: a memória por host é gravada com lsSet em sint_web_hosts; os contadores ficam em window.__sintWeb", () => {
  assert.match(html, /const WEB_HOSTS_KEY = "sint_web_hosts";/);
  assert.match(fnBody("webMemSet"), /lsSet\(WEB_HOSTS_KEY, /);
  assert.doesNotMatch(html, /localStorage\.setItem\(WEB_HOSTS_KEY/);
  assert.match(fnBody("webCount"), /window\.__sintWeb \|\| \(window\.__sintWeb = \{ direto: 0, proxy: 0, fallback: 0 \}\)/);
  assert.match(fnBody("webCount"), /console\.debug\(/);
});

test("v16: hls.js direto recomeça pelo proxy uma vez (webHlsShouldFallback) e mpegts.js também; fora do modo web nada muda", () => {
  assert.match(html, /webHlsShouldFallback\(\{ direct: webDirect, started: webStarted, fellBack: webFellBack/);
  assert.match(html, /webRestartViaProxy\(url, streamInfo\.url\)/);
  assert.match(html, /manifestLoadingMaxRetry: webDirect \? 2 : 8/);
  assert.match(html, /if \(webDirect && !webStarted && !webFellBack && errorType === mpegts\.ErrorTypes\.NETWORK_ERROR\)/);
  // todas as funções novas de rede começam por isWebApp()/proxied === url: o app nativo e a TV não passam por elas
  assert.match(fnBody("webFetchRouted"), /if \(!isWebApp\(\) \|\| proxied === url\) return fetch\(url, init\);/);
  assert.match(fnBody("webHlsPlan"), /if \(!isWebApp\(\) \|\| proxied === url\)/);
  assert.match(fnBody("webStreamPlan"), /if \(!isWebApp\(\) \|\| proxied === url\)/);
  assert.match(fnBody("webMediaSrc"), /if \(!isWebApp\(\) \|\| proxied === url\)/);
});

test("webUrl é um ponto único: token do aparelho, só destinos de provedor, URL absoluta", () => {
  const f = fnBody("webUrl");
  assert.match(f, /isWebApp\(\)/);
  assert.match(f, /localStorage\.getItem\(OTT_KEYS\.TOKEN\)/);
  assert.match(f, /ottWebShouldProxy\(url, webOwnOrigins\(\)\)/);
  assert.match(f, /location\.origin \+ ottWebProxy\(url, token, kind\)/);
});

test("tela cheia no iPhone/atalho usa a de CSS; o app nativo segue igual", () => {
  assert.match(fnBody("toggleFullscreen"), /isNativeApp\(\) \|\| \(isWebApp\(\) && webUsesPseudoFullscreen\(isIOSDevice\(\), isStandaloneDisplay\(\)\)\)/);
});

test("perfil: no app web a escolha vale 12 h no localStorage; o nativo segue no sessionStorage", () => {
  const f = fnBody("profileChosenRead");
  assert.match(f, /isWebApp\(\)\) return ottWebChosenValid\(localStorage\.getItem\(OTT_WEB_KEYS\.CHOSEN\), Date\.now\(\)\)/);
  assert.match(f, /sessionStorage\.getItem\(PROFILE_CHOSEN_KEY\) === "1"/);
  assert.match(fnBody("profileMarkChosen"), /OTT_WEB_KEYS\.CHOSEN, String\(Date\.now\(\)\)/);
});

test("localStorage robusto: as escritas listadas passam por lsSet", () => {
  for (const k of ['profKey("sint_recents")', 'profKey("sint_fav")', "LS.EPG_CACHE", "profKey(CONTINUE_KEY)", "profKey(MYLIST_KEY)", "DOWNLOADS_KEY", "OTT_KEYS.TOKEN", "OTT_KEYS.LAST_OK", "OTT_KEYS.ACCOUNT", "LS.PROXY", "LS.FIT"]) {
    const direto = html.split("localStorage.setItem(" + k).length - 1;
    assert.equal(direto, 0, "ainda grava direto: " + k);
    assert.ok(html.includes("lsSet(" + k), "falta lsSet para " + k);
  }
});

test("o app web liga volume, atalhos e carrosséis só com isWebApp(); volume só no computador", () => {
  assert.match(html, /if \(isWebApp\(\)\) webWire\(\{ togglePlayPause \}\);/);
  assert.match(fnBody("forceMaxVolume"), /if \(webVolumeControlOn\(\)\) \{ webApplyVolume\(video\); return; \}/);
  assert.match(fnBody("webVolumeControlOn"), /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(html, /@media \(hover: hover\) and \(pointer: fine\) \{\s*html\[data-web-app\] \.web-volume/);
});

test("nenhuma referência a ott*/Web* fora de funções nos blocos novos do script principal", () => {
  const main = html.slice(html.lastIndexOf("<script>"));
  const topLevel = main.split(/\r?\n/).filter((l) => /^(?:const|let|var) /.test(l) && /\b(ott[A-Z]\w*|OTT_\w+|isWebApp|webUrl|webBoot)\b/.test(l));
  // só declarações que usam ott* dentro de função/arrow ou literais já existentes antes do app web
  for (const l of topLevel) assert.doesNotMatch(l, /ottWeb|OTT_WEB|isWebApp|webUrl|webBoot/, l);
});

test("registro: erro técnico (não 400) vira mensagem amigável e não vaza texto em inglês do servidor", async () => {
  const o = loadOtt();
  const inst = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const naoExiste = fakeFetch(() => ({ status: 404, body: { message: "Could not find the function public.web_device_register" } }));
  await assert.rejects(o.ottWebRegister(cfg, "JWT", inst, {}, naoExiste), (e) => e.kind === "business" && /Tente de novo/.test(e.message) && !/Could not/.test(e.message));
  const vencido = fakeFetch(() => ({ status: 401, body: { message: "JWT expired" } }));
  await assert.rejects(o.ottWebRegister(cfg, "JWT", inst, {}, vencido), (e) => e.kind === "login");
});

// ── Troca de conta no mesmo navegador: os dados da conta anterior NÃO podem aparecer na nova ──
const DADOS_DA_CONTA_A = {
  sint_ott_token: "TOKEN_A", sint_ott_last_ok: "1", sint_ott_account: '{"nome":"Admin"}', sint_ott_config: "{}",
  sint_profile_active: "aaaaaaaa-1111", sint_profiles: '[{"id":"aaaaaaaa-1111","nome":"Admin"}]', sint_profiles_migrated: "1",
  sint_paaaaaaaa_fav: '["ESPN"]', sint_paaaaaaaa_recents: "[]", sint_paaaaaaaa_continue: "[]", sint_paaaaaaaa_favsync: "{}",
  sint_fav: '["antigo"]', sint_recents: "[]", sint_continue: "[]",
  sint_url: "http://lista", sint_mode: "url", sint_vod_url: "http://vod", sint_epg_url: "http://epg",
  sint_web_chosen: "x",
};
const DADOS_DO_NAVEGADOR = { sint_web_install: "inst-0123456789abcdef", sint_view: "grid", sint_fit: "cover", sint_web_volume: '{"v":0.5}', sint_web_hosts: "{}", sint_proxy: "https://p" };

test("conta diferente da última: apaga perfis, favoritos, recentes, token e lista da conta anterior e guarda o novo dono", () => {
  const o = loadOtt();
  const s = fakeStorage({ ...DADOS_DA_CONTA_A, ...DADOS_DO_NAVEGADOR, sint_web_owner: "admin-id" });
  assert.equal(o.ottWebOwnerSwitch(s, "novo-id"), true);
  for (const k of Object.keys(DADOS_DA_CONTA_A)) assert.equal(s.getItem(k), null, k + " deveria ter sido apagada");
  for (const k of Object.keys(DADOS_DO_NAVEGADOR)) assert.equal(s.getItem(k), DADOS_DO_NAVEGADOR[k], k + " é do navegador e deve ficar");
  assert.equal(s.getItem("sint_web_owner"), "novo-id");
});

test("mesma conta: não apaga nada", () => {
  const o = loadOtt();
  const s = fakeStorage({ ...DADOS_DA_CONTA_A, ...DADOS_DO_NAVEGADOR, sint_web_owner: "admin-id" });
  assert.equal(o.ottWebOwnerSwitch(s, "admin-id"), false);
  for (const k of Object.keys(DADOS_DA_CONTA_A)) assert.equal(s.getItem(k), DADOS_DA_CONTA_A[k], k);
});

test("sem dono guardado (navegador de antes desta correção): apaga e passa a guardar o dono", () => {
  const o = loadOtt();
  const s = fakeStorage({ ...DADOS_DA_CONTA_A, ...DADOS_DO_NAVEGADOR });
  assert.equal(o.ottWebOwnerSwitch(s, "u1"), true);
  assert.equal(s.getItem("sint_profiles"), null);
  assert.equal(s.getItem("sint_web_owner"), "u1");
  assert.equal(s.getItem("sint_web_install"), DADOS_DO_NAVEGADOR.sint_web_install);
});

test("sem id de usuário na sessão: não mexe em nada (nunca apaga por falta de informação)", () => {
  const o = loadOtt();
  const s = fakeStorage({ ...DADOS_DA_CONTA_A, sint_web_owner: "admin-id" });
  assert.equal(o.ottWebOwnerSwitch(s, ""), false);
  assert.equal(o.ottWebOwnerSwitch(s, undefined), false);
  assert.equal(s.getItem("sint_profiles"), DADOS_DA_CONTA_A.sint_profiles);
});

test("armazenamento que lança erro não derruba a entrada", () => {
  const o = loadOtt();
  const ruim = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } };
  assert.doesNotThrow(() => o.ottWebOwnerSwitch(ruim, "u1"));
});

test("o 'Sair' do app e o do site apagam os mesmos dados da conta", () => {
  const o = loadOtt();
  const s = fakeStorage({ ...DADOS_DA_CONTA_A, ...DADOS_DO_NAVEGADOR, sint_web_owner: "admin-id", sintoniza_painel_sessao: "{}" });
  o.ottWebWipeAccountData(s);
  for (const k of Object.keys(DADOS_DA_CONTA_A)) assert.equal(s.getItem(k), null, k);
  assert.equal(s.getItem("sint_web_owner"), null);
  assert.equal(s.getItem("sint_web_install"), DADOS_DO_NAVEGADOR.sint_web_install);
  assert.equal(s.getItem("sint_view"), "grid");
});

test("navegador virgem (sem dono e sem dados de conta): só guarda o dono, sem apagar nem pedir recarga", () => {
  const o = loadOtt();
  const s = fakeStorage({ ...DADOS_DO_NAVEGADOR });
  assert.equal(o.ottWebOwnerSwitch(s, "u1"), false);
  assert.equal(s.getItem("sint_web_owner"), "u1");
  assert.equal(s.getItem("sint_web_install"), DADOS_DO_NAVEGADOR.sint_web_install);
  assert.equal(o.ottWebOwnerSwitch(s, "u1"), false);
});
