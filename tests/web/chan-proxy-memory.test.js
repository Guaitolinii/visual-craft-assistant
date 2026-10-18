import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";
import { LINK_HTML_PATH, fakeStorage } from "../ott/loadOtt.js";

function load() {
  const ctx = vm.createContext({ JSON, Date, Math, Object, Array, String, Number });
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx, {
    filename: "resilience-helpers.js",
  });
  return ctx;
}

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("webChanKey: mesmo texto -> mesmo hash de 8 hex; textos diferentes -> hashes diferentes", () => {
  const { webChanKey } = load();
  assert.equal(typeof webChanKey, "function");

  const url1 = "http://xjet.fun:80/live/user123/pass456/12345.ts";
  const url2 = "http://xjet.fun:80/live/user123/pass456/12346.ts";

  const h1 = webChanKey(url1);
  const h1Again = webChanKey(url1);
  const h2 = webChanKey(url2);

  assert.equal(typeof h1, "string");
  assert.equal(h1.length, 8);
  assert.match(h1, /^[0-9a-f]{8}$/i);
  assert.equal(h1, h1Again);
  assert.notEqual(h1, h2);
});

test("webChanKey: não-string e string vazia -> ''", () => {
  const { webChanKey } = load();
  assert.equal(webChanKey(""), "");
  assert.equal(webChanKey(null), "");
  assert.equal(webChanKey(undefined), "");
  assert.equal(webChanKey(123), "");
  assert.equal(webChanKey({}), "");
  assert.equal(webChanKey([]), "");
  assert.equal(webChanKey(true), "");
});

test("webChanKey: o hash NÃO contém trechos da URL", () => {
  const { webChanKey } = load();
  const user = "mysecretusername";
  const pass = "topsecretpassword";
  const url = `http://painel.tv:8080/live/${user}/${pass}/9999.ts`;

  const h = webChanKey(url);
  assert.equal(h.includes(user), false);
  assert.equal(h.includes(pass), false);
  assert.equal(h.includes("painel"), false);
  assert.equal(h.includes("9999"), false);
});

test("webChanProxyRead/Write/Clear: grava e lê com fakeStorage", () => {
  const { webChanProxyRead, webChanProxyWrite } = load();
  const s = fakeStorage();
  const now = 1000000;
  const url = "http://iptv.stream:80/live/u/p/1.ts";

  assert.equal(webChanProxyRead(s, url, now), false);
  webChanProxyWrite(s, url, now);
  assert.equal(webChanProxyRead(s, url, now), true);
  assert.equal(webChanProxyRead(s, url, now + 1000), true);
});

test("webChanProxyRead: vence após 6 h (+1 ms)", () => {
  const { webChanProxyRead, webChanProxyWrite } = load();
  const s = fakeStorage();
  const now = 2000000;
  const url = "http://iptv.stream:80/live/u/p/2.ts";
  const SIX_HOURS_MS = 6 * 3600 * 1000;

  webChanProxyWrite(s, url, now);
  // Pouco antes de vencer
  assert.equal(webChanProxyRead(s, url, now + SIX_HOURS_MS - 1), true);
  // Exatamente ou mais que 6h
  assert.equal(webChanProxyRead(s, url, now + SIX_HOURS_MS), false);
  assert.equal(webChanProxyRead(s, url, now + SIX_HOURS_MS + 1), false);
});

test("webChanProxyRead/Write/Clear: canais diferentes independentes e Clear remove só o pedido", () => {
  const { webChanProxyRead, webChanProxyWrite, webChanProxyClear } = load();
  const s = fakeStorage();
  const now = 3000000;
  const urlA = "http://iptv.stream:80/live/u/p/canalA.ts";
  const urlB = "http://iptv.stream:80/live/u/p/canalB.ts";

  webChanProxyWrite(s, urlA, now);
  webChanProxyWrite(s, urlB, now);

  assert.equal(webChanProxyRead(s, urlA, now), true);
  assert.equal(webChanProxyRead(s, urlB, now), true);

  webChanProxyClear(s, urlA);
  assert.equal(webChanProxyRead(s, urlA, now), false);
  assert.equal(webChanProxyRead(s, urlB, now), true);

  // Clear em canal não existente não faz nada e não lança
  webChanProxyClear(s, "http://iptv.stream:80/live/u/p/canalInexistente.ts");
  assert.equal(webChanProxyRead(s, urlB, now), true);
});

