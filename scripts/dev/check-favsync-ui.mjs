// Verifica no Chrome a sincronização dos favoritos do perfil com a conta (celular), com Capacitor simulado e ?ott=1.
// Conta e backend FINGIDOS: o fetch é trocado por um falso (preScript) que guarda a "conta" no localStorage da página
// (sobrevive aos reloads), serve a lista de canais (M3U) e registra o corpo de cada RPC. QUALQUER outra URL de rede é
// recusada (e registrada em __bloq: o teste falha se houver). Nenhum aparelho real é criado; o backend real não é tocado.
//   (a) o seletor não sincroniza nada antes de escolher; escolher o perfil sincroniza o perfil escolhido (fav_list com o p_perfil dele)
//   (b) primeira vez: união (fav_merge só com o que existia só no celular, incluindo os favoritos fixos) e o que só a conta tem aparece nos Favoritos (canal, filme, série)
//   (c) favoritar/desfavoritar canal e filme dispara fav_set com as chaves certas (p_on true/false)
//   (d) depois da primeira vez a conta manda (remove o que saiu, traz o que entrou) e os favoritos fixos não voltam
//   (e) trocar de perfil sincroniza o outro perfil, sem misturar
//   (f) sem rede: o local continua funcionando, a chave fica pendente e sai na próxima sincronização (marcar e desmarcar)
//   (g) sem conta (?noott=1): nenhuma RPC de favoritos
// Uso: node scripts/dev/check-favsync-ui.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
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
const LISTA = "https://lista.falsa.invalid/canais.m3u";
const M3U = "#EXTM3U\n" + ["Globo SP", "SBT", "ESPN", "Combate", "Record"].map((n) => `#EXTINF:-1 group-title="Teste",${n}\nhttps://stream.falso.invalid/${encodeURIComponent(n)}.m3u8`).join("\n") + "\n";
const I = (k, titulo, extra) => ({ k, tipo: k[0] === "c" ? "canal" : k[0] === "f" ? "filme" : "serie", titulo, capa: "", ano: 0, ...extra });

