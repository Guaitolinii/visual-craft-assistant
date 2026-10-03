// Sincronia de progresso e envio com posição (celular <-> TV), de ponta a ponta contra o backend REAL.
// O celular é a página real (Chrome/CDP, ?ott=1), ativada de verdade; a "TV" é este script
// (RPCs reais device_start/device_claim/progress_put/progress_get/cast_poll/cast_ack/progress_clear).
// O <video> do Chrome não tem mídia: currentTime/duration/paused/play/pause são FINGIDOS na própria página
// (Object.defineProperty no elemento), o resto do app (resume, grava, envio, pausa) é o código real.
// Nunca imprime chaves, senhas nem tokens.
// Uso: node scripts/dev/e2e-sync.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const MODELO_TV = "TV Sync E2E";
const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;
const falha = (msg) => { throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera uma condição (função async) por até `ms`; devolve o último valor
const esperar = async (fn, ms, passo = 250) => { const fim = Date.now() + ms; let v = null; while (Date.now() < fim) { v = await fn(); if (v) return v; await sleep(passo); } return v; };

const POS_TV = 1234;      // minuto gravado pela "TV"
const POS_CELULAR = 2000; // minuto a que o celular "anda"
const DURACAO = 7200;     // duração fingida do filme

let tokenTv = null;  // token da "TV" simulada
let chave = null;    // chave de progresso usada (para o progress_clear)
let ok = false;

try {
  await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true }, async (page) => {
    const desvincularCelular = async () => {
      try {
        const t = await page.eval(`localStorage.getItem("sint_ott_token")`);
        if (t) await rpc("device_unlink", { p_token: t });
      } catch (e) { /* página indisponível */ }
    };
    try {
      // ── 1. Cria a "TV" (device_start + device_claim) e ativa o celular de verdade ──
      const jwt = await login();
      if (!jwt) falha("não consegui entrar com o usuário de teste");
      const start = await rpc("device_start", { p_modelo: MODELO_TV, p_sistema: "node" });
      if (start.status !== 200 || !start.data || !start.data.device_token) falha("device_start da TV falhou: " + JSON.stringify(start.data));
      tokenTv = start.data.device_token;
      const claimTv = await rpc("device_claim", { p_code: start.data.code }, jwt);
      if (claimTv.status !== 200) falha("device_claim da TV falhou: " + JSON.stringify(claimTv.data));
      await rpc("cast_poll", { p_token: tokenTv }); // a TV "aparece online" para o celular
      console.log("TV simulada ativada");

      const tokenInicial = await page.eval(`localStorage.getItem("sint_ott_token")`);
      if (tokenInicial) await rpc("device_unlink", { p_token: tokenInicial });
      await page.eval(`localStorage.clear(); location.reload()`);
      await page.sleep(4000);
      const codigo = await page.eval(`document.getElementById("ott-code").textContent`);
      if (!/^[A-Z]{4}-\d{4}$/.test(codigo)) falha("o app não mostrou um código válido: " + codigo);
      const claim = await rpc("device_claim", { p_code: codigo }, jwt);
      if (claim.status !== 200) falha("o backend recusou o código do celular: " + JSON.stringify(claim.data));
      let liberado = false;
      for (let i = 0; i < 40 && !liberado; i++) {
        await page.sleep(1500);
        try { liberado = await page.eval(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`); } catch (e) { /* recarregando */ }
      }
      if (!liberado) falha("o celular não liberou depois da confirmação");
      // as listas podem recarregar a página ao serem gravadas: espera haver canais
      let nome = null;
      for (let i = 0; i < 40 && !nome; i++) {
        try { nome = await page.eval(`(getChannels()[0] || {}).name || null`); } catch (e) { /* recarregando */ }
        if (!nome) await page.sleep(1000);
      }
      if (!nome) falha("a conta de teste não carregou nenhum canal no celular");
      console.log("celular ativado");

      // ── 2. Filme de teste: o primeiro com stream_id da lista VOD da conta (lida aqui no Node, sem CORS) ──
      let filme = null;
      let origem = "sintético (a conta de teste não tem VOD acessível)";
      try {
        const creds = await page.eval(`(() => { const c = parseXtreamCredentials(localStorage.getItem(LS.VOD_URL)); return c ? { base: c.base, u: c.username, p: c.password } : null; })()`);
        if (creds) {
          const api = (action, extra = {}) => `${creds.base}/player_api.php?` + new URLSearchParams({ username: creds.u, password: creds.p, action, ...extra }).toString();
          const get = async (u) => (await fetch(u, { signal: AbortSignal.timeout(25000) })).json();
          const cats = await get(api("get_vod_categories"));
          for (const c of (Array.isArray(cats) ? cats.slice(0, 5) : []).filter(Boolean)) {
            const lista = await get(api("get_vod_streams", { category_id: c.category_id }));
            const f = (Array.isArray(lista) ? lista : []).find((x) => x && x.stream_id && (x.name || x.title));
            if (f) { filme = { stream_id: String(f.stream_id), name: String(f.name || f.title), container_extension: f.container_extension || "mp4" }; break; }
          }
          if (filme) origem = "real da lista VOD da conta";
        }
      } catch (e) { /* sem VOD acessível: cai no filme sintético */ }
      if (!filme) filme = { stream_id: "e2esync1", name: "Filme E2E Sync", container_extension: "mp4" };
      chave = `vod:${filme.stream_id}`;
      console.log(`filme de teste (${origem}): stream_id ${filme.stream_id}`);

      // ── 3. A "TV" grava o minuto (progress_put); o celular abre o filme e retoma por ele ──
      const put = await rpc("progress_put", { p_token: tokenTv, p_key: chave, p_kind: "vod", p_position: POS_TV, p_duration: DURACAO });
      if (put.status !== 200 || !put.data || put.data.status !== "ok") falha("progress_put da TV falhou: " + JSON.stringify(put.data));

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
      const item = { stream_id: filme.stream_id, name: filme.name, container_extension: filme.container_extension };
      // URL falsa (nada é baixado): o foco é o minuto, não a mídia
      await page.eval(`playVodSelection("https://e2e-sync.invalid/filme.mp4", { id: ${JSON.stringify(item.stream_id)}, contType: "vod", title: ${JSON.stringify(item.name)}, cover: null, vodItem: ${JSON.stringify(item)}, castInfo: { kind: "vod", item: ${JSON.stringify(item)} } }); 1`);
      const retomou = await esperar(() => page.eval(`window.__fake.t === ${POS_TV}`), 15000);
      const tAtual = await page.eval(`window.__fake.t`);
      if (!retomou) falha(`o celular não retomou pelo minuto da TV (esperado ${POS_TV}, currentTime = ${tAtual})`);
      console.log(`celular retomou pelo minuto gravado pela TV: ${tAtual}`);

      // ── 4. O celular "anda" até 2000 s e grava na conta; a "TV" lê o mesmo minuto ──
      await page.eval(`window.__fake.t = ${POS_CELULAR}; pushProgressToAccount(true); 1`);
      const lido = await esperar(async () => {
        const r = await rpc("progress_get", { p_token: tokenTv, p_key: chave });
        return r.data && r.data.found === true && Number(r.data.position_sec) === POS_CELULAR ? r.data : null;
      }, 10000, 500);
      if (!lido) falha(`a TV não leu ${POS_CELULAR} s em progress_get depois que o celular gravou`);
      console.log(`celular gravou ${lido.position_sec} s; a TV leu o mesmo valor`);

      // ── 5. Envio com posição: o celular dispara; a "TV" recebe positionSec === 2000 ──
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
      if (comando.payload.positionSec !== POS_CELULAR) falha(`positionSec esperado ${POS_CELULAR}, veio ${JSON.stringify(comando.payload.positionSec)}`);
      if (/http/i.test(JSON.stringify(comando.payload))) falha("o payload contém um link (http)");
      console.log("TV recebeu:", comando.kind, "| positionSec:", comando.payload.positionSec, "| sem http no payload");

      // ── 6. A "TV" confirma que tocou: o celular pausa e avisa ──
      const ack = await rpc("cast_ack", { p_token: tokenTv, p_id: comando.id, p_status: "played", p_motivo: "" });
      if (ack.status !== 200 || !ack.data || ack.data.status !== "ok") falha("cast_ack falhou: " + JSON.stringify(ack.data));
      const pausou = await esperar(() => page.eval(`document.getElementById("player-video").paused === true`), 12000, 200);
      if (!pausou) falha("o celular não pausou depois do cast_ack played");
      // o aviso aparece logo depois da pausa (mesmo ciclo de acompanhamento do celular)
      const avisou = await esperar(() => page.eval(`window.__vistos.includes("Tocando na TV")`), 10000, 100);
      console.log("avisos vistos no celular:", JSON.stringify(await page.eval(`window.__vistos`)));
      if (!avisou) falha('o celular não mostrou "Tocando na TV"');
      console.log("celular pausou (video.paused = true) depois do ack");
      ok = true;
    } finally {
      await desvincularCelular(); // celular, sempre
    }
  });
} catch (e) {
  console.error("✖ " + e.message);
} finally {
  // limpeza da "TV" simulada e do progresso, sempre
  if (tokenTv) {
    if (chave) await rpc("progress_clear", { p_token: tokenTv, p_key: chave }).catch(() => {});
    await rpc("device_unlink", { p_token: tokenTv }).catch(() => {});
  }
}

if (!ok) process.exit(1);
console.log("✔ ok: TV grava → celular retoma → celular grava → TV lê → envio com positionSec → ack → celular pausa");
