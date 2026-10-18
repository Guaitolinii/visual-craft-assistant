import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";
import {
  construirEpgExtra,
  normalizeChannelName,
  truncateDesc,
} from "../../scripts/epg_extra/build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..", "..");
const LINK_HTML_PATH = path.join(ROOT_DIR, "sintoniza-link.html");
const WORKFLOW_PATH = path.join(ROOT_DIR, ".github", "workflows", "epg-extra.yml");

function loadAppEpgHelpers() {
  const source = extractInlineScriptById(LINK_HTML_PATH, "epg-helpers");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "epg-helpers.js" });
  return context;
}

function toXmltvDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
}

test("construirEpgExtra: processa XML pequeno inline, mescla canais, filtra janela e valida limites", () => {
  const agoraMs = 1760800000000;
  const agoraSec = Math.floor(agoraMs / 1000);

  // Janela: fim > agora - 2h (agora - 7200s) e inicio < agora + 36h (agora + 129600s)
  const dInicio1 = toXmltvDate(agoraMs);
  const dFim1 = toXmltvDate(agoraMs + 3600 * 1000);

  // Programa duplicado em início no canal b (deve ser desduplicado)
  const dInicio2 = toXmltvDate(agoraMs);
  const dFim2 = toXmltvDate(agoraMs + 3600 * 1000);

  // Programa no canal b posterior com título longo (> 80) e sinopse longa (> 160)
  const dInicio3 = toXmltvDate(agoraMs + 3600 * 1000);
  const dFim3 = toXmltvDate(agoraMs + 7200 * 1000);
  const longTitle = "Campeonato Brasileiro Série A: Rodada decisiva com muitos gols e comentários dos especialistas ao vivo";
  const longDesc = "A".repeat(300);

  // Programa no canal a sem sinopse (<desc> ausente)
  const dInicio4 = toXmltvDate(agoraMs + 7200 * 1000);
  const dFim4 = toXmltvDate(agoraMs + 10800 * 1000);

  // Programa no canal a no passado, fora da janela (terminou há mais de 2h)
  const dInicioPassado = toXmltvDate(agoraMs - 4 * 3600 * 1000);
  const dFimPassado = toXmltvDate(agoraMs - 3 * 3600 * 1000);

  // Programa no canal a no futuro, fora da janela (inicia após 36h)
  const dInicioFuturo = toXmltvDate(agoraMs + 37 * 3600 * 1000);
  const dFimFuturo = toXmltvDate(agoraMs + 38 * 3600 * 1000);

  // Programa no Canal X fora da janela (canal sem nenhum programa na janela não deve aparecer)
  const dInicioCanalX = toXmltvDate(agoraMs - 10 * 3600 * 1000);
  const dFimCanalX = toXmltvDate(agoraMs - 8 * 3600 * 1000);

  const xml = `<?xml version="1.0" encoding="utf-8" ?>
<tv>
  <channel id="chan-a">
    <display-name>São Paulo/SP  SporTV HD</display-name>
  </channel>
  <channel id="chan-b">
    <display-name>SporTV SD</display-name>
  </channel>
  <channel id="chan-c">
    <display-name>Canal X</display-name>
  </channel>

  <!-- Canal a: programa na janela com entidades e quebras de linha -->
  <programme start="${dInicio1}" stop="${dFim1}" channel="chan-a">
    <title lang="pt">Futebol &amp; Notícias &lt;ao vivo&gt;</title>
    <desc lang="pt">Destaques da rodada&#10;&#10;e lances &quot;capitais&quot; &amp; entrevistas.</desc>
  </programme>

  <!-- Canal b: programa duplicado em início (mesmo normName 'sportv') -->
  <programme start="${dInicio2}" stop="${dFim2}" channel="chan-b">
    <title lang="pt">Futebol &amp; Notícias (SD)</title>
  </programme>

  <!-- Canal b: programa na janela com título > 80 e sinopse de 300 caracteres -->
  <programme start="${dInicio3}" stop="${dFim3}" channel="chan-b">
    <title lang="pt">${longTitle}</title>
    <desc lang="pt">${longDesc}</desc>
  </programme>

  <!-- Canal a: programa na janela sem tag desc -->
  <programme start="${dInicio4}" stop="${dFim4}" channel="chan-a">
    <title lang="pt">Debate Esportivo</title>
  </programme>

  <!-- Canal a: programa no passado fora da janela -->
  <programme start="${dInicioPassado}" stop="${dFimPassado}" channel="chan-a">
    <title lang="pt">Jogo Antigo</title>
  </programme>

  <!-- Canal a: programa no futuro fora da janela -->
  <programme start="${dInicioFuturo}" stop="${dFimFuturo}" channel="chan-a">
    <title lang="pt">Jogo Distante</title>
  </programme>

  <!-- Canal a: sem título (deve ser ignorado) -->
  <programme start="${toXmltvDate(agoraMs + 12000 * 1000)}" stop="${toXmltvDate(agoraMs + 13000 * 1000)}" channel="chan-a">
    <desc lang="pt">Sem título aqui</desc>
  </programme>

  <!-- Canal a: com data inválida (deve ser ignorado) -->
  <programme start="data-invalida" stop="${toXmltvDate(agoraMs + 14000 * 1000)}" channel="chan-a">
    <title lang="pt">Data Inválida</title>
  </programme>

  <!-- Canal c (Canal X): só programa fora da janela -->
  <programme start="${dInicioCanalX}" stop="${dFimCanalX}" channel="chan-c">
    <title lang="pt">Programa do Canal X Fora da Janela</title>
  </programme>
</tv>`;

  const resultado = construirEpgExtra(xml, agoraMs);

  assert.equal(resultado.v, 1, "versão do contrato deve ser 1");
  assert.equal(resultado.gerado, agoraMs, "gerado deve corresponder ao agoraMs fornecido");

  const canais = resultado.canais;
  assert.ok(canais, "objeto canais deve existir");
  // Canal X não tem programas na janela, então não deve aparecer
  assert.deepEqual(Object.keys(canais), ["sportv"], "somente canais com programas na janela entram");

  const progs = canais.sportv;
  assert.ok(Array.isArray(progs), "canais['sportv'] deve ser array");
  // 3 programas válidos na janela (os outros foram fora, sem título, data inválida ou início duplicado)
  assert.equal(progs.length, 3, "deve conter exatamente os 3 programas válidos");

  // Ordenação por início e sem duplicatas
  for (let i = 0; i < progs.length - 1; i++) {
    assert.ok(progs[i][0] < progs[i + 1][0], `progs devem estar estritamente ordenados por início: ${progs[i][0]} < ${progs[i + 1][0]}`);
  }

  // Programa 1: checar decodificação de entidades XML e quebras colapsadas
  const [ini1, fim1, tit1, sin1] = progs[0];
  assert.equal(ini1, agoraSec);
  assert.equal(fim1, agoraSec + 3600);
  assert.equal(typeof ini1, "number");
  assert.ok(Number.isInteger(ini1), "início deve ser inteiro em segundos");
  assert.ok(Number.isInteger(fim1), "fim deve ser inteiro em segundos");
  assert.equal(tit1, "Futebol & Notícias <ao vivo>");
  assert.equal(sin1, 'Destaques da rodada e lances "capitais" & entrevistas.');

  // Programa 2: título cortado com max 80 e sinopse cortada em max 160
  const [ini2, fim2, tit2, sin2] = progs[1];
  assert.equal(ini2, agoraSec + 3600);
  assert.equal(fim2, agoraSec + 7200);
  assert.ok(tit2.length <= 80, `título deve ter no máximo 80 caracteres (tinha ${tit2.length})`);
  assert.ok(sin2.length <= 160, `sinopse deve ter no máximo 160 caracteres (tinha ${sin2.length})`);
  assert.ok(sin2.endsWith("…"), "sinopse longa deve terminar em …");

  // Programa 3: sem tag desc deve ter sinopse ""
  const [ini3, fim3, tit3, sin3] = progs[2];
  assert.equal(ini3, agoraSec + 7200);
  assert.equal(fim3, agoraSec + 10800);
  assert.equal(tit3, "Debate Esportivo");
  assert.equal(sin3, "", "sinopse ausente deve ser string vazia");
});

