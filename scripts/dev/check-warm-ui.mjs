// Verifica no Chrome (Capacitor simulado, ?ott=1) a entrada com o seletor de perfil como primeira tela e o pré-carregamento de Filmes e Séries.
// Conta, lista de canais e provedor Xtream FINGIDOS: o fetch é trocado por um falso (preScript); QUALQUER outra URL de rede é recusada e
// registrada em __bloq (o teste falha se houver). Nenhum aparelho real é criado; o backend real não é tocado.
//   (a) 3 perfis: a primeira coisa visível é o seletor (amostrado quadro a quadro; a Início nunca aparece antes), mesmo com a rede lenta
//   (b) 1 perfil: entra direto, sem seletor; sem cache: tela de espera e depois o seletor
//   (c) o aquecimento roda em etapas (filmes, séries), duas categorias por vez; o chip aparece e some; nenhuma URL do provedor é pedida duas vezes
//   (d) a busca funciona antes (durante) e depois do aquecimento; nenhuma tarefa longa (> 80 ms) na thread com CPU 4x mais lenta
//   (e) com economia de dados (saveData) o aquecimento não roda; sem lista de filmes também não
// Uso: node scripts/dev/check-warm-ui.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";
const P = {
  A: { id: A, nome: "Ana", avatar: "padrao", padrao: true },
  B: { id: B, nome: "Bia", avatar: "pipoca", padrao: false },
  C: { id: C, nome: "Caio", avatar: "claquete", padrao: false },
};
const LISTA = "https://lista.falsa.invalid/canais.m3u";
const VOD = "http://provedor.falso.invalid:80/get.php?username=u&password=p&type=m3u_plus";
const M3U = "#EXTM3U\n" + ["Globo SP", "SBT", "ESPN"].map((n) => `#EXTINF:-1 group-title="Teste",${n}\nhttps://stream.falso.invalid/${encodeURIComponent(n)}.m3u8`).join("\n") + "\n";
const CATS_FILMES = 12, CATS_SERIES = 8, ITENS = 300, ATRASO = 250;

