import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");

test("entrar e sair da tela cheia liberam o sensor; só o botão de girar trava uma orientação", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "enter", wantLandscape: false }), { method: "unlock", options: {} });
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "exit", wantLandscape: true }), { method: "unlock", options: {} });
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "rotate", wantLandscape: true }), { method: "lock", options: { orientation: "landscape" } });
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "rotate", wantLandscape: false }), { method: "lock", options: { orientation: "portrait" } });
});

test("a saída da tela cheia não trava mais o app em retrato", () => {
  assert.doesNotMatch(html, /callNativePlugin\("ScreenOrientation", "lock", \{ orientation: "portrait" \}\)/);
});

test("o Android respeita o 'girar automaticamente' do aparelho nas quatro posições", () => {
  assert.match(manifest, /android:screenOrientation="fullUser"/);
});
