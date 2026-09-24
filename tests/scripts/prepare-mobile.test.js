import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectDefaults } from "../../scripts/prepare-mobile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const WWW_INDEX = path.join(ROOT, "www", "index.html");
const SCRIPT = path.join(ROOT, "scripts", "prepare-mobile.js");

// Ambiente do processo filho sem as duas variáveis de URL padrão, mesmo que
// quem roda os testes as tenha definidas na máquina (simula build-mobile.yml,
// que não passa esses secrets).
function envWithoutDefaults(extra = {}) {
  const env = { ...process.env, ...extra };
  if (!("DEFAULT_CHANNELS_URL" in extra)) delete env.DEFAULT_CHANNELS_URL;
  if (!("DEFAULT_VOD_URL" in extra)) delete env.DEFAULT_VOD_URL;
  return env;
}

test("injectDefaults replaces both tokens when env values are present", () => {
  const html = `<input id="a" value="__DEFAULT_CHANNELS_URL__"><input id="b" value="__DEFAULT_VOD_URL__">`;
  const out = injectDefaults(html, { DEFAULT_CHANNELS_URL: "http://x/ch.m3u", DEFAULT_VOD_URL: "http://y/get.php?x=1" });
  assert.equal(out, `<input id="a" value="http://x/ch.m3u"><input id="b" value="http://y/get.php?x=1">`);
});

test("injectDefaults replaces tokens with empty string when env values are absent", () => {
  const html = `value="__DEFAULT_CHANNELS_URL__" value="__DEFAULT_VOD_URL__"`;
  const out = injectDefaults(html, {});
  assert.equal(out, `value="" value=""`);
});

test("sintoniza-link.html carries the placeholder tokens, never a literal credential default", () => {
  const source = readFileSync(path.join(ROOT, "sintoniza-link.html"), "utf8");
  assert.ok(source.includes("__DEFAULT_CHANNELS_URL__"), "missing __DEFAULT_CHANNELS_URL__ token");
  assert.ok(source.includes("__DEFAULT_VOD_URL__"), "missing __DEFAULT_VOD_URL__ token");
});

test("prepare-mobile.js injects env default URLs into www/index.html", () => {
  if (existsSync(WWW_INDEX)) rmSync(WWW_INDEX);

  execFileSync("node", [SCRIPT], {
    cwd: ROOT,
    env: envWithoutDefaults({
      DEFAULT_CHANNELS_URL: "http://test.invalid/ch.m3u",
      DEFAULT_VOD_URL: "http://test.invalid/get.php?username=u&password=p",
    }),
  });

  const copied = readFileSync(WWW_INDEX, "utf8");
  assert.ok(copied.includes("http://test.invalid/ch.m3u"), "channels default not injected");
  assert.ok(copied.includes("http://test.invalid/get.php?username=u&password=p"), "VOD default not injected");
  assert.ok(!copied.includes("__DEFAULT_CHANNELS_URL__"), "channels token left in output");
  assert.ok(!copied.includes("__DEFAULT_VOD_URL__"), "VOD token left in output");
});

// Roda por último: deixa www/index.html no estado de um build sem secrets.
test("prepare-mobile.js without env writes sintoniza-link.html with tokens blanked to www/index.html", () => {
  if (existsSync(WWW_INDEX)) rmSync(WWW_INDEX);

  execFileSync("node", [SCRIPT], { cwd: ROOT, env: envWithoutDefaults() });

  assert.ok(existsSync(WWW_INDEX), "www/index.html was not created");

  const source = readFileSync(path.join(ROOT, "sintoniza-link.html"), "utf8");
  const copied = readFileSync(WWW_INDEX, "utf8");
  assert.equal(copied, injectDefaults(source, {}), "www/index.html must be sintoniza-link.html with tokens replaced by \"\"");
  assert.ok(!copied.includes("__DEFAULT_CHANNELS_URL__"), "channels token left in output");
  assert.ok(!copied.includes("__DEFAULT_VOD_URL__"), "VOD token left in output");
});
