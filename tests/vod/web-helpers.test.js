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