// Backend falso + provedor falso + semeadura (feita UMA vez por página)
function preScript(seed, opcoes) {
  return `(() => {
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    const opc = ${JSON.stringify(opcoes || {})};
    if (!localStorage.getItem("__seeded")) {
      const s = ${JSON.stringify(seed)};
      Object.keys(s.ls || {}).forEach(k => localStorage.setItem(k, s.ls[k]));
      Object.keys(s.ss || {}).forEach(k => sessionStorage.setItem(k, s.ss[k]));
      localStorage.setItem("__srv", JSON.stringify(s.srv || { perfis: [] }));
      localStorage.setItem("__bloq", "[]");
      localStorage.setItem("__seeded", "1");
    }
    if (opc.saveData) Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" }, configurable: true });
    // linha do tempo do que cobre a tela: a cada quadro, o elemento do topo no centro e se o app (page-shell) está visível
    window.__quadros = [];
    window.__prov = [];
    window.__rpcs = [];
    window.__chip = [];
    window.__long = [];
    const topo = () => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (!el) return "nada";
      if (el.closest("#profile-gate")) return "seletor";
      if (el.closest("#ott-gate")) return "ott";
      return "app";
    };
    const amostra = () => {
      try {
        const shell = document.querySelector(".page-shell");
        const appVisivel = !!shell && getComputedStyle(shell).visibility !== "hidden" && document.documentElement.classList.contains("ott-open") === false && document.documentElement.classList.contains("profile-open") === false;
        const t = topo(), l = window.__quadros;
        const k = t + (appVisivel ? "+appvisivel" : "");
        if (!l.length || l[l.length - 1].k !== k) l.push({ k, t: Math.round(performance.now()) });
      } catch (e) { /* documento ainda sem corpo */ }
      requestAnimationFrame(amostra);
    };
    requestAnimationFrame(amostra);
    try { new PerformanceObserver(list => list.getEntries().forEach(e => window.__long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }))).observe({ type: "longtask", buffered: true }); } catch (e) { /* sem longtask */ }
    document.addEventListener("DOMContentLoaded", () => {
      const chip = document.getElementById("warm-chip");
      if (chip) new MutationObserver(() => window.__chip.push({ on: chip.classList.contains("visible"), t: Math.round(performance.now()) })).observe(chip, { attributes: true, attributeFilter: ["class"] });
    });
    const realFetch = window.fetch.bind(window);
    const bloq = (url) => { const b = JSON.parse(localStorage.getItem("__bloq") || "[]"); b.push(url); localStorage.setItem("__bloq", JSON.stringify(b)); };
    const filmes = (c) => Array.from({ length: ${ITENS} }, (_, i) => ({ stream_id: c * 1000 + i, name: "Filme " + c + "-" + i + (i % 7 === 0 ? " Aventura" : " Drama"), year: String(2000 + (i % 24)), added: String(1700000000 + i), category_id: String(c), stream_icon: "", container_extension: "mp4" }));
    const series = (c) => Array.from({ length: ${ITENS} }, (_, i) => ({ series_id: c * 1000 + i, name: "Serie " + c + "-" + i + (i % 7 === 0 ? " Aventura" : " Drama"), releaseDate: (2000 + (i % 24)) + "-01-01", last_modified: String(1700000000 + i), category_id: String(c), cover: "" }));
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    window.fetch = async (url, init) => {
      url = String(url);
      if (url.endsWith("/app-config.json")) return J({ url: "https://falso.supabase.co", anonKey: "chave-falsa" });
      if (url === ${JSON.stringify(LISTA)}) return { ok: true, status: 200, text: async () => ${JSON.stringify(M3U)} };
      if (url.indexOf("https://raw.githubusercontent.com/Guaitolinii/visual-craft-assistant/vod-data/") === 0) return J({}, 404);
      if (url.indexOf("http://provedor.falso.invalid:80/player_api.php") === 0) {
        window.__prov.push({ url: url.replace(/username=u&password=p&/, ""), t: Math.round(performance.now()) });
        const q = new URL(url).searchParams;
        await espera(${ATRASO});
        const a = q.get("action");
        if (a === "get_vod_categories") return J(Array.from({ length: ${CATS_FILMES} }, (_, i) => ({ category_id: String(i + 1), category_name: "Filmes | Categoria " + (i + 1) })));
        if (a === "get_series_categories") return J(Array.from({ length: ${CATS_SERIES} }, (_, i) => ({ category_id: String(i + 1), category_name: "Séries | Categoria " + (i + 1) })));
        if (a === "get_vod_streams") return J(filmes(Number(q.get("category_id"))));
        if (a === "get_series") return J(series(Number(q.get("category_id"))));
        return J([]);
      }
      if (!url.includes("/rest/v1/rpc/")) {
        if (["file:", "data:", "blob:"].some(p => url.startsWith(p))) return realFetch(url, init);
        bloq(url);
        throw new TypeError("rede bloqueada no teste: " + url);
      }
      const nome = url.split("/rpc/")[1];
      window.__rpcs.push(nome);
      const srv = JSON.parse(localStorage.getItem("__srv"));
      if (opc.atrasoServidor) await espera(opc.atrasoServidor);
      const vod = opc.semVod ? null : ${JSON.stringify(VOD)};
      if (nome === "device_config") return J({ status: "ok", user: { nome: "Conta Teste", status: "active", acesso_fim: "2030-01-01" }, playlists: [{ id: "l1", nome: "Principal", url_m3u: ${JSON.stringify(LISTA)}, url_vod: vod, url_epg: null }] });
      if (nome === "perfil_list") return J({ status: "ok", perfis: srv.perfis });
      if (nome.indexOf("fav_") === 0) return J({ status: "ok", itens: [], total: 0 });
      return J({ status: "ok" });
    };
  })();`;
}

