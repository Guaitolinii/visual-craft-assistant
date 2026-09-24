import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TV_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html");

// Mesmo conjunto de funções puras que o teste de paridade compara com a
// cópia de sintoniza-link.html. As que devolvem objetos/arrays são copiadas
// para este realm (JSON) antes de voltar — deepStrictEqual compara protótipos
// e objetos criados dentro do vm têm Object/Array.prototype diferentes.
const PURE_HELPER_NAMES = [
  "providerKeyForItem", "attachProviders", "groupItemsByProvider",
  "dedupeVodItemsByTitle", "vodItemYearKey", "vodItemAddedTs", "selectNewestVodItems",
  "parseXtreamCredentials", "buildVodStreamUrl", "buildSeriesEpisodeUrl", "xtreamApiUrl",
];

function toHostRealm(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function loadTvVodHelpers() {
  const html = readFileSync(TV_HTML_PATH, "utf8");
  // Ignora os <script src="..."> (hls.js/mpegts.js) e pega o último inline —
  // o script principal da TV, onde os helpers foram portados.
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const mainScript = scripts[scripts.length - 1][1];

  // O topo do script da TV lê window.tizen/window.webOS, console e
  // localStorage já na avaliação; o resto (DOM, player) só roda dentro do
  // callback de DOMContentLoaded, que nunca dispara com addEventListener
  // stubado. URL/URLSearchParams são usados pelos helpers de Xtream.
  const localStorageData = {};
  const context = {
    window: {},
    console,
    document: { addEventListener: () => {} },
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

  // Expõe explicitamente cada helper no contexto (o 'use strict' no topo do
  // script não impede declarações de função no nível do script de virarem
  // propriedades do global, mas a atribuição explícita é o mesmo mecanismo
  // comprovado por loadVodHelpers.js e blinda contra variações de engine).
  vm.runInContext(
    mainScript +
      PURE_HELPER_NAMES.map(n => `\nthis.${n} = typeof ${n} !== 'undefined' ? ${n} : undefined;`).join(""),
    context
  );

  const out = {};
  for (const name of PURE_HELPER_NAMES) {
    const fn = context[name];
    if (typeof fn === "function") out[name] = (...args) => toHostRealm(fn(...args));
  }
  return out;
}
