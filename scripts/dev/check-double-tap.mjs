// Verifica no Chrome, com toques reais: dois toques na tela de reprodução abrem a tela cheia.
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true }, async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false)`); // mostra o player
  await page.sleep(600);
  // canto superior esquerdo da área: o centro é ocupado pelo botão grande de reproduzir
  const box = await page.eval(`(() => { const r = document.querySelector("#player-screen .player-media").getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.2), y: Math.round(r.top + r.height * 0.3) }; })()`);
  await page.tap(box.x, box.y);
  await page.sleep(120);
  await page.tap(box.x + 3, box.y + 2);
  await page.sleep(500);
  const cheia = await page.eval(`document.getElementById("player-screen").classList.contains("pseudo-fullscreen")`);
  console.log("tela cheia depois de dois toques:", cheia);
  if (!cheia) { console.error("✖ não abriu a tela cheia"); process.exit(1); }
  console.log("✔ ok");
});