const base = (extra, comVod = true) => ({ sint_ott_token: "token-falso", sint_ott_last_ok: String(Date.now()), sint_url: LISTA, sint_mode: "url", ...(comVod ? { sint_vod_url: VOD } : {}), ...extra });
const cache = (...ps) => JSON.stringify(ps);
const url = (q) => pathToFileURL("sintoniza-link.html").href + q;

async function cena(titulo, seed, opts, fn) {
  console.log("— " + titulo);
  const pre = preScript(seed, opts.opcoes);
  new Function(pre); // lança SyntaxError se o fetch falso não puder ser instalado: nunca toca o backend real
  await withPage(url(opts.q || "?ott=1"), { native: opts.native !== false, preScript: pre }, async (page) => {
    page.captura = async (nome) => { if (pasta) await page.screenshot(`${pasta}/${nome}.png`); };
    page.espera = async (expr, ms = 20000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) { try { if (await page.eval(expr)) return true; } catch (e) { /* página recarregando */ } await page.sleep(100); }
      return false;
    };
    await fn(page);
    const bloq = await page.eval(`JSON.parse(localStorage.getItem("__bloq") || "[]")`);
    confere(bloq.length === 0, "nenhuma rede além do fetch fingido deveria ser tentada: " + JSON.stringify(bloq));
  });
}

const sessao = { sint_profile_chosen: "1" };
const comPerfis = (ps, extra, comVod) => ({ ls: base({ sint_profile_active: A, sint_profiles: cache(...ps), sint_profiles_migrated: "1", ...extra }, comVod), srv: { perfis: ps } });

// ── (a) a primeira coisa visível é o seletor ──
await cena("3 perfis, rede lenta: o seletor é a primeira coisa; a Início nunca aparece antes", comPerfis([P.A, P.B, P.C]), { opcoes: { atrasoServidor: 3500 } }, async (page) => {
  await page.espera(`document.documentElement.classList.contains("profile-open")`, 10000);
  await page.sleep(500);
  const q = await page.eval(`window.__quadros`);
  const ordem = q.map((x) => x.k);
  console.log("   linha do tempo:", JSON.stringify(q));
  confere(!ordem.some((k) => k.indexOf("appvisivel") >= 0), "o app (Início) não pode aparecer em nenhum quadro antes da escolha: " + JSON.stringify(ordem));
  confere(ordem.indexOf("seletor") >= 0, "o seletor deveria cobrir a tela: " + JSON.stringify(ordem));
  const iSel = ordem.indexOf("seletor");
  confere(ordem.slice(0, iSel).every((k) => k === "nada"), "antes do seletor não pode haver outra tela (nem a de carregamento): " + JSON.stringify(ordem));
  confere(ordem[ordem.length - 1] === "seletor", "o seletor deveria seguir na tela enquanto a rede responde: " + JSON.stringify(ordem));
  await page.captura("warm-1-seletor-rede-lenta");
});
await cena("3 perfis, rede normal: seletor; escolher mostra a Início e o seletor não volta", comPerfis([P.A, P.B, P.C]), {}, async (page) => {
  await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 3 && document.documentElement.classList.contains("profile-open")`, 15000);
  await page.sleep(800);
  confere((await page.eval(`window.__quadros.map(x => x.k)`)).every((k) => k.indexOf("appvisivel") < 0), "a Início não pode aparecer antes da escolha");
  await page.eval(`document.querySelector('#profile-grid .pg-card[data-id="${A}"]').click()`);
  await page.espera(`!document.documentElement.classList.contains("profile-open")`, 8000);
  await page.sleep(500);
  const q = await page.eval(`window.__quadros.map(x => x.k)`);
  confere(q[q.length - 1] === "app+appvisivel", "depois da escolha a Início deveria aparecer: " + JSON.stringify(q));
});

// ── (b) 1 perfil entra direto; sem cache há tela de espera e depois o seletor ──
await cena("1 perfil: entra direto, sem seletor", comPerfis([P.A]), {}, async (page) => {
  await page.espera(`activeProfileId() === "${A}" && !_profile.booting && document.body.classList.contains("ott-mode")`, 20000);
  await page.sleep(500);
  const q = await page.eval(`window.__quadros.map(x => x.k)`);
  confere(q.indexOf("seletor") < 0, "com 1 perfil o seletor não pode aparecer: " + JSON.stringify(q));
  confere((await page.eval(`document.getElementById("welcome-h1").textContent`)).indexOf("Ana") >= 0, "a saudação deveria mostrar a Ana");
});
await cena("sem cache de perfis: tela de espera e depois o seletor", { ls: base({ sint_profile_active: A }), srv: { perfis: [P.A, P.B, P.C] } }, { opcoes: { atrasoServidor: 1200 } }, async (page) => {
  await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 3`, 20000);
  const q = await page.eval(`window.__quadros.map(x => x.k)`);
  confere(q.every((k) => k.indexOf("appvisivel") < 0), "sem cache a Início também não pode aparecer antes do seletor: " + JSON.stringify(q));
  confere(q[q.length - 1] === "seletor", "no fim o seletor deveria estar na tela: " + JSON.stringify(q));
});

