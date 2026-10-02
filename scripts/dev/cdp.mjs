// Verificação em desenvolvimento: abre uma página no Chrome (sem janela), controla por DevTools (CDP),
// mede o DOM, simula toques e tira captura. Não faz parte do app nem do build.
// Uso:  import { withPage } from "./cdp.mjs";  await withPage(url, { native: true }, async (page) => { ... });
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {{width?:number,height?:number,native?:boolean,preScript?:string}} opts
 *   native: simula o app Capacitor (window.Capacitor.isNativePlatform() = true)
 *   preScript: JS que roda antes da página (ex.: fingir plugins nativos)
 */
export async function withPage(url, opts, fn) {
  const { width = 390, height = 844, native = false, preScript = "" } = opts || {};
  const port = 9333 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), "sint-cdp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, "--autoplay-policy=no-user-gesture-required",
    "--no-first-run", "--disable-gpu", "about:blank",
  ], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = list.find((t) => t.type === "page");
      } catch (e) { /* Chrome ainda abrindo */ }
    }
    if (!target) throw new Error("O Chrome não abriu (confira a variável CHROME).");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    const nativeStub = native ? "window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false, getPlatform: () => 'android' };" : "";
    if (nativeStub || preScript) await send("Page.addScriptToEvaluateOnNewDocument", { source: nativeStub + preScript });
    await send("Page.navigate", { url });
    await sleep(2500); // fontes, CDN e boot do app
    const page = {
      send,
      sleep,
      async eval(expression) {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || "erro na página");
        return r.result.result.value;
      },
      // Toque real (gera touchstart/touchend, pointerup e click)
      async tap(x, y) {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      },
      async screenshot(file) {
        const r = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(file, Buffer.from(r.result.data, "base64"));
      },
    };
    return await fn(page);
  } finally {
    chrome.kill();
  }
}
