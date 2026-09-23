import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("esperas entre tentativas crescem 1s por vez, com teto de 5s (~15s no total)", () => {
  const ctx = loadVodHelpers();
  const delays = [1, 2, 3, 4, 5, 6].map(a => ctx.computeDirectPlayRetryDelayMs(a));
  assert.deepEqual(delays, [1000, 2000, 3000, 4000, 5000, 5000]);
  assert.equal(delays.slice(0, 5).reduce((s, d) => s + d, 0), 15000);
});

test("não tenta de novo quando o iOS exige um toque do usuário", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.shouldRetryDirectPlay({ errorName: "NotAllowedError", attempt: 1, maxAttempts: 6, url: "http://x/movie/u/p/1.mp4", isIOS: true }), false);
});

test("não tenta de novo um MKV no iPhone, mas tenta no Android", () => {
  const ctx = loadVodHelpers();
  const url = "http://x/movie/u/p/1.mkv";
  assert.equal(ctx.shouldRetryDirectPlay({ errorName: "NotSupportedError", attempt: 1, maxAttempts: 6, url, isIOS: true }), false);
  assert.equal(ctx.shouldRetryDirectPlay({ errorName: "NotSupportedError", attempt: 1, maxAttempts: 6, url, isIOS: false }), true);
});

test("para de tentar ao chegar no limite de tentativas", () => {
  const ctx = loadVodHelpers();
  const base = { errorName: "NotSupportedError", maxAttempts: 6, url: "http://x/movie/u/p/1.mp4", isIOS: true };
  assert.equal(ctx.shouldRetryDirectPlay({ ...base, attempt: 5 }), true);
  assert.equal(ctx.shouldRetryDirectPlay({ ...base, attempt: 6 }), false);
});

test("mensagem de erro do MEDIA_ERR 4 é neutra e mostra o código real", () => {
  const ctx = loadVodHelpers();
  const r = ctx.describeDirectPlayError({ errorName: "NotSupportedError", mediaErrorCode: 4, url: "http://x/movie/u/p/1.mp4", isIOS: true, attempts: 6 });
  assert.match(r.message, /recusou/);
  assert.match(r.message, /formato/);
  assert.doesNotMatch(r.message, /CORS/);
  assert.equal(r.code, "NotSupportedError · MEDIA_ERR 4 · 6 tentativas");
});

test("mensagem de erro de MKV no iPhone cita o formato", () => {
  const ctx = loadVodHelpers();
  const r = ctx.describeDirectPlayError({ errorName: "NotSupportedError", mediaErrorCode: 4, url: "http://x/movie/u/p/1.mkv?t=1", isIOS: true, attempts: 1 });
  assert.match(r.message, /MKV/);
});

test("retoma do ponto salvo só quando faz sentido", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.shouldApplyResume(120, 3600), true);
  assert.equal(ctx.shouldApplyResume(0, 3600), false);
  assert.equal(ctx.shouldApplyResume(3598, 3600), false); // a 2s do fim: começa do zero
  assert.equal(ctx.shouldApplyResume(120, NaN), false);
});