// Backend falso + semeadura (feita UMA vez por página: os reloads do teste mantêm o estado)
function preScript(seed) {
  return `(() => {
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    if (!localStorage.getItem("__seeded")) {
      const s = ${JSON.stringify(seed)};
      Object.keys(s.ls || {}).forEach(k => localStorage.setItem(k, s.ls[k]));
      Object.keys(s.ss || {}).forEach(k => sessionStorage.setItem(k, s.ss[k]));
      localStorage.setItem("__srv", JSON.stringify(s.srv || { perfis: [], fav: {} }));
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
      srv.fav = srv.fav || {};
      if (nome === "device_config") return J({ status: "ok", user: { nome: "Conta Teste", status: "active", acesso_fim: "2030-01-01" }, playlists: [{ id: "l1", nome: "Principal", url_m3u: ${JSON.stringify(LISTA)}, url_vod: null, url_epg: null }] });
      if (nome === "perfil_list") return J({ status: "ok", perfis: srv.perfis });
      if (nome.indexOf("fav_") === 0) {
        if (srv.favFail) throw new TypeError("sem rede");
        const lista = srv.fav[body.p_perfil] = srv.fav[body.p_perfil] || [];
        if (nome === "fav_list") return J({ status: "ok", itens: lista });
        if (nome === "fav_set") {
          const i = lista.findIndex(x => x.k === body.p_chave);
          if (i >= 0) lista.splice(i, 1);
          if (body.p_on) lista.unshift({ k: body.p_chave, tipo: body.p_tipo, titulo: body.p_titulo, capa: body.p_capa, ano: body.p_ano });
          grava(); return J({ status: "ok" });
        }
        if (nome === "fav_merge") {
          body.p_itens.forEach(it => { if (!lista.some(x => x.k === it.k)) lista.unshift(it); });
          grava(); return J({ status: "ok", total: lista.length });
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
    page.servidor = (perfil) => page.eval(`(JSON.parse(localStorage.getItem("__srv")).fav || {})[${JSON.stringify(perfil)}] || []`);
    page.mexeServidor = (js) => page.eval(`(() => { const srv = JSON.parse(localStorage.getItem("__srv")); srv.fav = srv.fav || {}; ${js}; localStorage.setItem("__srv", JSON.stringify(srv)); })()`);
    page.canaisFav = () => page.eval(`_state.favorites.slice().sort()`);
    page.titulosVod = (tipo) => page.eval(`(() => { setState({ section: "catalog", active: "Favoritos", favKind: ${JSON.stringify(tipo)} }); return [...document.querySelectorAll("#channel-container .vod-card p")].map(p => p.textContent).sort(); })()`);
    await fn(page);
    const bloq = await page.eval(`JSON.parse(localStorage.getItem("__bloq") || "[]")`);
    confere(bloq.length === 0, "nenhuma rede além do fetch fingido deveria ser tentada: " + JSON.stringify(bloq));
  });
}

const sessao = { sint_profile_chosen: "1" };
const semente = (extra) => ({
  ls: base({ sint_profile_active: A, sint_profiles: cache(P.A, P.B), sint_profiles_migrated: "1", ...extra }),
  ss: sessao,
  srv: { perfis: [P.A, P.B], fav: {} },
});
const sincronizou = (page, id) => page.espera(`activeProfileId() === "${id}" && favSyncLoad("${id}").feito === true && !_favsync.busy`, 30000);

// ── (a) o seletor não sincroniza antes da escolha ──
await cena("seletor aberto: nada de favoritos até escolher o perfil", {
  ls: base({ sint_profile_active: A, sint_profiles: cache(P.A, P.B), sint_profiles_migrated: "1" }),
  srv: { perfis: [P.A, P.B], fav: { [B]: [I("f:99", "Filme da Bia")] } },
}, {}, async (page) => {
  await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 2 && document.documentElement.classList.contains("profile-open")`, 25000);
  await page.espera(`_state.channels !== null`, 20000); // a lista de canais carrega atrás do seletor
  await page.sleep(1500);
  confere((await page.rpcs("fav_list")).length === 0, "com o seletor aberto nenhum fav_list deveria sair");
  await page.eval(`window.__marca_troca = 1; document.querySelector('#profile-grid .pg-card[data-id="${B}"]').click()`);
  await page.espera(`typeof window.__marca_troca === "undefined" && document.readyState === "complete" && typeof profileBoot === "function"`, 20000);
  confere(await sincronizou(page, B), "escolher a Bia deveria sincronizar o perfil dela");
  const listas = await page.rpcs("fav_list");
  confere(listas.length >= 1 && listas.every((b) => b.p_perfil === B && b.p_token === "token-falso"), "o fav_list deveria levar o token e o perfil escolhido (Bia): " + JSON.stringify(listas));
  confere((await page.titulosVod("vod")).join() === "Filme da Bia", "o filme da conta deveria aparecer nos favoritos da Bia");
});

