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
  // catálogo Xtream (categorias, itens, info de série): tudo passa por vodApiFetch, que chama webFetchRouted uma vez só, limita a
  // concorrência e repete 429/5xx (o xjet.fun devolvia 500/429 quando as 38 categorias saíam de uma vez)
  assert.equal((html.match(/await webFetchRouted\(url\);/g) || []).length, 1);
  assert.equal((html.match(/await vodApiFetch\(url\);/g) || []).length, 2); // categorias e itens do catálogo
  assert.match(html, /await vodApiFetch\(xtreamApiUrl\(creds, "get_series_info"/);
  assert.match(html, /const VOD_API_CONCURRENCY = 4;/);
  assert.match(html, /if \(\(res\.status !== 429 && res\.status < 500\) \|\| n >= VOD_API_RETRY_MS\.length\) return res;/);
  assert.match(html, /webFetchRouted\(hlsAlternative, probeInit, "hls", \{ directTimeoutMs: 6000, noMemory: true \}\)/); // a sondagem não grava a memória do host
  assert.match(html, /if \(!\(opts && opts\.noMemory\)\) webMemSet\(url, "data", "d"\);/);
  assert.match(html, /if \(res\.ok && !\(opts && opts\.noMemory\)\) webMemSet\(url, "data", "p"\);/);
  assert.match(html, /webFetchRouted\(url, headInit, undefined, \{ directTimeoutMs: 2500 \}\)/);
  assert.match(html, /webFetchRouted\(url, probeInit, undefined, \{ directTimeoutMs: 3000 \}\)/);
  // mídia e streams: o plano de rota decide direto x proxy
  assert.match(html, /const media = webMediaSrc\(url, forceProxy === true\);/); // tryDirectPlay (a escolha vai para tryDirectPlayWith, com a resolução do endereço final)
  assert.match(html, /if \(!isWebApp\(\)\) \{ tryDirectPlayWith\(url, video, attempt, gen, forceProxy, \{ src: url, direct: false \}\); return; \}/);
  assert.match(html, /await webHlsPlan\(streamInfo\.url\)/);
  assert.match(html, /webStreamPlan\(streamInfo\.url\)/);
  assert.match(html, /webMediaSrc\(streamInfo\.url, false, "hls"\)/);
  assert.match(html, /playUrl = proxyIfInsecure\(streamInfo\.url\);/); // o nativo continua como era
  // nenhum fetch/src de provedor chama webUrl direto fora do módulo de rotas
  assert.doesNotMatch(html, /fetch\(isWebApp\(\) \? webUrl\(/);
  assert.doesNotMatch(html, /fetch\(webUrl\(/);
  assert.doesNotMatch(html, /video\.src = isWebApp\(\) \? webUrl\(/);
});

test("endereço final resolvido pelo proxy (k=resolve): só vira https o que tem certificado possível; o resto fica no proxy", async () => {
  const vm = await import("node:vm");
  const i = html.indexOf("function webUpgradeToHttps(");
  assert.ok(i > 0, "falta webUpgradeToHttps");
  const fim = i + html.slice(i).search(/\r?\n\}\r?\n/) + 3; // o arquivo pode ter quebra de linha CRLF
  const ctx = vm.createContext({ URL });
  vm.runInContext(html.slice(i, fim) + "\n;this.f = webUpgradeToHttps;", ctx);
  const up = (u) => ctx.f(u);
  assert.equal(up("http://s2.fofura.top:80/auth/abc"), "https://s2.fofura.top/auth/abc"); // porta 80 → https sem porta
  assert.equal(up("http://vod.exemplo.fun/Filmes/a.mp4"), "https://vod.exemplo.fun/Filmes/a.mp4");
  assert.equal(up("https://ja.https.exemplo/x.ts"), "https://ja.https.exemplo/x.ts");
  assert.equal(up("http://209.14.88.180/x.mp4"), null); // IP puro não tem certificado válido
  assert.equal(up("http://exemplo.com:8080/x.ts"), null); // porta diferente de 80: não adivinha
  assert.equal(up("lixo"), null);
  assert.equal(up(undefined), null);
  // o proxy resolve (k=resolve) e o app só usa isso fora do plano direto; falha do endereço final cai no proxy normal
  assert.match(html, /const pedido = webUrl\(url, "resolve"\);/);
  assert.match(html, /const final = await webResolveFinal\(streamInfo\.url\);/);
  assert.match(html, /if \(webResolvedDirect\) _webResolveFail\.set\(streamInfo\.url, Date\.now\(\)\);/);
  assert.match(html, /webResolveFinal\(url\)\.then\(\(final\) => \{/);
  assert.match(html, /if \(media\.resolved\) _webResolveFail\.set\(url, Date\.now\(\)\);/);
  // a sondagem do espelho .m3u8 não se repete por canal depois que o host mostrou que não tem HLS
  assert.match(html, /if \(probeNoHlsKnown\(url\)\) return \{ type: "mpegts", url \};/);
  assert.match(html, /if \(probeRes\.ok && !ehManifesto\) probeNoHlsMark\(url\);/);
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

// ── iPhone/iPad no app web: HLS nativo (AVPlayer) em vez de hls.js sobre ManagedMediaSource ──
test("iPhone/iPad com HLS nativo: prefere o nativo; Android/computador seguem no hls.js", () => {
  const o = loadOtt();
  assert.equal(o.ottWebPreferNativeHls(true, true, false), true);   // iPhone, Safari sabe tocar HLS
  assert.equal(o.ottWebPreferNativeHls(false, true, false), false); // Android/Chrome/computador: hls.js
  assert.equal(o.ottWebPreferNativeHls(true, false, false), false); // iOS sem HLS nativo: hls.js
});

test("se o nativo falhou neste canal, volta para o hls.js (uma vez)", () => {
  const o = loadOtt();
  assert.equal(o.ottWebPreferNativeHls(true, true, true), false);
});

// ── webResolveFinal: repetição em 429/5xx no último salto (provedor limitando conexão) ──
test("webResolveFinal: constante WEB_RESOLVE_RETRY_MS existe com [700, 1500]", () => {
  assert.match(html, /const\s+WEB_RESOLVE_RETRY_MS\s*=\s*\[\s*700\s*,\s*1500\s*\];/);
});

const makeResolveRunner = async (opts = {}) => {
  const vm = await import("node:vm");
  const i = html.indexOf("const _webResolved = new Map();");
  assert.ok(i > 0, "falta _webResolved");
  const fim = html.indexOf("// Mídia em <video src>");
  assert.ok(fim > i, "falta fim do bloco webResolveFinal");
  const code = html.slice(i, fim);

  const fetchCalls = [];
  const delays = [];
  const queue = [...(opts.responses || [])];

  const ctx = vm.createContext({
    isWebApp: () => (opts.isWebApp !== undefined ? opts.isWebApp : true),
    webUrl: opts.webUrl || ((u, k) => "/api/proxy?k=" + k + "&u=" + encodeURIComponent(u)),
    fetch: async (u, reqOpts) => {
      fetchCalls.push({ u, reqOpts });
      if (opts.fetchThrows) throw new Error("rede indisponível");
      const next = queue.shift();
      if (!next) throw new Error("sem resposta no stub");
      if (next instanceof Error) throw next;
      return next;
    },
    AbortController,
    setTimeout: (fn, ms) => {
      delays.push(ms);
      if (ms >= 5000) return 0;
      if (typeof opts.onTimeout === "function") opts.onTimeout(ms, delays.length);
      fn();
      return 0;
    },
    clearTimeout: () => {},
    Date,
    Map,
    URL,
    JSON,
    Promise,
  });

  vm.runInContext(code + "\n;this.webResolveFinal = webResolveFinal; this._webResolved = _webResolved; this._webResolveFail = _webResolveFail;", ctx);
  return { ctx, fetchCalls, delays };
};

test("webResolveFinal: 429, 429 e depois 200 repete 2 vezes e devolve https (3 chamadas)", async () => {
  const url = "http://prov.test:8080/live/x";
  const okJson = { status: 200, url: "http://s2.exemplo.top:80/auth/x" };
  const { ctx, fetchCalls, delays } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => okJson },
    ],
  });
  const res = await ctx.webResolveFinal(url);
  assert.equal(res, "https://s2.exemplo.top/auth/x");
  assert.equal(fetchCalls.length, 3);
  assert.deepEqual(delays.filter((ms) => ms < 5000), [700, 1500]);
});

test("webResolveFinal: 200 na primeira tentativa devolve https e usa cache na segunda (1 chamada no total)", async () => {
  const url = "http://prov.test:8080/live/x";
  const okJson = { status: 200, url: "http://s2.exemplo.top:80/auth/x" };
  const { ctx, fetchCalls } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => okJson },
    ],
  });
  const res1 = await ctx.webResolveFinal(url);
  assert.equal(res1, "https://s2.exemplo.top/auth/x");
  assert.equal(fetchCalls.length, 1);
  const res2 = await ctx.webResolveFinal(url);
  assert.equal(res2, "https://s2.exemplo.top/auth/x");
  assert.equal(fetchCalls.length, 1);
});

