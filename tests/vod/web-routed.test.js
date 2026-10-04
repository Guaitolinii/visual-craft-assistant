// App web (v16): direto primeiro, proxy só se falhar. Testa webFetchRouted, webHlsPlan e webMediaSrc
// com o script principal carregado num contexto isolado, fetch e localStorage falsos (nenhuma rede real).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const LINK_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "sintoniza-link.html");

const TOKEN = "t".repeat(64);
const PROXY = "https://sintonizatv.test/api/proxy?u=";

function ambienteWeb({ https = true, memoria = null, responder } = {}) {
  const c = loadVodHelpers();
  // o app web usa o ott-core (isWebApp, OTT_KEYS, ottWebProxy...): carrega no mesmo contexto, como na página real
  vm.runInContext(extractInlineScriptById(LINK_HTML, "qrcodegen"), c);
  vm.runInContext(extractInlineScriptById(LINK_HTML, "ott-core"), c);
  c.location = { pathname: "/app/", protocol: https ? "https:" : "http:", origin: https ? "https://sintonizatv.test" : "http://127.0.0.1:8000", hostname: "sintonizatv.test" };
  c.AbortController = AbortController;
  c.localStorage.setItem("sint_ott_token", TOKEN);
  if (memoria) c.localStorage.setItem("sint_web_hosts", JSON.stringify(memoria));
  c.chamadas = [];
  c.fetch = async (url, init) => {
    c.chamadas.push(String(url));
    return responder(String(url), init);
  };
  return c;
}
const resp = (status = 200) => ({ ok: status < 400, status });
const viaProxy = (u) => u.startsWith(PROXY);
const memoriaDe = (c) => JSON.parse(c.localStorage.getItem("sint_web_hosts") || "{}");
const contadores = (c) => JSON.parse(JSON.stringify(c.window.__sintWeb));

test("webFetchRouted: https com CORS vai direto, zero chamadas ao proxy, e o host vira 'd'", async () => {
  const c = ambienteWeb({ responder: () => resp(200) });
  const r = await c.webFetchRouted("https://prov.test/player_api.php?a=1");
  assert.equal(r.status, 200);
  assert.deepEqual(c.chamadas, ["https://prov.test/player_api.php?a=1"]);
  assert.equal(memoriaDe(c)["prov.test"].m, "d");
  assert.deepEqual(contadores(c), { direto: 1, proxy: 0, fallback: 0 });
});

test("webFetchRouted: falha de rede/CORS no direto repete UMA vez pelo proxy e o host vira 'p'", async () => {
  const c = ambienteWeb({ responder: (u) => { if (viaProxy(u)) return resp(200); throw new TypeError("Failed to fetch"); } });
  const r = await c.webFetchRouted("https://prov.test/get.php?u=1");
  assert.equal(r.status, 200);
  assert.equal(c.chamadas.length, 2);
  assert.equal(c.chamadas[0], "https://prov.test/get.php?u=1");
  assert.ok(viaProxy(c.chamadas[1]) && c.chamadas[1].includes("&t=" + TOKEN));
  assert.equal(memoriaDe(c)["prov.test"].m, "p");
  assert.deepEqual(contadores(c), { direto: 0, proxy: 1, fallback: 1 });
  // a partir daí vai direto ao proxy, sem tentar o direto de novo
  await c.webFetchRouted("https://prov.test/player_api.php");
  assert.equal(c.chamadas.length, 3);
  assert.ok(viaProxy(c.chamadas[2]));
  assert.deepEqual(contadores(c), { direto: 0, proxy: 2, fallback: 1 });
});

test("webFetchRouted: o provedor recusar o navegador (403, 406, 451) também cai no proxy; 404 não", async () => {
  for (const status of [403, 406, 451]) {
    const c = ambienteWeb({ responder: (u) => (viaProxy(u) ? resp(200) : resp(status)) });
    const r = await c.webFetchRouted("https://prov.test/get.php");
    assert.equal(r.status, 200, "status " + status);
    assert.equal(c.chamadas.length, 2, "status " + status);
  }
  const c = ambienteWeb({ responder: () => resp(404) }); // 404 é resposta legítima do provedor: não repete
  assert.equal((await c.webFetchRouted("https://prov.test/x")).status, 404);
  assert.equal(c.chamadas.length, 1);
});

