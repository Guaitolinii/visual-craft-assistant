import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

test("abre em pé, sem giro, com o botão de deitar", () => {
  const l = loadVodHelpers().computeFsLayout({ wantLandscape: false, viewportLandscape: false, nativeOrientation: false });
  assert.deepEqual(l, { cssRotate: false, showRotateBtn: true, rotateIcon: "rectangle-horizontal" });
});

test("sem plugin nativo, deitar gira o player via CSS", () => {
  const l = loadVodHelpers().computeFsLayout({ wantLandscape: true, viewportLandscape: false, nativeOrientation: false });
  assert.deepEqual(l, { cssRotate: true, showRotateBtn: true, rotateIcon: "rectangle-vertical" });
});

test("com plugin nativo, deitar nunca usa o giro via CSS", () => {
  const l = loadVodHelpers().computeFsLayout({ wantLandscape: true, viewportLandscape: false, nativeOrientation: true });
  assert.equal(l.cssRotate, false);
});

test("aparelho já na horizontal: sem giro via CSS; sem plugin, não dá para forçar a vertical", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.computeFsLayout({ wantLandscape: false, viewportLandscape: true, nativeOrientation: false }), { cssRotate: false, showRotateBtn: false, rotateIcon: "rectangle-vertical" });
  assert.equal(ctx.computeFsLayout({ wantLandscape: true, viewportLandscape: true, nativeOrientation: true }).showRotateBtn, true);
});
