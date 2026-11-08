import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

const ctx = loadVodHelpers();
const enc = new TextEncoder();

test("constantes de limite de lista de canais", () => {
  assert.equal(ctx.LISTA_CANAIS_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(ctx.LISTA_CANAIS_MAX_QTD, 20000);
  assert.match(ctx.MSG_LISTA_CANAIS_GRANDE, /25 MB/);
  assert.match(ctx.MSG_LISTA_CANAIS_GRANDE, /recusada para não travar o aplicativo/);
});

test("listaExcedeTamanhoDeclarado: true só se número finito > maxBytes", () => {
  const max = 100;
  assert.equal(ctx.listaExcedeTamanhoDeclarado("101", max), true);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(101, max), true);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(" 150 ", max), true);

  assert.equal(ctx.listaExcedeTamanhoDeclarado("100", max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(100, max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado("50", max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado("-1", max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(null, max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(undefined, max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado("", max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado("abc", max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado("NaN", max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(Infinity, max), false);
  assert.equal(ctx.listaExcedeTamanhoDeclarado(NaN, max), false);
});

test("listaTextoPareceM3u: detecta #EXTM3U e #EXTINF, rejeita vazios, HTML e JSON", () => {
  assert.equal(ctx.listaTextoPareceM3u("#EXTM3U\n#EXTINF:-1,Canal\nhttp://x"), true);
  assert.equal(ctx.listaTextoPareceM3u("  \r\n#EXTM3U\n#EXTINF:-1,Canal"), true);
  assert.equal(ctx.listaTextoPareceM3u("\uFEFF#EXTM3U\n#EXTINF:-1,Canal"), true);
  assert.equal(ctx.listaTextoPareceM3u("#EXTINF:-1,Canal sem cabecalho"), true);

  assert.equal(ctx.listaTextoPareceM3u(""), false);
  assert.equal(ctx.listaTextoPareceM3u("   \n\t  "), false);
  assert.equal(ctx.listaTextoPareceM3u("<html><head><title>Erro</title></head><body>502</body></html>"), false);
  assert.equal(ctx.listaTextoPareceM3u('{"status":"error","message":"unauthorized"}'), false);
  assert.equal(ctx.listaTextoPareceM3u(null), false);
  assert.equal(ctx.listaTextoPareceM3u(undefined), false);
  assert.equal(ctx.listaTextoPareceM3u(12345), false);
  assert.equal(ctx.listaTextoPareceM3u({}), false);
});

test("listaLimitarCanais: limita quantidade e indica cortados", () => {
  const canais5 = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

  const res3 = ctx.listaLimitarCanais(canais5, 3);
  assert.equal(res3.canais.length, 3);
  assert.deepEqual(res3.canais, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(res3.cortados, 2);

  const res5 = ctx.listaLimitarCanais(canais5, 5);
  assert.equal(res5.canais.length, 5);
  assert.equal(res5.cortados, 0);

  const res10 = ctx.listaLimitarCanais(canais5, 10);
  assert.equal(res10.canais.length, 5);
  assert.equal(res10.cortados, 0);

  const res0 = ctx.listaLimitarCanais(canais5, 0);
  assert.equal(res0.canais.length, 0);
  assert.equal(res0.cortados, 5);

  const resNeg = ctx.listaLimitarCanais(canais5, -2);
  assert.equal(resNeg.canais.length, 0);
  assert.equal(resNeg.cortados, 5);

  assert.deepEqual(ctx.listaLimitarCanais(null, 5), { canais: [], cortados: 0 });
  assert.deepEqual(ctx.listaLimitarCanais("canais", 5), { canais: [], cortados: 0 });
  assert.deepEqual(ctx.listaLimitarCanais({ 0: "a" }, 5), { canais: [], cortados: 0 });
});

test("lerTextoComLimite: resposta falsa no teto exato devolve texto inteiro", async () => {
  const texto = "a".repeat(50);
  const res = new Response(texto, {
    headers: { "content-length": "50" },
  });
  const lido = await ctx.lerTextoComLimite(res, 50, "Erro");
  assert.equal(lido, texto);
});

test("lerTextoComLimite: 1 byte acima via Content-Length rejeita sem ler corpo", async () => {
  let leu = false;
  let cancelou = false;
  const falso = {
    headers: {
      get: (n) => (n.toLowerCase() === "content-length" ? "51" : null),
    },
    body: {
      cancel: () => {
        cancelou = true;
        return Promise.resolve();
      },
    },
    text: () => {
      leu = true;
      return Promise.resolve("corpo");
    },
  };

  await assert.rejects(
    ctx.lerTextoComLimite(falso, 50, "Passou do limite"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "Passou do limite");
      return true;
    }
  );
  assert.equal(leu, false);
  assert.equal(cancelou, true);
});

test("lerTextoComLimite: sem Content-Length, leitor em pedaços cancela e rejeita se passar do teto", async () => {
  let cancelChamadas = 0;
  const pedacos = [
    enc.encode("a".repeat(20)),
    enc.encode("b".repeat(20)),
    enc.encode("c".repeat(20)), // total 60 > teto 50
  ];
  let idx = 0;

  const mockReader = {
    read: () => {
      if (idx < pedacos.length) {
        return Promise.resolve({ value: pedacos[idx++], done: false });
      }
      return Promise.resolve({ value: undefined, done: true });
    },
    cancel: () => {
      cancelChamadas++;
      return Promise.resolve();
    },
  };

  const falso = {
    headers: null,
    body: {
      getReader: () => mockReader,
    },
    text: () => Promise.resolve("fallback"),
  };

  await assert.rejects(
    ctx.lerTextoComLimite(falso, 50, "Teto estourado"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "Teto estourado");
      return true;
    }
  );

  assert.equal(cancelChamadas, 1);
});

test("lerTextoComLimite: sem body/headers cai em text() de contingencia e confere teto", async () => {
  const falsoOk = {
    text: () => Promise.resolve("12345"),
  };
  const lido = await ctx.lerTextoComLimite(falsoOk, 5, "Erro");
  assert.equal(lido, "12345");

  const falsoExcede = {
    text: () => Promise.resolve("123456"),
  };
  await assert.rejects(
    ctx.lerTextoComLimite(falsoExcede, 5, "Passou"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "Passou");
      return true;
    }
  );
});

test("sintoniza-link.html integra limites em loadPlaylistFromUrl e loadPlaylistFromFile", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");

  // loadPlaylistFromUrl deve usar lerTextoComLimite, listaTextoPareceM3u e listaLimitarCanais
  assert.match(html, /async function loadPlaylistFromUrl/);
  assert.match(html, /lerTextoComLimite\s*\(\s*res\s*,\s*LISTA_CANAIS_MAX_BYTES\s*,\s*MSG_LISTA_CANAIS_GRANDE\s*\)/);
  assert.match(html, /!listaTextoPareceM3u\s*\(\s*text\s*\)/);
  assert.match(html, /listaLimitarCanais\s*\(/);

  // loadPlaylistFromFile deve checar file.size > LISTA_CANAIS_MAX_BYTES antes de file.text()
  assert.match(html, /async function loadPlaylistFromFile/);
  assert.match(html, /file\.size\s*>\s*LISTA_CANAIS_MAX_BYTES/);
});
