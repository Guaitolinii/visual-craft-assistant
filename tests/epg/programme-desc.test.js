import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

export function loadEpgHelpers() {
  const source = extractInlineScriptById(LINK_HTML_PATH, "epg-helpers");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "epg-helpers.js" });
  return context;
}

const SAMPLE_XMLTV_3_PROGRAMMES = `<?xml version="1.0" encoding="utf-8" ?>
<tv>
  <programme start="20261018100000 -0300" stop="20261018110000 -0300" start_timestamp="1789344000" stop_timestamp="1789347600" channel="canal1">
    <title lang="pt">Deu Bolo!</title>
    <desc lang="pt">Duas equipes formadas por mãe e filha disputam o melhor doce.</desc>
  </programme>
  <programme start="20261018110000 -0300" stop="20261018120000 -0300" start_timestamp="1789347600" stop_timestamp="1789351200" channel="canal1">
    <title lang="pt">Jornal do Dia</title>
  </programme>
  <programme start="20261018120000 -0300" stop="20261018130000 -0300" start_timestamp="1789351200" stop_timestamp="1789354800" channel="canal1">
    <title lang="pt">Tom &amp; Jerry</title>
    <desc lang="pt">Tom &amp; Jerry em &quot;A Corrida&quot;.\n\n   Muitas trapalhadas\r\n   e diversão!   </desc>
  </programme>
</tv>`;

test("truncateDesc: texto curto permanece intacto", () => {
  const ctx = loadEpgHelpers();
  assert.equal(typeof ctx.truncateDesc, "function", "truncateDesc deve ser exportada no bloco epg-helpers");
  assert.equal(ctx.truncateDesc("Texto curto intacto.", 240), "Texto curto intacto.");
  assert.equal(ctx.truncateDesc("A".repeat(240), 240), "A".repeat(240));
});

test("truncateDesc: texto longo trunca em no máximo 240 caracteres terminando em …", () => {
  const ctx = loadEpgHelpers();
  const text = "A".repeat(300);
  const truncated = ctx.truncateDesc(text, 240);
  assert.equal(truncated.length, 240);
  assert.ok(truncated.endsWith("…"), "deve terminar em …");
});

test("truncateDesc: não corta no meio de palavra quando há espaço antes do limite", () => {
  const ctx = loadEpgHelpers();
  // 30 palavras de ~8 letras = ~270 caracteres
  const words = Array.from({ length: 35 }, (_, i) => `palavra${i}`);
  const longText = words.join(" ");
  const truncated = ctx.truncateDesc(longText, 240);
  assert.ok(truncated.length <= 240, `tamanho ${truncated.length} deve ser <= 240`);
  assert.ok(truncated.endsWith("…"), "deve terminar com …");
  const withoutEllipsis = truncated.slice(0, -1);
  assert.ok(!withoutEllipsis.endsWith(" "), "não deve ter espaço antes da reticência");
  // O final antes de … deve ser uma palavra inteira
  const lastWord = withoutEllipsis.split(" ").pop();
  assert.ok(words.includes(lastWord), `"${lastWord}" deve ser uma palavra inteira da lista`);
});

test("truncateDesc: não-string devolve ''", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.truncateDesc(null), "");
  assert.equal(ctx.truncateDesc(undefined), "");
  assert.equal(ctx.truncateDesc(12345), "");
  assert.equal(ctx.truncateDesc({}), "");
  assert.equal(ctx.truncateDesc([]), "");
  assert.equal(ctx.truncateDesc(true), "");
});

test("extractXmltvProgrammes: lê <desc>, decodifica entidades e colapsa espaços", () => {
  const ctx = loadEpgHelpers();
  const programmes = ctx.extractXmltvProgrammes(SAMPLE_XMLTV_3_PROGRAMMES);
  assert.equal(programmes.length, 3);

  // Programa 1: com <desc>
  assert.equal(programmes[0].title, "Deu Bolo!");
  assert.equal(programmes[0].desc, "Duas equipes formadas por mãe e filha disputam o melhor doce.");

  // Programa 2: sem <desc>
  assert.equal(programmes[1].title, "Jornal do Dia");
  assert.equal(programmes[1].desc, "");

  // Programa 3: com entidades e quebras de linha
  assert.equal(programmes[2].title, "Tom & Jerry");
  assert.equal(programmes[2].desc, 'Tom & Jerry em "A Corrida". Muitas trapalhadas e diversão!');
});