test("webResolveFinal: 429 nas 3 tentativas devolve null e não grava cache (total 6 chamadas em 2 invocações)", async () => {
  const url = "http://prov.test:8080/live/x";
  const { ctx, fetchCalls } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 429, url }) },
    ],
  });
  const res1 = await ctx.webResolveFinal(url);
  assert.equal(res1, null);
  assert.equal(fetchCalls.length, 3);
  assert.equal(ctx._webResolved.has(url), false);

  const res2 = await ctx.webResolveFinal(url);
  assert.equal(res2, null);
  assert.equal(fetchCalls.length, 6);
  assert.equal(ctx._webResolved.has(url), false);
});

test("webResolveFinal: 404 do último salto devolve null sem repetir (1 chamada)", async () => {
  const url = "http://prov.test:8080/live/x";
  const { ctx, fetchCalls } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 404, url }) },
    ],
  });
  const res = await ctx.webResolveFinal(url);
  assert.equal(res, null);
  assert.equal(fetchCalls.length, 1);
});

test("webResolveFinal: res.ok === false (proxy fora) devolve null sem repetir (1 chamada)", async () => {
  const url = "http://prov.test:8080/live/x";
  const { ctx, fetchCalls } = await makeResolveRunner({
    responses: [
      { ok: false, status: 502, json: async () => ({}) },
    ],
  });
  const res = await ctx.webResolveFinal(url);
  assert.equal(res, null);
  assert.equal(fetchCalls.length, 1);
});

