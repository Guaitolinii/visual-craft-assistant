// Verifica no Chrome (com plugin nativo falso) a sequência de chamadas de orientação na tela cheia:
// entrar = unlock, girar = lock, sair = unlock.
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

// Finge o plugin nativo e registra as chamadas
const preScript = `
  window.__chamadas = [];
  window.Capacitor.isPluginAvailable = (n) => n === "ScreenOrientation" || n === "StatusBar";
  window.Capacitor.nativePromise = (plugin, method, options) => { window.__chamadas.push(plugin + "." + method + ":" + JSON.stringify(options)); return Promise.resolve({}); };
`;

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true, preScript }, async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false); toggleFullscreen();`);   // entra
  await page.eval(`toggleFsRotation()`);                                              // gira
  await page.eval(`toggleFullscreen()`);                                              // sai
  const chamadas = await page.eval(`window.__chamadas`);
  console.log(chamadas);
  const esperado = ["ScreenOrientation.unlock", "ScreenOrientation.lock", "ScreenOrientation.unlock"];
  const obtido = chamadas.filter((c) => c.startsWith("ScreenOrientation")).map((c) => c.split(":")[0]);
  if (obtido.length !== esperado.length || !esperado.every((e, i) => obtido[i] === e)) { console.error("✖ sequência de orientação inesperada"); process.exit(1); }
  console.log("✔ ok");
});
