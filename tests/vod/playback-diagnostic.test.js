import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("sanitizeDiagnosticText remove URLs (que levam usuário/senha)", () => {
  const out = loadVodHelpers().sanitizeDiagnosticText("falhou em http://srv:80/movie/joao/s3nh4/9.mp4 agora");
  assert.equal(out, "falhou em [url] agora");
  assert.doesNotMatch(out, /s3nh4|joao/);
});

test("describeCodecSupport lista sim/não por formato", () => {
  const out = loadVodHelpers().describeCodecSupport({ "H.264": "probably", HEVC: "", AAC: "maybe", AC3: "", "E-AC3": "", MKV: "" });
  assert.equal(out, "H.264 sim · HEVC não · AAC sim · AC3 não · E-AC3 não · MKV não");
});

test("fileExtFromUrl e formatBytes", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.fileExtFromUrl("http://s/movie/u/p/9.MP4?t=1"), "mp4");
  assert.equal(ctx.fileExtFromUrl("http://s/live/u/p/9"), "");
  assert.equal(ctx.fileExtFromUrl("http://s/movie/u/p/9.mp4&token=abc"), "");
  assert.equal(ctx.formatBytes(1610612736), "1.5 GB");
  assert.equal(ctx.formatBytes(734003200), "700 MB");
});

test("HTTP 401/403/429/509: mensagem culpa o limite de telas ou o login expirado", () => {
  const ctx = loadVodHelpers();
  for (const httpStatus of [401, 403, 429, 509]) {
    const msg = ctx.refineDirectPlayErrorMessage({ httpStatus, contentType: "", baseMessage: "base", refinable: true });
    assert.match(msg, new RegExp(`HTTP ${httpStatus}`));
    assert.match(msg, /limite de telas/);
  }
});

test("HTTP 404/410: mensagem diz que o arquivo não existe mais no servidor", () => {
  const ctx = loadVodHelpers();
  for (const httpStatus of [404, 410]) {
    const msg = ctx.refineDirectPlayErrorMessage({ httpStatus, contentType: "", baseMessage: "base", refinable: true });
    assert.match(msg, new RegExp(`HTTP ${httpStatus}`));
    assert.match(msg, /não existe mais/);
  }
});

test("HTTP 500-599 (exceto 501): mensagem diz que o provedor está com erro agora", () => {
  const msg = loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 500, contentType: "", baseMessage: "base", refinable: true });
  assert.match(msg, /HTTP 500/);
  assert.match(msg, /erro agora/);
});

test("HTTP 4xx/5xx inconclusivo (405/501: HEAD não suportado) mantém a mensagem original", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.refineDirectPlayErrorMessage({ httpStatus: 405, contentType: "", baseMessage: "base", refinable: true }), "base");
  assert.equal(ctx.refineDirectPlayErrorMessage({ httpStatus: 501, contentType: "", baseMessage: "base", refinable: true }), "base");
});

test("servidor entregou vídeo: a mensagem culpa o formato no aparelho", () => {
  const msg = loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 200, contentType: "video/mp4", baseMessage: "base", refinable: true });
  assert.match(msg, /formato/);
  assert.doesNotMatch(msg, /limite de telas/);
});

test("sem resposta da sondagem: mantém a mensagem original", () => {
  assert.equal(loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 0, contentType: "", baseMessage: "base", refinable: true }), "base");
});

test("refinable false: nunca reescreve a mensagem, mesmo com um HTTP que normalmente refinaria", () => {
  const msg = loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 403, contentType: "", baseMessage: "base", refinable: false });
  assert.equal(msg, "base");
});

test("buildPlaybackDiagnostic junta tudo e nunca inclui URL", () => {
  const text = loadVodHelpers().buildPlaybackDiagnostic({
    appVersion: "v7", platform: "android", userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) Chrome/129",
    fileExt: "mp4", errorName: "NotSupportedError", mediaErrorCode: 4,
    mediaErrorMessage: "DEMUXER_ERROR_NO_SUPPORTED_STREAMS: http://srv/movie/u/p/9.mp4",
    attempts: 6, httpStatus: 200, contentType: "video/mp4", contentLength: 1610612736, probeError: "",
    codecSummary: "H.264 sim · HEVC sim · AAC sim · AC3 não · E-AC3 não · MKV não",
  });
  assert.match(text, /^Sintoniza v7 · android/);
  assert.match(text, /Player: NotSupportedError · MEDIA_ERR 4 · 6 tentativa\(s\)/);
  assert.match(text, /Detalhe do player: DEMUXER_ERROR_NO_SUPPORTED_STREAMS: \[url\]/);
  assert.match(text, /Servidor: HTTP 200 · video\/mp4 · 1\.5 GB/);
  assert.match(text, /Formatos do aparelho: H\.264 sim/);
  assert.doesNotMatch(text, /http:\/\//);
});

test("buildPlaybackDiagnostic sem resposta do servidor", () => {
  const text = loadVodHelpers().buildPlaybackDiagnostic({
    appVersion: "v7", platform: "ios", userAgent: "iPhone", fileExt: "mp4", errorName: "NotSupportedError",
    mediaErrorCode: 4, mediaErrorMessage: "", attempts: 6, httpStatus: 0, contentType: "", contentLength: 0,
    probeError: "Failed to fetch", codecSummary: "H.264 sim",
  });
  assert.match(text, /Servidor: sem resposta \(Failed to fetch\)/);
  assert.doesNotMatch(text, /Detalhe do player/);
});