test("webResolveFinal: resposta com url igual à de entrada ou IP puro devolve null", async () => {
  const url = "http://prov.test:8080/live/x";
  const { ctx: ctx1 } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 200, url }) },
    ],
  });
  assert.equal(await ctx1.webResolveFinal(url), null);

  const { ctx: ctx2 } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 200, url: "http://192.168.1.10:80/auth/x" }) },
    ],
  });
  assert.equal(await ctx2.webResolveFinal(url), null);
});

test("webResolveFinal: 5xx no último salto repete até 2 vezes", async () => {
  const url = "http://prov.test:8080/live/x";
  const okJson = { status: 200, url: "http://s2.exemplo.top:80/auth/x" };
  const { ctx, fetchCalls } = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 502, url }) },
      { ok: true, json: async () => ({ status: 500, url }) },
      { ok: true, json: async () => okJson },
    ],
  });
  const res = await ctx.webResolveFinal(url);
  assert.equal(res, "https://s2.exemplo.top/auth/x");
  assert.equal(fetchCalls.length, 3);
});

test("webResolveFinal entradas inválidas: json sem url ou status, fetch que lança, webUrl sem proxy", async () => {
  const url = "http://prov.test:8080/live/x";

  // JSON sem url
  const { ctx: ctxSemUrl, fetchCalls: fSemUrl } = await makeResolveRunner({
    responses: [{ ok: true, json: async () => ({ status: 200 }) }],
  });
  assert.equal(await ctxSemUrl.webResolveFinal(url), null);
  assert.equal(fSemUrl.length, 1);

  // JSON sem status
  const { ctx: ctxSemStatus, fetchCalls: fSemStatus } = await makeResolveRunner({
    responses: [{ ok: true, json: async () => ({ url: "http://s2.exemplo.top:80/auth/x" }) }],
  });
  assert.equal(await ctxSemStatus.webResolveFinal(url), null);
  assert.equal(fSemStatus.length, 1);

  // fetch que lança exceção
  const { ctx: ctxErro, fetchCalls: fErro } = await makeResolveRunner({
    fetchThrows: true,
  });
  assert.equal(await ctxErro.webResolveFinal(url), null);
  assert.equal(fErro.length, 1);

  // webUrl devolve a própria URL (sem token do aparelho)
  const { ctx: ctxSemToken, fetchCalls: fSemToken } = await makeResolveRunner({
    webUrl: (u) => u,
  });
  assert.equal(await ctxSemToken.webResolveFinal(url), null);
  assert.equal(fSemToken.length, 0);
});

