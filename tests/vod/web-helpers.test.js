// App web: atalhos de teclado, tela cheia por CSS e escrita segura no localStorage (funções puras do script principal)
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const ctx = loadVodHelpers();
const ev = (key, extra = {}) => ({ key, target: { tagName: "BODY" }, ...extra });

test("atalhos: espaço e k alternam play/pause", () => {
  assert.equal(ctx.webKeyAction(ev(" ")), "playpause");
  assert.equal(ctx.webKeyAction(ev("k")), "playpause");
  assert.equal(ctx.webKeyAction(ev("K")), "playpause");
});

test("atalhos: setas andam 10 s e mexem no volume", () => {
  assert.equal(ctx.webKeyAction(ev("ArrowLeft")), "seek-back");
  assert.equal(ctx.webKeyAction(ev("ArrowRight")), "seek-fwd");
  assert.equal(ctx.webKeyAction(ev("ArrowUp")), "vol-up");
  assert.equal(ctx.webKeyAction(ev("ArrowDown")), "vol-down");
});

test("atalhos: m mudo, f tela cheia, / busca, Esc sai da tela cheia", () => {
  assert.equal(ctx.webKeyAction(ev("m")), "mute");
  assert.equal(ctx.webKeyAction(ev("M")), "mute");
  assert.equal(ctx.webKeyAction(ev("f")), "fullscreen");
  assert.equal(ctx.webKeyAction(ev("/")), "search");
  assert.equal(ctx.webKeyAction(ev("Escape")), "exit-fullscreen");
});

test("atalhos: nunca com o foco num campo de texto", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
    assert.equal(ctx.webKeyAction(ev(" ", { target: { tagName } })), null, tagName);
    assert.equal(ctx.webKeyAction(ev("f", { target: { tagName } })), null, tagName);
    assert.equal(ctx.webKeyAction(ev("ArrowLeft", { target: { tagName } })), null, tagName);
  }
  assert.equal(ctx.webKeyAction(ev("m", { target: { tagName: "DIV", isContentEditable: true } })), null);
});

test("atalhos: com Ctrl, Alt ou Cmd ficam para o navegador (Ctrl+F, Ctrl+K...)", () => {
  assert.equal(ctx.webKeyAction(ev("f", { ctrlKey: true })), null);
  assert.equal(ctx.webKeyAction(ev("k", { metaKey: true })), null);
  assert.equal(ctx.webKeyAction(ev("ArrowLeft", { altKey: true })), null); // Alt+Seta = voltar do navegador
});

test("atalhos: espaço com foco num botão ou link fica para o próprio botão (sem acionar duas vezes)", () => {
  assert.equal(ctx.webKeyAction(ev(" ", { target: { tagName: "BUTTON" } })), null);
  assert.equal(ctx.webKeyAction(ev(" ", { target: { tagName: "A" } })), null);
  assert.equal(ctx.webKeyAction(ev("k", { target: { tagName: "BUTTON" } })), "playpause");
  assert.equal(ctx.webKeyAction(ev("ArrowRight", { target: { tagName: "BUTTON" } })), "seek-fwd");
});

test("atalhos: outras teclas e eventos vazios não fazem nada", () => {
  assert.equal(ctx.webKeyAction(ev("a")), null);
  assert.equal(ctx.webKeyAction(ev("Enter")), null);
  assert.equal(ctx.webKeyAction(ev("Tab")), null);
  assert.equal(ctx.webKeyAction(null), null);
  assert.equal(ctx.webKeyAction({}), null);
  assert.equal(ctx.webKeyAction({ key: "m" }), "mute"); // sem target
});

test("tela cheia por CSS no iPhone/iPad e no atalho instalado; no navegador comum a Fullscreen API", () => {
  assert.equal(ctx.webUsesPseudoFullscreen(true, false), true);
  assert.equal(ctx.webUsesPseudoFullscreen(false, true), true);
  assert.equal(ctx.webUsesPseudoFullscreen(true, true), true);
  assert.equal(ctx.webUsesPseudoFullscreen(false, false), false);
});

test("lsSet grava normalmente e devolve true", () => {
  assert.equal(ctx.lsSet("sint_teste", "valor"), true);
  assert.equal(ctx.localStorage.getItem("sint_teste"), "valor");
});

