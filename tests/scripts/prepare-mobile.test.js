import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const WWW_INDEX = path.join(ROOT, "www", "index.html");

test("prepare-mobile.js copies sintoniza-link.html to www/index.html", () => {
  if (existsSync(WWW_INDEX)) rmSync(WWW_INDEX);

  execFileSync("node", [path.join(ROOT, "scripts", "prepare-mobile.js")], {
    cwd: ROOT,
  });

  assert.ok(existsSync(WWW_INDEX), "www/index.html was not created");

  const source = readFileSync(path.join(ROOT, "sintoniza-link.html"), "utf8");
  const copied = readFileSync(WWW_INDEX, "utf8");
  assert.equal(copied, source, "www/index.html must be byte-identical to sintoniza-link.html");
});