// ── (b)(c)(d) principal: união, marcar/desmarcar, a conta manda ──
await cena("perfil principal: união, marcar/desmarcar e a conta manda", {
  ...semente({
    sint_paaaaaaaa_fav: JSON.stringify(["SBT"]),
    sint_paaaaaaaa_mylist: JSON.stringify([{ type: "vod", id: 7, title: "Filme Local", cover: "", ts: 5, item: { stream_id: 7, name: "Filme Local", container_extension: "mkv" } }]),
  }),
  srv: { perfis: [P.A, P.B], fav: { [A]: [I("c:globo sp", "Globo SP"), I("f:5", "Filme da Conta", { ano: 2020 }), I("s:2", "Série da Conta")], [B]: [I("f:99", "Filme da Bia")] } },
}, {}, async (page) => {
  confere(await sincronizou(page, A), "a primeira sincronização do principal deveria terminar: " + JSON.stringify(await page.eval(`favSyncLoad(activeProfileId())`)));
  // (b) união
  const merges = await page.rpcs("fav_merge");
  const enviados = merges.flatMap((m) => m.p_itens.map((i) => i.k)).sort();
  confere(merges.length === 1 && merges[0].p_perfil === A, "a união deveria usar um fav_merge para o perfil principal: " + JSON.stringify(merges.map((m) => m.p_perfil)));
  confere(JSON.stringify(enviados) === JSON.stringify(["c:combate", "c:espn", "c:sbt", "f:7"]), "só o que existia só no celular (inclusive os favoritos fixos) deveria ser enviado: " + JSON.stringify(enviados));
  const f7 = merges[0].p_itens.find((i) => i.k === "f:7");
  confere(f7 && f7.tipo === "filme" && f7.titulo === "Filme Local" && f7.capa === "" && f7.ano === 0, "o item enviado deveria ter só id, nome, capa e ano: " + JSON.stringify(f7));
  confere(!/https?:\/\/stream|password|username/i.test(JSON.stringify(merges)), "nenhum link de stream pode ir para a conta");
  confere(JSON.stringify(await page.canaisFav()) === JSON.stringify(["Combate", "ESPN", "Globo SP", "SBT"]), "os canais favoritos deveriam ser a união: " + JSON.stringify(await page.canaisFav()));
  confere((await page.titulosVod("vod")).join() === "Filme Local,Filme da Conta", "os filmes deveriam ser a união: " + JSON.stringify(await page.titulosVod("vod")));
  confere((await page.titulosVod("series")).join() === "Série da Conta", "a série que só a conta tinha deveria aparecer");
  confere((await page.eval(`(loadMyList().find(e => String(e.id) === "7") || { item: {} }).item.container_extension`)) === "mkv", "o item local completo não pode ser trocado pelo mínimo da conta");
  confere((await page.eval(`localStorage.getItem("sint_paaaaaaaa_favsync")`)).indexOf('"feito":true') > 0, "o estado da sincronização deveria ficar gravado por perfil");
  await page.eval(`setState({ section: "catalog", active: "Favoritos", favKind: "vod" })`);
  await page.sleep(500);
  await page.captura("favsync-1-filmes");
  const nomesCanais = await page.eval(`visibleChannels ? (setState({ section: "catalog", active: "Favoritos", favKind: "channels" }), visibleChannels().map(c => c.name).sort()) : []`);
  confere(nomesCanais.join() === "Combate,ESPN,Globo SP,SBT", "a aba Favoritos > Canais deveria listar a união: " + JSON.stringify(nomesCanais));
  await page.sleep(400);
  await page.captura("favsync-2-canais");

  // (c) marcar/desmarcar
  const sets0 = (await page.rpcs("fav_set")).length;
  await page.eval(`toggleFav(getChannels().find(c => c.name === "Record").id)`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "fav_set").length === ${sets0 + 1}`, 5000);
  let sets = (await page.rpcs("fav_set")).slice(sets0);
  confere(sets.length === 1 && JSON.stringify(sets[0]) === JSON.stringify({ p_token: "token-falso", p_perfil: A, p_chave: "c:record", p_tipo: "canal", p_titulo: "Record", p_capa: "", p_ano: 0, p_on: true }), "favoritar o canal deveria chamar fav_set com a chave c:record: " + JSON.stringify(sets));
  await page.eval(`toggleMyListFor({ stream_id: 11, name: "Filme Novo", stream_icon: "https://falso.invalid/p.jpg", year: "2021" }, "vod")`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "fav_set").length === ${sets0 + 2}`, 5000);
  sets = (await page.rpcs("fav_set")).slice(sets0);
  confere(sets[1] && sets[1].p_chave === "f:11" && sets[1].p_tipo === "filme" && sets[1].p_titulo === "Filme Novo" && sets[1].p_ano === 2021 && sets[1].p_capa === "https://falso.invalid/p.jpg" && sets[1].p_on === true, "favoritar o filme deveria chamar fav_set f:11: " + JSON.stringify(sets[1]));
  await page.eval(`toggleMyListFor({ series_id: 3, name: "Série Nova" }, "series")`);
  await page.eval(`toggleFav(getChannels().find(c => c.name === "Record").id)`);
  await page.eval(`toggleMyListFor({ stream_id: 11, name: "Filme Novo" }, "vod")`);
  await page.espera(`JSON.parse(localStorage.getItem("__log")).filter(r => r.nome === "fav_set").length === ${sets0 + 5}`, 5000);
  sets = (await page.rpcs("fav_set")).slice(sets0);
  confere(JSON.stringify(sets.slice(2).map((s) => [s.p_chave, s.p_on])) === JSON.stringify([["s:3", true], ["c:record", false], ["f:11", false]]), "desfavoritar deveria chamar fav_set com p_on false: " + JSON.stringify(sets.map((s) => [s.p_chave, s.p_on])));
  const noServidor = (await page.servidor(A)).map((i) => i.k).sort();
  confere(noServidor.join() === "c:combate,c:espn,c:globo sp,c:sbt,f:5,f:7,s:2,s:3", "a conta deveria refletir as marcações: " + noServidor.join());
  confere((await page.eval(`favSyncLoad(activeProfileId()).pendentes.length + favSyncLoad(activeProfileId()).remover.length`)) === 0, "com a conta respondendo não deveria sobrar pendência");
  confere(!(await page.servidor(B)).some((i) => i.k !== "f:99"), "o outro perfil não pode receber nada do principal");

  // (d) a conta manda: outro aparelho tirou SBT e ESPN e pôs Record; o ESPN (favorito fixo) não pode voltar
  await page.mexeServidor(`srv.fav["${A}"] = srv.fav["${A}"].filter(i => i.k !== "c:sbt" && i.k !== "c:espn" && i.k !== "f:7"); srv.fav["${A}"].unshift({ k: "c:record", tipo: "canal", titulo: "Record", capa: "", ano: 0 })`);
  await page.eval(`syncFavorites()`);
  const ok = await page.espera(`JSON.stringify(_state.favorites.slice().sort()) === '["Combate","Globo SP","Record"]'`, 8000);
  confere(ok, "a conta manda: SBT e ESPN saem e Record entra: " + JSON.stringify(await page.canaisFav()));
  await page.eval(`render(); renderOnNow()`);
  await page.sleep(300);
  confere(!(await page.canaisFav()).includes("ESPN"), "o favorito fixo (ESPN) não pode voltar depois da primeira sincronização");
  confere((await page.titulosVod("vod")).join() === "Filme da Conta", "o filme removido em outro aparelho deveria sair daqui: " + JSON.stringify(await page.titulosVod("vod")));
});

