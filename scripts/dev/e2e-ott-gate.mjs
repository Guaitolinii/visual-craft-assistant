// Ativação de verdade: o app mostra o código, o "painel" (aqui, o usuário de teste) confirma o código
// pelo backend real e o app libera e carrega as listas. Nunca imprime chaves nem senhas.
// Uso: node scripts/dev/e2e-ott-gate.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;

await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true }, async (page) => {
  // O primeiro carregamento já pediu um código: apaga esse aparelho solto antes de começar do zero
  const tokenInicial = await page.eval(`localStorage.getItem("sint_ott_token")`);
  if (tokenInicial) await rpc("device_unlink", { p_token: tokenInicial });
  await page.eval(`localStorage.clear(); location.reload()`);
  await page.sleep(4000);
  const codigo = await page.eval(`document.getElementById("ott-code").textContent`);
  console.log("código na tela:", codigo);
  if (!/^[A-Z]{4}-\d{4}$/.test(codigo)) { console.error("✖ o app não mostrou um código válido"); process.exit(1); }

  const jwt = await login();
  const claim = await rpc("device_claim", { p_code: codigo }, jwt);
  console.log("confirmação do código:", claim.status, claim.data && claim.data.ok);
  if (claim.status !== 200) { console.error("✖ o backend recusou o código:", JSON.stringify(claim.data)); process.exit(1); }

  // o app consulta a cada 5 s; espera liberar (pode recarregar sozinho ao gravar as listas)
  let liberado = false;
  for (let i = 0; i < 40 && !liberado; i++) {
    await page.sleep(1500);
    try { liberado = await page.eval(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`); } catch (e) { /* página recarregando */ }
  }
  const estado = await page.eval(`({ lista: !!localStorage.getItem("sint_url"), conta: JSON.parse(localStorage.getItem("sint_ott_account") || "null") })`);
  console.log("app liberado:", liberado, "| lista gravada:", estado.lista, "| conta:", estado.conta && estado.conta.status);

  // limpeza: remove o aparelho de teste
  const token = await page.eval(`localStorage.getItem("sint_ott_token")`);
  if (token) await rpc("device_unlink", { p_token: token });

  if (!liberado || !estado.conta) { console.error("✖ o app não liberou depois da confirmação"); process.exit(1); }
  console.log("✔ ok: ativação de ponta a ponta");
});