test("normalizeChannelName: devolve exatamente o mesmo que a função do app para 30 nomes reais", () => {
  const appCtx = loadAppEpgHelpers();
  assert.equal(typeof appCtx.normalizeChannelName, "function", "normalizeChannelName deve existir no app");

  const nomes = [
    // 8 obrigatórios da especificação
    "São Paulo/SP  Tnt novelas HD",
    "ESPN",
    "Disney+ 01",
    "[PT] AXN HD",
    "24H • ✅Futurama",
    "Globo Anhanguera Goiânia FHD",
    "HBO 2 4K",
    "A&E SD",
    // Mais 22 nomes reais do dialeto epgshare01 e operadoras brasileiras
    "São Paulo/SP  SporTV HD ³",
    "Belo Horizonte/MG  Premiere 6",
    "Discovery H&H",
    "Paramount+",
    "Canal Rural",
    "Zoomoo FHD",
    "Zoomoo [H265]",
    "Canção Nova",
    "São Paulo/SP   TV Brasil 2",
    "Telecine Premium FHD",
    "Canal Brasil HD",
    "Globo SP HD",
    "SBT HD",
    "Record TV HD",
    "Band HD",
    "CNN Brasil",
    "Combate HD",
    "Universal TV",
    "Warner Channel",
    "Cartoon Network HD",
    "Megapix HD",
    "Multishow HD",
    "GNT HD",
    "Viva HD",
  ];

  assert.equal(nomes.length >= 30, true, "deve testar pelo menos 30 nomes reais");

  for (const nome of nomes) {
    const esperado = appCtx.normalizeChannelName(nome);
    const obtido = normalizeChannelName(nome);
    assert.equal(obtido, esperado, `Divergência na normalização de: "${nome}"`);
  }
});

