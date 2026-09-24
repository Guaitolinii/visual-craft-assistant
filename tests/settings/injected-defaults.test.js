import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";
import { injectDefaults } from "../../scripts/prepare-mobile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Storage em memória, no realm do teste (o seed só usa getItem/setItem).
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

const CH = "http://srv.invalid/get.php?username=u&password=p&type=m3u_plus";
const VOD = "http://srv.invalid/get.php?username=u&password=p";

test("resolveInjectedDefault blanks an unreplaced token and empty values", () => {
  const { resolveInjectedDefault } = loadVodHelpers();
  assert.equal(resolveInjectedDefault("__DEFAULT_CHANNELS_URL__"), "");
  assert.equal(resolveInjectedDefault("__DEFAULT_VOD_URL__"), "");
  assert.equal(resolveInjectedDefault(""), "");
  assert.equal(resolveInjectedDefault(undefined), "");
  assert.equal(resolveInjectedDefault(CH), CH);
});

test("seedInjectedDefaults writes both defaults into an empty storage (channels in url mode)", () => {
  const { seedInjectedDefaults } = loadVodHelpers();
  const s = memoryStorage();
  seedInjectedDefaults(s, { channels: CH, vod: VOD });
  assert.equal(s.data.sint_url, CH);
  assert.equal(s.data.sint_mode, "url");
  assert.equal(s.data.sint_vod_url, VOD);
});

test("seedInjectedDefaults never overwrites a URL the user already saved", () => {
  const { seedInjectedDefaults } = loadVodHelpers();
  const s = memoryStorage({ sint_url: "http://mine/list.m3u", sint_vod_url: "http://mine/get.php?username=a&password=b" });
  seedInjectedDefaults(s, { channels: CH, vod: VOD });
  assert.equal(s.data.sint_url, "http://mine/list.m3u");
  assert.equal(s.data.sint_vod_url, "http://mine/get.php?username=a&password=b");
});

test("seedInjectedDefaults seeds only once: a URL the user cleared stays cleared", () => {
  const { seedInjectedDefaults } = loadVodHelpers();
  const s = memoryStorage();
  seedInjectedDefaults(s, { channels: CH, vod: VOD });
  s.removeItem("sint_url");      // botão Limpar da lista
  s.removeItem("sint_vod_url");  // botão Limpar das credenciais
  seedInjectedDefaults(s, { channels: CH, vod: VOD }); // próxima abertura
  assert.equal(s.getItem("sint_url"), null);
  assert.equal(s.getItem("sint_vod_url"), null);
});

test("seedInjectedDefaults with unreplaced tokens (dev / build without secrets) writes nothing", () => {
  const { seedInjectedDefaults } = loadVodHelpers();
  const s = memoryStorage();
  seedInjectedDefaults(s, { channels: "__DEFAULT_CHANNELS_URL__", vod: "" });
  assert.deepEqual(s.data, {});
  // ...e não marca como semeado: um build posterior com secrets ainda semeia.
  seedInjectedDefaults(s, { channels: CH, vod: VOD });
  assert.equal(s.data.sint_url, CH);
  assert.equal(s.data.sint_vod_url, VOD);
});

test("the built page (tokens injected) carries the real defaults verbatim, even with $ in the password", () => {
  const env = {
    DEFAULT_CHANNELS_URL: "http://srv.invalid/get.php?username=u&password=pa$$w$&rd",
    DEFAULT_VOD_URL: "http://srv.invalid/get.php?username=u&password=x$'y$`z",
  };
  const ctx = loadVodHelpers({ transformHtml: (html) => injectDefaults(html, env) });
  assert.equal(ctx.INJECTED_DEFAULTS.channels, env.DEFAULT_CHANNELS_URL);
  assert.equal(ctx.INJECTED_DEFAULTS.vod, env.DEFAULT_VOD_URL);
});

test("the unbuilt page (dev) resolves both defaults to empty", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.resolveInjectedDefault(ctx.INJECTED_DEFAULTS.channels), "");
  assert.equal(ctx.resolveInjectedDefault(ctx.INJECTED_DEFAULTS.vod), "");
});

test("boot seeds the defaults after ?lista= and before the VOD tabs check and the playlist auto-load", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  const boot = html.slice(html.indexOf('document.addEventListener("DOMContentLoaded"'));
  const seedAt = boot.indexOf("seedInjectedDefaults(localStorage, INJECTED_DEFAULTS);");
  assert.ok(seedAt > 0, "boot does not call seedInjectedDefaults(localStorage, INJECTED_DEFAULTS)");
  assert.ok(boot.indexOf('.get("lista")') < seedAt, "seed must run after ?lista= (a shared link wins)");
  assert.ok(seedAt < boot.indexOf("updateVodTabsVisibility();"), "seed must run before the VOD tabs check");
  assert.ok(seedAt < boot.indexOf("const savedUrl = localStorage.getItem(LS.URL);"), "seed must run before the auto-load");
});
