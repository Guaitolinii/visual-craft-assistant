// Favoritos por perfil, de ponta a ponta contra o backend REAL.
// O celular é a página real (Chrome/CDP, ?ott=1), ativada de verdade; a "TV" é este script
// (RPCs reais device_start/device_claim/perfil_list/fav_list/fav_set).
// Nunca imprime chaves, senhas nem tokens. Rode UMA vez por hora (limites de taxa: device_start 20/h, device_claim 10/10 min).
// Uso: node scripts/dev/e2e-favoritos.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const MODELO_TV = "TV Favoritos E2E";
const NOME_PERFIL = "E2E Fav";
const FILME = { stream_id: "e2efavfilme1", name: "Filme E2E Favoritos", container_extension: "mp4" };
const SERIE_ID = "e2efavserie1";
const SERIE_TITULO = "Série E2E Favoritos";
const K_FILME = `f:${FILME.stream_id}`;
const K_SERIE = `s:${SERIE_ID}`;

const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;
const falha = (msg) => { throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera uma condição (função async) por até `ms`; devolve o último valor
const esperar = async (fn, ms, passo = 250) => { const fim = Date.now() + ms; let v = null; while (Date.now() < fim) { try { v = await fn(); } catch (e) { v = null; /* página recarregando */ } if (v) return v; await sleep(passo); } return v; };

let tokenTv = null;   // token da "TV" simulada
let perfilId = null;  // id do perfil "E2E Fav" (para a limpeza)
let principalId = null;
let ok = false;

// A "TV" lê os favoritos de um perfil (fav_list) e devolve um mapa chave -> item
const tvLe = async (perfil) => {
  const r = await rpc("fav_list", { p_token: tokenTv, p_perfil: perfil });
  if (r.status !== 200 || !r.data || r.data.status !== "ok" || !Array.isArray(r.data.itens)) falha("fav_list da TV falhou: " + JSON.stringify(r.data));
  return Object.fromEntries(r.data.itens.map((i) => [i.k, i]));
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
      const favsPrincipalAntes = await tvLe(principalId);

      // ── 1. Celular real: ativa, escolhe o principal, cria "E2E Fav" pelo editor e o escolhe ──
      const tokenInicial = await page.eval(`localStorage.getItem("sint_ott_token")`);
      if (tokenInicial) await rpc("device_unlink", { p_token: tokenInicial });
      await page.eval(`localStorage.clear(); sessionStorage.clear(); location.reload()`);
      await page.sleep(4000);
      const codigo = await page.eval(`document.getElementById("ott-code").textContent`);
      if (!/^[A-Z]{4}-\d{4}$/.test(codigo)) falha("o app não mostrou um código válido: " + codigo);
      const claim = await rpc("device_claim", { p_code: codigo }, jwt);
      if (claim.status !== 200) falha("o backend recusou o código do celular: " + JSON.stringify(claim.data));
      if (!(await pg(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`, 60000, 1500))) falha("o celular não liberou depois da confirmação");
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
      console.log(`(1) celular criou "${NOME_PERFIL}"; a TV viu pelo perfil_list`);

      // escolhe o "E2E Fav" (o app recarrega com ele ativo)
      await page.eval(`profileCloseGate(); profileOpenFromUi(false); 1`);
      if (!(await pg(`document.querySelector('#profile-grid .pg-card[data-id="${perfilId}"]') !== null`, 15000, 200))) falha("o seletor não listou o perfil E2E Fav");
      await page.eval(`window.__marca_troca = 1; document.querySelector('#profile-grid .pg-card[data-id="${perfilId}"]').click(); 1`);
      const trocou = await pg(`typeof window.__marca_troca === "undefined" && activeProfileId() === "${perfilId}" && !_profile.booting && !document.documentElement.classList.contains("profile-open")`, 60000, 500);
      if (!trocou) falha("o celular não recarregou com o perfil E2E Fav ativo");
      if (!(await pg(`(getChannels()[0] || {}).name`, 60000, 1000))) falha("a conta de teste não carregou nenhum canal depois da troca de perfil");
      // espera a primeira sincronização do perfil novo (daí em diante a conta manda)
      if (!(await pg(`!_favsync.busy && favSyncLoad(activeProfileId()).feito`, 60000, 500))) falha("o celular não fez a primeira sincronização de favoritos do perfil novo");

      // ── 2. O celular favorita um canal e um filme; a "TV" lê fav_list do perfil ──
      const marca = await page.eval(`(() => {
        const ch = getChannels().find(c => !/^(Combate|ESPN)/i.test(c.name)) || getChannels()[0];
        const antes = isFav(ch);
        toggleFav(ch.id);
        toggleMyListFor(${JSON.stringify(FILME)}, "vod");
        return { nome: ch.name, antes, depois: isFav(ch), chave: ottFavKeyChannel(ch.name), lista: loadMyList().map(e => e.type + ":" + e.id) };
      })()`);
      if (marca.antes || !marca.depois) falha("o canal não ficou favorito no celular: " + JSON.stringify(marca));
      if (!marca.lista.includes("vod:" + FILME.stream_id)) falha("o filme não entrou na Minha lista do celular: " + JSON.stringify(marca.lista));
      if (favsPrincipalAntes[marca.chave]) falha("o canal escolhido já era favorito do principal (teste inconclusivo): " + marca.chave);
      const chaveCanal = marca.chave;
      let lidos = null;
      await esperar(async () => { lidos = await tvLe(perfilId); return lidos[chaveCanal] && lidos[K_FILME]; }, 15000, 700);
      if (!lidos || !lidos[chaveCanal] || !lidos[K_FILME]) falha("a TV não viu os favoritos do celular em fav_list: " + JSON.stringify(Object.keys(lidos || {})));
      if (lidos[chaveCanal].tipo !== "canal" || lidos[K_FILME].tipo !== "filme" || lidos[K_FILME].titulo !== FILME.name) falha("os favoritos vieram com dados inesperados: " + JSON.stringify(lidos));
      console.log(`(2) celular favoritou 1 canal (${chaveCanal.slice(0, 2)}…) e 1 filme (${K_FILME}); a TV leu fav_list: ${Object.keys(lidos).length} itens`);

      // ── 3. A "TV" favorita uma série; o celular, ao sincronizar, a recebe em Minha lista ──
      await esperar(() => page.eval(`favSyncLoad(activeProfileId()).pendentes.length === 0`), 10000, 300); // o envio do celular já foi confirmado
      const setS = await rpc("fav_set", { p_token: tokenTv, p_perfil: perfilId, p_chave: K_SERIE, p_tipo: "serie", p_titulo: SERIE_TITULO, p_capa: "", p_ano: 2024, p_on: true });
      if (setS.status !== 200 || !setS.data || setS.data.status !== "ok") falha("fav_set da série pela TV falhou: " + JSON.stringify(setS.data));
      const recebeu = await pg(`(async () => { await syncFavorites(); return loadMyList().some(e => e.type === "series" && String(e.id) === ${JSON.stringify(SERIE_ID)}); })()`, 30000, 1500);
      if (!recebeu) falha("o celular não recebeu a série da TV em Minha lista depois de sincronizar: " + JSON.stringify(await page.eval(`loadMyList().map(e => e.type + ":" + e.id)`)));
      const estado3 = await page.eval(`({ lista: loadMyList().map(e => e.type + ":" + e.id), titulo: (loadMyList().find(e => e.type === "series") || {}).title })`);
      if (!estado3.lista.includes("vod:" + FILME.stream_id)) falha("o filme sumiu do celular ao receber a série: " + JSON.stringify(estado3.lista));
      if (estado3.titulo !== SERIE_TITULO) falha("o título da série veio errado: " + JSON.stringify(estado3.titulo));
      console.log(`(3) a TV favoritou a série (${K_SERIE}); o celular sincronizou e a tem em Minha lista`);

      // ── 4. A "TV" desmarca o filme; o celular, ao sincronizar, o perde (a série e o canal ficam) ──
      const setF = await rpc("fav_set", { p_token: tokenTv, p_perfil: perfilId, p_chave: K_FILME, p_tipo: "filme", p_titulo: "", p_capa: "", p_ano: 0, p_on: false });
      if (setF.status !== 200 || !setF.data || setF.data.status !== "ok") falha("fav_set (desmarcar o filme) pela TV falhou: " + JSON.stringify(setF.data));
      const perdeu = await pg(`(async () => { await syncFavorites(); return !loadMyList().some(e => e.type === "vod" && String(e.id) === ${JSON.stringify(FILME.stream_id)}); })()`, 30000, 1500);
      if (!perdeu) falha("o celular ainda tem o filme que a TV desmarcou: " + JSON.stringify(await page.eval(`loadMyList().map(e => e.type + ":" + e.id)`)));
      const estado4 = await page.eval(`({ lista: loadMyList().map(e => e.type + ":" + e.id), canalFav: isFav(getChannels().find(c => c.name === ${JSON.stringify(marca.nome)})) })`);
      if (!estado4.lista.includes("series:" + SERIE_ID)) falha("a série sumiu do celular: " + JSON.stringify(estado4.lista));
      if (!estado4.canalFav) falha("o canal favorito sumiu do celular");
      console.log("(4) a TV desmarcou o filme; o celular sincronizou e o perdeu (série e canal continuam)");

      // ── 5. Isolamento: o perfil principal não tem nenhum desses itens ──
      const principalDepois = await tvLe(principalId);
      for (const k of [chaveCanal, K_FILME, K_SERIE]) {
        if (principalDepois[k] && !favsPrincipalAntes[k]) falha(`o item ${k.slice(0, 2)}… do E2E Fav apareceu no perfil principal`);
      }
      const localPrincipal = await page.eval(`({ fav: JSON.parse(localStorage.getItem(profKeyFor("sint_fav", ${JSON.stringify(principalId)})) || "[]"), lista: JSON.parse(localStorage.getItem(profKeyFor("sint_mylist", ${JSON.stringify(principalId)})) || "[]").map(e => e.type + ":" + e.id) })`);
      if (localPrincipal.fav.includes(marca.nome) || localPrincipal.lista.includes("series:" + SERIE_ID) || localPrincipal.lista.includes("vod:" + FILME.stream_id)) falha("os favoritos do E2E Fav vazaram para o armazenamento local do principal");
      console.log(`(5) o perfil principal não tem os itens (conta: ${Object.keys(principalDepois).length} favoritos; local: ${localPrincipal.fav.length} canais, ${localPrincipal.lista.length} na lista)`);
      ok = true;
    } finally {
      await desvincularCelular(); // celular, sempre
    }
  });
} catch (e) {
  console.error("✖ " + e.message);
} finally {
  // limpeza da "TV" simulada e do perfil, sempre
  if (tokenTv) {
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
console.log('✔ ok: celular cria "E2E Fav" → favorita canal e filme → TV lê fav_list → TV favorita série e celular recebe → TV desmarca filme e celular perde → principal isolado');