test("webChanProxyWrite: limite de 300 (grave 305, os 5 mais antigos somem)", () => {
  const { webChanProxyRead, webChanProxyWrite } = load();
  const s = fakeStorage();
  const baseTime = 1000000;

  for (let i = 1; i <= 305; i++) {
    webChanProxyWrite(s, `http://iptv.stream:80/live/u/p/ch${i}.ts`, baseTime + i * 10);
  }

  const raw = s.getItem("sint_web_chan_proxy");
  const data = JSON.parse(raw);
  assert.equal(Object.keys(data).length, 300);

  // Canais 1 a 5 devem ter sumido (eram os mais antigos)
  for (let i = 1; i <= 5; i++) {
    assert.equal(webChanProxyRead(s, `http://iptv.stream:80/live/u/p/ch${i}.ts`, baseTime + 4000), false, `Canal ${i} deveria ter sido descartado`);
  }

  // Canais 6 a 305 devem continuar presentes
  for (let i = 6; i <= 305; i++) {
    assert.equal(webChanProxyRead(s, `http://iptv.stream:80/live/u/p/ch${i}.ts`, baseTime + 4000), true, `Canal ${i} deveria estar presente`);
  }
});

test("entradas inválidas: JSON de lixo, storage ausente, relógio adiantado, chave __proto__, URL não-string", () => {
  const { webChanProxyRead, webChanProxyWrite, webChanProxyClear } = load();

  // Storage ausente / null / undefined
  assert.equal(webChanProxyRead(null, "http://iptv.stream/1.ts", 1000), false);
  assert.equal(webChanProxyRead(undefined, "http://iptv.stream/1.ts", 1000), false);
  assert.doesNotThrow(() => webChanProxyWrite(null, "http://iptv.stream/1.ts", 1000));
  assert.doesNotThrow(() => webChanProxyWrite(undefined, "http://iptv.stream/1.ts", 1000));
  assert.doesNotThrow(() => webChanProxyClear(null, "http://iptv.stream/1.ts"));
  assert.doesNotThrow(() => webChanProxyClear(undefined, "http://iptv.stream/1.ts"));

  // Storage que lança em getItem/setItem
  const throwingStorage = {
    getItem: () => { throw new Error("storage disk error"); },
    setItem: () => { throw new Error("quota exceeded"); },
    removeItem: () => { throw new Error("fail"); },
  };
  assert.equal(webChanProxyRead(throwingStorage, "http://iptv.stream/1.ts", 1000), false);
  assert.doesNotThrow(() => webChanProxyWrite(throwingStorage, "http://iptv.stream/1.ts", 1000));
  assert.doesNotThrow(() => webChanProxyClear(throwingStorage, "http://iptv.stream/1.ts"));

  // JSON de lixo no storage -> false sem lançar
  const garbageStorage = fakeStorage({ sint_web_chan_proxy: "in{valid json" });
  assert.equal(webChanProxyRead(garbageStorage, "http://iptv.stream/1.ts", 1000), false);
  assert.doesNotThrow(() => webChanProxyClear(garbageStorage, "http://iptv.stream/1.ts"));
  // Write sobre JSON quebrado deve recuperar e gravar
  assert.doesNotThrow(() => webChanProxyWrite(garbageStorage, "http://iptv.stream/1.ts", 1000));
  assert.equal(webChanProxyRead(garbageStorage, "http://iptv.stream/1.ts", 1000), true);

  // Array ou primitivo no JSON
  const arrayStorage = fakeStorage({ sint_web_chan_proxy: "[\"item\"]" });
  assert.equal(webChanProxyRead(arrayStorage, "http://iptv.stream/1.ts", 1000), false);

  // URL vazia ou não-string ignorada
  const s = fakeStorage();
  webChanProxyWrite(s, "", 1000);
  webChanProxyWrite(s, null, 1000);
  webChanProxyWrite(s, undefined, 1000);
  webChanProxyWrite(s, 12345, 1000);
  assert.equal(s.getItem("sint_web_chan_proxy"), null);
  assert.equal(webChanProxyRead(s, "", 1000), false);
  assert.equal(webChanProxyRead(s, null, 1000), false);
  assert.doesNotThrow(() => webChanProxyClear(s, ""));
  assert.doesNotThrow(() => webChanProxyClear(s, null));

  // Relógio adiantado em mais de 60s no registro
  const urlSkew = "http://iptv.stream/skew.ts";
  webChanProxyWrite(s, urlSkew, 2000000);
  // Leitura com relógio 61s atrasado em relação ao registro (ts > nowMs + 60000)
  assert.equal(webChanProxyRead(s, urlSkew, 2000000 - 61000), false);
  // Leitura com relógio dentro da tolerância de 60s
  assert.equal(webChanProxyRead(s, urlSkew, 2000000 - 59000), true);

  // Chave __proto__
  const protoStorage = fakeStorage({ sint_web_chan_proxy: '{"__proto__": 123}' });
  assert.equal(webChanProxyRead(protoStorage, "__proto__", 1000), false);
  webChanProxyWrite(protoStorage, "__proto__", 1000);
  const afterWrite = JSON.parse(protoStorage.getItem("sint_web_chan_proxy") || "{}");
  assert.equal(Object.prototype.hasOwnProperty.call(afterWrite, "__proto__"), false);
});

