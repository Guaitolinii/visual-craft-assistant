// Verifica no Chrome (viewport de celular, toques reais) o gesto de arrastar da borda esquerda para abrir o menu lateral:
//   (a) arrasto da borda para o centro abre          (b) arrasto começando no meio não abre
//   (c) arrasto vertical na borda não abre           (d) com o menu aberto, arrasto para a esquerda fecha
//   (e) player em tela cheia não abre                (f) folha de ações aberta não abre
//   (g) arrasto lento (mais de 700 ms) não abre
// Sem conta e sem rede (?noott=1). Uso: node scripts/dev/check-edge-swipe.mjs
// Cada cena usa uma página nova com UM só arrasto: o Chrome emulado reentrega, no meio do gesto seguinte, a posição final do
// gesto anterior (movimento "fantasma" que um dedo real não gera) e isso falsearia o resultado.
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

// Arrasto real com o dedo: touchStart -> vários touchMove -> touchEnd
async function arrasta(page, x0, y0, x1, y1, passos = 8, pausaMs = 12) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= passos; i++) {
    const x = x0 + ((x1 - x0) * i) / passos, y = y0 + ((y1 - y0) * i) / passos;
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.sleep(pausaMs);
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.sleep(350); // fim da transição do menu
}
const aberto = (page) => page.eval(`document.getElementById("sidebar").classList.contains("open") && document.body.classList.contains("sidebar-open")`);

async function cena(titulo, fn) {
  console.log("— " + titulo);
  await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true, width: 390, height: 844 }, async (page) => {
    confere(await page.eval(`getComputedStyle(document.getElementById("menu-btn")).display !== "none"`), "o botão do menu deveria existir no layout do celular");
    await fn(page);
  });
}

await cena("(a) da borda para o centro abre", async (page) => {
  confere(!(await aberto(page)), "o menu deveria começar fechado");
  await arrasta(page, 6, 420, 150, 430);
  confere(await aberto(page), "arrastar da borda esquerda para o centro deveria abrir o menu");
  confere(await page.eval(`getComputedStyle(document.getElementById("sidebar-scrim")).display !== "none"`), "o fundo escuro do menu deveria aparecer, como no botão das 3 listras");
});

await cena("(d) com o menu aberto, para a esquerda fecha", async (page) => {
  await page.eval(`openSidebar()`);
  await page.sleep(350);
  confere(await aberto(page), "o menu deveria abrir pelo botão para o teste");
  await arrasta(page, 300, 500, 120, 505);
  confere(!(await aberto(page)), "arrastar para a esquerda com o menu aberto deveria fechá-lo");
});

await cena("(b) começando no meio não abre", async (page) => {
  await arrasta(page, 150, 420, 320, 430);
  confere(!(await aberto(page)), "arrasto que começa no meio da tela não pode abrir o menu");
});

await cena("(c) arrasto vertical na borda não abre", async (page) => {
  await arrasta(page, 8, 300, 22, 560);
  confere(!(await aberto(page)), "arrasto vertical na borda não pode abrir o menu");
});

await cena("(g) gesto lento (mais de 700 ms) não abre", async (page) => {
  await arrasta(page, 6, 420, 150, 428, 8, 250); // 4 passos já passam de 56 px, só depois de ~1 s
  confere(!(await aberto(page)), "arrasto lento na borda não pode abrir o menu");
});

await cena("(e) tela cheia do player não abre", async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false)`);
  await page.sleep(500);
  await page.eval(`enterPseudoFullscreen()`);
  await page.sleep(400);
  confere(await page.eval(`document.getElementById("player-screen").classList.contains("pseudo-fullscreen")`), "a tela cheia deveria estar ativa para o teste");
  await arrasta(page, 6, 420, 150, 430);
  confere(!(await aberto(page)), "em tela cheia o arrasto da borda não pode abrir o menu");
});

await cena("(f) folha de ações aberta não abre", async (page) => {
  await page.eval(`document.getElementById("action-sheet").classList.remove("hidden")`);
  await arrasta(page, 6, 420, 150, 430);
  confere(!(await aberto(page)), "com a folha de ações aberta o arrasto da borda não pode abrir o menu");
});

if (falhas.length) { console.error("✖ " + falhas.length + " falha(s)"); process.exit(1); }
console.log("✔ ok");