test("lsSet: cota estourada apaga o guia (EPG) em cache e tenta de novo uma vez", () => {
  const ls = ctx.localStorage;
  const original = ls.setItem;
  ls.setItem("sint_epg_cache", "x".repeat(10));
  let cheio = true;
  ls.setItem = (k, v) => {
    if (cheio && k !== "sint_epg_cache") { cheio = false; throw new Error("QuotaExceededError"); } // o 1º write estoura
    return original(k, v);
  };
  try {
    assert.equal(ctx.lsSet("sint_fav", "[1]"), true);
    assert.equal(ls.getItem("sint_epg_cache"), null); // guia apagado
    assert.equal(ls.getItem("sint_fav"), "[1]");
  } finally {
    ls.setItem = original;
  }
});

test("lsSet: se continua estourando devolve false e nunca lança", () => {
  const ls = ctx.localStorage;
  const original = ls.setItem;
  ls.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    assert.equal(ctx.lsSet("sint_recents", "[]"), false);
  } finally {
    ls.setItem = original;
  }
});

// ─── Direto primeiro, proxy só se precisar (v16): rota por host, memória e parse ───
const H = 3600 * 1000;
const AGORA = 1_800_000_000_000;
const dados = (url, mem, https = true, agora = AGORA) => ctx.webRoute(url, mem, agora, https, "data");
const midia = (url, mem, https = true, agora = AGORA) => ctx.webRoute(url, mem, agora, https, "media");

test("webRoute: http numa página https é conteúdo misto, sempre proxy (mesmo com memória 'd')", () => {
  assert.equal(dados("http://prov.com:8080/get.php", {}), "proxy");
  assert.equal(midia("http://prov.com/movie/u/p/1.mp4", {}), "proxy");
  assert.equal(dados("http://prov.com/a", { "prov.com": { m: "d", t: AGORA } }), "proxy");
});

test("webRoute: http numa página http (teste local) não é conteúdo misto e segue as regras normais", () => {
  assert.equal(dados("http://127.0.0.1:9000/a", {}, false), "probe");
  assert.equal(midia("http://127.0.0.1:9000/a", {}, false), "direct");
});

test("webRoute: sem memória, dados sondam o direto e mídia (<video src>) vai direto", () => {
  assert.equal(dados("https://prov.com/get.php", {}), "probe");
  assert.equal(midia("https://prov.com/movie/1.mp4", {}), "direct");
});

test("webRoute: memória 'd' vale 24 h e depois volta a sondar", () => {
  const mem = (t) => ({ "prov.com": { m: "d", t } });
  assert.equal(dados("https://prov.com/a", mem(AGORA - 23 * H)), "direct");
  assert.equal(dados("https://prov.com/a", mem(AGORA - 25 * H)), "probe");
});

test("webRoute: memória 'p' vale 6 h (proxy) e depois tenta o direto de novo", () => {
  const mem = (t) => ({ "prov.com": { m: "p", t } });
  assert.equal(dados("https://prov.com/a", mem(AGORA - 5 * H)), "proxy");
  assert.equal(dados("https://prov.com/a", mem(AGORA - 7 * H)), "probe");
  assert.equal(midia("https://prov.com/a", { "v:prov.com": { m: "p", t: AGORA - 5 * H } }), "proxy");
  assert.equal(midia("https://prov.com/a", { "v:prov.com": { m: "p", t: AGORA - 7 * H } }), "direct");
});

test("webRoute: a memória é por host (com porta) e separada entre dados (CORS) e mídia (<video>)", () => {
  const mem = { "prov.com": { m: "p", t: AGORA } };
  assert.equal(dados("https://outro.com/a", mem), "probe");
  assert.equal(dados("https://prov.com:8443/a", mem), "probe"); // outra porta = outro servidor
  assert.equal(dados("https://PROV.com/a", mem), "proxy"); // host sem diferenciar maiúsculas
  assert.equal(midia("https://prov.com/a", mem), "direct"); // CORS ruim nos dados não impede o <video> direto
});

test("webRoute: relógio adiantado na memória (t no futuro) é ignorado; entradas ruins também", () => {
  assert.equal(dados("https://prov.com/a", { "prov.com": { m: "p", t: AGORA + 5 * H } }), "probe");
  assert.equal(dados("https://prov.com/a", { "prov.com": { m: "x", t: AGORA } }), "probe");
  assert.equal(dados("https://prov.com/a", { "prov.com": null }), "probe");
  assert.equal(dados("https://prov.com/a", null), "probe");
  assert.equal(dados("https://prov.com/a", undefined), "probe");
});

test("webRoute: URL inválida ou que não é http(s) não tem o que decidir (direct)", () => {
  assert.equal(dados("lixo", {}), "direct");
  assert.equal(dados("blob:https://x/abc", {}), "direct");
});

