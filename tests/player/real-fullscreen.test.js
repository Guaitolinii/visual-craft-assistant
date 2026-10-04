// Tela cheia REAL (Fullscreen API) no computador: não pode virar mini-player nem deixar o player preso ao sair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const ctx = loadVodHelpers();
const el = (classes = []) => ({ classList: { contains: (c) => classes.includes(c) } });

test("isRealFullscreen: só quando o próprio #player-screen é o elemento em tela cheia (com prefixo webkit para Safari/iPad)", () => {
  const player = el();
  assert.equal(ctx.isRealFullscreen(player, { fullscreenElement: player }), true);
  assert.equal(ctx.isRealFullscreen(player, { webkitFullscreenElement: player }), true);
  assert.equal(ctx.isRealFullscreen(player, { fullscreenElement: el() }), false); // outro elemento (ex.: o <video> sozinho)
  assert.equal(ctx.isRealFullscreen(player, { fullscreenElement: null }), false);
  assert.equal(ctx.isRealFullscreen(player, {}), false);
  assert.equal(ctx.isRealFullscreen(null, { fullscreenElement: null }), false);
  assert.equal(ctx.isRealFullscreen(player, null), false);
});

test("isFullscreenNow: tela cheia por CSS (nativo/iPhone) ou real (computador)", () => {
  const doc = { fullscreenElement: null };
  assert.equal(ctx.isFullscreenNow(el(["pseudo-fullscreen"]), doc), true);
  assert.equal(ctx.isFullscreenNow(el(), doc), false);
  const player = el();
  assert.equal(ctx.isFullscreenNow(player, { fullscreenElement: player }), true);
  assert.equal(ctx.isFullscreenNow(player, { webkitFullscreenElement: player }), true);
});

test("computeScrolledAway: em tela cheia real não mede (mantém o valor anterior), como na janela flutuante", () => {
  const base = { hasSelection: true, pipActive: false, fullscreen: true, anchorBottom: 0, topbarBottom: 100 }; // âncora colapsada mede "fora da tela"
  assert.equal(ctx.computeScrolledAway({ ...base, previous: false }), false);
  assert.equal(ctx.computeScrolledAway({ ...base, previous: true }), true);
  // fora da tela cheia a medida continua valendo
  assert.equal(ctx.computeScrolledAway({ ...base, fullscreen: false, previous: false }), true);
  assert.equal(ctx.computeScrolledAway({ ...base, fullscreen: undefined, anchorBottom: 300, previous: true }), false);
  assert.equal(ctx.computeScrolledAway({ ...base, hasSelection: false, previous: true }), false);
});

test("computePlayerMode: tela cheia (real ou CSS) é sempre 'full', mesmo com a rolagem medindo 'fora da tela'", () => {
  assert.equal(ctx.computePlayerMode({ section: "catalog", hasSelection: true, hasActiveMedia: true, playerScrolledAway: true, isFullscreen: true }), "full");
});

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const corpo = (nome) => {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i >= 0, "função " + nome + " não encontrada");
  const j = html.indexOf("\n}\n", i);
  return html.slice(i, j + 3);
};

test("setPlayerMode e updateDocking tratam a tela cheia real como 'full'", () => {
  assert.match(corpo("setPlayerMode"), /const isFullscreen = isFullscreenNow\(el, document\);/);
  assert.match(corpo("updateDocking"), /fullscreen: isRealFullscreen\(document\.getElementById\("player-screen"\), document\)/);
});

test("entrar em tela cheia real trava a âncora ANTES (depois que o player sai do fluxo ela mediria 0 px)", () => {
  const f = corpo("toggleFullscreen");
  const trava = f.indexOf("lockPlayerAnchor()");
  const pede = f.indexOf("el.requestFullscreen()");
  assert.ok(trava > 0 && pede > trava, "lockPlayerAnchor deve vir antes de requestFullscreen");
});

test("fullscreenchange: atualiza o ícone e, ao sair, zera a medida, solta a âncora e mede de novo", () => {
  assert.match(html, /document\.addEventListener\("fullscreenchange", onPlayerFullscreenChange\);/);
  assert.match(html, /document\.addEventListener\("webkitfullscreenchange", onPlayerFullscreenChange\);/);
  const f = corpo("onPlayerFullscreenChange");
  assert.match(f, /updateFullscreenBtnIcon\(\)/);
  assert.match(f, /restorePlayerLayout\(\)/);
  const r = corpo("restorePlayerLayout");
  assert.match(r, /_playerScrolledAway = false;/);
  assert.match(r, /unlockPlayerAnchor\(\)/);
  assert.match(r, /setPlayerMode\(\)/);
  assert.match(r, /scheduleDockingUpdate/);
  assert.match(corpo("restorePlayerAfterPip"), /restorePlayerLayout\(\)/); // a janela flutuante reaproveita
});

test("CSS: o elemento em tela cheia real ocupa a janela, sem moldura, e mantém os controles", () => {
  assert.match(html, /html #player-screen:fullscreen \{[^}]*position: fixed[^}]*width: 100vw !important[^}]*margin: 0 !important/);
  assert.match(html, /html #player-screen:-webkit-full-screen \{[^}]*width: 100vw !important/); // regra separada: seletor desconhecido invalidaria a lista
  assert.doesNotMatch(html, /#player-screen:fullscreen \.player-controls \{[^}]*display: none/);
});

test("toggleFullscreen: sair da tela cheia real vem antes da decisão pela tela cheia por CSS (display-mode: fullscreen engana isStandaloneDisplay)", () => {
  const f = corpo("toggleFullscreen");
  assert.ok(f.indexOf("document.exitFullscreen") > 0 && f.indexOf("document.exitFullscreen") < f.indexOf("webUsesPseudoFullscreen"));
  assert.equal(f.split("document.exitFullscreen()").length - 1, 1); // uma saída só, sem bloco duplicado
});
