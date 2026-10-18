import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function loadEpgHelpers() {
  const source = extractInlineScriptById(LINK_HTML_PATH, "epg-helpers");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "epg-helpers.js" });
  return context;
}

test("epgExtraToIndex: JSON válido de 2 canais filtra janela e inclui desc só quando existe", () => {
  const ctx = loadEpgHelpers();
  assert.equal(typeof ctx.epgExtraToIndex, "function", "epgExtraToIndex deve ser exportada em epg-helpers");

  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const data = {
    v: 1,
    gerado: nowMs,
    canais: {
      sportv: [
        // No ar agora: 15 min atrás até 45 min no futuro
        [nowSec - 900, nowSec + 2700, "Futebol Ao Vivo", "Grande clássico nacional"],
        // Terminado há 2 h (fora da janela de 30 min no passado)
        [nowSec - 3 * 3600, nowSec - 2 * 3600, "VT Noturno", "Compacto da rodada"],
        // Começa em 40 h (fora da janela de 7 h no futuro)
        [nowSec + 40 * 3600, nowSec + 41 * 3600, "Jogo Futuro", "Prévia da final"],
      ],
      globo: [
        // No ar agora, sem sinopse
        [nowSec - 600, nowSec + 1800, "Jornal da Noite", ""],
      ],
    },
  };

  const index = ctx.epgExtraToIndex(data, nowMs);

  assert.ok(index.sportv, "sportv deve estar no índice");
  assert.equal(index.sportv.length, 1, "sportv deve ter apenas 1 programa dentro da janela");
  assert.deepEqual(plain(index.sportv[0]), {
    start: (nowSec - 900) * 1000,
    stop: (nowSec + 2700) * 1000,
    title: "Futebol Ao Vivo",
    desc: "Grande clássico nacional",
  });

  assert.ok(index.globo, "globo deve estar no índice");
  assert.equal(index.globo.length, 1, "globo deve ter 1 programa dentro da janela");
  assert.deepEqual(plain(index.globo[0]), {
    start: (nowSec - 600) * 1000,
    stop: (nowSec + 1800) * 1000,
    title: "Jornal da Noite",
  });
  assert.equal("desc" in index.globo[0], false, "desc vazia não deve ser incluída no objeto");
});

test("epgExtraToIndex: ignora a chave __proto__", () => {
  const ctx = loadEpgHelpers();
  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const rawJson = JSON.stringify({
    v: 1,
    canais: {
      canal1: [[nowSec - 600, nowSec + 1800, "Programa Bom", "Sinopse"]],
      __proto__: [[nowSec - 600, nowSec + 1800, "Programa Malicioso", "Hack"]],
    },
  });
  const data = JSON.parse(rawJson);

  const index = ctx.epgExtraToIndex(data, nowMs);
  assert.ok(index.canal1, "canal1 deve estar presente");
  assert.equal(Object.prototype.hasOwnProperty.call(index, "__proto__"), false, "não deve ter propriedade própria __proto__");
  assert.equal(Object.keys(index).includes("__proto__"), false, "__proto__ não deve aparecer nas chaves");
});

