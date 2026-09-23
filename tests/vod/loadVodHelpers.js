import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Funções puras do script principal usadas pelos testes da v6. As que
// devolvem objetos/arrays são copiadas para este realm (JSON) antes de
// voltar para o teste - deepStrictEqual compara protótipos, e objetos
// criados dentro do vm têm Object/Array.prototype diferentes.
const PURE_HELPER_NAMES = [
  "shouldRetryDirectPlay", "describeDirectPlayError", "isContainerUnsupportedOnIOS", "shouldApplyResume",
  "formatEpisodeTitle", "trimVodItem",
  "getCatalogTabLayout", "getMobileTabForSection",
  "computePlayerMode", "isPlayerScrolledAway", "shouldDockSearch",
  "isInMyList", "toggleMyListEntry", "getMyListItems", "buildMyListEntry",
  "getCardActions", "computeFsLayout",
];

function toHostRealm(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

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
      "\nthis.getUnifiedRecentItems = typeof getUnifiedRecentItems !== 'undefined' ? getUnifiedRecentItems : undefined;" +
      "\nthis.computeDirectPlayRetryDelayMs = typeof computeDirectPlayRetryDelayMs !== 'undefined' ? computeDirectPlayRetryDelayMs : undefined;" +
      "\nthis.filterVodItemsByQuery = typeof filterVodItemsByQuery !== 'undefined' ? filterVodItemsByQuery : undefined;" +
      "\nthis.dedupeVodItemsByTitle = typeof dedupeVodItemsByTitle !== 'undefined' ? dedupeVodItemsByTitle : undefined;" +
      "\nthis.selectNewestVodItems = typeof selectNewestVodItems !== 'undefined' ? selectNewestVodItems : undefined;" +
      PURE_HELPER_NAMES.map(n => `\nthis.${n} = typeof ${n} !== 'undefined' ? ${n} : undefined;`).join(""),
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

  const originalGetUnifiedRecentItems = context.getUnifiedRecentItems;
  if (originalGetUnifiedRecentItems) {
    context.getUnifiedRecentItems = function(channelRecents, continueMap, limit) {
      const result = originalGetUnifiedRecentItems(channelRecents, continueMap, limit);
      return Array.from(result, item => ({ ...item }));
    };
  }

  // dedupeVodItemsByTitle/selectNewestVodItems don't construct new item
  // objects (they return the very same references passed in, which already
  // belong to the host realm) - only the outer array is built inside the vm,
  // so a shallow Array.from (host realm) is enough here, unlike the
  // deep-copy needed above for getContinueWatchingItems.
  const originalDedupeVodItemsByTitle = context.dedupeVodItemsByTitle;
  if (originalDedupeVodItemsByTitle) {
    context.dedupeVodItemsByTitle = function(items) {
      return Array.from(originalDedupeVodItemsByTitle(items));
    };
  }

  const originalSelectNewestVodItems = context.selectNewestVodItems;
  if (originalSelectNewestVodItems) {
    context.selectNewestVodItems = function(items, limit) {
      return Array.from(originalSelectNewestVodItems(items, limit));
    };
  }

  for (const name of PURE_HELPER_NAMES) {
    const fn = context[name];
    if (typeof fn === "function") context[name] = (...args) => toHostRealm(fn(...args));
  }

  return context;
}
