import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

test("player fica grande em todas as abas enquanto está visível", () => {
  const ctx = loadVodHelpers();
  for (const section of ["catalog", "vod"]) {
    assert.equal(ctx.computePlayerMode({ section, hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "full");
    assert.equal(ctx.computePlayerMode({ section, hasActiveMedia: false, playerScrolledAway: true, isFullscreen: false }), "full");
  }
});

test("vira mini-player só com algo tocando e o player fora da tela", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "vod", hasActiveMedia: true, playerScrolledAway: true, isFullscreen: false }), "mini");
});

test("em Configurações nunca fica grande", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "mini");
  assert.equal(ctx.computePlayerMode({ section: "settings", hasActiveMedia: false, playerScrolledAway: false, isFullscreen: false }), "hidden");
});

test("tela cheia sempre vence", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasActiveMedia: true, playerScrolledAway: true, isFullscreen: true }), "full");
});

test("busca se encaixa na topbar quando o lugar dela passa por baixo da topbar", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.shouldDockSearch(90, 100), true);
  assert.equal(ctx.shouldDockSearch(120, 100), false);
});

test("player conta como fora da tela com menos de 48px visíveis abaixo da topbar", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.isPlayerScrolledAway(200, 100), false);
  assert.equal(ctx.isPlayerScrolledAway(140, 100), true);
});

test("voltar de Configurações zera a medida antiga de 'player fora da tela'", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "settings", section: "catalog", scrolledAway: true }), false);
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "settings", section: "vod", scrolledAway: true }), false);
});

test("fora dessa volta, a medida da rolagem é mantida", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "catalog", section: "catalog", scrolledAway: true }), true);
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "vod", section: "settings", scrolledAway: true }), true);
  // o zeramento só acontece na transição de saída de Configurações
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "settings", section: "settings", scrolledAway: true }), true);
  // primeira renderização (sem seção anterior)
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: null, section: "catalog", scrolledAway: false }), false);
});
