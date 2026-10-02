// Verifica no Chrome: depois de entrar e sair da janela flutuante (PiP), o player grande volta (não fica só o mini-player).
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false); setState({ playing: true })`);
  await page.sleep(500);
  const antes = await page.eval(`document.getElementById("player-screen").classList.contains("mini-player")`);
  // entra na janela flutuante (o Android avisa por este evento) e o layout encolhe
  await page.eval(`(() => { const e = new Event("sintonizapip"); e.active = true; window.dispatchEvent(e); updateDocking(); })()`);
  await page.sleep(400);
  // sai da janela flutuante
  await page.eval(`(() => { const e = new Event("sintonizapip"); e.active = false; e.closed = false; window.dispatchEvent(e); })()`);
  await page.sleep(1200);
  const depois = await page.eval(`(() => { const el = document.getElementById("player-screen"); return { mini: el.classList.contains("mini-player"), altura: Math.round(el.getBoundingClientRect().height) }; })()`);
  console.log({ miniAntes: antes, depois });
  if (depois.mini || depois.altura < 100) { console.error("✖ o player grande não voltou depois da janela flutuante"); process.exit(1); }
  console.log("✔ ok");
});