test("truncateDesc: curto intacto, longo <= max terminando em …, sem cortar palavra, não-string -> ''", () => {
  // Curto intacto
  assert.equal(truncateDesc("Texto curto", 160), "Texto curto");
  assert.equal(truncateDesc("Exatamente 10", 13), "Exatamente 10");

  // Longo <= max terminando em …
  const longoSemEspaco = "A".repeat(200);
  const trunc1 = truncateDesc(longoSemEspaco, 160);
  assert.equal(trunc1.length, 160);
  assert.ok(trunc1.endsWith("…"));

  // Não corta no meio de palavra quando há espaço antes do limite
  const frase = "Primeira Segunda Terceira Quarta Quinta Sexta Sétima Oitava Nona Décima DécimaPrimeira";
  const trunc2 = truncateDesc(frase, 50);
  assert.ok(trunc2.length <= 50, `tamanho ${trunc2.length} deve ser <= 50`);
  assert.ok(trunc2.endsWith("…"), "deve terminar em …");
  const semReticencias = trunc2.slice(0, -1);
  assert.ok(!frase.slice(semReticencias.length).match(/^[a-zA-ZÀ-ÿ]/), "não deve cortar palavra ao meio se houver espaço antes");

  // Não-string devolve ''
  assert.equal(truncateDesc(null, 160), "");
  assert.equal(truncateDesc(undefined, 160), "");
  assert.equal(truncateDesc(12345, 160), "");
  assert.equal(truncateDesc({}, 160), "");
  assert.equal(truncateDesc([], 160), "");
  assert.equal(truncateDesc(true, 160), "");
});

test("Tamanho: XML sintético com 400 canais x 6 programas produz JSON < 1.2 MB", () => {
  const agoraMs = 1760800000000;
  const sinopse160 = "Sinopse demonstrativa para validar o tamanho final do arquivo compactado e normalizado do EPG público semanal brasileiro com detalhes e informações extras.";
  assert.ok(sinopse160.length <= 160, `sinopse deve ter <= 160 caracteres (tem ${sinopse160.length})`);

  let xml = '<?xml version="1.0" encoding="utf-8" ?>\n<tv>\n';
  for (let c = 0; c < 400; c++) {
    xml += `  <channel id="c_${c}"><display-name>Canal de Teste ${c} HD</display-name></channel>\n`;
  }
  for (let c = 0; c < 400; c++) {
    for (let p = 0; p < 6; p++) {
      const ini = toXmltvDate(agoraMs + p * 3600 * 1000);
      const fim = toXmltvDate(agoraMs + (p + 1) * 3600 * 1000);
      xml += `  <programme start="${ini}" stop="${fim}" channel="c_${c}">\n`;
      xml += `    <title>Programa ${p} do Canal ${c}</title>\n`;
      xml += `    <desc>${sinopse160}</desc>\n`;
      xml += `  </programme>\n`;
    }
  }
  xml += "</tv>";

  const resultado = construirEpgExtra(xml, agoraMs);
  const json = JSON.stringify(resultado);
  const byteLength = Buffer.byteLength(json, "utf8");

  assert.equal(Object.keys(resultado.canais).length, 400);
  assert.ok(
    byteLength < 1.2 * 1024 * 1024,
    `Tamanho (${(byteLength / 1024).toFixed(1)} KB) deve ser menor que 1.2 MB`
  );
});