// ── (e) trocar de perfil: o outro perfil sincroniza o dele ──
await cena("trocar de perfil sincroniza o outro perfil", {
  ...semente({ sint_pbbbbbbbb_fav: JSON.stringify(["Record"]) }),
  srv: { perfis: [P.A, P.B], fav: { [A]: [I("f:5", "Filme da Ana")], [B]: [I("f:99", "Filme da Bia"), I("c:sbt", "SBT")] } },
}, {}, async (page) => {
  await sincronizou(page, A);
  await page.eval(`window.__marca_troca = 1; profileChoose(${JSON.stringify(P.B)})`);
  await page.espera(`typeof window.__marca_troca === "undefined" && document.readyState === "complete" && typeof profileBoot === "function"`, 20000);
  confere(await sincronizou(page, B), "o perfil trocado deveria sincronizar");
  confere(JSON.stringify(await page.canaisFav()) === JSON.stringify(["Record", "SBT"]), "a Bia (primeira vez) deveria ter a união Record + SBT: " + JSON.stringify(await page.canaisFav()));
  confere((await page.titulosVod("vod")).join() === "Filme da Bia", "a Bia só deveria ver o filme dela, não o da Ana: " + JSON.stringify(await page.titulosVod("vod")));
  const merges = (await page.rpcs("fav_merge")).filter((m) => m.p_perfil === B);
  confere(merges.length === 1 && merges[0].p_itens.map((i) => i.k).join() === "c:record", "só o Record (que só a Bia tinha neste aparelho) deveria ser enviado para a Bia: " + JSON.stringify(merges));
  confere(!(await page.servidor(B)).some((i) => i.k === "f:5"), "nada da Ana pode ir parar na Bia");
});

