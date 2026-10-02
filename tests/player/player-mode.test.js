import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

test("player fica grande em todas as abas enquanto há algo selecionado", () => {
  const ctx = loadVodHelpers();
  for (const section of ["catalog", "vod"]) {
    assert.equal(ctx.computePlayerMode({ section, hasSelection: true, hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "full");
    // canal ao vivo pausado: continua visível para dar para retomar
    assert.equal(ctx.computePlayerMode({ section, hasSelection: true, hasActiveMedia: false, playerScrolledAway: true, isFullscreen: false }), "full");
  }
});

test("sem nada selecionado o retângulo da tela de reprodução não aparece em aba nenhuma", () => {
  const ctx = loadVodHelpers();
  for (const section of ["catalog", "vod", "downloads", "settings"]) {
    for (const playerScrolledAway of [false, true]) {
      assert.equal(ctx.computePlayerMode({ section, hasSelection: false, hasActiveMedia: false, playerScrolledAway, isFullscreen: false }), "hidden");
    }
  }
});

test("vira mini-player só com algo tocando e o player fora da tela", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "vod", hasSelection: true, hasActiveMedia: true, playerScrolledAway: true, isFullscreen: false }), "mini");
});

test("em Configurações nunca fica grande", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasSelection: true, hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "mini");
  assert.equal(ctx.computePlayerMode({ section: "settings", hasSelection: true, hasActiveMedia: false, playerScrolledAway: false, isFullscreen: false }), "hidden");
});

test("tela cheia sempre vence", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasSelection: true, hasActiveMedia: true, playerScrolledAway: true, isFullscreen: true }), "full");
});

test("a medida 'player fora da tela' só vale com algo selecionado", () => {
  const ctx = loadVodHelpers();
  // sem seleção não há o que minimizar (a âncora está vazia e mediria sempre "fora")
  assert.equal(ctx.computeScrolledAway({ hasSelection: false, pipActive: false, anchorBottom: 0, topbarBottom: 100, previous: true }), false);
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: false, anchorBottom: 140, topbarBottom: 100, previous: false }), true);
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: false, anchorBottom: 300, topbarBottom: 100, previous: true }), false);
});

test("dentro da janela flutuante a medida não muda (o layout lá é outro)", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: true, anchorBottom: 0, topbarBottom: 100, previous: false }), false);
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: true, anchorBottom: 300, topbarBottom: 100, previous: true }), true);
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

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("ao sair da janela flutuante o app recompõe o player grande", () => {
  assert.match(html, /function restorePlayerAfterPip\(\)/);
  assert.match(html, /if \(!active\) restorePlayerAfterPip\(\);/);
});

test("ao voltar para o app (visível de novo) o player é recomposto se não estiver na janela flutuante", () => {
  assert.match(html, /visibilityState === "visible" && !document\.body\.classList\.contains\("pip-active"\)\) restorePlayerAfterPip\(\)/);
});
