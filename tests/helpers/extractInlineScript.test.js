import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "./extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "..", "..", "sintoniza.html");

test("extractInlineScriptById returns the source of the resilience-helpers script", () => {
  const source = extractInlineScriptById(HTML_PATH, "resilience-helpers");
  assert.match(source, /function pickInitialBufferStageIndex/);
});

test("extractInlineScriptById throws a clear error when the id is missing", () => {
  assert.throws(
    () => extractInlineScriptById(HTML_PATH, "does-not-exist"),
    /does-not-exist/
  );
});
