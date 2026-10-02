// Carrega os scripts embutidos "qrcodegen" e "ott-core" do sintoniza-link.html num contexto isolado.
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Objetos que saem do contexto vm têm outros protótipos; o teste compara como JSON.
export const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function loadOtt() {
  const ctx = vm.createContext({ URL, URLSearchParams, JSON, Date, Math, Promise, Error, setTimeout, clearTimeout, console });
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "qrcodegen"), ctx);
  vm.runInContext(
    extractInlineScriptById(LINK_HTML_PATH, "ott-core") +
      `\n;this.__ott = { OTT_KEYS, OTT_LIST_KEYS, OTT_PANEL_URL, OTT_OFFLINE_GRACE_MS, ottParseConfig, ottLoadConfig, ottDetectDevice,
        ottParseDeviceConfig, ottApplyPlaylist, ottWithinGrace, ottParseIsoMs, ottFormatDateBr, ottDaysLeft, ottFormatCountdown,
        ottCallRpc, ottDeviceStart, ottDeviceConfig, ottDeviceUnlink, ottActivationLink, ottQrSvgPath, ottDecide, ottAccountSummary,
        ottBuildCastPayload, ottCastTargets, ottCastSend, ottCastStatus, ottCastIsFinal, ottCastStatusText };`,
    ctx
  );
  return ctx.__ott;
}

// Armazenamento falso (localStorage)
export function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

// fetch falso: responde com o corpo dado (objeto vira JSON)
export function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  f.calls = calls;
  return f;
}