// ── (c) aquecimento: etapas, chip, nenhuma requisição repetida, sem tarefa longa ──
const abreEMede = (page, tipo) => page.eval(`new Promise(res => {
  const t0 = performance.now();
  openVodSection(${JSON.stringify(tipo)});
  const f = () => { if (_vodCatalogCache.vodType === ${JSON.stringify(tipo)} && _vodCatalogCache.settled === true) res(Math.round(performance.now() - t0)); else setTimeout(f, 5); };
  f();
})`);
const pesquisa = (page, limpa) => page.eval(`new Promise(res => {
  ${limpa ? "_vodCatalogCache.flat = null;" : ""}
  const i = document.getElementById("vod-search-input"); i.value = ""; i.dispatchEvent(new Event("input"));
  const t0 = performance.now();
  i.value = "aventura"; i.dispatchEvent(new Event("input"));
  const f = () => { const n = document.querySelectorAll("#vod-search-results .vod-card").length; if (n > 0 && document.getElementById("vod-search-results").style.display === "grid") res({ ms: Math.round(performance.now() - t0), n }); else setTimeout(f, 5); };
  f();
})`);
const numeros = {};

await cena("aquecimento: etapas, chip, sem requisição duplicada e sem tarefa longa (CPU 4x mais lenta)", { ...comPerfis([P.A, P.B]), ss: sessao }, { opcoes: { atrasoServidor: 3000 } }, async (page) => {
  await page.send("Emulation.setCPUThrottlingRate", { rate: 4 }); // o aquecimento só começa quando a conta responder (3 s)
  const comecou = await page.espera(`_warm.w !== null`, 20000);
  confere(comecou, "o aquecimento deveria começar com a conta liberada e a lista de filmes");
  confere(await page.espera(`_warm.w.estado() === "pronto"`, 90000), "o aquecimento deveria terminar: " + (await page.eval(`_warm.w.estado()`)));
  await page.sleep(500);
  const prov = await page.eval(`window.__prov`);
  const porUrl = {};
  prov.forEach((p) => { porUrl[p.url] = (porUrl[p.url] || 0) + 1; });
  const repetidas = Object.keys(porUrl).filter((u) => porUrl[u] > 1);
  confere(repetidas.length === 0, "nenhuma URL do provedor pode ser pedida duas vezes: " + JSON.stringify(repetidas.map((u) => [u, porUrl[u]])));
  const filmes = prov.filter((p) => /action=get_vod_/.test(p.url)), series = prov.filter((p) => /action=get_series/.test(p.url));
  confere(filmes.length === 1 + CATS_FILMES && series.length === 1 + CATS_SERIES, `deveria pedir 1 lista de categorias + uma requisição por categoria (filmes ${filmes.length}/${1 + CATS_FILMES}, séries ${series.length}/${1 + CATS_SERIES})`);
  // etapas em ordem: todos os filmes começam antes de qualquer série (as séries só entram na etapa seguinte)
  confere(Math.max(...filmes.map((p) => p.t)) <= Math.min(...series.map((p) => p.t)), "a etapa dos filmes deveria terminar antes de começar a das séries");
  // duas categorias por vez (as requisições de uma etapa não se sobrepõem em mais de 2)
  const sobrepoe = (l) => { let m = 0; l.forEach((p) => { const n = l.filter((q) => q.t >= p.t && q.t < p.t + ATRASO * 0.8).length; if (n > m) m = n; }); return m; };
  const catsOnly = (l) => l.filter((p) => /category_id=/.test(p.url));
  confere(sobrepoe(catsOnly(series)) <= 2 && sobrepoe(catsOnly(filmes)) <= 2, `deveria buscar duas categorias por vez: filmes ${sobrepoe(catsOnly(filmes))}, séries ${sobrepoe(catsOnly(series))}`);
  const chip = await page.eval(`window.__chip`);
  confere(chip.length >= 2 && chip[0].on === true && chip[chip.length - 1].on === false, "o chip deveria ligar com o aquecimento e desligar sozinho: " + JSON.stringify(chip));
  confere(!(await page.eval(`document.getElementById("warm-chip").classList.contains("visible")`)), "o chip não pode ficar na tela depois de terminar");
  // nenhuma tarefa longa enquanto o aquecimento trabalha: da primeira requisição de categoria (a partir daí só o aquecimento processa dados; antes disso o app ainda está montando a tela) até a última resposta
  const ini = Math.min(...prov.filter((p) => /category_id=/.test(p.url)).map((p) => p.t)), fim = Math.max(...prov.map((p) => p.t)) + ATRASO + 150;
  const longas = (await page.eval(`window.__long`)).filter((l) => l.start + l.dur >= ini && l.start <= fim);
  console.log(`   janela do aquecimento: ${fim - ini} ms | tarefas longas dentro dela:`, JSON.stringify(longas));
  confere(longas.filter((l) => l.dur > 80).length === 0, "nenhuma tarefa longa (> 80 ms) deveria bloquear a thread durante o aquecimento: " + JSON.stringify(longas));
  // abrir Filmes e Séries depois: nada novo pedido ao provedor, abre com tudo pronto
  const antes = prov.length;
  numeros.abrirComAquecimento = await abreEMede(page, "movies");
  const abriuSeries = await abreEMede(page, "series");
  confere((await page.eval(`window.__prov.length`)) === antes, "abrir Filmes e Séries depois do aquecimento não pode pedir nada ao provedor");
  confere((await page.eval(`Object.keys(_vodCatalogCache.itemsByCategory).length`)) === CATS_SERIES, "a aba Séries deveria abrir com as " + CATS_SERIES + " categorias");
  console.log(`   abrir Filmes até o catálogo completo: ${numeros.abrirComAquecimento} ms (Séries: ${abriuSeries} ms), CPU 4x mais lenta`);
  // busca DEPOIS do aquecimento
  await abreEMede(page, "movies");
  const esperado = CATS_FILMES * Math.ceil(ITENS / 7);
  const comFlat = await pesquisa(page, false);
  const semFlat = await pesquisa(page, true);
  confere(comFlat.n === esperado && semFlat.n === esperado, `a busca depois do aquecimento deveria achar ${esperado} filmes: ${comFlat.n}/${semFlat.n}`);
  console.log(`   primeira busca depois do aquecimento: ${comFlat.ms} ms (com a lista já achatada) | ${semFlat.ms} ms (refazendo achatar+deduplicar), ${comFlat.n} resultados`);
});

