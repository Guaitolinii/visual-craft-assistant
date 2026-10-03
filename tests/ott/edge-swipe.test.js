// Ligação do gesto "arrastar da borda esquerda abre o menu" (celular) e exclusão do gesto de voltar no Android
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");
const java = readFileSync(new URL("../../android/app/src/main/java/com/sintoniza/iptv/MainActivity.java", import.meta.url), "utf8");

test("o gesto reaproveita openSidebar/closeSidebar e é ligado na inicialização", () => {
  const fn = html.match(/function setupEdgeSwipe\(\) \{[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fn, "setupEdgeSwipe");
  assert.match(fn[0], /edgeSwipeDecision\(/);
  assert.match(fn[0], /openSidebar\(\)/);
  assert.match(fn[0], /closeSidebar\(\)/);
  assert.match(html, /getElementById\("sidebar-scrim"\)\.addEventListener\("click", closeSidebar\);\s*setupEdgeSwipe\(\)/);
});

test("os ouvintes de toque são passivos (não atrapalham a rolagem)", () => {
  const fn = html.match(/function setupEdgeSwipe\(\) \{[\s\S]*?\r?\n\}\r?\n/)[0];
  for (const ev of ["touchstart", "touchmove", "touchend"]) {
    assert.match(fn, new RegExp(`addEventListener\\("${ev}"[\\s\\S]*?passive: true`));
  }
  assert.doesNotMatch(fn, /preventDefault/);
});

test("fica desligado em tela cheia, com modal/folha aberta e sem o botão do menu (layout largo)", () => {
  const fn = html.match(/function edgeSwipeBlocked\(\) \{[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fn, "edgeSwipeBlocked");
  assert.match(fn[0], /menu-btn/);
  assert.match(fn[0], /pseudo-fullscreen/);
  for (const id of ["vod-modal", "action-sheet", "tv-sheet"]) assert.ok(fn[0].includes(`"${id}"`), id);
  assert.match(fn[0], /profile-open/);
  assert.match(fn[0], /ott-open/);
});

test("Android: exclui uma faixa da borda esquerda do gesto de voltar do sistema", () => {
  assert.match(java, /import android\.graphics\.Rect;/);
  assert.match(java, /import android\.view\.View;/);
  assert.match(java, /import java\.util\.Collections;/);
  assert.match(java, /setSystemGestureExclusionRects\(/);
  assert.match(java, /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.Q\) return;/);
  assert.match(java, /void onWindowFocusChanged\(boolean hasFocus\)/);
  assert.match(java, /addOnLayoutChangeListener/);
});
