// Teste no Chrome real da aba Jogos: serve o app e um jogos.json de teste, abre a aba e confere seções, cards e cliques.
// Uso: node scripts/dev/check-jogos-web.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");
const agora = Math.floor(Date.now() / 1000);
const jogo = (id, esporte, casa, fora, ini, dur, canais, provaveis) => ({
  id, esporte, competicao: esporte === "nfl" ? "NFL" : "Brasileirão Série A", casa: { nome: casa, escudo: "" }, fora: { nome: fora, escudo: "" },
  inicio: agora + ini, fim: agora + ini + dur, canais, provaveis,
});
const JOGOS = { v: 1, gerado: agora, fuso: "America/Sao_Paulo", jogos: [
  jogo("vivo", "futebol", "Flamengo", "Palmeiras", -1800, 5400, ["sportv"], []),
  jogo("incerto", "futebol", "Coritiba", "Grêmio", 3600, 7200, [], ["premiere 1", "premiere 3"]),
  jogo("sem-canal", "futebol", "Remo", "Paysandu", 5400, 7200, ["tnt sports"], []),
  jogo("nfl", "nfl", "Eagles", "Cowboys", 7200, 12600, ["espn 2"], []),
] };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/app/index.html") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(APP); }
  if (u.pathname === "/jogos.json") { res.setHeader("access-control-allow-origin", "*"); return res.end(JSON.stringify(JOGOS)); }
  res.statusCode = 404; res.end("nada");
}).listen(8098);

const dir = mkdtempSync(path.join(tmpdir(), "chr-"));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--remote-debugging-port=9336", `--user-data-dir=${dir}`, "--no-first-run", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await (await fetch("http://127.0.0.1:9336/json")).json(); break; } catch { await sleep(250); } }
const alvo = await (await fetch("http://127.0.0.1:9336/json/new?" + encodeURIComponent("http://localhost:8098/app/index.html?noott=1"), { method: "PUT" })).json();
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const call = (method, params = {}) => new Promise((r) => { const i = ++id; const h = (m) => { const d = JSON.parse(m.data); if (d.id === i) { ws.removeEventListener("message", h); r(d.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? "ERRO: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result.value; };
await call("Runtime.enable");
const erros = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") erros.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); });
await sleep(2500);

// O endereço do arquivo é uma constante do app: confere que aponta para o vod-data e troca só o fetch para usar o servidor local
console.log("1) a constante aponta para o vod-data:", await ev(`JOGOS_URL.includes("/vod-data/jogos.json")`));
await ev(`(() => { const orig = window.fetch; window.fetch = (u, o) => orig(String(u).includes("raw.githubusercontent.com") ? "http://localhost:8098/jogos.json" : u, o); return 1 })()`);
// Canais de teste direto no estado (sem redesenhar o catálogo) e um selectChannel de mentira que só anota o id
await ev(`_state.channels = [
  { id: 1, name: "SporTV HD", url: "http://x/1.ts", category: "Esportes" }, { id: 2, name: "SporTV FHD", url: "http://x/2.ts", category: "Esportes" },
  { id: 3, name: "Premiere 1 HD", url: "http://x/3.ts", category: "Esportes" }, { id: 4, name: "Premiere 3 FHD", url: "http://x/4.ts", category: "Esportes" },
  { id: 5, name: "ESPN 2 HD", url: "http://x/5.ts", category: "Esportes" } ]`);
await ev(`window.__tocados = []; selectChannel = (ch) => { window.__tocados.push(ch.id); }`);
console.log("2) abrir a aba:", await ev(`(openJogosSection(), "ok")`));
await sleep(1500);
console.log("3) seção e menu:", await ev(`({ secao: _state.section, vistoMenu: !document.getElementById("jogos-view").classList.contains("hidden"), ativo: document.querySelector("#nav-jogos-btn").classList.contains("active") })`));
console.log("4) títulos das seções:", await ev(`[...document.querySelectorAll("#jogos-content h2, #jogos-content .jogos-grupo")].map(h => h.textContent)`));
console.log("5) selo AO VIVO só no jogo em andamento:", await ev(`[...document.querySelectorAll(".jogo-card")].map(c => c.dataset.jogoId + ":" + !!c.querySelector(".jogo-vivo"))`));
console.log("6) canal de cada card:", await ev(`[...document.querySelectorAll(".jogo-card")].map(c => c.dataset.jogoId + "=" + c.querySelector(".jogo-canal span").textContent)`));

console.log("7) jogo com um canal confirmado toca direto (SporTV HD, id 1):", await ev(`(document.querySelector('[data-jogo-id="vivo"]').click(), window.__tocados.slice())`));
console.log("8) jogo só com prováveis abre a folha com os canais da conta:", await ev(`(document.querySelector('[data-jogo-id="incerto"]').click(), { aberta: !document.getElementById("jogos-sheet").classList.contains("hidden"), canais: [...document.querySelectorAll("#jogos-sheet-actions span")].map(s => s.textContent) })`));
console.log("9) escolher na folha toca o canal e fecha:", await ev(`(document.querySelector('[data-jogos-canal="4"]').click(), { tocados: window.__tocados.slice(), fechada: document.getElementById("jogos-sheet").classList.contains("hidden") })`));
console.log("10) jogo cujo canal não está na lista avisa:", await ev(`(document.querySelector('[data-jogo-id="sem-canal"]').click(), document.getElementById("toast").textContent)`));
console.log("11) cache gravado no aparelho:", await ev(`JSON.parse(localStorage.getItem("sint_jogos_cache")).data.jogos.length`));
console.log("12) voltar para Canais esconde a aba:", await ev(`(setState({ section: "catalog" }), document.getElementById("jogos-view").classList.contains("hidden"))`));
console.log("erros de JS:", erros.length ? erros : "nenhum");

ws.close(); chrome.kill(); srv.close(); process.exit(0);
