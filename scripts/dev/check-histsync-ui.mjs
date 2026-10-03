// Verifica no Chrome a sincronização do histórico do perfil com a conta ("Continuar assistindo" e canais recentes), com Capacitor simulado e ?ott=1.
// Conta e backend FINGIDOS: o fetch é trocado por um falso (preScript) que guarda a "conta" no localStorage da página
// (sobrevive aos reloads), serve a lista de canais (M3U) e registra o corpo de cada RPC. QUALQUER outra URL de rede é
// recusada (e registrada em __bloq: o teste falha se houver). Nenhum aparelho real é criado; o backend real não é tocado
// (as RPCs hist_* só existem no servidor depois da migração 0013).
//   (a) o seletor não sincroniza nada antes de escolher; escolher o perfil sincroniza o perfil escolhido (hist_list com o p_perfil dele)
//   (b) primeira vez: união (hist_put só do que existia só no celular, sem nenhum link) e o que só a conta tem aparece em "Continuar assistindo" (título, capa, minuto) e nos canais recentes; terminado não aparece
//   (c) abrir um cartão da conta: com credenciais Xtream monta o link e abre no minuto; sem credenciais avisa e não abre
//   (d) assistir (simulado) dispara hist_put com as chaves certas (filme, episódio, canal), com throttle de 20 s e na hora ao pausar/sair
//   (e) remover do continuar / dos recentes dispara hist_remove
//   (f) depois da primeira vez a conta manda (remove o que saiu, traz o que entrou)
//   (g) trocar de perfil sincroniza o outro perfil, sem misturar
//   (h) sem rede: o local funciona, fica pendente e a pendência sai na próxima sincronização (gravar e remover)
//   (i) sem conta (?noott=1): nenhuma RPC de histórico
// Uso: node scripts/dev/check-histsync-ui.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const P = {
  A: { id: A, nome: "Ana", avatar: "padrao", padrao: true },
  B: { id: B, nome: "Bia", avatar: "pipoca", padrao: false },
};
const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const LISTA = "https://lista.falsa.invalid/canais.m3u";
const VOD_URL = "http://srv.falso.invalid:8080/get.php?username=usu&password=sen&type=m3u_plus";
const M3U = "#EXTM3U\n" + ["Globo SP", "SBT", "ESPN", "Combate", "Record"].map((n) => `#EXTINF:-1 group-title="Teste",${n}\nhttps://stream.falso.invalid/${encodeURIComponent(n)}.m3u8`).join("\n") + "\n";
// item da conta
const H = (k, titulo, extra) => ({ k, tipo: k[0] === "c" ? "canal" : k[0] === "f" ? "filme" : "episodio", titulo, capa: "", meta: {}, pos: 0, dur: 0, em: iso(T0 - 3600000), ...extra });

