// Histórico do perfil na conta ("Continuar assistindo" e canais recentes), de ponta a ponta contra o backend REAL.
// O celular é a página real (Chrome/CDP, ?ott=1), ativada de verdade; a "TV" é este script
// (RPCs reais device_start/device_claim/perfil_list/hist_put/hist_list/hist_remove).
// O <video> do Chrome não tem mídia: currentTime/duration/paused/play/pause são FINGIDOS na própria página
// (Object.defineProperty no elemento); o resto do app (perfis, histórico, sincronização, remoção) é o código real.
// Nunca imprime chaves, senhas nem tokens. Rode UMA vez por hora (limites de taxa: device_start 20/h, device_claim 10/10 min).
// Uso: node scripts/dev/e2e-historico.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const MODELO_TV = "TV Historico E2E";
const NOME_PERFIL = "E2E Hist";
const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;
const falha = (msg) => { throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera uma condição (função async) por até `ms`; devolve o último valor
const esperar = async (fn, ms, passo = 250) => { const fim = Date.now() + ms; let v = null; while (Date.now() < fim) { try { v = await fn(); } catch (e) { v = null; /* página recarregando */ } if (v) return v; await sleep(passo); } return v; };
// Chave do canal: "c:" + nome em minúsculas, sem acento, espaços colapsados, até 120 (contrato do plano; calculada aqui, independente do app)
const chaveCanal = (nome) => "c:" + String(nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

// Itens gravados pela "TV"
const FILME = { k: "f:e2ehistfilme1", titulo: "Filme E2E Historico", capa: "https://e2e-hist.invalid/filme1.jpg", pos: 1200, dur: 7200, meta: { ext: "mp4", ano: 2024 } };
const EPISODIO = { k: "e:e2ehistep1", titulo: "Serie E2E Hist · S02E03", capa: "https://e2e-hist.invalid/ep1.jpg", pos: 600, dur: 2700, meta: { ext: "mkv", serieId: "e2ehistserie1", serieTitulo: "Serie E2E Hist", serieCapa: "https://e2e-hist.invalid/serie1.jpg", temporada: 2, numero: 3, ano: 2024 } };
// Filme que o celular "assiste"
const ASSISTIDO = { id: "e2ehistfilme2", name: "Filme E2E Assistido", container_extension: "mp4", k: "f:e2ehistfilme2" };
const POS_CELULAR = 900;
const DURACAO = 7200;

let tokenTv = null;   // token da "TV" simulada
let perfilId = null;  // id do perfil "E2E Hist" (para a limpeza)
let principalId = null;
let ok = false;

// A "TV" lê o histórico de um perfil (hist_list) e devolve um mapa chave -> item
const tvLe = async (perfil) => {
  const r = await rpc("hist_list", { p_token: tokenTv, p_perfil: perfil });
  if (r.status !== 200 || !r.data || r.data.status !== "ok" || !Array.isArray(r.data.itens)) falha("hist_list da TV falhou: " + JSON.stringify(r.data));
  return Object.fromEntries(r.data.itens.map((i) => [i.k, i]));
};
// A "TV" grava um item no histórico de um perfil
const tvPut = async (perfil, it, tipo) => {
  const r = await rpc("hist_put", { p_token: tokenTv, p_perfil: perfil, p_chave: it.k, p_tipo: tipo, p_titulo: it.titulo, p_capa: it.capa || "", p_meta: it.meta || {}, p_pos: it.pos || 0, p_dur: it.dur || 0 });
  if (r.status !== 200 || !r.data || r.data.status !== "ok") falha(`hist_put da TV (${it.k.slice(0, 2)}…) falhou: ` + JSON.stringify(r.data));
};

try {
  await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true }, async (page) => {
    const desvincularCelular = async () => {
      try {
        const t = await page.eval(`localStorage.getItem("sint_ott_token")`);
        if (t) await rpc("device_unlink", { p_token: t });
      } catch (e) { /* página indisponível */ }
    };
    const pg = (expr, ms, passo) => esperar(() => page.eval(expr), ms, passo);
    try {
      // ── 0. Cria a "TV" (device_start + device_claim); a "TV" lista os perfis (cria o principal) ──
      const jwt = await login();
      if (!jwt) falha("não consegui entrar com o usuário de teste");
      const start = await rpc("device_start", { p_modelo: MODELO_TV, p_sistema: "node" });
      if (start.status !== 200 || !start.data || !start.data.device_token) falha("device_start da TV falhou: " + JSON.stringify(start.data));
      tokenTv = start.data.device_token;
      const claimTv = await rpc("device_claim", { p_code: start.data.code }, jwt);
      if (claimTv.status !== 200) falha("device_claim da TV falhou: " + JSON.stringify(claimTv.data));
      await rpc("cast_poll", { p_token: tokenTv });
      console.log("TV simulada ativada");

      let lista = await rpc("perfil_list", { p_token: tokenTv });
      if (lista.status !== 200 || !lista.data || lista.data.status !== "ok" || !Array.isArray(lista.data.perfis)) falha("perfil_list da TV falhou: " + JSON.stringify(lista.data));
      // sobra de uma rodada anterior interrompida: remove os perfis E2E (nunca o principal)
      for (const p of lista.data.perfis.filter((x) => !x.padrao && /^E2E /.test(x.nome))) await rpc("perfil_delete", { p_token: tokenTv, p_id: p.id });
      lista = await rpc("perfil_list", { p_token: tokenTv });
      const principal = lista.data.perfis.find((p) => p.padrao);
      if (!principal) falha("perfil_list não criou o perfil principal: " + JSON.stringify(lista.data));
      if (lista.data.perfis.length >= 5) falha(`a conta de teste já tem 5 perfis: não dá para criar o ${NOME_PERFIL}`);
      principalId = principal.id;
      const histPrincipalAntes = await tvLe(principalId);

      // ── 1. Celular real: ativa, escolhe o principal, cria "E2E Hist" pelo editor e o escolhe ──
      const tokenInicial = await page.eval(`localStorage.getItem("sint_ott_token")`);
      if (tokenInicial) await rpc("device_unlink", { p_token: tokenInicial });
      await page.eval(`localStorage.clear(); sessionStorage.clear(); location.reload()`);
      await page.sleep(4000);
      const codigo = await page.eval(`document.getElementById("ott-code").textContent`);
      if (!/^[A-Z]{4}-\d{4}$/.test(codigo)) falha("o app não mostrou um código válido: " + codigo);
      const claim = await rpc("device_claim", { p_code: codigo }, jwt);
      if (claim.status !== 200) falha("o backend recusou o código do celular: " + JSON.stringify(claim.data));
      if (!(await pg(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`, 60000, 1500))) {
        const diag = await page.eval(`({ aberto: document.documentElement.classList.contains("ott-open"), modo: document.body.classList.contains("ott-mode"), codigo: (document.getElementById("ott-code") || {}).textContent, token: !!localStorage.getItem("sint_ott_token"), toast: (document.getElementById("toast") || {}).textContent })`).catch(() => null);
        // consulta o servidor como o app faz (sem imprimir o token): mostra o status que o celular está recebendo
        const cfg = await page.eval(`ottDeviceConfig(_ott.cfg, localStorage.getItem(OTT_KEYS.TOKEN)).then(c => JSON.stringify(c, (k, v) => /token/i.test(k) ? "[oculto]" : v)).catch(e => "erro: " + e.message)`).catch((e) => "falha: " + e.message);
        falha("o celular não liberou depois da confirmação; estado: " + JSON.stringify(diag) + "; device_config: " + String(cfg).slice(0, 400));
      }
      const ativouPrincipal = await esperar(async () => {
        const s = await page.eval(`({ ativo: activeProfileId(), aberto: document.documentElement.classList.contains("profile-open"), boot: _profile.booting, lista: _profile.list.length })`);
        if (s.aberto && !s.boot && s.lista) await page.eval(`profileChoose(_profile.list.find(p => p.padrao)); 1`);
        return s.ativo === principalId && !s.aberto && !s.boot;
      }, 60000, 1500);
      if (!ativouPrincipal) falha("o celular não ficou com o perfil principal ativo");
      if (!(await pg(`(getChannels()[0] || {}).name`, 60000, 1000))) falha("a conta de teste não carregou nenhum canal no celular");

      await page.eval(`profileOpenFromUi(true); 1`);
      if (!(await pg(`document.querySelector("#profile-grid .pg-add") !== null`, 15000, 200))) falha("o modo gerenciar não mostrou o cartão Adicionar perfil");
      await page.eval(`document.querySelector("#profile-grid .pg-add").click(); 1`);
      if (!(await pg(`!document.getElementById("profile-editor").hidden`, 5000, 150))) falha("o editor de perfil não abriu");
      await page.eval(`(() => {
        const inp = document.getElementById("profile-name-input"); inp.value = ${JSON.stringify(NOME_PERFIL)}; inp.dispatchEvent(new Event("input"));
        document.getElementById("profile-save-btn").click();
        return 1;
      })()`);
      if (!(await pg(`!document.getElementById("profile-picker").hidden`, 15000, 200))) falha("o editor não salvou o perfil: " + (await page.eval(`document.getElementById("profile-error").textContent`)));
      const visto = await esperar(async () => {
        const r = await rpc("perfil_list", { p_token: tokenTv });
        return (r.data && Array.isArray(r.data.perfis) && r.data.perfis.find((p) => p.nome === NOME_PERFIL)) || null;
      }, 10000, 500);
      if (!visto) falha(`a "TV" não viu o perfil "${NOME_PERFIL}" no perfil_list`);
      perfilId = visto.id;
      // escolhe o "E2E Hist" (o app recarrega com ele ativo)
      await page.eval(`profileCloseGate(); profileOpenFromUi(false); 1`);
      if (!(await pg(`document.querySelector('#profile-grid .pg-card[data-id="${perfilId}"]') !== null`, 15000, 200))) falha("o seletor não listou o perfil E2E Hist");
      await page.eval(`window.__marca_troca = 1; document.querySelector('#profile-grid .pg-card[data-id="${perfilId}"]').click(); 1`);
      const trocou = await pg(`typeof window.__marca_troca === "undefined" && activeProfileId() === "${perfilId}" && !_profile.booting && !document.documentElement.classList.contains("profile-open")`, 60000, 500);
      if (!trocou) falha("o celular não recarregou com o perfil E2E Hist ativo");
      if (!(await pg(`(getChannels()[0] || {}).name`, 60000, 1000))) falha("a conta de teste não carregou nenhum canal depois da troca de perfil");
      // espera a primeira sincronização do histórico do perfil novo (daí em diante a conta manda)
      if (!(await pg(`!_histsync.busy && histSyncLoad(activeProfileId()).feito`, 60000, 500))) falha("o celular não fez a primeira sincronização de histórico do perfil novo");
      console.log(`(1) celular criou e escolheu "${NOME_PERFIL}"; primeira sincronização de histórico feita`);

      // ── 2. A "TV" grava filme, episódio e canal no perfil (hist_put) ──
      const canal = await page.eval(`(() => { const c = getChannels().find(x => !/^(Combate|ESPN)/i.test(x.name)) || getChannels()[0]; return { id: c.id, nome: c.name }; })()`);
      const K_CANAL = chaveCanal(canal.nome);
      const CANAL = { k: K_CANAL, titulo: canal.nome, capa: "", pos: 0, dur: 0, meta: {} };
      await tvPut(perfilId, FILME, "filme");
      await tvPut(perfilId, EPISODIO, "episodio");
      await tvPut(perfilId, CANAL, "canal");
      const naConta = await tvLe(perfilId);
      for (const it of [FILME, EPISODIO, CANAL]) if (!naConta[it.k]) falha("a TV não leu de volta o item gravado: " + it.k.slice(0, 2) + "…");
      if (naConta[FILME.k].pos !== 1200 || naConta[FILME.k].dur !== 7200) falha("hist_list devolveu minuto errado para o filme: " + JSON.stringify(naConta[FILME.k]));
      console.log(`(2) a TV gravou 1 filme, 1 episódio e 1 canal no perfil; hist_list: ${Object.keys(naConta).length} itens`);

      // ── 3. O celular sincroniza e mostra os itens (título/capa/minuto; canal em recentes) ──
      await page.eval(`_histsync.busy = false; 1`);
      const sincronizou = await pg(`(async () => { await syncHistory(); const m = histReadContinue(); return !!(m["resume-vod-e2ehistfilme1"] && m["resume-series-e2ehistep1"]); })()`, 45000, 1500);
      if (!sincronizou) falha("o celular não recebeu o filme e o episódio da TV depois de syncHistory(): " + JSON.stringify(await page.eval(`Object.keys(histReadContinue())`)));
      const loc = await page.eval(`(() => {
        const m = histReadContinue();
        const f = m["resume-vod-e2ehistfilme1"], e = m["resume-series-e2ehistep1"];
        const cards = [...document.querySelectorAll("#home-recents-list .vod-card")].map(b => ({
          texto: b.textContent.replace(/\\s+/g, " ").trim(),
          capa: (b.querySelector("img") || {}).src || "",
          barra: (b.querySelector(".vod-progress span") || {}).style ? b.querySelector(".vod-progress span").style.width : "",
          canal: b.getAttribute("data-channel-id")
        }));
        return { f, e, cards, recents: (_state.recents || []).map(r => r.id), linhaFilmes: continueWatchingRowHtml("vod"), linhaSeries: continueWatchingRowHtml("series") };
      })()`);
      if (!loc.f || loc.f.title !== FILME.titulo || loc.f.cover !== FILME.capa || Math.floor(loc.f.progress) !== FILME.pos || loc.f.duration !== FILME.dur) falha("o filme veio errado no celular: " + JSON.stringify(loc.f));
      if (!loc.e || loc.e.title !== EPISODIO.titulo || loc.e.cover !== EPISODIO.capa || Math.floor(loc.e.progress) !== EPISODIO.pos || loc.e.duration !== EPISODIO.dur) falha("o episódio veio errado no celular: " + JSON.stringify(loc.e));
      if (loc.f.url) falha("o filme da conta veio com link guardado (deveria ser montado só ao abrir)");
      const cartaoF = loc.cards.find((c) => c.texto.includes(FILME.titulo));
      const cartaoE = loc.cards.find((c) => c.texto.includes("Serie E2E Hist") && c.texto.includes("S02E03"));
      if (!cartaoF) falha("o cartão do filme não apareceu nos recentes do Início: " + JSON.stringify(loc.cards.map((c) => c.texto)));
      if (!cartaoE) falha("o cartão do episódio não apareceu nos recentes do Início: " + JSON.stringify(loc.cards.map((c) => c.texto)));
      if (cartaoF.capa !== FILME.capa) falha("o cartão do filme não tem a capa da conta: " + cartaoF.capa);
      if (cartaoE.capa !== EPISODIO.capa) falha("o cartão do episódio não tem a capa da conta: " + cartaoE.capa);
      if (cartaoF.barra !== "17%") falha(`a barra do filme deveria marcar 17% (1200/7200), marcou ${JSON.stringify(cartaoF.barra)}`);
      if (cartaoE.barra !== "22%") falha(`a barra do episódio deveria marcar 22% (600/2700), marcou ${JSON.stringify(cartaoE.barra)}`);
      if (!loc.linhaFilmes.includes(FILME.titulo)) falha('o filme não apareceu em "Continue Assistindo" de Filmes');
      if (!loc.linhaSeries.includes("S02E03")) falha('o episódio não apareceu em "Continue Assistindo" de Séries');
      if (!loc.recents.includes(canal.id)) falha("o canal da TV não entrou nos recentes do celular: " + JSON.stringify(loc.recents));
      if (!loc.cards.some((c) => String(c.canal) === String(canal.id))) falha("o cartão do canal não apareceu nos recentes do Início");
      console.log(`(3) celular sincronizou: filme (${loc.f.progress}/${loc.f.duration} s, barra ${cartaoF.barra}) e episódio (${loc.e.progress}/${loc.e.duration} s, barra ${cartaoE.barra}) em Continue Assistindo, com título e capa; canal nos recentes`);

      // ── 4. O celular "assiste" um filme sintético; a "TV" lê hist_list e vê o minuto ──
      await page.eval(`(() => {
        const v = document.getElementById("player-video");
        const st = { t: 0, d: ${DURACAO}, paused: true };
        Object.defineProperty(v, "currentTime", { configurable: true, get: () => st.t, set: (x) => { st.t = Number(x); } });
        Object.defineProperty(v, "duration", { configurable: true, get: () => st.d });
        Object.defineProperty(v, "readyState", { configurable: true, get: () => 4 });
        Object.defineProperty(v, "paused", { configurable: true, get: () => st.paused });
        v.play = () => { st.paused = false; v.dispatchEvent(new Event("play")); return Promise.resolve(); };
        v.pause = () => { if (!st.paused) { st.paused = true; v.dispatchEvent(new Event("pause")); } };
        window.__fake = st;
        return 1;
      })()`);
      const item = { stream_id: ASSISTIDO.id, name: ASSISTIDO.name, container_extension: ASSISTIDO.container_extension };
      await page.eval(`playVodSelection("https://e2e-hist.invalid/filme.mp4", { id: ${JSON.stringify(item.stream_id)}, contType: "vod", title: ${JSON.stringify(item.name)}, cover: null, vodItem: ${JSON.stringify(item)}, castInfo: { kind: "vod", item: ${JSON.stringify(item)} } }); 1`);
      // "anda" até 900 s: o evento de tempo grava no "continuar" do aparelho; a pausa envia o item à conta
      await page.eval(`window.__fake.t = ${POS_CELULAR}; document.getElementById("player-video").dispatchEvent(new Event("timeupdate")); 1`);
      if (!(await pg(`!!histReadContinue()["resume-vod-${ASSISTIDO.id}"]`, 10000, 200))) falha("o filme assistido não entrou no Continue Assistindo do celular");
      await page.eval(`document.getElementById("player-video").pause(); 1`);
      const lido = await esperar(async () => {
        const m = await tvLe(perfilId);
        const x = m[ASSISTIDO.k];
        return x && x.pos === POS_CELULAR ? x : null;
      }, 15000, 700);
      if (!lido) falha(`a TV não viu ${ASSISTIDO.k} com ${POS_CELULAR} s em hist_list depois que o celular assistiu: ` + JSON.stringify(Object.keys(await tvLe(perfilId))));
      if (lido.tipo !== "filme" || lido.titulo !== ASSISTIDO.name || lido.dur !== DURACAO) falha("o item assistido chegou à conta com dados inesperados: " + JSON.stringify(lido));
      if (/http/i.test(JSON.stringify(lido.meta || {}))) falha("o meta do item contém um link (http)");
      console.log(`(4) celular assistiu até ${lido.pos} s; a TV leu em hist_list: ${lido.k.slice(0, 2)}… "${lido.titulo}" ${lido.pos}/${lido.dur} s`);
      await page.eval(`closeMiniPlayer(); 1`);

      // ── 5. O celular remove um item (ação "Remover dos recentes"); a "TV" confirma que sumiu ──
      await page.eval(`_actionSheetContext = { recentId: "resume-vod-e2ehistfilme1" }; runCardAction("recent-remove"); 1`);
      const sumiu = await esperar(async () => { const m = await tvLe(perfilId); return !m[FILME.k] ? m : null; }, 15000, 700);
      if (!sumiu) falha("a TV ainda vê o filme removido no celular em hist_list");
      if (!sumiu[EPISODIO.k] || !sumiu[CANAL.k] || !sumiu[ASSISTIDO.k]) falha("a remoção levou outros itens junto: " + JSON.stringify(Object.keys(sumiu)));
      // sincronizar de novo não o traz de volta
      await page.eval(`_histsync.busy = false; 1`);
      await pg(`(async () => { await syncHistory(); return true; })()`, 30000, 1500);
      const volta = await page.eval(`!!histReadContinue()["resume-vod-e2ehistfilme1"]`);
      if (volta) falha("o filme removido voltou ao celular depois de sincronizar");
      if ((await tvLe(perfilId))[FILME.k]) falha("o filme removido voltou à conta depois de sincronizar");
      console.log(`(5) celular removeu o filme; a TV confirmou em hist_list (restam: ${Object.keys(sumiu).length} itens) e a sincronização não o trouxe de volta`);

      // ── 6. Isolamento: o perfil principal não tem nenhum desses itens ──
      const principalDepois = await tvLe(principalId);
      for (const k of [FILME.k, EPISODIO.k, CANAL.k, ASSISTIDO.k]) {
        if (principalDepois[k] && !histPrincipalAntes[k]) falha(`o item ${k.slice(0, 2)}… do E2E Hist apareceu no histórico do principal na conta`);
      }
      const localPrincipal = await page.eval(`Object.keys(JSON.parse(localStorage.getItem(profKeyFor(CONTINUE_KEY, ${JSON.stringify(principalId)})) || "{}"))`);
      if (localPrincipal.some((k) => /e2ehist/.test(k))) falha("o histórico do E2E Hist vazou para o armazenamento local do principal: " + JSON.stringify(localPrincipal));
      console.log(`(6) o perfil principal não tem os itens (conta: ${Object.keys(principalDepois).length} itens; local: ${localPrincipal.length} em continuar)`);
      ok = true;
    } finally {
      await desvincularCelular(); // celular, sempre
    }
  });
} catch (e) {
  console.error("✖ " + e.message);
} finally {
  // limpeza da "TV" simulada, do progresso e dos perfis E2E, sempre
  if (tokenTv) {
    if (perfilId) await rpc("progress_clear", { p_token: tokenTv, p_key: `vod:${ASSISTIDO.id}`, p_perfil: perfilId }).catch(() => {});
    const l = await rpc("perfil_list", { p_token: tokenTv }).catch(() => null);
    const sobras = l && l.data && Array.isArray(l.data.perfis) ? l.data.perfis.filter((x) => !x.padrao && /^E2E /.test(x.nome)).map((x) => x.id) : [];
    if (perfilId && !sobras.includes(perfilId)) sobras.push(perfilId);
    for (const id of sobras) {
      const del = await rpc("perfil_delete", { p_token: tokenTv, p_id: id }).catch(() => null);
      if (!del || !del.data || del.data.status !== "ok") console.error("aviso: não consegui excluir um perfil E2E: " + JSON.stringify(del && del.data));
    }
    await rpc("device_unlink", { p_token: tokenTv }).catch(() => {});
  }
}

if (!ok) process.exit(1);
console.log('✔ ok: celular cria "E2E Hist" → TV grava filme, episódio e canal → celular mostra em Continue Assistindo/recentes → celular assiste e TV vê o minuto → celular remove e TV confirma → principal isolado');