test("epgExtraToIndex: entradas inválidas no nível raiz retornam {} sem lançar", () => {
  const ctx = loadEpgHelpers();
  const nowMs = 1760800000 * 1000;

  assert.deepEqual(plain(ctx.epgExtraToIndex(null, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex(undefined, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex("string inválida", nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex(12345, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex([], nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex({ v: 2, canais: {} }, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex({ v: 1 }, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex({ v: 1, canais: null }, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex({ v: 1, canais: "não é objeto" }, nowMs)), {});
  assert.deepEqual(plain(ctx.epgExtraToIndex({ v: 1, canais: [] }, nowMs)), {});
});

test("epgExtraToIndex: canais com valor não-array são ignorados", () => {
  const ctx = loadEpgHelpers();
  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const data = {
    v: 1,
    canais: {
      invalido1: null,
      invalido2: "texto",
      invalido3: 12345,
      invalido4: {},
      valido: [[nowSec - 600, nowSec + 1800, "Programa Valido", ""]],
    },
  };

  const index = ctx.epgExtraToIndex(data, nowMs);
  assert.deepEqual(Object.keys(index), ["valido"]);
});

test("epgExtraToIndex: entradas malformadas e tempos lixo descartadas sem derrubar as boas", () => {
  const ctx = loadEpgHelpers();
  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const data = {
    v: 1,
    canais: {
      misto: [
        null,
        "não é array",
        123,
        [],
        [nowSec],
        [nowSec, nowSec + 3600], // tamanho < 3
        [NaN, nowSec + 3600, "Título"], // start NaN
        [nowSec, NaN, "Título"], // stop NaN
        [nowSec, nowSec - 3600, "Fim menor que início"], // fim < início
        [nowSec, nowSec, "Fim igual a início"], // fim == início
        [nowSec, nowSec + 3600, 12345], // título não-string
        [nowSec, nowSec + 3600, null], // título null
        ["lixo", nowSec + 3600, "Start lixo"], // tempos lixo
        [nowSec, "lixo", "Stop lixo"],
        ["", nowSec + 3600, "Start vazio"],
        [null, nowSec + 3600, "Start null"],
        // Única entrada boa:
        [nowSec - 600, nowSec + 1800, "Programa Correto", "Sinopse"],
      ],
      soInvalido: [
        null,
        [nowSec, nowSec],
        [NaN, NaN, "Inválido"],
      ],
    },
  };

  const index = ctx.epgExtraToIndex(data, nowMs);
  assert.ok(index.misto, "misto deve estar no índice");
  assert.equal(index.misto.length, 1);
  assert.equal(index.misto[0].title, "Programa Correto");
  assert.equal("soInvalido" in index, false, "canal sem entradas válidas não entra no índice");
});

test("epgExtraToIndex: tempos numéricos em string são aceitos", () => {
  const ctx = loadEpgHelpers();
  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const data = {
    v: 1,
    canais: {
      canal1: [
        [String(nowSec - 300), String(nowSec + 1500), "Programa em String", "Desc"],
      ],
    },
  };

  const index = ctx.epgExtraToIndex(data, nowMs);
  assert.ok(index.canal1);
  assert.equal(index.canal1.length, 1);
  assert.equal(index.canal1[0].start, (nowSec - 300) * 1000);
  assert.equal(index.canal1[0].stop, (nowSec + 1500) * 1000);
  assert.equal(index.canal1[0].title, "Programa em String");
  assert.equal(index.canal1[0].desc, "Desc");
});

test("epgExtraToIndex: resultado ordenado por início", () => {
  const ctx = loadEpgHelpers();
  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const data = {
    v: 1,
    canais: {
      canal1: [
        [nowSec + 3600, nowSec + 7200, "Programa 3"],
        [nowSec - 600, nowSec + 1800, "Programa 1"],
        [nowSec + 1800, nowSec + 3600, "Programa 2"],
      ],
    },
  };

  const index = ctx.epgExtraToIndex(data, nowMs);
  assert.ok(index.canal1);
  assert.equal(index.canal1.length, 3);
  assert.equal(index.canal1[0].title, "Programa 1");
  assert.equal(index.canal1[1].title, "Programa 2");
  assert.equal(index.canal1[2].title, "Programa 3");
});

test("compatibilidade com getCurrentAndNextProgramme: índice gerado devolve programa atual e próximo", () => {
  const ctx = loadEpgHelpers();
  const nowSec = 1760800000;
  const nowMs = nowSec * 1000;

  const data = {
    v: 1,
    canais: {
      sportv: [
        [nowSec - 1800, nowSec - 600, "Pré-Jogo"],
        [nowSec - 600, nowSec + 3600, "Jogo ao Vivo"],
        [nowSec + 3600, nowSec + 7200, "Pós-Jogo"],
      ],
    },
  };

  const index = ctx.epgExtraToIndex(data, nowMs);
  assert.ok(index.sportv);

  const res = ctx.getCurrentAndNextProgramme(index.sportv, nowMs);
  assert.ok(res.current, "deve ter programa atual");
  assert.equal(res.current.title, "Jogo ao Vivo");
  assert.ok(res.next, "deve ter próximo programa");
  assert.equal(res.next.title, "Pós-Jogo");
});

test("ligação no HTML: EPG_EXTRA_URL, chamada de epgExtraToIndex antes de EPGSHARE01_URL e verificação >= 20", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");

  assert.ok(
    html.includes('const EPG_EXTRA_URL = "https://raw.githubusercontent.com/Guaitolinii/visual-craft-assistant/vod-data/epg-extra.json";'),
    "deve declarar const EPG_EXTRA_URL com a URL correta"
  );

  const fnMatch = /async function fetchSupplementaryEpgIndex\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(html);
  assert.ok(fnMatch, "fetchSupplementaryEpgIndex deve existir no HTML");

  const fnBody = fnMatch[1];
  const idxExtra = fnBody.indexOf("epgExtraToIndex(");
  const idxEpgShare = fnBody.indexOf("EPGSHARE01_URL");

  assert.ok(idxExtra !== -1, "fetchSupplementaryEpgIndex deve chamar epgExtraToIndex(");
  assert.ok(idxEpgShare !== -1, "fetchSupplementaryEpgIndex deve referenciar EPGSHARE01_URL");
  assert.ok(idxExtra < idxEpgShare, "epgExtraToIndex deve ser chamado antes de EPGSHARE01_URL no fluxo");
  assert.ok(/>=\s*20/.test(fnBody), "fetchSupplementaryEpgIndex deve verificar se o índice tem pelo menos 20 canais (>= 20)");
});