// Backend falso + semeadura (feita UMA vez por página: os reloads do teste mantêm o estado)
function preScript(seed) {
  return `(() => {
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    if (!localStorage.getItem("__seeded")) {
      const s = ${JSON.stringify(seed)};
      Object.keys(s.ls || {}).forEach(k => localStorage.setItem(k, s.ls[k]));
      Object.keys(s.ss || {}).forEach(k => sessionStorage.setItem(k, s.ss[k]));
      localStorage.setItem("__srv", JSON.stringify(s.srv || { perfis: [], hist: {} }));
      localStorage.setItem("__log", "[]");
      localStorage.setItem("__bloq", "[]");
      localStorage.setItem("__seeded", "1");
    }
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      url = String(url);
      if (url.endsWith("/app-config.json")) return J({ url: "https://falso.supabase.co", anonKey: "chave-falsa" });
      if (url === ${JSON.stringify(LISTA)}) return { ok: true, status: 200, text: async () => ${JSON.stringify(M3U)} };
      if (!url.includes("/rest/v1/rpc/")) {
        if (["file:", "data:", "blob:"].some(p => url.startsWith(p))) return realFetch(url, init);
        const b = JSON.parse(localStorage.getItem("__bloq") || "[]"); b.push(url); localStorage.setItem("__bloq", JSON.stringify(b));
        throw new TypeError("rede bloqueada no teste: " + url);
      }
      const nome = url.split("/rpc/")[1];
      const body = JSON.parse(init.body || "{}");
      const log = JSON.parse(localStorage.getItem("__log") || "[]"); log.push({ nome, body }); localStorage.setItem("__log", JSON.stringify(log));
      const srv = JSON.parse(localStorage.getItem("__srv"));
      const grava = () => localStorage.setItem("__srv", JSON.stringify(srv));
      srv.hist = srv.hist || {};
      if (nome === "device_config") return J({ status: "ok", user: { nome: "Conta Teste", status: "active", acesso_fim: "2030-01-01" }, playlists: [{ id: "l1", nome: "Principal", url_m3u: ${JSON.stringify(LISTA)}, url_vod: null, url_epg: null }] });
      if (nome === "perfil_list") return J({ status: "ok", perfis: srv.perfis });
      if (nome === "fav_list") return J({ status: "ok", itens: [] });
      if (nome === "fav_merge") return J({ status: "ok", total: 0 });
      if (nome.indexOf("hist_") === 0) {
        if (srv.histFail) throw new TypeError("sem rede");
        const lista = srv.hist[body.p_perfil] = srv.hist[body.p_perfil] || [];
        if (nome === "hist_list") return J({ status: "ok", itens: lista.slice().sort((a, b) => Date.parse(b.em) - Date.parse(a.em)) });
        if (nome === "hist_put") {
          const i = lista.findIndex(x => x.k === body.p_chave);
          if (i >= 0) lista.splice(i, 1);
          lista.push({ k: body.p_chave, tipo: body.p_tipo, titulo: body.p_titulo, capa: body.p_capa, meta: body.p_meta, pos: body.p_pos, dur: body.p_dur, em: new Date().toISOString() });
          grava(); return J({ status: "ok" });
        }
        if (nome === "hist_remove") {
          const i = lista.findIndex(x => x.k === body.p_chave);
          if (i >= 0) lista.splice(i, 1);
          grava(); return J({ status: "ok" });
        }
      }
      return J({ status: "ok" });
    };
  })();`;
}

const base = (extra) => ({ sint_ott_token: "token-falso", sint_ott_last_ok: String(Date.now()), sint_url: LISTA, sint_mode: "url", ...extra });
const cache = (...ps) => JSON.stringify(ps);
const url = (q) => pathToFileURL("sintoniza-link.html").href + q;

async function cena(titulo, seed, opts, fn) {
  console.log("— " + titulo);
  new Function(preScript(seed)); // lança SyntaxError se o fetch falso não puder ser instalado: nunca toca o backend real
  await withPage(url(opts.q || "?ott=1"), { native: opts.native !== false, preScript: preScript(seed) }, async (page) => {
    page.captura = async (nome) => { if (pasta) await page.screenshot(`${pasta}/${nome}.png`); };
    page.espera = async (expr, ms = 15000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) { try { if (await page.eval(expr)) return true; } catch (e) { /* página recarregando */ } await page.sleep(150); }
      return false;
    };
    page.rpcs = (nome) => page.eval(`JSON.parse(localStorage.getItem("__log") || "[]").filter(r => r.nome === ${JSON.stringify(nome)}).map(r => r.body)`);
    page.servidor = (perfil) => page.eval(`(JSON.parse(localStorage.getItem("__srv")).hist || {})[${JSON.stringify(perfil)}] || []`);
    page.mexeServidor = (js) => page.eval(`(() => { const srv = JSON.parse(localStorage.getItem("__srv")); srv.hist = srv.hist || {}; ${js}; localStorage.setItem("__srv", JSON.stringify(srv)); })()`);
    page.continuar = () => page.eval(`Object.keys(histReadContinue()).sort()`);
    page.estado = () => page.eval(`histSyncLoad(activeProfileId())`);
    // Cartões do Início ("Acessados Recentemente"): título e capa de cada um
    page.cartoesInicio = () => page.eval(`(() => { setSection("Início"); renderHomeLists(); return [...document.querySelectorAll("#home-recents-list .vod-card")].map(c => ({ key: c.dataset.vodKey || ("canal-" + c.dataset.channelId), titulo: (c.querySelector("p.vod-card-name, p") || {}).textContent || "", capa: (c.querySelector("img") || {}).src || "", barra: c.querySelector(".vod-progress span") ? c.querySelector(".vod-progress span").style.width : "" })); })()`);
    await fn(page);
    const bloq = await page.eval(`JSON.parse(localStorage.getItem("__bloq") || "[]")`);
    confere(bloq.length === 0, "nenhuma rede além do fetch fingido deveria ser tentada: " + JSON.stringify(bloq));
  });
}