// ── (d) busca durante o aquecimento (como hoje) e sem requisições repetidas ──
await cena("busca durante o aquecimento funciona; chip visível; captura", { ...comPerfis([P.A, P.B]), ss: sessao }, { opcoes: { atrasoServidor: 1500 } }, async (page) => {
  await page.espera(`_warm.w && _warm.w.estado() === "rodando"`, 20000);
  await page.eval(`openVodSection("movies")`);
  await page.espera(`Object.keys(_vodCatalogCache.itemsByCategory).length >= 2`, 15000);
  const chipLigado = await page.eval(`document.getElementById("warm-chip").classList.contains("visible")`);
  await page.sleep(400); // a transição do chip termina
  await page.captura("warm-2-chip-e-filmes");
  await page.eval(`(() => { const i = document.getElementById("vod-search-input"); i.value = "aventura"; i.dispatchEvent(new Event("input")); })()`);
  await page.espera(`document.getElementById("vod-search-results").style.display === "grid" && document.querySelectorAll("#vod-search-results .vod-card").length > 0`, 8000);
  const parcial = await page.eval(`document.querySelectorAll("#vod-search-results .vod-card").length`);
  confere(parcial > 0, "a busca deveria funcionar durante o aquecimento (como hoje, com o que já chegou): " + parcial);
  confere(chipLigado || (await page.eval(`_warm.w.estado()`)) !== "rodando", "o chip deveria estar ligado enquanto o aquecimento roda");
  console.log("   durante o aquecimento: resultados parciais", parcial, "| chip ligado:", chipLigado);
  confere(await page.espera(`_warm.w.estado() === "pronto" && _vodCatalogCache.settled === true`, 90000), "tudo deveria terminar");
  await page.eval(`document.getElementById("vod-search-clear").click()`);
  const final = await pesquisa(page, false);
  confere(final.n === CATS_FILMES * Math.ceil(ITENS / 7), "depois de terminar a busca deveria achar tudo: " + final.n);
  const repetidas = Object.entries((await page.eval(`window.__prov`)).reduce((m, p) => { m[p.url] = (m[p.url] || 0) + 1; return m; }, {})).filter(([, n]) => n > 1);
  confere(repetidas.length === 0, "abrir Filmes durante o aquecimento não pode repetir requisições (junta-se às que já estão a caminho): " + JSON.stringify(repetidas));
});

