// Atraso (colchão) adaptativo dos canais ao vivo no app web/celular — mesma regra do app da TV (services/liveGuard.ts):
// o canal começa ~5 trechos atrás do ao vivo e, se travar, sobe um degrau; o degrau fica guardado por canal.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";
import { LINK_HTML_PATH } from "../ott/loadOtt.js";

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx, { filename: "resilience-helpers.js" });
  return ctx;
}
function storage(inicial = {}) {
  const d = { ...inicial };
  return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } };
}

test("degraus: o atraso só cresce, parte do degrau 2 (~5 trechos) e o último é o teto", () => {
  const c = load();
  assert.deepEqual(Array.from(c.LIVE_LATENCY_SYNC), [3, 4, 5, 6]);
  assert.equal(c.LIVE_LATENCY_DEFAULT_STAGE, 2);
  assert.equal(c.clampLiveLatencyStage(-1), 0);
  assert.equal(c.clampLiveLatencyStage(99), 3);
  assert.equal(c.clampLiveLatencyStage(NaN), 0);
  assert.equal(c.liveLatencySync(2), 5);
});

test("config do hls.js: atraso do degrau e só pula para o ao vivo se ficar MUITO atrás", () => {
  const c = load();
  const cfg = c.liveLatencyHlsConfig(2);
  assert.equal(cfg.liveSyncDurationCount, 5);
  assert.equal(cfg.liveMaxLatencyDurationCount, 5 * 3 + 3);
  assert.equal(cfg.maxBufferLength, 60);      // o teto do buffer acompanha o atraso: senão o colchão real fica em ~25 s
  assert.equal(cfg.maxMaxBufferLength, 120);
});

test("sobe o atraso quando trava 2 s, depois de 15 s tocando, no máximo 1x a cada 20 s e até o teto", () => {
  const c = load();
  const base = { frozenSeconds: 2, msSincePlayStart: 60000, msSinceLastEscalation: 60000, stage: 2 };
  assert.equal(c.shouldEscalateLiveLatency(base), true);
  assert.equal(c.shouldEscalateLiveLatency({ ...base, frozenSeconds: 1 }), false);        // engasgo curto
  assert.equal(c.shouldEscalateLiveLatency({ ...base, msSincePlayStart: 8000 }), false);  // engasgo de abertura não conta
  assert.equal(c.shouldEscalateLiveLatency({ ...base, msSinceLastEscalation: 5000 }), false);
  assert.equal(c.shouldEscalateLiveLatency({ ...base, stage: 3 }), false);                // já no teto
});

test("degrau por canal fica guardado; canal novo abre no degrau de partida; lixo ou erro de armazenamento nunca derruba", () => {
  const c = load();
  const s = storage();
  assert.equal(c.readLiveLatencyStage(s, "ch1"), 2);
  c.writeLiveLatencyStage(s, "ch1", 3);
  assert.equal(c.readLiveLatencyStage(s, "ch1"), 3);
  assert.equal(c.readLiveLatencyStage(s, "ch2"), 2);
  assert.equal(c.readLiveLatencyStage(storage({ sint_live_stage: "{lixo" }), "ch1"), 2);
  const ruim = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(c.readLiveLatencyStage(ruim, "ch1"), 2);
  assert.doesNotThrow(() => c.writeLiveLatencyStage(ruim, "ch1", 1));
});

test("o mapa de degraus não cresce sem limite (200 canais, os mais recentes)", () => {
  const c = load();
  const s = storage();
  for (let i = 0; i < 400; i++) c.writeLiveLatencyStage(s, "ch" + i, 3);
  assert.ok(Object.keys(JSON.parse(s.d.sint_live_stage)).length <= 200);
  assert.equal(c.readLiveLatencyStage(s, "ch399"), 3);
});

test("o player usa o degrau: o hls.js do ao vivo recebe liveSyncDurationCount do degrau e o vigia sobe o atraso", () => {
  const html = require_html();
  assert.match(html, /liveSyncDurationCount: liveLatencySync\(currentLiveLatencyStage\)/);
  assert.match(html, /shouldEscalateLiveLatency\(/);
  assert.match(html, /writeLiveLatencyStage\(localStorage/);
});

import { readFileSync } from "node:fs";
function require_html() { return readFileSync(LINK_HTML_PATH, "utf8"); }
