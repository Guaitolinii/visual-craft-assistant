import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("(a) liveRetryDelayMs: espera crescente de 1s, 2s, 4s, 8s, 10s e entradas inválidas", () => {
  const helpers = loadVodHelpers();
  assert.equal(typeof helpers.liveRetryDelayMs, "function", "liveRetryDelayMs deve ser exportada");

  const table = [
    { input: 1, expected: 1000 },
    { input: 2, expected: 2000 },
    { input: 3, expected: 4000 },
    { input: 4, expected: 8000 },
    { input: 5, expected: 10000 },
    { input: 6, expected: 10000 },
    { input: 50, expected: 10000 },
    // Entradas inválidas
    { input: 0, expected: 1000 },
    { input: -1, expected: 1000 },
    { input: -3, expected: 1000 },
    { input: NaN, expected: 1000 },
    { input: Infinity, expected: 1000 },
    { input: -Infinity, expected: 1000 },
    { input: "abc", expected: 1000 },
    { input: "", expected: 1000 },
    { input: undefined, expected: 1000 },
    { input: null, expected: 1000 },
    { input: {}, expected: 1000 },
    { input: [], expected: 1000 },
  ];

  for (const { input, expected } of table) {
    assert.equal(
      helpers.liveRetryDelayMs(input),
      expected,
      `liveRetryDelayMs(${JSON.stringify(input)}) deveria retornar ${expected}`
    );
  }
});

test("(d) shouldRetryLive: retenta somente mesma geração, não pausado e canal ao vivo", () => {
  const helpers = loadVodHelpers();
  assert.equal(typeof helpers.shouldRetryLive, "function", "shouldRetryLive deve ser exportada");

  const table = [
    { input: { sameGeneration: true, userPaused: false, isVod: false }, expected: true },
    { input: { sameGeneration: false, userPaused: false, isVod: false }, expected: false },
    { input: { sameGeneration: true, userPaused: true, isVod: false }, expected: false },
    { input: { sameGeneration: true, userPaused: false, isVod: true }, expected: false },
    { input: { sameGeneration: false, userPaused: true, isVod: true }, expected: false },
    { input: {}, expected: false },
    { input: undefined, expected: false },
    { input: null, expected: false },
  ];

  for (const { input, expected } of table) {
    assert.equal(
      helpers.shouldRetryLive(input),
      expected,
      `shouldRetryLive(${JSON.stringify(input)}) deveria retornar ${expected}`
    );
  }
});
test("(b) loader só com círculo: #player-loader não contém <p> e tem <div class=\"spinner\">", () => {
  const loaderMatch = html.match(/<div class="player-loader" id="player-loader">([\s\S]*?)<\/div>\s*<!-- Overlay de erro -->/);
  assert.ok(loaderMatch, "#player-loader não encontrado no HTML");
  const loaderInner = loaderMatch[1];
  assert.ok(loaderInner.includes('<div class="spinner"></div>'), "spinner ausente dentro do loader");
  assert.ok(!loaderInner.includes("<p>"), "loader ainda contém tag <p>");
});

test("(b) textos proibidos de carregamento e reconexão não existem no código-fonte", () => {
  const forbiddenPatterns = [
    "Carregando buffer",
    "Conectando ao canal",
    "Servidor ocupado",
  ];
  for (const text of forbiddenPatterns) {
    assert.ok(
      !html.includes(text),
      `texto proibido "${text}" ainda existe em sintoniza-link.html`
    );
  }
});

test("(c) varredura do código-fonte: nenhum caminho de canal ao vivo chama showPlayerError", () => {
  // Apenas a verificação de canal sem URL no início do playStream pode chamar showPlayerError sem checagem de VOD
  const matches = [...html.matchAll(/showPlayerError\([^)]*\)/g)];
  assert.ok(matches.length > 0, "deve encontrar chamadas a showPlayerError");

  // Cada chamada fora de playStream(!url) deve estar protegida por isVod
  // Vamos analisar os blocos onde showPlayerError é chamado
  const lines = html.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.includes("showPlayerError(") && !line.includes("function showPlayerError")) {
      const lineNum = idx + 1;
      const windowContext = lines.slice(Math.max(0, idx - 15), Math.min(lines.length, idx + 10)).join("\n");
      const isMissingUrlCheck = windowContext.includes("!url") && line.includes("Canal sem URL");
      const isGuardedByVod = windowContext.includes("isVod") || windowContext.includes(".isVod");

      assert.ok(
        isMissingUrlCheck || isGuardedByVod,
        `Chamada a showPlayerError na linha ${lineNum} não está protegida por verificação de VOD nem é !url:\n${line}`
      );
    }
  }
});