// ── (f) sem rede: o local funciona e a pendência sai depois ──
await cena("sem rede: o local continua funcionando e a pendência sai na próxima sincronização", {
  ...semente({ sint_pbbbbbbbb_fav: "[]" }),
  ls: base({ sint_profile_active: B, sint_profiles: cache(P.A, P.B), sint_profiles_migrated: "1" }),
  srv: { perfis: [P.A, P.B], fav: { [B]: [I("c:sbt", "SBT")] } },
}, {}, async (page) => {
  await sincronizou(page, B);
  await page.mexeServidor(`srv.favFail = true`);
  await page.eval(`toggleFav(getChannels().find(c => c.name === "Record").id)`);                      // marca sem rede
  await page.eval(`toggleFav(getChannels().find(c => c.name === "SBT").id)`);                         // desmarca sem rede
  await page.eval(`toggleMyListFor({ stream_id: 21, name: "Filme Offline" }, "vod")`);                // filme sem rede
  await page.sleep(600);
  const st = await page.eval(`favSyncLoad(activeProfileId())`);
  confere(JSON.stringify(await page.canaisFav()) === JSON.stringify(["Record"]), "sem rede o favorito local deveria funcionar: " + JSON.stringify(await page.canaisFav()));
  confere(st.pendentes.slice().sort().join() === "c:record,f:21" && st.remover.join() === "c:sbt", "as chaves deveriam ficar pendentes (marcar) e para remover (desmarcar): " + JSON.stringify(st));
  await page.eval(`syncFavorites()`);
  await page.sleep(800);
  confere(JSON.stringify(await page.canaisFav()) === JSON.stringify(["Record"]) && (await page.eval(`isInMyList(loadMyList(), "vod", 21)`)), "uma sincronização que falha não pode apagar o que está só no aparelho");
  await page.mexeServidor(`srv.favFail = false`);
  await page.eval(`_favsync.busy = false; syncFavorites()`);
  const ok = await page.espera(`(() => { const s = favSyncLoad(activeProfileId()); return s.pendentes.length === 0 && s.remover.length === 0; })()`, 8000);
  confere(ok, "quando a rede volta a pendência deveria sair");
  const noServidor = (await page.servidor(B)).map((i) => i.k).sort();
  confere(noServidor.join() === "c:record,f:21", "a conta deveria receber o Record e o filme e perder o SBT: " + noServidor.join());
  confere(JSON.stringify(await page.canaisFav()) === JSON.stringify(["Record"]), "o SBT desmarcado sem rede não pode voltar da conta");
});

// ── (g) sem conta ──
await cena("sem conta (?noott=1): nenhuma RPC de favoritos", { ls: { sint_url: LISTA, sint_mode: "url" }, srv: { perfis: [], fav: {} } }, { q: "?noott=1", native: false }, async (page) => {
  await page.espera(`_state.channels !== null`, 20000);
  await page.eval(`toggleFav(getChannels().find(c => c.name === "Record").id); toggleMyListFor({ stream_id: 1, name: "F" }, "vod")`);
  await page.sleep(800);
  const log = await page.eval(`JSON.parse(localStorage.getItem("__log") || "[]").map(r => r.nome)`);
  confere(log.length === 0, "sem conta nenhuma RPC deveria sair: " + JSON.stringify(log));
  confere((await page.eval(`_state.favorites.indexOf("Record") >= 0 && isInMyList(loadMyList(), "vod", 1)`)), "sem conta o favorito local continua funcionando como antes");
});

if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
console.log("✔ ok");
