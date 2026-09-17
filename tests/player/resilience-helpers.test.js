import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "..", "..", "sintoniza.html");

export function loadResilienceHelpers() {
  const source = extractInlineScriptById(HTML_PATH, "resilience-helpers");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "resilience-helpers.js" });
  return context;
}

test("pickInitialBufferStageIndex: defaults to stage 0 on fast/unknown connections", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "4g", stagesLength: 5 }),
    0
  );
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: undefined, stagesLength: 5 }),
    0
  );
});

test("pickInitialBufferStageIndex: starts higher on 3g", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "3g", stagesLength: 5 }),
    1
  );
});

test("pickInitialBufferStageIndex: starts even higher on 2g/slow-2g", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "2g", stagesLength: 5 }),
    2
  );
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "slow-2g", stagesLength: 5 }),
    2
  );
});

test("pickInitialBufferStageIndex: clamps to the last stage when the ladder is short", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "2g", stagesLength: 2 }),
    1
  );
});

test("pickInitialBufferStageIndex: returns 0 when stagesLength is missing or 0", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "2g", stagesLength: 0 }), 0);
  assert.equal(ctx.pickInitialBufferStageIndex({}), 0);
});

test("MPEGTS_RESILIENCE_CONFIG: prioritizes protective forward buffer without destructive latency chasing", () => {
  // Compared field-by-field instead of via deepEqual: the config object is
  // created inside the vm sandbox realm, and Node's assert.deepEqual/
  // deepStrictEqual reject cross-realm plain objects as "not reference-equal"
  // even when every own-enumerable property matches.
  const config = loadResilienceHelpers().MPEGTS_RESILIENCE_CONFIG;
  assert.equal(config.liveBufferLatencyChasing, false);
  assert.equal(config.autoCleanupSourceBuffer, true);
  assert.equal(config.autoCleanupMaxBackwardDuration, 60);
  assert.equal(config.autoCleanupMinBackwardDuration, 30);
  assert.deepEqual(Object.keys(config).sort(), [
    "autoCleanupMaxBackwardDuration",
    "autoCleanupMinBackwardDuration",
    "autoCleanupSourceBuffer",
    "liveBufferLatencyChasing",
  ]);
});

test("computeReconnectBackoffMs: grows exponentially with attempt number", () => {
  const ctx = loadResilienceHelpers();
  const fixedRandom = () => 0; // pin jitter to the low end (50% of the exponential value)
  assert.equal(ctx.computeReconnectBackoffMs(0, { baseMs: 1000, randomFn: fixedRandom }), 500);
  assert.equal(ctx.computeReconnectBackoffMs(1, { baseMs: 1000, randomFn: fixedRandom }), 1000);
  assert.equal(ctx.computeReconnectBackoffMs(2, { baseMs: 1000, randomFn: fixedRandom }), 2000);
});

test("computeReconnectBackoffMs: caps at maxMs regardless of attempt", () => {
  const ctx = loadResilienceHelpers();
  const fixedRandom = () => 1; // pin jitter to the high end (100% of the exponential value)
  assert.equal(
    ctx.computeReconnectBackoffMs(10, { baseMs: 1000, maxMs: 15000, randomFn: fixedRandom }),
    15000
  );
});

test("computeReconnectBackoffMs: uses sane defaults when opts is omitted", () => {
  const ctx = loadResilienceHelpers();
  const value = ctx.computeReconnectBackoffMs(0);
  assert.ok(value >= 500 && value <= 1000, `expected 500-1000, got ${value}`);
});

test("createMediaErrorEscalation: escalates RECOVER -> SWAP_AUDIO_CODEC -> FULL_REBUILD", () => {
  const ctx = loadResilienceHelpers();
  const escalation = ctx.createMediaErrorEscalation();
  assert.equal(escalation.record(0), "RECOVER");
  assert.equal(escalation.record(100), "SWAP_AUDIO_CODEC");
  assert.equal(escalation.record(200), "FULL_REBUILD");
  assert.equal(escalation.record(300), "FULL_REBUILD");
});

test("createMediaErrorEscalation: resets the ladder after a quiet window", () => {
  const ctx = loadResilienceHelpers();
  const escalation = ctx.createMediaErrorEscalation({ windowMs: 20000 });
  assert.equal(escalation.record(0), "RECOVER");
  assert.equal(escalation.record(5000), "SWAP_AUDIO_CODEC");
  // 30s of healthy playback passes before the next error - ladder should reset
  assert.equal(escalation.record(35000), "RECOVER");
});

test("createMediaErrorEscalation: reset() manually clears the ladder", () => {
  const ctx = loadResilienceHelpers();
  const escalation = ctx.createMediaErrorEscalation();
  escalation.record(0);
  escalation.record(100);
  escalation.reset();
  assert.equal(escalation.record(200), "RECOVER");
});

test("getVisibilityAction: hidden tab suspends the watchdog", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.getVisibilityAction("hidden"), "SUSPEND_WATCHDOG");
});

test("getVisibilityAction: visible tab resumes the watchdog", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.getVisibilityAction("visible"), "RESUME_WATCHDOG");
});

test("createPrebufferController: releases immediately upon reaching solid cushion (>= 15s)", () => {
  const ctx = loadResilienceHelpers();
  const controller = ctx.createPrebufferController({ targetBufSec: 25 });
  assert.equal(controller.tick(0, 300).action, "WAITING");
  assert.equal(controller.tick(10.0, 300).action, "WAITING");
  const decision = controller.tick(18.7, 300);
  assert.equal(decision.action, "LAUNCH");
  assert.equal(decision.reason, "SOLID_CUSHION");
});

test("createPrebufferController: releases upon reaching burst plateau (>= 6s with 5 ticks stall)", () => {
  const ctx = loadResilienceHelpers();
  const controller = ctx.createPrebufferController({ targetBufSec: 25 });
  controller.tick(8.0, 300);
  for (let i = 0; i < 4; i++) {
    assert.equal(controller.tick(8.0, 300).action, "WAITING");
  }
  const decision = controller.tick(8.0, 300); // 5th tick with no delta
  assert.equal(decision.action, "LAUNCH");
  assert.equal(decision.reason, "BURST_CEILING_REACHED");
});

test("createPrebufferController: triggers reconnect on 12s dead stream", () => {
  const ctx = loadResilienceHelpers();
  const controller = ctx.createPrebufferController({ targetBufSec: 25, maxWaitMs: 12000 });
  for (let t = 0; t < 11700; t += 300) {
    assert.equal(controller.tick(0, 300).action, "WAITING");
  }
  const decision = controller.tick(0, 300);
  assert.equal(decision.action, "RECONNECT");
  assert.equal(decision.reason, "TIMEOUT_DEAD_SOURCE");
});
