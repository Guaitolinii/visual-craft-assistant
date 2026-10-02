// Verifica no Chrome: sem nada selecionado o retângulo da tela de reprodução some; ao escolher um canal, volta.
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  const idle = await page.eval(`(() => { const el = document.getElementById("player-screen"); const r = el.getBoundingClientRect(); return { oculto: el.classList.contains("player-hidden"), altura: r.height }; })()`);
  console.log("sem nada selecionado:", idle);
  if (!idle.oculto || idle.altura > 0) { console.error("✖ o retângulo ainda aparece"); process.exit(1); }
  // escolhe um canal: o player grande volta
  const apos = await page.eval(`(() => { const ch = getChannels()[0]; selectChannel(ch, false); const el = document.getElementById("player-screen"); return { oculto: el.classList.contains("player-hidden"), mini: el.classList.contains("mini-player"), altura: el.getBoundingClientRect().height }; })()`);
  console.log("com canal selecionado:", apos);
  if (apos.oculto || apos.mini || apos.altura < 100) { console.error("✖ o player não voltou ao escolher um canal"); process.exit(1); }
  console.log("✔ ok");
});