test("webResolveFinal: interrompe repetições se webResolveFailed virar verdadeiro", async () => {
  const url = "http://prov.test:8080/live/x";
  let runner;
  runner = await makeResolveRunner({
    responses: [
      { ok: true, json: async () => ({ status: 429, url }) },
      { ok: true, json: async () => ({ status: 200, url: "http://s2.exemplo.top:80/auth/x" }) },
    ],
    onTimeout: () => {
      runner.ctx._webResolveFail.set(url, Date.now());
    },
  });
  const res = await runner.ctx.webResolveFinal(url);
  assert.equal(res, null);
  assert.equal(runner.fetchCalls.length, 1);
});

// ── webRestartViaProxy / canais mortos: proxy forçado uma vez sem envenenar a memória ──
test("webRestartViaProxy: não grava 'p' imediatamente e usa _webForceProxyDataUrl para a próxima tentativa", () => {
  const restartBody = fnBody("webRestartViaProxy");
  assert.doesNotMatch(restartBody, /webMemSet\(hostUrl,\s*"data",\s*"p"\)/);
  assert.match(restartBody, /_webForceProxyDataUrl\s*=\s*hostUrl/);
  assert.match(html, /let\s+_webForceProxyDataUrl\s*=\s*null;/);
  assert.match(fnBody("webStreamPlan"), /_webForceProxyDataUrl\s*===\s*url/);
  assert.match(fnBody("webStreamPlan"), /forced:\s*true/);
  assert.match(fnBody("webHlsPlan"), /_webForceProxyDataUrl\s*===\s*url/);
  assert.match(fnBody("webHlsPlan"), /forced:\s*true/);
  assert.match(html, /mpegtsPlayer\.on\(mpegts\.Events\.MEDIA_INFO,\s*\(\)\s*=>\s*\{[\s\S]*?(?:webForced\s*\|\|\s*webResolvedDirect)[\s\S]*?webMemSet\(streamInfo\.url,\s*"data",\s*"p"\)/);
  assert.match(html, /hlsInstance\.on\(Hls\.Events\.FRAG_LOADED,\s*\(\)\s*=>\s*\{[\s\S]*?webForced[\s\S]*?webMemSet\(streamInfo\.url,\s*"data",\s*"p"\)/);
});

test("webStreamPlan: canal morto não grava 'p'; força proxy uma vez por URL e descarta", async () => {
  const vm = await import("node:vm");
  const i = html.indexOf("function webStreamPlan(");
  assert.ok(i > 0, "falta webStreamPlan");
  const fim = i + html.slice(i).search(/\r?\n\}\r?\n/) + 3;
  const code = html.slice(i, fim);

  let proxyCalls = 0;
  const makeCtx = (opts = {}) => {
    const ctx = vm.createContext({
      isWebApp: () => (opts.isWebApp !== undefined ? opts.isWebApp : true),
      webUrl: opts.webUrl || ((u) => "/api/proxy?u=" + u),
      webRoute: () => (opts.webRoute !== undefined ? opts.webRoute : "direct"),
      webMemLoad: () => ({}),
      webPageIsHttps: () => true,
      webCount: (name) => { if (name === "proxy") proxyCalls++; },
      webHost: () => "h",
      Date,
      _webForceProxyDataUrl: opts._webForceProxyDataUrl !== undefined ? opts._webForceProxyDataUrl : null,
    });
    vm.runInContext(code + "\n;this.webStreamPlan = webStreamPlan; this.getForce = () => _webForceProxyDataUrl; this.setForce = (v) => { _webForceProxyDataUrl = v; };", ctx);
    return ctx;
  };

  const url = "https://xjet.fun/live/1.ts";
  const ctx = makeCtx();

  // (a) sem força → { src: url, direct: true }
  assert.deepEqual(plain(ctx.webStreamPlan(url)), { src: url, direct: true });
  assert.equal(ctx.getForce(), null);

  // (b) com _webForceProxyDataUrl = url → devolve proxy com forced: true e a variável fica null
  ctx.setForce(url);
  assert.deepEqual(plain(ctx.webStreamPlan(url)), {
    src: "/api/proxy?u=" + url,
    direct: false,
    forced: true,
  });
  assert.equal(ctx.getForce(), null);

  // uma segunda chamada volta a ser direta (consumido uma vez)
  assert.deepEqual(plain(ctx.webStreamPlan(url)), { src: url, direct: true });

  // (c) com força para OUTRA url → ignora e segue direto
  const outraUrl = "https://xjet.fun/live/outra.ts";
  ctx.setForce(outraUrl);
  assert.deepEqual(plain(ctx.webStreamPlan(url)), { src: url, direct: true });
  assert.equal(ctx.getForce(), outraUrl);

  // Entradas inválidas:
  // _webForceProxyDataUrl nulo ou diferente da URL pedida (ignora)
  ctx.setForce(null);
  assert.deepEqual(plain(ctx.webStreamPlan(url)), { src: url, direct: true });
  ctx.setForce("https://invalida.test");
  assert.deepEqual(plain(ctx.webStreamPlan(url)), { src: url, direct: true });

  // webStreamPlan com URL vazia/sem token (webUrl devolve a própria URL → { src: url, direct: false } como hoje)
  const ctxSemToken = makeCtx({ webUrl: (u) => u });
  assert.deepEqual(plain(ctxSemToken.webStreamPlan("")), { src: "", direct: false });
  assert.deepEqual(plain(ctxSemToken.webStreamPlan(url)), { src: url, direct: false });
  ctxSemToken.setForce(url);
  assert.deepEqual(plain(ctxSemToken.webStreamPlan(url)), { src: url, direct: false });
});

test("webHlsPlan: se _webForceProxyDataUrl === url devolve proxy com forced: true e zera a variável", async () => {
  const vm = await import("node:vm");
  const i = html.indexOf("async function webHlsPlan(");
  assert.ok(i > 0, "falta webHlsPlan");
  const fim = i + html.slice(i).search(/\r?\n\}\r?\n/) + 3;
  const code = html.slice(i, fim);

  let probeCalls = 0;
  let proxyCounts = 0;
  const makeCtx = (opts = {}) => {
    const ctx = vm.createContext({
      isWebApp: () => (opts.isWebApp !== undefined ? opts.isWebApp : true),
      webUrl: opts.webUrl || ((u, k) => "/api/proxy?k=" + k + "&u=" + u),
      webRoute: () => (opts.webRoute !== undefined ? opts.webRoute : "direct"),
      webMemLoad: () => ({}),
      webPageIsHttps: () => true,
      webCount: (name) => { if (name === "proxy") proxyCounts++; },
      webHost: () => "h",
      webHlsProbe: async () => { probeCalls++; return true; },
      webMemSet: () => {},
      Date,
      _webForceProxyDataUrl: opts._webForceProxyDataUrl !== undefined ? opts._webForceProxyDataUrl : null,
    });
    vm.runInContext(code + "\n;this.webHlsPlan = webHlsPlan; this.getForce = () => _webForceProxyDataUrl; this.setForce = (v) => { _webForceProxyDataUrl = v; };", ctx);
    return ctx;
  };

  const url = "https://xjet.fun/live/1.m3u8";
  const ctx = makeCtx();

  // Sem força: direto
  const p1 = await ctx.webHlsPlan(url);
  assert.deepEqual(plain(p1), { src: url, direct: true });
  assert.equal(ctx.getForce(), null);

  // Com força para a URL: proxy com forced: true e consome uma vez
  ctx.setForce(url);
  const p2 = await ctx.webHlsPlan(url);
  assert.deepEqual(plain(p2), { src: "/api/proxy?k=hls&u=" + url, direct: false, forced: true });
  assert.equal(ctx.getForce(), null);

  // Próxima chamada volta a ser direta
  const p3 = await ctx.webHlsPlan(url);
  assert.deepEqual(plain(p3), { src: url, direct: true });

  // Com força para outra URL: ignora
  ctx.setForce("https://xjet.fun/live/outra.m3u8");
  const p4 = await ctx.webHlsPlan(url);
  assert.deepEqual(plain(p4), { src: url, direct: true });
  assert.equal(ctx.getForce(), "https://xjet.fun/live/outra.m3u8");

  // Entrada inválida: sem token (webUrl devolve a URL original)
  const ctxSemToken = makeCtx({ webUrl: (u) => u });
  ctxSemToken.setForce(url);
  const p5 = await ctxSemToken.webHlsPlan(url);
  assert.deepEqual(plain(p5), { src: url, direct: false });
});

test("host só vira 'p' quando o link NÃO tem redirecionamento (falha de um salto adiante não envenena o host)", () => {
  assert.match(html, /const _webRedirected = new Map\(\);/);
  assert.match(html, /function webChainRedirects\(url\) \{\s*return _webRedirected\.get\(url\) === true;/);
  assert.match(html, /_webRedirected\.set\(url, j\.url !== url\)/);
  assert.match(html, /\(webForced \|\| webResolvedDirect\) && !webChainRedirects\(streamInfo\.url\)\) webMemSet\(streamInfo\.url, "data", "p"\)/);
});