test("Entradas inválidas: XML vazio, undefined, sem programme, desc vazia e stop <= start", () => {
  const agoraMs = 1760800000000;
  const esperadoVazio = { v: 1, gerado: agoraMs, canais: {} };

  assert.deepEqual(construirEpgExtra("", agoraMs), esperadoVazio);
  assert.deepEqual(construirEpgExtra(undefined, agoraMs), esperadoVazio);
  assert.deepEqual(construirEpgExtra(null, agoraMs), esperadoVazio);
  assert.deepEqual(construirEpgExtra("<tv></tv>", agoraMs), esperadoVazio);
  assert.deepEqual(construirEpgExtra("<tv><channel id='1'><display-name>X</display-name></channel></tv>", agoraMs), esperadoVazio);

  // XML com <desc/>, <desc></desc> e stop <= start
  const ini = toXmltvDate(agoraMs);
  const fim = toXmltvDate(agoraMs + 3600 * 1000);
  const xml = `<?xml version="1.0" encoding="utf-8" ?>
<tv>
  <channel id="ch1"><display-name>Canal Um HD</display-name></channel>
  <!-- <desc/> deve virar "" -->
  <programme start="${ini}" stop="${fim}" channel="ch1">
    <title>Prog 1</title>
    <desc/>
  </programme>
  <!-- <desc></desc> deve virar "" -->
  <programme start="${toXmltvDate(agoraMs + 3600 * 1000)}" stop="${toXmltvDate(agoraMs + 7200 * 1000)}" channel="ch1">
    <title>Prog 2</title>
    <desc></desc>
  </programme>
  <!-- stop == start deve ser ignorado -->
  <programme start="${toXmltvDate(agoraMs + 7200 * 1000)}" stop="${toXmltvDate(agoraMs + 7200 * 1000)}" channel="ch1">
    <title>Prog Invalido Stop Igual Start</title>
  </programme>
  <!-- stop < start deve ser ignorado -->
  <programme start="${toXmltvDate(agoraMs + 9000 * 1000)}" stop="${toXmltvDate(agoraMs + 8000 * 1000)}" channel="ch1">
    <title>Prog Invalido Stop Menor Start</title>
  </programme>
</tv>`;

  const res = construirEpgExtra(xml, agoraMs);
  assert.ok(res.canais["canal um"]);
  assert.equal(res.canais["canal um"].length, 2, "deve conter apenas os 2 programas com stop > start");
  assert.equal(res.canais["canal um"][0][3], "", "<desc/> deve virar string vazia");
  assert.equal(res.canais["canal um"][1][3], "", "<desc></desc> deve virar string vazia");
});

test("Workflow .github/workflows/epg-extra.yml: asserções de texto no YAML", () => {
  const yamlContent = readFileSync(WORKFLOW_PATH, "utf8");

  assert.ok(yamlContent.includes('cron: "17 */6 * * *"'), 'deve conter schedule cron "17 */6 * * *"');
  assert.ok(yamlContent.includes("ref: vod-data"), "deve conter checkout com ref: vod-data");
  assert.ok(yamlContent.includes("contents: write"), "deve conter permissão contents: write");
  assert.ok(yamlContent.includes("scripts/epg_extra/build.mjs"), "deve apontar para scripts/epg_extra/build.mjs");
  assert.ok(yamlContent.includes("git push origin vod-data"), "deve conter git push origin vod-data");

  // Filtra linhas de comentário (começadas por # após trim)
  const nonCommentLines = yamlContent
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  assert.ok(
    !nonCommentLines.includes("continue-on-error"),
    "não deve conter continue-on-error fora de comentário"
  );
  assert.ok(
    !nonCommentLines.includes("|| true"),
    "não deve conter || true fora de comentário"
  );
  assert.ok(
    !nonCommentLines.includes("if: always()"),
    "não deve conter if: always() fora de comentário"
  );
});
