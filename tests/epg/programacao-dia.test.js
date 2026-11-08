import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("epgProgramacaoDoDia: estados passou/agora/depois e progresso", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 10_000_000;
  const programmes = [
    { start: nowMs - 15 * 60 * 1000, stop: nowMs - 5 * 60 * 1000, title: "Passou há pouco", desc: "D1" },
    { start: nowMs - 10 * 60 * 1000, stop: nowMs + 10 * 60 * 1000, title: "No ar agora", desc: "D2" },
    { start: nowMs + 10 * 60 * 1000, stop: nowMs + 40 * 60 * 1000, title: "Depois", desc: "D3" },
  ];

  const res = epgProgramacaoDoDia(programmes, nowMs);
  assert.equal(res.temGuia, true);
  assert.equal(res.itens.length, 3);

  // passou
  assert.equal(res.itens[0].titulo, "Passou há pouco");
  assert.equal(res.itens[0].estado, "passou");
  assert.equal(res.itens[0].progresso, 100);
  assert.equal(res.itens[0].desc, "D1");

  // agora (exatamente na metade: 10m decorridos de 20m => 50%)
  assert.equal(res.itens[1].titulo, "No ar agora");
  assert.equal(res.itens[1].estado, "agora");
  assert.equal(res.itens[1].progresso, 50);
  assert.equal(res.itens[1].desc, "D2");

  // depois
  assert.equal(res.itens[2].titulo, "Depois");
  assert.equal(res.itens[2].estado, "depois");
  assert.equal(res.itens[2].progresso, 0);
  assert.equal(res.itens[2].desc, "D3");
});

test("epgProgramacaoDoDia: limites de progresso no agora (0% no início exato, 100% no quase fim, arredondamento)", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 10_000_000;

  // Início exato
  const pInicio = [{ start: nowMs, stop: nowMs + 100_000, title: "Começando" }];
  const resInicio = epgProgramacaoDoDia(pInicio, nowMs);
  assert.equal(resInicio.itens[0].estado, "agora");
  assert.equal(resInicio.itens[0].progresso, 0);

  // Arredondamento (ex: 33.33% vira 33)
  const pRound = [{ start: nowMs - 33_333, stop: nowMs + 66_667, title: "Um terço" }];
  const resRound = epgProgramacaoDoDia(pRound, nowMs);
  assert.equal(resRound.itens[0].progresso, 33);
});

test("epgProgramacaoDoDia: janela de corte (passado 30m e futuro 24h por padrão)", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 100_000_000;
  const m = 60 * 1000;
  const h = 60 * m;

  const programmes = [
    // Terminou há 31 min (fora da janela: stop <= nowMs - 30m)
    { start: nowMs - 60 * m, stop: nowMs - 31 * m, title: "Acabou há 31m" },
    // Terminou há 29 min (dentro da janela: stop > nowMs - 30m)
    { start: nowMs - 50 * m, stop: nowMs - 29 * m, title: "Acabou há 29m" },
    // Começa em 24h01m (fora da janela: start >= nowMs + 24h)
    { start: nowMs + 24 * h + 1 * m, stop: nowMs + 25 * h, title: "Começa em 24h01m" },
    // Começa em 23h59m (dentro da janela)
    { start: nowMs + 23 * h + 59 * m, stop: nowMs + 25 * h, title: "Começa em 23h59m" },
  ];

  const res = epgProgramacaoDoDia(programmes, nowMs);
  assert.equal(res.temGuia, true);
  assert.deepEqual(res.itens.map(i => i.titulo), ["Acabou há 29m", "Começa em 23h59m"]);
});

test("epgProgramacaoDoDia: ordenação por start", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 100_000_000;
  const programmes = [
    { start: nowMs + 3000, stop: nowMs + 4000, title: "Segundo" },
    { start: nowMs + 1000, stop: nowMs + 2000, title: "Primeiro" },
    { start: nowMs - 2000, stop: nowMs - 1000, title: "Passado" },
  ];

  const res = epgProgramacaoDoDia(programmes, nowMs);
  assert.deepEqual(res.itens.map(i => i.titulo), ["Passado", "Primeiro", "Segundo"]);
});

test("epgProgramacaoDoDia: corte em max mantendo sempre o agora", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 100_000_000;
  // Cria 10 itens no passado, 1 no agora, 10 no futuro
  const programmes = [];
  for (let i = 10; i >= 1; i--) {
    programmes.push({ start: nowMs - i * 60000, stop: nowMs - (i - 1) * 60000, title: `Passado ${i}` });
  }
  programmes.push({ start: nowMs - 30000, stop: nowMs + 30000, title: "Agora" });
  for (let i = 1; i <= 10; i++) {
    programmes.push({ start: nowMs + i * 60000, stop: nowMs + (i + 1) * 60000, title: `Futuro ${i}` });
  }

  // max = 5
  const res = epgProgramacaoDoDia(programmes, nowMs, { max: 5 });
  assert.equal(res.itens.length, 5);
  // O item "Agora" DEVE estar presente
  assert.ok(res.itens.some(i => i.estado === "agora" && i.titulo === "Agora"));
});