test("webFetchRouted: http numa página https vai direto ao proxy (conteúdo misto), sem tentar o direto", async () => {
  const c = ambienteWeb({ responder: () => resp(200) });
  await c.webFetchRouted("http://prov.test:8080/get.php");
  assert.equal(c.chamadas.length, 1);
  assert.ok(viaProxy(c.chamadas[0]));
  assert.deepEqual(contadores(c), { direto: 0, proxy: 1, fallback: 0 });
  assert.deepEqual(memoriaDe(c), {}); // nada a aprender: o http nunca teve escolha
});

test("webFetchRouted: memória 'p' válida vai direto ao proxy; vencida (7 h) tenta o direto de novo", async () => {
  const agora = Date.now();
  const c1 = ambienteWeb({ memoria: { "prov.test": { m: "p", t: agora - 1 * 3600e3 } }, responder: () => resp(200) });
  await c1.webFetchRouted("https://prov.test/a");
  assert.equal(c1.chamadas.length, 1);
  assert.ok(viaProxy(c1.chamadas[0]));
  const c2 = ambienteWeb({ memoria: { "prov.test": { m: "p", t: agora - 7 * 3600e3 } }, responder: () => resp(200) });
  await c2.webFetchRouted("https://prov.test/a");
  assert.deepEqual(c2.chamadas, ["https://prov.test/a"]);
  assert.equal(memoriaDe(c2)["prov.test"].m, "d"); // o direto voltou a funcionar
});

test("webFetchRouted: memória 'd' vai direto sem sondar; se mesmo assim falhar, cai no proxy uma vez e corrige a memória", async () => {
  const c = ambienteWeb({ memoria: { "prov.test": { m: "d", t: Date.now() - 3600e3 } }, responder: (u) => { if (viaProxy(u)) return resp(200); throw new TypeError("Failed to fetch"); } });
  await c.webFetchRouted("https://prov.test/a");
  assert.equal(c.chamadas.length, 2);
  assert.equal(memoriaDe(c)["prov.test"].m, "p");
});

