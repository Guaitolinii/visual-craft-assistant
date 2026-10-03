// Arrastar da borda esquerda abre o menu lateral (função pura de decisão)
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const d = (o) => loadVodHelpers().edgeSwipeDecision({ startX: 10, startY: 400, x: 90, y: 410, dtMs: 200, sidebarOpen: false, ...o });

test("toque na borda arrastado para o centro abre o menu", () => {
  assert.equal(d({}), "open");
});

test("limites da borda: 28 px ainda vale, 29 px não", () => {
  assert.equal(d({ startX: 28, x: 28 + 56 }), "open");
  assert.equal(d({ startX: 29, x: 29 + 80 }), null);
});

test("começar longe da borda (meio da tela) não abre", () => {
  assert.equal(d({ startX: 180, x: 300 }), null);
});

test("deslocamento curto (< 56 px) não abre; exatamente 56 px abre", () => {
  assert.equal(d({ x: 10 + 55 }), null);
  assert.equal(d({ x: 10 + 56, y: 400 }), "open");
});

test("arrasto muito vertical não abre (rolagem)", () => {
  assert.equal(d({ x: 10 + 60, y: 400 + 80 }), null);
  // limite: |dy| = 0,6 * dx ainda é horizontal o bastante
  assert.equal(d({ x: 10 + 100, y: 400 + 60 }), "open");
  assert.equal(d({ x: 10 + 100, y: 400 - 61 }), null);
});

test("gesto lento (> 700 ms) não abre; 700 ms ainda abre", () => {
  assert.equal(d({ dtMs: 701 }), null);
  assert.equal(d({ dtMs: 700 }), "open");
});

test("arrastar para a esquerda a partir da borda não abre", () => {
  assert.equal(d({ startX: 20, x: 0 }), null);
});

test("com o menu aberto, arrastar para a esquerda fecha", () => {
  assert.equal(d({ sidebarOpen: true, startX: 250, x: 180 }), "close");
  assert.equal(d({ sidebarOpen: true, startX: 250, x: 194 }), "close");
});

test("com o menu aberto: curto, vertical ou lento não fecha; para a direita não faz nada", () => {
  assert.equal(d({ sidebarOpen: true, startX: 250, x: 196 }), null);
  assert.equal(d({ sidebarOpen: true, startX: 250, x: 180, y: 400 + 80 }), null);
  assert.equal(d({ sidebarOpen: true, startX: 250, x: 180, dtMs: 900 }), null);
  assert.equal(d({ sidebarOpen: true, startX: 10, x: 90 }), null);
});

test("com o menu fechado, arrastar para a esquerda no meio não faz nada", () => {
  assert.equal(d({ startX: 250, x: 150 }), null);
});

test("entradas inválidas devolvem null", () => {
  assert.equal(loadVodHelpers().edgeSwipeDecision(null), null);
  assert.equal(loadVodHelpers().edgeSwipeDecision({}), null);
});