test("segurança: a chave guardada em localStorage não contém usuário/senha", () => {
  const { webChanProxyWrite } = load();
  const s = fakeStorage();
  const secretUser = "meu_usuario_secreto";
  const secretPass = "minha_senha_super_secreta";
  const url = `http://live.exemplo.com:8080/live/${secretUser}/${secretPass}/101.ts?token=xyz123`;

  webChanProxyWrite(s, url, 1000000);
  const raw = s.getItem("sint_web_chan_proxy");
  assert.ok(raw, "deve ter gravado no storage");
  assert.equal(raw.includes(secretUser), false, "não deve conter o nome do usuário");
  assert.equal(raw.includes(secretPass), false, "não deve conter a senha");
  assert.equal(raw.includes("xyz123"), false, "não deve conter tokens da query");
  assert.equal(raw.includes("live.exemplo.com"), false, "não deve conter o host");
});

test("ligação em detectStreamType: consulta webChanProxyRead antes de probeNoHlsKnown", () => {
  const probeIdx = html.indexOf("if (probeNoHlsKnown(url))");
  assert.ok(probeIdx > 0, "deve existir if (probeNoHlsKnown(url))");

  const detectIdx = html.indexOf("async function detectStreamType(url)");
  assert.ok(detectIdx > 0, "deve existir detectStreamType");

  const tsSection = html.slice(detectIdx, probeIdx + 60);
  assert.ok(
    tsSection.includes("webChanProxyRead(localStorage, url, Date.now())"),
    "detectStreamType deve chamar webChanProxyRead(localStorage, url, Date.now()) antes de probeNoHlsKnown"
  );
  assert.ok(
    tsSection.indexOf("webChanProxyRead(localStorage, url, Date.now())") < tsSection.indexOf("probeNoHlsKnown(url)"),
    "webChanProxyRead deve vir antes de probeNoHlsKnown"
  );
});

test("ligação em playStream: webCanalLembrado declarado e consultado, webResolveFinal ignorado se lembrado", () => {
  assert.ok(html.includes("let webCanalLembrado = false;"), "deve declarar let webCanalLembrado = false;");
  assert.ok(html.includes("const webLembrado = webChanProxyRead("), "deve ler const webLembrado = webChanProxyRead(");

  // mpegts branch em playStream
  const mpegtsBranchIdx = html.indexOf('} else if (streamInfo.type === "mpegts") {');
  assert.ok(mpegtsBranchIdx > 0, 'deve encontrar ramo streamInfo.type === "mpegts"');
  const mpegtsBranch = html.slice(mpegtsBranchIdx, mpegtsBranchIdx + 800);

  assert.ok(mpegtsBranch.includes("const webLembrado = webChanProxyRead(localStorage, streamInfo.url, Date.now());"));
});

test("ligação no MEDIA_INFO de mpegts: grava webChanProxyWrite condicionado", () => {
  assert.ok(
    html.includes("if (webForced && !webResolvedDirect && webChainRedirects(streamInfo.url)) webChanProxyWrite(localStorage, streamInfo.url, Date.now());"),
    "MEDIA_INFO deve gravar no storage se webForced && !webResolvedDirect && webChainRedirects(streamInfo.url)"
  );
});

test("ligação no ERROR de mpegts: apaga lembrança e recomeça via playStream se webCanalLembrado && !webStarted && !webFellBack", () => {
  assert.ok(
    html.includes("webChanProxyClear(localStorage, streamInfo.url)"),
    "ERROR deve chamar webChanProxyClear"
  );
  assert.ok(
    html.includes("if (webCanalLembrado && !webStarted && !webFellBack)"),
    "ERROR deve testar webCanalLembrado && !webStarted && !webFellBack"
  );
});