test("webMemKey: host em minúsculas com porta; mídia ganha o prefixo v:", () => {
  assert.equal(ctx.webMemKey("https://Prov.COM:8443/a?b=1", "data"), "prov.com:8443");
  assert.equal(ctx.webMemKey("http://prov.com/a", "media"), "v:prov.com");
  assert.equal(ctx.webMemKey("lixo", "data"), "");
});

test("webMemParse: aceita o formato certo e descarta lixo sem lançar", () => {
  assert.deepEqual(ctx.webMemParse(JSON.stringify({ "a.com": { m: "d", t: 5 }, "b.com": { m: "p", t: 9 } })), { "a.com": { m: "d", t: 5 }, "b.com": { m: "p", t: 9 } });
  assert.deepEqual(ctx.webMemParse(null), {});
  assert.deepEqual(ctx.webMemParse(""), {});
  assert.deepEqual(ctx.webMemParse("{lixo"), {});
  assert.deepEqual(ctx.webMemParse("[1,2]"), {});
  assert.deepEqual(ctx.webMemParse("42"), {});
  assert.deepEqual(ctx.webMemParse(JSON.stringify({ "a.com": { m: "x", t: 5 }, "b.com": { m: "d" }, "c.com": "d", "d.com": { m: "p", t: "ontem" }, "e.com": { m: "d", t: 7 } })), { "e.com": { m: "d", t: 7 } });
});

test("webMemParse: mais de 200 hosts guarda os 200 mais recentes", () => {
  const grande = {};
  for (let i = 0; i < 250; i++) grande["h" + i + ".com"] = { m: "d", t: 1000 + i };
  const r = ctx.webMemParse(JSON.stringify(grande));
  assert.equal(Object.keys(r).length, 200);
  assert.ok(r["h249.com"] && r["h50.com"] && !r["h49.com"]);
});

test("webMemMark: grava d/p com a hora, sem alterar o objeto original", () => {
  const base = { "a.com": { m: "d", t: 1 } };
  const r = ctx.webMemMark(base, "b.com", "p", 500);
  assert.deepEqual(r, { "a.com": { m: "d", t: 1 }, "b.com": { m: "p", t: 500 } });
  assert.deepEqual(base, { "a.com": { m: "d", t: 1 } });
  assert.deepEqual(ctx.webMemMark(r, "a.com", "p", 900)["a.com"], { m: "p", t: 900 }); // troca o modo
});

test("webMemMark: limita a 200 hosts descartando os mais antigos", () => {
  let mem = {};
  for (let i = 0; i < 200; i++) mem = ctx.webMemMark(mem, "h" + i + ".com", "d", 1000 + i);
  assert.equal(Object.keys(mem).length, 200);
  mem = ctx.webMemMark(mem, "novo.com", "p", 5000);
  assert.equal(Object.keys(mem).length, 200);
  assert.ok(mem["novo.com"] && !mem["h0.com"] && mem["h1.com"]);
});

test("webMemMark: modo inválido ou host vazio não grava nada", () => {
  assert.deepEqual(ctx.webMemMark({}, "a.com", "x", 1), {});
  assert.deepEqual(ctx.webMemMark({}, "", "d", 1), {});
  assert.deepEqual(ctx.webMemMark(null, "a.com", "d", 1), { "a.com": { m: "d", t: 1 } });
});

test("webHlsShouldFallback: só no direto, antes de tocar, uma vez, e só em erro de rede", () => {
  const base = { direct: true, started: false, fellBack: false, fatal: true, type: "networkError", details: "fragLoadError", code: 0 };
  assert.equal(ctx.webHlsShouldFallback(base), true);
  assert.equal(ctx.webHlsShouldFallback({ ...base, fatal: false }), true); // sem CORS: status 0 já resolve na hora
  assert.equal(ctx.webHlsShouldFallback({ ...base, fatal: false, code: 404 }), false); // erro comum, deixa o hls.js tentar
  assert.equal(ctx.webHlsShouldFallback({ ...base, fatal: false, details: "bufferStalledError" }), false);
  assert.equal(ctx.webHlsShouldFallback({ ...base, code: 404 }), true); // fatal de rede sempre cai para o proxy
  assert.equal(ctx.webHlsShouldFallback({ ...base, direct: false }), false);
  assert.equal(ctx.webHlsShouldFallback({ ...base, started: true }), false); // já tocou: queda de rede de verdade, não é CORS
  assert.equal(ctx.webHlsShouldFallback({ ...base, fellBack: true }), false);
  assert.equal(ctx.webHlsShouldFallback({ ...base, type: "mediaError" }), false);
});
