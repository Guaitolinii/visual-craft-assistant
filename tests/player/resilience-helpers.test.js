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
