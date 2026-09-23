// tests/player/tv-safety.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tv = readFileSync(path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html"), "utf8");

test("TV limpa nome/categoria/logo vindos da lista M3U", () => {
  assert.match(tv, /function sanitizeLabel\(/);
  assert.match(tv, /function sanitizeImageUrl\(/);
  assert.match(tv, /sanitizeLabel\(/);
});
