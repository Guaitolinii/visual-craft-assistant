import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

export function loadVodHelpers() {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const mainScript = scripts[scripts.length - 1][1];

  // Get the helper scripts that the main script depends on
  const resilienceHelpersScript = extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers");
  const epgHelpersScript = extractInlineScriptById(LINK_HTML_PATH, "epg-helpers");

  // Provide a minimal DOM context to avoid errors when the script tries to access document
  const localStorageData = {};
  const context = {
    window: {
      location: { protocol: "http:", origin: "http://localhost" },
      getComputedStyle: () => ({ display: "none", visibility: "visible", opacity: "1" })
    },
    console,
    document: {
      addEventListener: () => {},
      getElementById: () => ({
        addEventListener: () => {},
        style: {},
        classList: { toggle: () => {}, add: () => {}, remove: () => {} },
        offsetParent: null,
        value: "",
        files: null
      }),
      querySelectorAll: () => [],
      querySelector: () => null,
      fullscreenElement: null,
      exitFullscreen: () => {},
      activeElement: null,
      body: {},
      head: {}
    },
    localStorage: {
      getItem: (key) => localStorageData[key] || null,
      setItem: (key, value) => { localStorageData[key] = value; },
      removeItem: (key) => { delete localStorageData[key]; },
      clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); }
    },
    setTimeout: () => {},
    setInterval: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    URL: URL,
    URLSearchParams: URLSearchParams
  };

  vm.createContext(context);

  // Load helper scripts first
  vm.runInContext(resilienceHelpersScript, context);
  vm.runInContext(epgHelpersScript, context);

  // Then load the main script
  vm.runInContext(
    mainScript +
      "\nthis._parseXtreamCredentialsOriginal = parseXtreamCredentials;" +
      "\nthis.buildVodStreamUrl = typeof buildVodStreamUrl !== 'undefined' ? buildVodStreamUrl : undefined;" +
      "\nthis.buildSeriesEpisodeUrl = typeof buildSeriesEpisodeUrl !== 'undefined' ? buildSeriesEpisodeUrl : undefined;" +
      "\nthis.xtreamApiUrl = typeof xtreamApiUrl !== 'undefined' ? xtreamApiUrl : undefined;" +
      "\nthis.getContinueWatchingItems = typeof getContinueWatchingItems !== 'undefined' ? getContinueWatchingItems : undefined;" +
      "\nthis.computeDirectPlayRetryDelayMs = typeof computeDirectPlayRetryDelayMs !== 'undefined' ? computeDirectPlayRetryDelayMs : undefined;",
    context
  );

  // Create a wrapper for parseXtreamCredentials that crosses the context boundary cleanly
  const originalFunc = context._parseXtreamCredentialsOriginal;
  context.parseXtreamCredentials = function(url) {
    const result = originalFunc(url);
    if (!result) return null;
    // Return a plain object in this context, not the VM context object
    return { base: result.base, username: result.username, password: result.password };
  };

  // getContinueWatchingItems runs inside the vm sandbox, so the array (and the
  // objects inside it) it builds belong to that realm's Array/Object, not
  // this one's. assert.deepStrictEqual (used by the VOD tests) also compares
  // prototypes, so a vm-realm array checked against a host-realm array
  // literal fails even when every value matches - same cross-realm crossing
  // parseXtreamCredentials needed above, just for an array of plain objects
  // instead of a single object.
  const originalGetContinueWatchingItems = context.getContinueWatchingItems;
  if (originalGetContinueWatchingItems) {
    context.getContinueWatchingItems = function(continueMap, type) {
      const result = originalGetContinueWatchingItems(continueMap, type);
      // Array.from here is this (host) realm's, unlike result.map(), which
      // would still be the vm realm's Array.prototype.map and would still
      // build a vm-realm array even though the mapped items are plain.
      return Array.from(result, item => ({ ...item }));
    };
  }

  return context;
}