// ── (e) economia de dados e sem lista de filmes: não aquece ──
await cena("economia de dados: não aquece", { ...comPerfis([P.A, P.B]), ss: sessao }, { opcoes: { saveData: true } }, async (page) => {
  await page.espera(`activeProfileId() === "${A}" && document.body.classList.contains("ott-mode")`, 20000);
  await page.sleep(1500);
  confere((await page.eval(`_warm.w`)) === null && (await page.eval(`window.__prov.length`)) === 0, "com economia de dados nada deveria ser pedido ao provedor");
  await page.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const semAquecimento = await abreEMede(page, "movies");
  console.log(`   (controle) abrir Filmes SEM aquecimento até o catálogo completo: ${semAquecimento} ms (com aquecimento: ${numeros.abrirComAquecimento} ms), CPU 4x mais lenta`);
  confere(semAquecimento > numeros.abrirComAquecimento * 0.9, "com o aquecimento a aba Filmes deveria abrir mais rápido que sem ele");
});
await cena("sem lista de filmes: não aquece", { ...comPerfis([P.A, P.B], {}, false), ss: sessao }, { opcoes: { semVod: true } }, async (page) => {
  await page.espera(`activeProfileId() === "${A}" && document.body.classList.contains("ott-mode")`, 20000);
  await page.sleep(1500);
  confere((await page.eval(`_warm.w`)) === null && (await page.eval(`window.__prov.length`)) === 0, "sem lista de filmes nada deveria ser pedido ao provedor");
});

if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
console.log("✔ ok");
