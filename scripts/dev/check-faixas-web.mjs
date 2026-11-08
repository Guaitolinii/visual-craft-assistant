// Verifica no Chrome (?noott=1, sem rede) o botão e a folha "Áudio e legenda" (B5):
//   (a) filme sem faixas (Chrome de computador): o botão fica escondido de verdade
//   (b) com 2 áudios simulados e 1 legenda: o botão aparece, a folha lista, escolher liga a faixa e fecha
//   (c) canal ao vivo: botão escondido mesmo com faixas
// Uso: node scripts/dev/check-faixas-web.mjs (na raiz do projeto)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } else console.log("  ok: " + msg); };
const preScript = `(() => {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    url = String(url);
    if (["file:", "data:", "blob:"].some(p => url.startsWith(p))) return realFetch(url, init);
    throw new TypeError("rede bloqueada no teste: " + url);
  };
})();`;
new Function(preScript);

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { desktop: true, width: 1280, height: 800, preScript }, async (page) => {
  const btnVisivel = `getComputedStyle(document.getElementById("faixas-btn")).display !== "none"`;
  const sheetVisivel = `getComputedStyle(document.getElementById("faixas-sheet")).display !== "none"`;
  await page.eval(`(() => {
    window.__filme = { id: "m1", name: "Filme Teste", isVod: true, category: "Filme", initials: "F", color: "logo-c1" };
    setState({ selected: window.__filme }); renderPlayerInfo();
  })()`);

  console.log("(a) filme sem faixas");
  confere(!(await page.eval(btnVisivel)), "o botão fica escondido");

  console.log("(b) 2 áudios e 1 legenda simulados");
  await page.eval(`(() => {
    const v = document.getElementById("player-video");
    const audio = [{ language: "pt", label: "", enabled: true }, { language: "en", label: "", enabled: false }];
    audio.length = 2;
    const textos = [{ kind: "subtitles", language: "pt", label: "", mode: "disabled" }];
    Object.defineProperty(v, "audioTracks", { configurable: true, value: audio });
    Object.defineProperty(v, "textTracks", { configurable: true, value: textos });
    window.__audio = audio; window.__textos = textos;
    atualizarFaixasBtnVisibilidade();
  })()`);
  confere(await page.eval(btnVisivel), "o botão aparece");
  await page.eval(`document.getElementById("faixas-btn").click()`);
  confere(await page.eval(sheetVisivel), "a folha abre");
  const html = await page.eval(`document.getElementById("faixas-sheet-actions").innerHTML`);
  confere(/Português/.test(html) && /Inglês/.test(html) && /Desligada/.test(html), "lista áudios (Português, Inglês) e Legenda Desligada");
  confere(/✓ Português/.test(html), "o áudio ativo vem marcado");
  await page.eval(`document.querySelector('#faixas-sheet-actions [data-faixa-tipo="audio"][data-faixa-indice="1"]').click()`);
  confere((await page.eval(`window.__audio[1].enabled && !window.__audio[0].enabled`)) === true, "escolher Inglês liga a faixa 2 e desliga a 1");
  confere(!(await page.eval(sheetVisivel)), "a folha fecha ao escolher");
  await page.eval(`document.getElementById("faixas-btn").click()`);
  await page.eval(`document.querySelector('#faixas-sheet-actions [data-faixa-tipo="legenda"][data-faixa-indice="0"]').click()`);
  confere((await page.eval(`window.__textos[0].mode`)) === "showing", "escolher a legenda liga (showing)");
  await page.eval(`document.getElementById("faixas-btn").click()`);
  await page.eval(`document.querySelector('#faixas-sheet-actions [data-faixa-tipo="legenda"][data-faixa-indice="-1"]').click()`);
  confere((await page.eval(`window.__textos[0].mode`)) === "disabled", "Desligada desliga a legenda");
  await page.eval(`document.getElementById("faixas-btn").click()`);
  await page.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  confere(!(await page.eval(sheetVisivel)), "Esc fecha a folha");

  console.log("(c) canal ao vivo");
  await page.eval(`setState({ selected: { id: "c1", name: "Canal", category: "x", initials: "C", color: "logo-c1", url: "http://x.invalid/a.m3u8" } }); renderPlayerInfo()`);
  confere(!(await page.eval(btnVisivel)), "canal ao vivo: botão escondido");
});

if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1); }
console.log("\ntudo certo");