const sessao = { sint_profile_chosen: "1" };
const semente = (extra, srvHist) => ({
  ls: base({ sint_profile_active: A, sint_profiles: cache(P.A, P.B), sint_profiles_migrated: "1", ...extra }),
  ss: sessao,
  srv: { perfis: [P.A, P.B], hist: srvHist || {} },
});
const sincronizou = (page, id) => page.espera(`activeProfileId() === "${id}" && histSyncLoad("${id}").feito === true && !_histsync.busy`, 30000);

// ── (a) o seletor não sincroniza antes da escolha ──
await cena("seletor aberto: nada de histórico até escolher o perfil", {
  ls: base({ sint_profile_active: A, sint_profiles: cache(P.A, P.B), sint_profiles_migrated: "1" }),
  srv: { perfis: [P.A, P.B], hist: { [B]: [H("f:99", "Filme da Bia", { pos: 100, dur: 6000 })] } },
}, {}, async (page) => {
  await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 2 && document.documentElement.classList.contains("profile-open")`, 25000);
  await page.espera(`_state.channels !== null`, 20000);
  await page.sleep(1500);
  confere((await page.rpcs("hist_list")).length === 0, "com o seletor aberto nenhum hist_list deveria sair");
  await page.eval(`window.__marca_troca = 1; document.querySelector('#profile-grid .pg-card[data-id="${B}"]').click()`);
  await page.espera(`typeof window.__marca_troca === "undefined" && document.readyState === "complete" && typeof profileBoot === "function"`, 20000);
  confere(await sincronizou(page, B), "escolher a Bia deveria sincronizar o histórico dela");
  const listas = await page.rpcs("hist_list");
  confere(listas.length >= 1 && listas.every((b) => b.p_perfil === B && b.p_token === "token-falso"), "o hist_list deveria levar o token e o perfil escolhido (Bia): " + JSON.stringify(listas));
  confere((await page.continuar()).join() === "resume-vod-99", "o filme da conta deveria aparecer no continuar da Bia: " + JSON.stringify(await page.continuar()));
});

// ── (b)(c)(d)(e)(f) principal: união, abrir, assistir, remover, a conta manda ──
await cena("perfil principal: união, abrir cartão, assistir, remover e a conta manda", {
  ...semente({
    sint_paaaaaaaa_continue: JSON.stringify({
      "resume-vod-7": { id: "resume-vod-7", type: "vod", title: "Filme Local", cover: "https://falso.invalid/l.jpg", url: "http://srv.falso.invalid:8080/movie/usu/sen/7.mkv", progress: 600, duration: 7200, ts: T0 - 7200000, vodItem: { stream_id: 7, name: "Filme Local", container_extension: "mkv", year: "2018" } },
    }),
    sint_paaaaaaaa_recents: JSON.stringify([{ id: 1, type: "channel", ts: T0 - 1800000 }]),
  }, {
    [A]: [
      H("f:5", "Filme da Conta", { capa: "https://falso.invalid/p.jpg", meta: { ext: "mp4", ano: 2020 }, pos: 1200, dur: 6000, em: iso(T0 - 600000) }),
      H("e:9", "Série Y · S02E03", { capa: "https://falso.invalid/s.jpg", meta: { ext: "mkv", serieId: "2", serieTitulo: "Série Y", serieCapa: "https://falso.invalid/s.jpg", temporada: 2, numero: 3 }, pos: 300, dur: 3000, em: iso(T0 - 900000) }),
      H("f:6", "Filme Terminado", { pos: 5990, dur: 6000, em: iso(T0 - 300000) }),
      H("c:espn", "ESPN", { meta: { grupo: "Teste" }, em: iso(T0 - 1200000) }),
    ],
    [B]: [H("f:99", "Filme da Bia", { pos: 100, dur: 6000 })],
  }),
}, {}, async (page) => {
  confere(await sincronizou(page, A), "a primeira sincronização do principal deveria terminar: " + JSON.stringify(await page.estado()));
  // (b) união
  const puts = await page.rpcs("hist_put");
  const enviados = puts.map((p) => p.p_chave).sort();
  confere(JSON.stringify(enviados) === JSON.stringify(["c:globo sp", "f:7"]), "só o que existia só no celular (filme local e canal recente) deveria subir: " + JSON.stringify(enviados));
  confere(puts[0].p_chave === "f:7" && puts[1].p_chave === "c:globo sp", "o mais antigo sobe primeiro (a conta carimba a hora do envio): " + JSON.stringify(puts.map((p) => p.p_chave)));
  const f7 = puts.find((p) => p.p_chave === "f:7");
  confere(f7 && f7.p_tipo === "filme" && f7.p_titulo === "Filme Local" && f7.p_pos === 600 && f7.p_dur === 7200 && f7.p_capa === "https://falso.invalid/l.jpg" && JSON.stringify(f7.p_meta) === JSON.stringify({ ext: "mkv", ano: 2018 }), "o filme local deveria subir com ids e metadados: " + JSON.stringify(f7));
  const g = puts.find((p) => p.p_chave === "c:globo sp");
  confere(g && g.p_tipo === "canal" && g.p_titulo === "Globo SP" && g.p_pos === 0 && g.p_dur === 0 && g.p_meta.grupo === "Teste", "o canal recente deveria subir com o nome e o grupo: " + JSON.stringify(g));
  confere(!/srv\.falso|usu|sen\b|password|username|stream\.falso/i.test(JSON.stringify(puts)), "nenhum link de stream nem credencial pode ir para a conta: " + JSON.stringify(puts));
  confere((await page.continuar()).join() === "resume-series-9,resume-vod-5,resume-vod-7", "o continuar deveria ser a união (sem o terminado): " + JSON.stringify(await page.continuar()));
  confere((await page.eval(`histReadContinue()["resume-vod-7"].url`)) === "http://srv.falso.invalid:8080/movie/usu/sen/7.mkv", "a entrada local não pode perder o link");
  confere((await page.eval(`histReadContinue()["resume-vod-5"].url`)) === undefined, "o item da conta não grava link (o link é montado ao abrir)");
  const cartoes = await page.cartoesInicio();
  const porKey = (id) => cartoes.find((c) => c.key.endsWith("-" + id) && c.key.indexOf("canal") < 0); // a chave do cartão é resume-<tipo>-<id>, e o id já começa com resume-
  confere(porKey("resume-vod-5") && porKey("resume-vod-5").titulo === "Filme da Conta" && porKey("resume-vod-5").capa === "https://falso.invalid/p.jpg" && porKey("resume-vod-5").barra === "20%", "o filme da conta deveria aparecer no Início com título, capa e o minuto (20%): " + JSON.stringify(porKey("resume-vod-5")));
  confere(porKey("resume-series-9") && porKey("resume-series-9").titulo === "Série Y" && porKey("resume-series-9").barra === "10%", "o episódio da conta deveria aparecer com a série e o minuto (10%): " + JSON.stringify(porKey("resume-series-9")));
  confere(!cartoes.some((c) => /Terminado/.test(c.titulo)), "o filme terminado não pode aparecer em Continuar assistindo");
  confere(cartoes.some((c) => c.key === "canal-3" && c.titulo === "ESPN") && cartoes.some((c) => c.key === "canal-1" && c.titulo === "Globo SP"), "os canais recentes (da conta e do aparelho) deveriam aparecer: " + JSON.stringify(cartoes.map((c) => c.key)));
  await page.captura("histsync-1-inicio");
  const html = await page.eval(`continueWatchingRowHtml("vod")`);
  confere(/Filme da Conta/.test(html) && /Filme Local/.test(html) && !/Terminado/.test(html), "em Filmes, a fileira Continue Assistindo deveria ter os filmes (o da conta e o local), sem o terminado");
  confere((await page.estado()).pendentes.length === 0, "depois da união nada deveria ficar pendente: " + JSON.stringify(await page.estado()));

  // (c) abrir um cartão da conta: sem credenciais avisa; com credenciais monta o link e abre no minuto
  await page.eval(`window.__abertos = []; window.__playOrig = playVodSelection; playVodSelection = (u, m) => { window.__abertos.push({ u, resumeAt: m.resumeAt, id: m.continueId }); };`);
  await page.eval(`localStorage.removeItem(LS.VOD_URL); document.querySelector('#home-recents-list [data-vod-key$="resume-vod-5"]').click()`);
  confere((await page.eval(`window.__abertos.length`)) === 0 && /credenciais/i.test(await page.eval(`document.getElementById("toast").textContent`)), "sem credenciais Xtream o cartão da conta deveria avisar e não abrir");
  await page.eval(`localStorage.setItem(LS.VOD_URL, ${JSON.stringify(VOD_URL)}); document.querySelector('#home-recents-list [data-vod-key$="resume-vod-5"]').click(); document.querySelector('#home-recents-list [data-vod-key$="resume-series-9"]').click(); document.querySelector('#home-recents-list [data-vod-key$="resume-vod-7"]').click()`);
  const abertos = await page.eval(`window.__abertos`);
  confere(abertos.length === 3 && abertos[0].u === "http://srv.falso.invalid:8080/movie/usu/sen/5.mp4" && abertos[0].resumeAt === 1200 && abertos[0].id === "resume-vod-5", "o filme da conta deveria abrir no minuto 1200 com o link montado: " + JSON.stringify(abertos[0]));
  confere(abertos[1].u === "http://srv.falso.invalid:8080/series/usu/sen/9.mkv" && abertos[1].resumeAt === 300, "o episódio da conta deveria abrir no minuto 300 com a extensão da conta: " + JSON.stringify(abertos[1]));
  confere(abertos[2].u === "http://srv.falso.invalid:8080/movie/usu/sen/7.mkv" && abertos[2].resumeAt === 600, "o filme assistido aqui continua abrindo pelo link dele: " + JSON.stringify(abertos[2]));
  await page.eval(`playVodSelection = window.__playOrig`);

  // (d) assistir (simulado): hist_put com as chaves certas, throttle de 20 s, na hora ao pausar/sair
  const antes = (await page.rpcs("hist_put")).length;
  await page.eval(`saveContinueWatching({ id: "resume-vod-11", type: "vod", title: "Filme Novo", cover: "https://falso.invalid/n.jpg", url: "http://srv.falso.invalid:8080/movie/usu/sen/11.mp4", progress: 120, duration: 5400, vodItem: { stream_id: 11, name: "Filme Novo", container_extension: "mp4", year: "2021" } })`);
  await page.eval(`saveContinueWatching({ id: "resume-series-33", type: "series", title: "Série Z · S01E04", cover: "https://falso.invalid/z.jpg", url: "http://srv.falso.invalid:8080/series/usu/sen/33.mkv", progress: 60, duration: 2400, vodItem: { series_id: 4, name: "Série Z", cover: "https://falso.invalid/z.jpg", releaseDate: "2022-01-01" } })`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "hist_put").length === ${antes + 2}`, 5000);
  let novos = (await page.rpcs("hist_put")).slice(antes);
  confere(novos.length === 2, "assistir filme e episódio deveria gravar 2 itens: " + JSON.stringify(novos.map((n) => n.p_chave)));
  const filme = novos.find((n) => n.p_chave === "f:11");
  const ep = novos.find((n) => n.p_chave === "e:33");
  confere(filme && filme.p_tipo === "filme" && filme.p_pos === 120 && filme.p_dur === 5400 && filme.p_titulo === "Filme Novo" && filme.p_perfil === A && JSON.stringify(filme.p_meta) === JSON.stringify({ ext: "mp4", ano: 2021 }), "o filme deveria subir com chave f:11: " + JSON.stringify(filme));
  confere(ep && ep.p_tipo === "episodio" && ep.p_titulo === "Série Z · S01E04" && JSON.stringify(ep.p_meta) === JSON.stringify({ ext: "mkv", serieId: "4", serieTitulo: "Série Z", serieCapa: "https://falso.invalid/z.jpg", temporada: 1, numero: 4, ano: 2022 }), "o episódio deveria subir com chave e:33 e a série/temporada/número: " + JSON.stringify(ep));
  confere(!/srv\.falso|usu|sen\b|password/i.test(JSON.stringify(novos)), "assistir não pode mandar link nem credencial");
  await page.eval(`saveContinueWatching({ id: "resume-vod-11", type: "vod", title: "Filme Novo", cover: "https://falso.invalid/n.jpg", url: "http://srv.falso.invalid:8080/movie/usu/sen/11.mp4", progress: 125, duration: 5400, vodItem: { stream_id: 11, name: "Filme Novo" } })`);
  await page.sleep(500);
  confere((await page.rpcs("hist_put")).length === antes + 2, "dentro de 20 s o mesmo item não deveria subir de novo (throttle)");
  confere((await page.estado()).pendentes.indexOf("f:11") >= 0, "o item que não subiu fica pendente até a próxima gravação");
  // pausa/saída: grava na hora com o minuto de agora
  await page.eval(`setState({ selected: { id: "resume-vod-11", isVod: true, continueId: "resume-vod-11", name: "Filme Novo" }, playing: false }, true); histPutCurrent(true)`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "hist_put").length === ${antes + 3}`, 5000);
  novos = (await page.rpcs("hist_put")).slice(antes);
  confere(novos.length === 3 && novos[2].p_chave === "f:11" && novos[2].p_pos === 125, "ao pausar/sair o item deveria subir na hora com o último minuto: " + JSON.stringify(novos[2]));
  await page.eval(`setState({ selected: null }, true)`);
  confere((await page.estado()).pendentes.length === 0, "com a conta respondendo não deveria sobrar pendência: " + JSON.stringify(await page.estado()));
  // canal: selecionar grava o canal na hora
  await page.eval(`selectChannel(getChannels().find(c => c.name === "Record"), false)`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "hist_put").length === ${antes + 4}`, 5000);
  const canal = (await page.rpcs("hist_put"))[antes + 3];
  confere(canal && canal.p_chave === "c:record" && canal.p_tipo === "canal" && canal.p_titulo === "Record" && canal.p_pos === 0 && canal.p_dur === 0 && canal.p_meta.grupo === "Teste", "escolher um canal deveria gravar c:record: " + JSON.stringify(canal));
  const noServidor = (await page.servidor(A)).map((i) => i.k).sort();
  confere(noServidor.join() === "c:espn,c:globo sp,c:record,e:33,e:9,f:11,f:5,f:6,f:7", "a conta deveria refletir tudo: " + noServidor.join());
  confere(!(await page.servidor(B)).some((i) => i.k !== "f:99"), "o outro perfil não pode receber nada do principal");

  // (e) remover
  const rem0 = (await page.rpcs("hist_remove")).length;
  await page.eval(`removeContinueWatching("resume-vod-11")`);
  await page.eval(`(() => { _actionSheetContext = { kind: "channel-recent", title: "Record", channelId: getChannels().find(c => c.name === "Record").id }; runCardAction("recent-remove"); })()`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "hist_remove").length === ${rem0 + 2}`, 5000);
  const rems = (await page.rpcs("hist_remove")).slice(rem0);
  confere(JSON.stringify(rems.map((r) => [r.p_chave, r.p_perfil])) === JSON.stringify([["f:11", A], ["c:record", A]]), "remover deveria chamar hist_remove com as chaves certas: " + JSON.stringify(rems));
  confere(!(await page.servidor(A)).some((i) => i.k === "f:11" || i.k === "c:record"), "a conta deveria perder o filme e o canal removidos");
  confere((await page.estado()).remover.length === 0, "com a conta respondendo não deveria sobrar remoção pendente");

  // (f) a conta manda: outro aparelho tirou o filme da conta (f:5) e o canal ESPN, assistiu um filme novo e terminou o episódio e:9
  await page.mexeServidor(`srv.hist["${A}"] = srv.hist["${A}"].filter(i => i.k !== "f:5" && i.k !== "c:espn"); srv.hist["${A}"].forEach(i => { if (i.k === "e:9") { i.pos = 2950; i.dur = 3000; i.em = new Date().toISOString(); } }); srv.hist["${A}"].push({ k: "f:20", tipo: "filme", titulo: "Filme do Outro", capa: "", meta: { ext: "mp4" }, pos: 50, dur: 3000, em: new Date().toISOString() })`);
  await page.eval(`syncHistory()`);
  const ok = await page.espera(`Object.keys(histReadContinue()).sort().join() === "resume-series-33,resume-vod-20,resume-vod-7"`, 8000);
  confere(ok, "a conta manda: sai o que saiu ou terminou lá, entra o novo: " + JSON.stringify(await page.continuar()));
  confere(!(await page.eval(`_state.recents.some(r => r.id === 3)`)), "o canal removido em outro aparelho deveria sair dos recentes");
  confere((await page.rpcs("hist_put")).length === antes + 4, "depois da primeira vez o aparelho não reenvia o que a conta já tem");
});

// ── (g) trocar de perfil: o outro perfil sincroniza o dele ──
await cena("trocar de perfil sincroniza o outro perfil", {
  ...semente({
    sint_pbbbbbbbb_continue: JSON.stringify({ "resume-vod-60": { id: "resume-vod-60", type: "vod", title: "Filme só da Bia aqui", cover: "", url: "http://srv.falso.invalid:8080/movie/usu/sen/60.mp4", progress: 100, duration: 6000, ts: T0 - 5000, vodItem: { stream_id: 60, name: "Filme só da Bia aqui" } } }),
    sint_paaaaaaaa_continue: JSON.stringify({ "resume-vod-1": { id: "resume-vod-1", type: "vod", title: "Filme da Ana", cover: "", url: "http://srv.falso.invalid:8080/movie/usu/sen/1.mp4", progress: 100, duration: 6000, ts: T0 - 5000, vodItem: { stream_id: 1, name: "Filme da Ana" } } }),
  }, {
    [A]: [H("f:1", "Filme da Ana", { pos: 100, dur: 6000 })],
    [B]: [H("f:99", "Filme da Bia", { pos: 100, dur: 6000 })],
  }),
}, {}, async (page) => {
  await sincronizou(page, A);
  await page.eval(`window.__marca_troca = 1; profileChoose(${JSON.stringify(P.B)})`);
  await page.espera(`typeof window.__marca_troca === "undefined" && document.readyState === "complete" && typeof profileBoot === "function"`, 20000);
  confere(await sincronizou(page, B), "o perfil trocado deveria sincronizar");
  confere((await page.continuar()).join() === "resume-vod-60,resume-vod-99", "a Bia (primeira vez) deveria ter a união dela, sem nada da Ana: " + JSON.stringify(await page.continuar()));
  const puts = (await page.rpcs("hist_put")).filter((p) => p.p_perfil === B);
  confere(puts.length === 1 && puts[0].p_chave === "f:60", "só o filme que só a Bia tinha neste aparelho deveria subir para a Bia: " + JSON.stringify(puts));
  confere(!(await page.servidor(B)).some((i) => i.k === "f:1"), "nada da Ana pode ir parar na Bia");
  confere(!(await page.servidor(A)).some((i) => i.k === "f:60" || i.k === "f:99"), "nada da Bia pode ir parar na Ana");
});

// ── (h) sem rede: o local funciona e a pendência sai depois ──
await cena("sem rede: o local continua funcionando e a pendência sai na próxima sincronização", {
  ...semente({}, { [A]: [H("f:1", "Filme da Conta", { pos: 100, dur: 6000 }), H("f:2", "Outro da Conta", { pos: 100, dur: 6000 })] }),
}, {}, async (page) => {
  await sincronizou(page, A);
  await page.mexeServidor(`srv.histFail = true`);
  await page.eval(`saveContinueWatching({ id: "resume-vod-70", type: "vod", title: "Filme Offline", cover: "", url: "http://srv.falso.invalid:8080/movie/usu/sen/70.mp4", progress: 30, duration: 6000, vodItem: { stream_id: 70, name: "Filme Offline" } })`);   // assiste sem rede
  await page.eval(`removeContinueWatching("resume-vod-2")`);                                                                                     // remove sem rede
  await page.eval(`selectChannel(getChannels().find(c => c.name === "SBT"), false)`);                                                            // canal sem rede
  await page.sleep(600);
  const st = await page.estado();
  confere((await page.continuar()).join() === "resume-vod-1,resume-vod-70", "sem rede o local deveria funcionar: " + JSON.stringify(await page.continuar()));
  confere(st.pendentes.slice().sort().join() === "c:sbt,f:70" && st.remover.join() === "f:2", "as chaves deveriam ficar pendentes (gravar) e para remover (remover): " + JSON.stringify(st));
  await page.eval(`syncHistory()`);
  await page.sleep(800);
  confere((await page.continuar()).join() === "resume-vod-1,resume-vod-70" && (await page.eval(`_state.recents.some(r => r.id === 2)`)), "uma sincronização que falha não pode apagar o que está só no aparelho");
  await page.mexeServidor(`srv.histFail = false`);
  await page.eval(`_histsync.busy = false; syncHistory()`);
  const ok = await page.espera(`(() => { const s = histSyncLoad(activeProfileId()); return s.pendentes.length === 0 && s.remover.length === 0; })()`, 8000);
  confere(ok, "quando a rede volta a pendência deveria sair: " + JSON.stringify(await page.estado()));
  const noServidor = (await page.servidor(A)).map((i) => i.k).sort();
  confere(noServidor.join() === "c:sbt,f:1,f:70", "a conta deveria receber o filme e o canal e perder o removido: " + noServidor.join());
  confere((await page.continuar()).join() === "resume-vod-1,resume-vod-70", "o item removido sem rede não pode voltar da conta");
});

// ── (i) sem conta ──
await cena("sem conta (?noott=1): nenhuma RPC de histórico", { ls: { sint_url: LISTA, sint_mode: "url" }, srv: { perfis: [], hist: {} } }, { q: "?noott=1", native: false }, async (page) => {
  await page.espera(`_state.channels !== null`, 20000);
  await page.eval(`saveContinueWatching({ id: "resume-vod-1", type: "vod", title: "F", cover: "", url: "http://x/movie/a/b/1.mp4", progress: 30, duration: 600, vodItem: { stream_id: 1, name: "F" } }); selectChannel(getChannels().find(c => c.name === "Record"), false); histPutCurrent(true); removeContinueWatching("resume-vod-1"); syncHistory()`);
  await page.sleep(800);
  const log = await page.eval(`JSON.parse(localStorage.getItem("__log") || "[]").map(r => r.nome)`);
  confere(log.length === 0, "sem conta nenhuma RPC deveria sair: " + JSON.stringify(log));
  confere(await page.eval(`_state.recents.some(r => r.type === "channel")`), "sem conta o recente local continua funcionando como antes");
});

if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
console.log("✔ ok");