test("webFetchRouted: se o proxy também falha o erro sobe e nada é marcado como 'p'", async () => {
  const c = ambienteWeb({ responder: () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(c.webFetchRouted("https://prov.test/a"), /Failed to fetch/);
  assert.equal(c.chamadas.length, 2);
  assert.equal(memoriaDe(c)["prov.test"], undefined);
});

test("webFetchRouted: cancelamento de quem pediu não é repetido pelo proxy", async () => {
  const ctl = new AbortController();
  const c = ambienteWeb({ responder: () => { ctl.abort(); throw new DOMException("abortado", "AbortError"); } });
  await assert.rejects(c.webFetchRouted("https://prov.test/a", { signal: ctl.signal }));
  assert.equal(c.chamadas.length, 1);
});

test("webFetchRouted: destino próprio (este site, GitHub) e fora do modo web passam como fetch normal, sem contar", async () => {
  const c = ambienteWeb({ responder: () => resp(200) });
  await c.webFetchRouted("https://sintonizatv.test/app-config.json");
  await c.webFetchRouted("https://raw.githubusercontent.com/a/b/c.json");
  assert.deepEqual(c.chamadas, ["https://sintonizatv.test/app-config.json", "https://raw.githubusercontent.com/a/b/c.json"]);
  assert.equal(c.window.__sintWeb, undefined);
  const nativo = ambienteWeb({ responder: () => resp(200) });
  nativo.location.pathname = "/index.html"; // fora de /app/: não é o app web
  await nativo.webFetchRouted("https://prov.test/a");
  assert.deepEqual(nativo.chamadas, ["https://prov.test/a"]);
  assert.equal(nativo.window.__sintWeb, undefined);
});

test("webFetchRouted: sem token do aparelho não há proxy possível: fetch simples", async () => {
  const c = ambienteWeb({ responder: () => resp(200) });
  c.localStorage.removeItem("sint_ott_token");
  await c.webFetchRouted("https://prov.test/a");
  assert.deepEqual(c.chamadas, ["https://prov.test/a"]);
});

test("webHlsPlan: manifesto direto sondado (#EXTM3U) -> direto; sem CORS -> proxy k=hls e host 'p'", async () => {
  const bom = ambienteWeb({ responder: () => ({ ok: true, status: 200, text: async () => "#EXTM3U\n#EXT-X-VERSION:3\n" }) });
  const p1 = await bom.webHlsPlan("https://prov.test/live/1.m3u8");
  assert.equal(p1.direct, true);
  assert.equal(p1.src, "https://prov.test/live/1.m3u8");
  assert.equal(memoriaDe(bom)["prov.test"].m, "d");
  assert.equal((await bom.webHlsPlan("https://prov.test/live/2.m3u8")).direct, true); // memória 'd': não sonda de novo
  assert.equal(bom.chamadas.length, 1);

  const ruim = ambienteWeb({ responder: () => { throw new TypeError("Failed to fetch"); } });
  const p2 = await ruim.webHlsPlan("https://prov.test/live/1.m3u8");
  assert.equal(p2.direct, false);
  assert.ok(viaProxy(p2.src) && p2.src.endsWith("&k=hls"));
  assert.equal(memoriaDe(ruim)["prov.test"].m, "p");
  assert.deepEqual(contadores(ruim), { direto: 0, proxy: 1, fallback: 1 });

  const html = ambienteWeb({ responder: () => ({ ok: true, status: 200, text: async () => "<html>erro</html>" }) }); // não é manifesto
  assert.equal((await html.webHlsPlan("https://prov.test/live/1.m3u8")).direct, false);
});

test("webHlsPlan: http numa página https vai ao proxy sem sondar", async () => {
  const c = ambienteWeb({ responder: () => ({ ok: true, status: 200, text: async () => "#EXTM3U" }) });
  const p = await c.webHlsPlan("http://prov.test/live/1.m3u8");
  assert.equal(p.direct, false);
  assert.equal(c.chamadas.length, 0);
  assert.ok(viaProxy(p.src) && p.src.endsWith("&k=hls"));
});

test("webMediaSrc: https vai direto; http, memória 'p' de mídia e falha anterior vão pelo proxy", () => {
  const c = ambienteWeb({ responder: () => resp(200) });
  assert.equal(c.webMediaSrc("https://prov.test/movie/1.mp4").direct, true);
  assert.equal(c.webMediaSrc("https://prov.test/movie/1.mp4").src, "https://prov.test/movie/1.mp4");
  const http = c.webMediaSrc("http://prov.test/movie/1.mp4");
  assert.equal(http.direct, false);
  assert.ok(viaProxy(http.src));
  const forcado = c.webMediaSrc("https://prov.test/movie/1.mp4", true);
  assert.equal(forcado.direct, false);
  assert.equal(forcado.forced, true);
  const p = ambienteWeb({ memoria: { "v:prov.test": { m: "p", t: Date.now() } }, responder: () => resp(200) });
  assert.equal(p.webMediaSrc("https://prov.test/movie/1.mp4").direct, false);
  const soDados = ambienteWeb({ memoria: { "prov.test": { m: "p", t: Date.now() } }, responder: () => resp(200) }); // CORS ruim não impede o <video>
  assert.equal(soDados.webMediaSrc("https://prov.test/movie/1.mp4").direct, true);
});

test("webMediaSrc: HLS nativo (kind hls) forçado ao proxy reescreve o manifesto (k=hls)", () => {
  const c = ambienteWeb({ responder: () => resp(200) });
  const m = c.webMediaSrc("https://prov.test/live/1.m3u8", true, "hls");
  assert.ok(viaProxy(m.src) && m.src.endsWith("&k=hls"));
  assert.equal(m.forced, true);
});