test("extractXmltvProgrammes entradas inválidas: <desc> vazio, <desc/>, vários <desc>, só espaços, sem <programme>", () => {
  const ctx = loadEpgHelpers();

  // XML sem <programme>
  assert.equal(ctx.extractXmltvProgrammes("<tv></tv>").length, 0);
  // <desc> vazio
  const xmlEmptyDesc = `<tv><programme channel="c1" start_timestamp="1000" stop_timestamp="2000"><title>P1</title><desc></desc></programme></tv>`;
  assert.equal(ctx.extractXmltvProgrammes(xmlEmptyDesc)[0].desc, "");

  // <desc/> auto-fechado
  const xmlSelfClosing = `<tv><programme channel="c1" start_timestamp="1000" stop_timestamp="2000"><title>P1</title><desc/></programme></tv>`;
  assert.equal(ctx.extractXmltvProgrammes(xmlSelfClosing)[0].desc, "");

  const xmlSelfClosingSpaced = `<tv><programme channel="c1" start_timestamp="1000" stop_timestamp="2000"><title>P1</title><desc /></programme></tv>`;
  assert.equal(ctx.extractXmltvProgrammes(xmlSelfClosingSpaced)[0].desc, "");

  // Texto só com espaços e quebras de linha
  const xmlWhitespace = `<tv><programme channel="c1" start_timestamp="1000" stop_timestamp="2000"><title>P1</title><desc>   \n\t   </desc></programme></tv>`;
  assert.equal(ctx.extractXmltvProgrammes(xmlWhitespace)[0].desc, "");

  // Vários <desc> (usa o primeiro)
  const xmlMultipleDesc = `<tv><programme channel="c1" start_timestamp="1000" stop_timestamp="2000"><title>P1</title><desc lang="pt">Primeira sinopse</desc><desc lang="en">Second synopsis</desc></programme></tv>`;
  assert.equal(ctx.extractXmltvProgrammes(xmlMultipleDesc)[0].desc, "Primeira sinopse");
});

test("buildNameToProgrammesIndex: guarda desc quando existe e NÃO cria chave desc quando vazio", () => {
  const ctx = loadEpgHelpers();
  const channels = [{ id: "c1", displayName: "Canal Um" }];
  const now = 1789345000000;
  const programmes = [
    { channelId: "c1", start: now - 1000, stop: now + 1000, title: "Prog Com Desc", desc: "Sinopse do programa" },
    { channelId: "c1", start: now + 1000, stop: now + 3000, title: "Prog Sem Desc", desc: "" },
  ];
  const index = ctx.buildNameToProgrammesIndex(channels, programmes, { nowMs: now });
  assert.ok(index["canal um"]);
  assert.equal(index["canal um"].length, 2);

  // Com desc: chave existe
  assert.equal(index["canal um"][0].desc, "Sinopse do programa");
  assert.ok("desc" in index["canal um"][0]);

  // Sem desc: chave desc NÃO deve existir no objeto (para não inflar cache)
  assert.equal("desc" in index["canal um"][1], false, "chave desc não deve existir quando desc está vazio");
});

test("mergeEpgIndexes: preserva desc de ambas as fontes", () => {
  const ctx = loadEpgHelpers();
  const primary = {
    sportv: [{ start: 1, stop: 2, title: "Jogo Ao Vivo", desc: "Final do campeonato" }],
  };
  const extra = {
    espn: [{ start: 3, stop: 4, title: "Debate", desc: "Análise da rodada" }],
  };
  const merged = ctx.mergeEpgIndexes(primary, extra);
  assert.equal(merged.sportv[0].desc, "Final do campeonato");
  assert.equal(merged.espn[0].desc, "Análise da rodada");
});

test("getCurrentAndNextProgramme: entrada de cache antiga (sem desc) e desc inválido funcionam", () => {
  const ctx = loadEpgHelpers();
  // Entrada antiga sem chave desc
  const oldCache = [
    { start: 1000, stop: 2000, title: "Antigo Atual" },
    { start: 2000, stop: 3000, title: "Antigo Próximo" },
  ];
  const res = ctx.getCurrentAndNextProgramme(oldCache, 1500);
  assert.equal(res.current.title, "Antigo Atual");
  assert.equal(res.current.desc, undefined);
  assert.equal(res.next.title, "Antigo Próximo");

  // Entrada com desc não-string no cache (resiliente)
  const corruptCache = [
    { start: 1000, stop: 2000, title: "Corrupto", desc: 12345 },
  ];
  const resCorrupt = ctx.getCurrentAndNextProgramme(corruptCache, 1500);
  assert.equal(resCorrupt.current.title, "Corrupto");
  assert.equal(resCorrupt.current.desc, 12345);
});

test("Tamanho do cache: 400 canais x 4 programas com desc de 240 caracteres fica abaixo de 1.2 MB", () => {
  const ctx = loadEpgHelpers();
  const channels = [];
  const programmes = [];
  const now = 1789345000000;
  const desc240 = "A".repeat(239) + "…";

  for (let c = 1; c <= 400; c++) {
    const chId = `canal_${c}`;
    channels.push({ id: chId, displayName: `Canal ${c} HD` });
    for (let p = 0; p < 4; p++) {
      programmes.push({
        channelId: chId,
        start: now + p * 3600000,
        stop: now + (p + 1) * 3600000,
        title: `Programa Especial Número ${p + 1}`,
        desc: desc240,
      });
    }
  }

  const index = ctx.buildNameToProgrammesIndex(channels, programmes, { nowMs: now });
  const json = JSON.stringify(index);
  const sizeBytes = Buffer.byteLength(json, "utf8");
  assert.ok(
    sizeBytes < 1_200_000,
    `Tamanho do cache (${(sizeBytes / 1024 / 1024).toFixed(2)} MB) deve ser inferior a 1.2 MB (1.200.000 bytes)`
  );
});

test("Ligação no sintoniza-link.html: classe epg-desc e -webkit-line-clamp: 3 no estilo", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  assert.ok(html.includes('class="epg-desc"'), "deve conter class=\"epg-desc\" no HTML");
  assert.ok(html.includes("-webkit-line-clamp: 3"), "deve conter -webkit-line-clamp: 3 no CSS");
});