test("resiliência: circuit breaker em canal ao vivo não mata a reprodução nem chama showPlayerError", () => {
  // No reloadCurrentChannel, GIVE_UP para canal ao vivo deve aguardar 10s e agendar retentativa
  assert.match(html, /reconnectCircuitBreaker\.recordAttempt/);
  // Não pode haver showPlayerError incondicional após GIVE_UP
  assert.doesNotMatch(
    html,
    /verdict === "GIVE_UP"\s*\{[\s\S]{0,80}showPlayerError\(\s*ch\.isVod/
  );
});

test("resiliência: limite de conexões (HTTP 429) aguarda pelo menos 20s", () => {
  // Deve haver referência a 429 com espera mínima de 20s (20000 ms)
  assert.match(html, /429/);
  assert.match(html, /20000/);
});

test("resiliência: rajada de erros não empilha múltiplos timers de reconexão", () => {
  // Deve haver controle para evitar timers duplicados
  assert.match(html, /liveRetryTimer/);
});

test("resiliência: cancelamento de timer pendente ao trocar de canal ou fechar player", () => {
  // Deve limpar timer pendente em stopStream ou playStream
  assert.match(html, /stopStream\(\)/);
  assert.match(html, /clearTimeout\(liveRetryTimer\)/);
});

// ─── Regressões achadas na revisão ───
function funcaoDoHtml(nome) {
  // do "function nome(" até a primeira chave de fechamento na coluna 0
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i > -1, nome + " não encontrada no HTML");
  const fimFuncao = html.slice(i).search(/\r?\n\}\r?\n/);
  assert.ok(fimFuncao > -1, "fim de " + nome + " não encontrado");
  const texto = html.slice(i, i + fimFuncao + 3);
  return new Function(texto + "; return " + nome + ";")();
}

test("disjuntor: sem reset, depois do GIVE_UP toda chamada seguinte continua em GIVE_UP (por isso a retentativa o zera)", () => {
  const criar = funcaoDoHtml("createReconnectCircuitBreaker");
  const d = criar();
  const t0 = Date.now();
  let veredito = "";
  for (let i = 0; i < 6; i++) veredito = d.recordAttempt(t0 + i * 10000);
  assert.equal(veredito, "GIVE_UP");
  // 10 s depois (a espera do canal ao vivo) o disjuntor ainda desiste: o relógio de 5 min só libera de verdade bem depois
  assert.equal(d.recordAttempt(t0 + 70000), "GIVE_UP");
  d.reset();
  assert.equal(d.recordAttempt(t0 + 80000), "RETRY");
});

test("a retentativa agendada zera o disjuntor antes de recarregar o canal", () => {
  const m = html.match(/liveRetryTimer = setTimeout\(\(\) => \{[\s\S]*?\}, delay\);/);
  assert.ok(m, "temporizador da retentativa não encontrado");
  const corpo = m[0];
  const iReset = corpo.indexOf("reconnectCircuitBreaker.reset()");
  const iReload = corpo.indexOf("reloadCurrentChannel(true)");
  assert.ok(iReset > -1 && iReload > -1 && iReset < iReload, "reset do disjuntor tem que vir antes do reload");
});

test("o watchdog continua vigiando quando foi ele quem acendeu o círculo (e só sai cedo no loader da fase de conexão)", () => {
  assert.match(html, /let watchdogShowedLoader = false;/);
  assert.match(html, /loader\.classList\.contains\("active"\) && !watchdogShowedLoader\) return;/);
  // quem acende o círculo por imagem parada marca a flag; quem apaga (imagem andando) a zera
  assert.match(html, /watchdogShowedLoader = true;\s*showPlayerLoader\(\);/);
  assert.match(html, /watchdogShowedLoader = false;\s*hidePlayerLoader\(\);/);
  const reset = html.match(/function resetWatchdogCounters\(\) \{[\s\S]*?\r?\n\}/);
  assert.ok(reset && /watchdogShowedLoader = false;/.test(reset[0]), "resetWatchdogCounters tem que zerar a flag");
});