test("epgProgramacaoDoDia: temGuia é verdadeiro se havia guia válida mesmo que nenhum caiba na janela", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 100_000_000;
  const programmes = [
    // Muito antigo (terminou há 2 dias)
    { start: nowMs - 48 * 3600 * 1000, stop: nowMs - 47 * 3600 * 1000, title: "Antigo" },
  ];
  const res = epgProgramacaoDoDia(programmes, nowMs);
  assert.equal(res.temGuia, true);
  assert.equal(res.itens.length, 0);
});

test("epgProgramacaoDoDia: entradas inválidas e sanitização", () => {
  const { epgProgramacaoDoDia } = loadVodHelpers();
  const nowMs = 100_000_000;

  // programmes inválido
  assert.deepEqual(epgProgramacaoDoDia(null, nowMs), { temGuia: false, itens: [] });
  assert.deepEqual(epgProgramacaoDoDia("not an array", nowMs), { temGuia: false, itens: [] });
  assert.deepEqual(epgProgramacaoDoDia([], nowMs), { temGuia: false, itens: [] });

  // nowMs não numérico ou NaN
  const valids = [{ start: nowMs - 1000, stop: nowMs + 1000, title: "Ok" }];
  assert.deepEqual(epgProgramacaoDoDia(valids, NaN), { temGuia: true, itens: [] });
  assert.deepEqual(epgProgramacaoDoDia(valids, "invalid"), { temGuia: true, itens: [] });

  // itens com start/stop sujos, stop <= start, item null/não-objeto
  const dirty = [
    null,
    undefined,
    "string item",
    { start: "100", stop: "200", title: "String num" },
    { start: NaN, stop: 200, title: "NaN start" },
    { start: 100, stop: Infinity, title: "Inf stop" },
    { start: 200, stop: 100, title: "Invertido" },
    { start: 200, stop: 200, title: "Stop igual Start" },
    // Válido com título vazio vira "Programa"
    { start: nowMs - 500, stop: nowMs + 500, title: "", desc: null },
    { start: nowMs + 600, stop: nowMs + 1600, title: "   ", desc: 123 },
  ];
  const resDirty = epgProgramacaoDoDia(dirty, nowMs);
  assert.equal(resDirty.temGuia, true);
  assert.equal(resDirty.itens.length, 2);
  assert.equal(resDirty.itens[0].titulo, "Programa");
  assert.equal(resDirty.itens[0].desc, "");
  assert.equal(resDirty.itens[1].titulo, "Programa");
  assert.equal(resDirty.itens[1].desc, "");

  // opts inválidos usam padrões
  const resBadOpts = epgProgramacaoDoDia(
    [{ start: nowMs - 500, stop: nowMs + 500, title: "Teste" }],
    nowMs,
    { max: -5, passadoMs: -10, futuroMs: NaN }
  );
  assert.equal(resBadOpts.itens.length, 1);

  // Dois programas idênticos (mesmo start e title) => fica um só
  const dups = [
    { start: nowMs - 1000, stop: nowMs + 1000, title: "Dup", desc: "Primeiro" },
    { start: nowMs - 1000, stop: nowMs + 2000, title: "Dup", desc: "Segundo" },
  ];
  const resDups = epgProgramacaoDoDia(dups, nowMs);
  assert.equal(resDups.itens.length, 1);
  assert.equal(resDups.itens[0].desc, "Primeiro");
});

test("HTML: elementos do botão e da folha existem com os IDs corretos", () => {
  // Botão player-epg-day-btn logo abaixo de player-epg-desc
  assert.match(html, /id="player-epg-desc"[\s\S]*?id="player-epg-day-btn"/);
  assert.match(html, /<button[^>]+id="player-epg-day-btn"[^>]*hidden[^>]*>/);

  // Folha de programação do dia
  assert.match(html, /<div id="epg-day-sheet" class="action-sheet hidden" role="dialog" aria-modal="true" aria-hidden="true">/);
  assert.match(html, /id="epg-day-sheet-title"/);
  assert.match(html, /id="epg-day-sheet-actions"/);
  assert.match(html, /id="epg-day-sheet-cancel"/);
});

test("Ligações: fecharEpgDiaSheet no início de selectChannel e listeners da folha", () => {
  assert.match(html, /function selectChannel\(ch[\s\S]*?fecharEpgDiaSheet\(\)/);
  assert.match(html, /function abrirEpgDiaSheet\(\)/);
  assert.match(html, /function fecharEpgDiaSheet\(\)/);
  assert.match(html, /getElementById\("player-epg-day-btn"\)\.addEventListener\("click"/);
  assert.match(html, /getElementById\("epg-day-sheet-cancel"\)\.addEventListener\("click", fecharEpgDiaSheet\)/);
  assert.match(html, /getElementById\("epg-day-sheet"\)\.addEventListener\("click"/);
});
