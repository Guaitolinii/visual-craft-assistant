// Verifica no Chrome: a aba Favoritos mostra Canais, Filmes e Séries (Minha Lista) e o seletor aparece.
// Uso: node scripts/dev/check-favorites.mjs [arquivo-da-captura.png]  (a captura é opcional e não deve ser commitada)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const captura = process.argv[2];

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  // uma série e um filme na Minha Lista
  await page.eval(`localStorage.setItem("sint_mylist", JSON.stringify([
    { type: "vod", id: 1, title: "Filme Um", cover: "", item: { stream_id: 1, name: "Filme Um" }, ts: 2 },
    { type: "series", id: 9, title: "Série Nove", cover: "", item: { series_id: 9, name: "Série Nove" }, ts: 1 }
  ])); setState({ section: "catalog", active: "Favoritos", favKind: "vod" });`);
  await page.sleep(500);
  const vod = await page.eval(`({ abas: getComputedStyle(document.getElementById("fav-kind-tabs")).display, titulos: [...document.querySelectorAll("#channel-container .vod-card p")].map(p => p.textContent) })`);
  if (captura) await page.screenshot(captura);
  await page.eval(`setState({ favKind: "series" })`);
  await page.sleep(300);
  const series = await page.eval(`[...document.querySelectorAll("#channel-container .vod-card p")].map(p => p.textContent)`);
  // toque real no botão "Filmes" do seletor
  const pos = await page.eval(`(() => { const r = document.querySelector('[data-fav-kind="vod"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await page.tap(pos.x, pos.y);
  await page.sleep(300);
  const apos = await page.eval(`({ kind: _state.favKind, salvo: localStorage.getItem("sint_fav_kind"), titulos: [...document.querySelectorAll("#channel-container .vod-card p")].map(p => p.textContent) })`);
  console.log({ vod, series, apos });
  if (vod.abas === "none" || vod.titulos.join() !== "Filme Um" || series.join() !== "Série Nove" || apos.kind !== "vod" || apos.salvo !== "vod" || apos.titulos.join() !== "Filme Um") { console.error("✖ favoritos incorretos"); process.exit(1); }
  console.log("✔ ok");
});
