// Verifica no Chrome: os botões de pular 10 s são redondos (largura = altura, raio >= metade do lado).
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true }, async (page) => {
  // seleciona um canal para o player aparecer (sem seleção ele fica oculto e mede 0)
  await page.eval(`selectChannel(getChannels()[0], false)`);
  await page.sleep(500);
  const r = await page.eval(`(() => {
    const b = document.getElementById("vod-skip-back-btn");
    b.style.display = ""; // aparece só com filme; força para medir
    const cs = getComputedStyle(b);
    const box = b.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height), raio: cs.borderTopLeftRadius, toque: getComputedStyle(document.body).webkitTapHighlightColor };
  })()`);
  console.log(r);
  if (r.w === 0 || r.w !== r.h || parseFloat(r.raio) < r.w / 2) { console.error("✖ o botão de pular não é redondo"); process.exit(1); }
  console.log("✔ ok");
});
