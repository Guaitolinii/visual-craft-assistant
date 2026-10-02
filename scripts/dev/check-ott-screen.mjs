// Confere a tela de ativação do celular no Chrome, com o backend FINGIDO (só o visual e o link).
// Uso: node scripts/dev/check-ott-screen.mjs [caminho-da-captura.png]
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const captura = process.argv[2] || "ativacao-celular.png";

// Finge o backend: config e RPC respondem localmente
const preScript = `
  const _f = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    url = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/app-config.json")) return json({ url: "https://falso.supabase.co", anonKey: "chave-falsa" });
    if (url.includes("/rpc/device_start")) return json({ device_token: "tok", code: "ABCD-1234", expires_at: new Date(Date.now() + 15 * 60000).toISOString(), poll_seconds: 5 });
    if (url.includes("/rpc/device_config")) return json({ status: "pending", code: "ABCD-1234", expires_at: new Date(Date.now() + 15 * 60000).toISOString(), poll_seconds: 5 });
    return _f(url, init);
  };
`;

await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true, preScript }, async (page) => {
  await page.sleep(1500);
  const r = await page.eval(`({
    aberta: document.documentElement.classList.contains("ott-open"),
    codigo: document.getElementById("ott-code").textContent,
    link: document.getElementById("ott-open-panel").href,
    qr: document.querySelectorAll("#ott-qr path").length,
    contagem: document.getElementById("ott-timer").textContent,
  })`);
  console.log(r);
  await page.screenshot(captura);
  if (!r.aberta || r.codigo !== "ABCD-1234" || !/codigo=ABCD-1234/.test(r.link) || r.qr !== 1 || !/Código válido por/.test(r.contagem)) {
    console.error("✖ tela de ativação incorreta");
    process.exit(1);
  }
  console.log("✔ ok (captura em " + captura + ")");
});
