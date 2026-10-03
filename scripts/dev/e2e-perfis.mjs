// Perfis, dados por perfil e envio, de ponta a ponta contra o backend REAL.
// O celular é a página real (Chrome/CDP, ?ott=1), ativada de verdade; a "TV" é este script
// (RPCs reais device_start/device_claim/perfil_list/progress_put/progress_get/cast_poll/cast_ack).
// O <video> do Chrome não tem mídia: currentTime/duration/paused/play/pause são FINGIDOS na própria página
// (Object.defineProperty no elemento); o resto do app (perfis, favoritos, resume, grava, envio) é o código real.
// Nunca imprime chaves, senhas nem tokens. Rode UMA vez por hora (limites de taxa: device_start 20/h, device_claim 10/10 min).
// Uso: node scripts/dev/e2e-perfis.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const MODELO_TV = "TV Perfis E2E";
const NOME_BIA = "E2E Bia";
const AVATAR_BIA = "claquete";
const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;
const falha = (msg) => { throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera uma condição (função async) por até `ms`; devolve o último valor
const esperar = async (fn, ms, passo = 250) => { const fim = Date.now() + ms; let v = null; while (Date.now() < fim) { try { v = await fn(); } catch (e) { v = null; /* página recarregando */ } if (v) return v; await sleep(passo); } return v; };

const POS_PRINCIPAL = 3000; // minuto do filme no perfil principal (gravado pela "TV")
const POS_BIA = 1234;       // minuto do mesmo filme no perfil "E2E Bia" (gravado pela "TV")
const POS_CELULAR = 2000;   // minuto a que o celular "anda" no perfil "E2E Bia"
const DURACAO = 7200;       // duração fingida do filme

let tokenTv = null;   // token da "TV" simulada
let biaId = null;     // id do perfil "E2E Bia" (para a limpeza)
let principalId = null;
let chave = null;     // chave de progresso usada (para o progress_clear)
let ok = false;

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
      // ── 1. Cria a "TV" (device_start + device_claim); a "TV" lista os perfis (cria o principal) ──
      const jwt = await login();
      if (!jwt) falha("não consegui entrar com o usuário de teste");
      const start = await rpc("device_start", { p_modelo: MODELO_TV, p_sistema: "node" });
      if (start.status !== 200 || !start.data || !start.data.device_token) falha("device_start da TV falhou: " + JSON.stringify(start.data));
      tokenTv = start.data.device_token;
      const claimTv = await rpc("device_claim", { p_code: start.data.code }, jwt);
      if (claimTv.status !== 200) falha("device_claim da TV falhou: " + JSON.stringify(claimTv.data));
      await rpc("cast_poll", { p_token: tokenTv }); // a TV "aparece online" para o celular
      console.log("TV simulada ativada");

      let lista = await rpc("perfil_list", { p_token: tokenTv });
      if (lista.status !== 200 || !lista.data || lista.data.status !== "ok" || !Array.isArray(lista.data.perfis)) falha("perfil_list da TV falhou: " + JSON.stringify(lista.data));
      // sobra de uma rodada anterior interrompida: remove os perfis E2E (nunca o principal)
      for (const p of lista.data.perfis.filter((x) => !x.padrao && /^E2E /.test(x.nome))) await rpc("perfil_delete", { p_token: tokenTv, p_id: p.id });
      lista = await rpc("perfil_list", { p_token: tokenTv });
      const principal = lista.data.perfis.find((p) => p.padrao);
      if (!principal) falha("perfil_list não criou o perfil principal: " + JSON.stringify(lista.data));
      if (lista.data.perfis.length >= 5) falha("a conta de teste já tem 5 perfis: não dá para criar o E2E Bia");
      principalId = principal.id;
      console.log(`(1) perfil_list criou o principal "${principal.nome}" (padrao = true); perfis na conta: ${lista.data.perfis.length}`);

      // ── 2. Celular real: limpa, espera o código, ativa e espera o modo conta e o perfil principal ativo ──
      const tokenInicial = await page.eval(`localStorage.getItem("sint_ott_token")`);
      if (tokenInicial) await rpc("device_unlink", { p_token: tokenInicial });
      await page.eval(`localStorage.clear(); sessionStorage.clear(); location.reload()`);
      await page.sleep(4000);
      const codigo = await page.eval(`document.getElementById("ott-code").textContent`);
      if (!/^[A-Z]{4}-\d{4}$/.test(codigo)) falha("o app não mostrou um código válido: " + codigo);
      const claim = await rpc("device_claim", { p_code: codigo }, jwt);
      if (claim.status !== 200) falha("o backend recusou o código do celular: " + JSON.stringify(claim.data));
      let liberado = await pg(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`, 60000, 1500);
      if (!liberado) falha("o celular não liberou depois da confirmação");
      // com mais de 1 perfil na conta o app pergunta quem está assistindo: escolhe o principal
      const ativouPrincipal = await esperar(async () => {
        const s = await page.eval(`({ ativo: activeProfileId(), aberto: document.documentElement.classList.contains("profile-open"), boot: _profile.booting, lista: _profile.list.length })`);
        if (s.aberto && !s.boot && s.lista) await page.eval(`profileChoose(_profile.list.find(p => p.padrao)); 1`);
        return s.ativo === principalId && !s.aberto && !s.boot;
      }, 60000, 1500);
      if (!ativouPrincipal) falha("o celular não ficou com o perfil principal ativo");
      if (!(await pg(`(getChannels()[0] || {}).name`, 60000, 1000))) falha("a conta de teste não carregou nenhum canal no celular");
      console.log("celular ativado, com o perfil principal ativo");

      // ── 3. O celular cria "E2E Bia" pelo editor; a "TV" vê pelo perfil_list ──
      await page.eval(`profileOpenFromUi(true); 1`);
      if (!(await pg(`document.querySelector("#profile-grid .pg-add") !== null`, 15000, 200))) falha("o modo gerenciar não mostrou o cartão Adicionar perfil");
      await page.eval(`document.querySelector("#profile-grid .pg-add").click(); 1`);
      if (!(await pg(`!document.getElementById("profile-editor").hidden`, 5000, 150))) falha("o editor de perfil não abriu");
      await page.eval(`(() => {
        document.querySelector('#profile-avatar-grid .pe-av[data-av="${AVATAR_BIA}"]').click();
        const inp = document.getElementById("profile-name-input"); inp.value = ${JSON.stringify(NOME_BIA)}; inp.dispatchEvent(new Event("input"));
        document.getElementById("profile-save-btn").click();
        return 1;
      })()`);
      if (!(await pg(`!document.getElementById("profile-picker").hidden`, 15000, 200))) {
        falha("o editor não salvou o perfil: " + (await page.eval(`document.getElementById("profile-error").textContent`)));
      }
      const vistoPelaTv = await esperar(async () => {
        const r = await rpc("perfil_list", { p_token: tokenTv });
        return (r.data && Array.isArray(r.data.perfis) && r.data.perfis.find((p) => p.nome === NOME_BIA)) || null;
      }, 10000, 500);
      if (!vistoPelaTv) falha(`a "TV" não viu o perfil "${NOME_BIA}" no perfil_list`);
      if (vistoPelaTv.avatar !== AVATAR_BIA || vistoPelaTv.padrao !== false) falha("o perfil criado veio com dados inesperados: " + JSON.stringify(vistoPelaTv));
      biaId = vistoPelaTv.id;
      console.log(`(2) celular criou "${NOME_BIA}" (avatar ${vistoPelaTv.avatar}); a TV viu pelo perfil_list`);

      // ── 4. O celular escolhe "E2E Bia": recarrega, a saudação muda e os favoritos são independentes ──
      const h1Antes = await page.eval(`document.getElementById("welcome-h1").textContent`);
      await page.eval(`profileCloseGate(); profileOpenFromUi(false); 1`); // seletor normal (sai do modo gerenciar)
      if (!(await pg(`document.querySelector('#profile-grid .pg-card[data-id="${biaId}"]') !== null`, 15000, 200))) falha("o seletor não listou o perfil E2E Bia");
      await page.eval(`window.__marca_troca = 1; document.querySelector('#profile-grid .pg-card[data-id="${biaId}"]').click(); 1`);
      const trocou = await pg(`typeof window.__marca_troca === "undefined" && typeof profileBoot === "function" && activeProfileId() === "${biaId}" && !_profile.booting && !document.documentElement.classList.contains("profile-open")`, 60000, 500);
      if (!trocou) falha("o celular não recarregou com o perfil E2E Bia ativo");
      const h1Depois = await pg(`/^(Bom dia|Boa tarde|Boa noite), ${NOME_BIA}\\.$/.test(document.getElementById("welcome-h1").textContent) && document.getElementById("welcome-h1").textContent`, 20000, 300);
      if (!h1Depois) falha(`a saudação não mostrou "${NOME_BIA}": ${JSON.stringify(await page.eval(`document.getElementById("welcome-h1").textContent`))}`);
      if (h1Antes === h1Depois) falha("a saudação não mudou ao trocar de perfil: " + h1Depois);
      console.log(`(3) celular escolheu "${NOME_BIA}"; saudação: ${JSON.stringify(h1Antes)} -> ${JSON.stringify(h1Depois)}`);
      if (!(await pg(`(getChannels()[0] || {}).name`, 60000, 1000))) falha("a conta de teste não carregou nenhum canal depois da troca de perfil");

      // favoritos: marca um canal no "E2E Bia" e confere que o principal não o tem
      const fav = await page.eval(`(() => {
        const ch = getChannels().find(c => !/^(Combate|ESPN)/i.test(c.name)) || getChannels()[0];
        const antes = isFav(ch);
        toggleFav(ch.id);
        return { nome: ch.name, antes, depois: isFav(ch), bia: JSON.parse(localStorage.getItem(profKeyFor("sint_fav", ${JSON.stringify(biaId)})) || "[]"),
                 principal: JSON.parse(localStorage.getItem(profKeyFor("sint_fav", ${JSON.stringify(principalId)})) || "[]"), ativo: profKey("sint_fav") };
      })()`);
      if (fav.antes) falha("o E2E Bia já começou com o canal favorito: " + JSON.stringify(fav));
      if (!fav.depois || !fav.bia.includes(fav.nome)) falha("o favorito não ficou no E2E Bia: " + JSON.stringify(fav));
      if (fav.bia.length !== 1) falha("o E2E Bia deveria ter só 1 favorito (os do principal não vazam): " + JSON.stringify(fav.bia));
      if (fav.principal.includes(fav.nome)) falha("o favorito do E2E Bia apareceu no principal: " + JSON.stringify(fav.principal));
      if (fav.ativo !== "sint_p" + biaId.slice(0, 8) + "_fav") falha("a chave de favoritos do perfil ativo está errada: " + fav.ativo);
      console.log(`(4) favorito "${fav.nome}" só no E2E Bia (Bia: ${fav.bia.length} favorito; principal: ${fav.principal.length}, sem ele)`);

      // ── 5. Filme de teste sintético; a "TV" grava minutos DIFERENTES nos dois perfis ──
      const filme = { stream_id: "e2eperfis1", name: "Filme E2E Perfis", container_extension: "mp4" };
      chave = `vod:${filme.stream_id}`;
      const putP = await rpc("progress_put", { p_token: tokenTv, p_key: chave, p_kind: "vod", p_position: POS_PRINCIPAL, p_duration: DURACAO, p_perfil: principalId });
      const putB = await rpc("progress_put", { p_token: tokenTv, p_key: chave, p_kind: "vod", p_position: POS_BIA, p_duration: DURACAO, p_perfil: biaId });
      if (putP.status !== 200 || !putP.data || putP.data.status !== "ok") falha("progress_put do principal falhou: " + JSON.stringify(putP.data));
      if (putB.status !== 200 || !putB.data || putB.data.status !== "ok") falha("progress_put do E2E Bia falhou: " + JSON.stringify(putB.data));

      // Fingimos o <video> (sem mídia no Chrome headless): tempo, duração, estado e play/pause
      await page.eval(`(() => {
        localStorage.removeItem(CONTINUE_KEY); // regra do mais recente: o minuto local do celular fica vazio
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
      // URL falsa (nada é baixado): o foco é o minuto, não a mídia
      await page.eval(`playVodSelection("https://e2e-perfis.invalid/filme.mp4", { id: ${JSON.stringify(filme.stream_id)}, contType: "vod", title: ${JSON.stringify(filme.name)}, cover: null, vodItem: ${JSON.stringify(filme)}, castInfo: { kind: "vod", item: ${JSON.stringify(filme)} } }); 1`);
      const retomou = await pg(`window.__fake.t === ${POS_BIA}`, 15000);
      const tAtual = await page.eval(`window.__fake.t`);
      if (!retomou) falha(`o celular não retomou pelo minuto do E2E Bia (esperado ${POS_BIA}, currentTime = ${tAtual}; o do principal é ${POS_PRINCIPAL})`);
      console.log(`(5) celular (E2E Bia) retomou em ${tAtual} s, não nos ${POS_PRINCIPAL} s do principal`);

      // ── 6. O celular "anda" até 2000 s e grava; a "TV" lê por perfil; o do principal não muda ──
      await page.eval(`window.__fake.t = ${POS_CELULAR}; pushProgressToAccount(true); 1`);
      const lidoBia = await esperar(async () => {
        const r = await rpc("progress_get", { p_token: tokenTv, p_key: chave, p_perfil: biaId });
        return r.data && r.data.found === true && Number(r.data.position_sec) === POS_CELULAR ? r.data : null;
      }, 10000, 500);
      if (!lidoBia) falha(`a TV não leu ${POS_CELULAR} s do E2E Bia em progress_get depois que o celular gravou`);
      const lidoPrincipal = await rpc("progress_get", { p_token: tokenTv, p_key: chave, p_perfil: principalId });
      if (!lidoPrincipal.data || lidoPrincipal.data.found !== true || Number(lidoPrincipal.data.position_sec) !== POS_PRINCIPAL) falha("o minuto do principal mudou: " + JSON.stringify(lidoPrincipal.data));
      console.log(`(6) celular gravou ${lidoBia.position_sec} s; a TV leu no E2E Bia; o principal continua em ${lidoPrincipal.data.position_sec} s`);

      // ── 7. Envio: o celular dispara; a "TV" recebe perfilId do E2E Bia, positionSec e nenhum http ──
      await page.eval(`window.__vistos = []; window.__obs = setInterval(() => { const t = document.getElementById("toast").textContent; if (t && !window.__vistos.includes(t)) window.__vistos.push(t); }, 100); castCurrentToTv(); 1`);
      await page.sleep(1500);
      // Se a conta de teste tiver mais de uma TV, o app abre a folha de escolha: escolhe a "TV" simulada
      const folha = await page.eval(`!document.getElementById("tv-sheet").classList.contains("hidden")`);
      if (folha) {
        const clicou = await page.eval(`(() => { const b = [...document.querySelectorAll("#tv-sheet-list .tv-sheet-btn")].find(x => x.textContent.includes(${JSON.stringify(MODELO_TV)})); if (b) b.click(); return !!b; })()`);
        if (!clicou) falha("a folha de escolha abriu, mas não achei a TV simulada");
        console.log("folha de escolha de TV: escolhi a TV simulada");
      }
      let comando = null;
      for (let i = 0; i < 20 && !comando; i++) {
        const r = await rpc("cast_poll", { p_token: tokenTv });
        if (r.data && r.data.status !== "ok") falha("cast_poll devolveu " + JSON.stringify(r.data));
        comando = r.data && r.data.command;
        if (!comando) await sleep(1000);
      }
      if (!comando) falha("a TV não recebeu comando em 20 s");
      if (comando.kind !== "vod") falha("kind inesperado: " + comando.kind);
      if (!comando.payload || comando.payload.streamId !== filme.stream_id) falha("o streamId no payload não bate: " + JSON.stringify(comando.payload));
      if (comando.payload.perfilId !== biaId) falha(`perfilId esperado ${biaId}, veio ${JSON.stringify(comando.payload.perfilId)}`);
      if (comando.payload.positionSec !== POS_CELULAR) falha(`positionSec esperado ${POS_CELULAR}, veio ${JSON.stringify(comando.payload.positionSec)}`);
      if (/http/i.test(JSON.stringify(comando.payload))) falha("o payload contém um link (http)");
      console.log("(7) TV recebeu:", comando.kind, "| perfilId = E2E Bia | positionSec:", comando.payload.positionSec, "| sem http no payload");
      const ack = await rpc("cast_ack", { p_token: tokenTv, p_id: comando.id, p_status: "played", p_motivo: "" });
      if (ack.status !== 200 || !ack.data || ack.data.status !== "ok") falha("cast_ack falhou: " + JSON.stringify(ack.data));
      ok = true;
    } finally {
      await desvincularCelular(); // celular, sempre
    }
  });
} catch (e) {
  console.error("✖ " + e.message);
} finally {
  // limpeza da "TV" simulada, do perfil e do progresso, sempre
  if (tokenTv) {
    if (chave) {
      if (biaId) await rpc("progress_clear", { p_token: tokenTv, p_key: chave, p_perfil: biaId }).catch(() => {});
      if (principalId) await rpc("progress_clear", { p_token: tokenTv, p_key: chave, p_perfil: principalId }).catch(() => {});
    }
    if (!biaId) {
      // falhou antes de eu saber o id: procura pelo nome (nunca mexe no principal)
      const l = await rpc("perfil_list", { p_token: tokenTv }).catch(() => null);
      const p = l && l.data && Array.isArray(l.data.perfis) ? l.data.perfis.find((x) => !x.padrao && x.nome === NOME_BIA) : null;
      if (p) biaId = p.id;
    }
    if (biaId) {
      const del = await rpc("perfil_delete", { p_token: tokenTv, p_id: biaId }).catch(() => null);
      if (!del || !del.data || del.data.status !== "ok") console.error("aviso: não consegui excluir o perfil E2E Bia: " + JSON.stringify(del && del.data));
    }
    await rpc("device_unlink", { p_token: tokenTv }).catch(() => {});
  }
}

if (!ok) process.exit(1);
console.log('✔ ok: perfil principal → celular cria "E2E Bia" → TV vê → saudação e favoritos por perfil → minutos separados → envio com perfilId e sem http');
