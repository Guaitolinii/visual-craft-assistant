import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("dois toques rápidos e próximos contam como duplo toque", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.isDoubleTap({ ts: 1000, x: 100, y: 100 }, { ts: 1250, x: 108, y: 104 }), true);
});

test("primeiro toque, toque devagar ou longe não contam", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.isDoubleTap(null, { ts: 1000, x: 0, y: 0 }), false);
  assert.equal(ctx.isDoubleTap({ ts: 1000, x: 100, y: 100 }, { ts: 1600, x: 100, y: 100 }), false); // devagar
  assert.equal(ctx.isDoubleTap({ ts: 1000, x: 100, y: 100 }, { ts: 1200, x: 300, y: 100 }), false); // longe
});

test("a tela de reprodução inteira escuta o duplo toque (não só o <video>) e sobrou um único caminho", () => {
  assert.match(html, /querySelector\("#player-screen \.player-media"\)[\s\S]{0,400}addEventListener\("pointerup"/);
  assert.doesNotMatch(html, /getElementById\("player-video"\)\.addEventListener\("dblclick"/);
  assert.doesNotMatch(html, /_lastVideoTapTs/);
});
