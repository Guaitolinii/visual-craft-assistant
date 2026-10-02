// Envio do celular para a TV, de ponta a ponta contra o backend REAL.
// O celular é a página real (Chrome/CDP, ?ott=1), ativada de verdade; a "TV" é este script
// (RPCs reais device_start/device_claim/cast_poll/cast_ack). Nunca imprime chaves, senhas nem tokens.
// Uso: node scripts/dev/e2e-cast.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const MODELO_TV = "TV Cast E2E";
const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;
const falha = (msg) => { throw new Error(msg); };

let tokenTv = null; // token da "TV" simulada (para a limpeza)
let ok = false;

try {
  await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true }, async (page) => {
    try {
      // ── 1. Cria a "TV": device_start (tipo tv) + device_claim com o usuário de teste ──
      const jwt = await login();
      if (!jwt) falha("não consegui entrar com o usuário de teste");
      const start = await rpc("device_start", { p_modelo: MODELO_TV, p_sistema: "node" });
      if (start.status !== 200 || !start.data || !start.data.device_token) falha("device_start da TV falhou: " + JSON.stringify(start.data));
      tokenTv = start.data.device_token;
      const claimTv = await rpc("device_claim", { p_code: start.data.code }, jwt);
      if (claimTv.status !== 200) falha("device_claim da TV falhou: " + JSON.stringify(claimTv.data));
      await rpc("cast_poll", { p_token: tokenTv }); // a TV "aparece online" para o celular
      console.log("TV simulada ativada");

      // ── 2. Celular real: limpa, espera o código, ativa e espera o modo conta ──
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
        try { liberado = await page.eval(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`); } catch (e) { /* página recarregando */ }
      }
      if (!liberado) falha("o celular não liberou depois da confirmação");
      // as listas podem recarregar a página ao serem gravadas: espera haver canais
      let nome = null;
      for (let i = 0; i < 40 && !nome; i++) {
        try { nome = await page.eval(`(getChannels()[0] || {}).name || null`); } catch (e) { /* recarregando */ }
        if (!nome) await page.sleep(1000);
      }
      if (!nome) falha("a conta de teste não carregou nenhum canal no celular");
      console.log("celular ativado; primeiro canal:", nome);

      // ── 3. No celular: seleciona o canal e dispara o envio (sem esperar o fluxo terminar) ──
      await page.eval(`window.__vistos = []; window.__obs = setInterval(() => { const t = document.getElementById("toast").textContent; if (t && !window.__vistos.includes(t)) window.__vistos.push(t); }, 100); 1`);
      await page.eval(`(() => { const ch = getChannels()[0]; selectChannel(ch, false); window.__cast = castToTv("channel", ch); return 1; })()`);

      // Se a conta de teste tiver mais de uma TV, o app abre a folha de escolha: escolhe a "TV" simulada
      await page.sleep(1500);
      const folha = await page.eval(`!document.getElementById("tv-sheet").classList.contains("hidden")`);
      if (folha) {
        const clicou = await page.eval(`(() => { const b = [...document.querySelectorAll("#tv-sheet-list .tv-sheet-btn")].find(x => x.textContent.includes(${JSON.stringify(MODELO_TV)})); if (b) b.click(); return !!b; })()`);
        if (!clicou) falha("a folha de escolha abriu, mas não achei a TV simulada");
        console.log("folha de escolha de TV: escolhi a TV simulada");
      }

      // ── 4. A "TV" consulta a fila (até 20 s) e recebe o comando ──
      let comando = null;
      for (let i = 0; i < 20 && !comando; i++) {
        const r = await rpc("cast_poll", { p_token: tokenTv });
        if (r.data && r.data.status !== "ok") falha("cast_poll devolveu " + JSON.stringify(r.data));
        comando = r.data && r.data.command;
        if (!comando) await page.sleep(1000);
      }
      if (!comando) falha("a TV não recebeu comando em 20 s");
      if (comando.kind !== "channel") falha("kind inesperado: " + comando.kind);
      if (!comando.payload || comando.payload.name !== nome) falha("o nome no payload não bate: " + JSON.stringify(comando.payload));
      if (/http/i.test(JSON.stringify(comando.payload))) falha("o payload contém um link (http)");
      console.log("TV recebeu:", comando.kind, "|", comando.payload.name, "| de:", comando.from);

      // ── 5. A "TV" confirma que tocou ──
      const ack = await rpc("cast_ack", { p_token: tokenTv, p_id: comando.id, p_status: "played", p_motivo: "" });
      if (ack.status !== 200 || !ack.data || ack.data.status !== "ok") falha("cast_ack falhou: " + JSON.stringify(ack.data));

      // ── 6. O celular mostra "Tocando na TV" (até 10 s) ──
      let tocou = false;
      for (let i = 0; i < 100 && !tocou; i++) {
        tocou = await page.eval(`window.__vistos.includes("Tocando na TV")`);
        if (!tocou) await page.sleep(100);
      }
      console.log("avisos vistos no celular:", JSON.stringify(await page.eval(`window.__vistos`)));
      if (!tocou) falha('o celular não mostrou "Tocando na TV"');

      // limpeza do celular (token do localStorage)
      const tokenCel = await page.eval(`localStorage.getItem("sint_ott_token")`);
      if (tokenCel) await rpc("device_unlink", { p_token: tokenCel });
      ok = true;
    } catch (e) {
      // limpeza do celular também em caso de falha
      try {
        const tokenCel = await page.eval(`localStorage.getItem("sint_ott_token")`);
        if (tokenCel) await rpc("device_unlink", { p_token: tokenCel });
      } catch (e2) { /* página indisponível */ }
      throw e;
    }
  });
} catch (e) {
  console.error("✖ " + e.message);
} finally {
  // limpeza da "TV" simulada, sempre
  if (tokenTv) await rpc("device_unlink", { p_token: tokenTv }).catch(() => {});
}

if (!ok) process.exit(1);
console.log('✔ ok: celular → fila → TV → ack → "Tocando na TV"');
