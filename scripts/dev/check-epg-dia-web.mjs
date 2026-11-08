// Verifica no Chrome (?noott=1, sem rede) a "Programação do dia" do canal (B2):
//   (a) canal com guia: o botão aparece e a folha lista passado, AGORA (com barra) e próximos
//   (b) fechar por botão, fundo e Esc; (c) canal sem guia e filme: o botão fica escondido de verdade
// Uso: node scripts/dev/check-epg-dia-web.mjs (na raiz do projeto)
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
  await page.eval(`(() => {
    const agora = Date.now(), min = 60000;
    epgIndexByName[normalizeChannelName("Canal Teste")] = [
      { start: agora - 80 * min, stop: agora - 40 * min, title: "Muito antigo", desc: "" },
      { start: agora - 20 * min, stop: agora - 5 * min, title: "Acabou", desc: "" },
      { start: agora - 5 * min, stop: agora + 25 * min, title: "No ar <b>agora</b>", desc: "Descrição do agora" },
      { start: agora + 25 * min, stop: agora + 85 * min, title: "Depois", desc: "" },
    ];
    window.__canal = { id: "t1", name: "Canal Teste", category: "Teste", url: "http://x.invalid/a.m3u8", initials: "CT", color: "logo-c1" };
    setState({ channels: [window.__canal], selected: window.__canal });
    renderPlayerInfo();
  })()`);
  const btnVisivel = `getComputedStyle(document.getElementById("player-epg-day-btn")).display !== "none"`;
  const sheetVisivel = `getComputedStyle(document.getElementById("epg-day-sheet")).display !== "none"`;

  console.log("(a) canal com guia");
  confere(await page.eval(btnVisivel), "o botão aparece");
  await page.eval(`document.getElementById("player-epg-day-btn").click()`);
  confere(await page.eval(sheetVisivel), "a folha abre");
  const html = await page.eval(`document.getElementById("epg-day-sheet-actions").innerHTML`);
  confere(/Acabou/.test(html) && /AGORA/.test(html) && /Depois/.test(html), "lista passado recente, AGORA e próximo");
  confere(!/Muito antigo/.test(html), "o que passou há mais de 30 min não entra");
  confere(/epg-day-progress-bar/.test(html) && /Descrição do agora/.test(html), "o AGORA tem barra e descrição");
  confere(!/<b>agora<\/b>/.test(html) && /&lt;b&gt;/.test(html), "o título é escapado (sem HTML injetado)");

  console.log("(b) fechar");
  await page.eval(`document.getElementById("epg-day-sheet-cancel").click()`);
  confere(!(await page.eval(sheetVisivel)), "o botão Fechar fecha");
  await page.eval(`document.getElementById("player-epg-day-btn").click()`);
  await page.eval(`document.getElementById("epg-day-sheet").click()`);
  confere(!(await page.eval(sheetVisivel)), "clicar no fundo fecha");
  await page.eval(`document.getElementById("player-epg-day-btn").click()`);
  await page.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  confere(!(await page.eval(sheetVisivel)), "Esc fecha");
  await page.eval(`document.getElementById("player-epg-day-btn").click()`);
  await page.eval(`selectChannel({ id: "t2", name: "Outro", category: "x", url: "http://x.invalid/b.m3u8", initials: "O", color: "logo-c1" }, false)`);
  confere(!(await page.eval(sheetVisivel)), "trocar de canal fecha a folha");

  console.log("(c) sem guia e filme");
  confere(!(await page.eval(btnVisivel)), "canal sem guia: botão escondido");
  await page.eval(`setState({ selected: { id: "m1", name: "Canal Teste", isVod: true, category: "Filme", initials: "F", color: "logo-c1" } }); renderPlayerInfo()`);
  confere(!(await page.eval(btnVisivel)), "filme: botão escondido");
});

if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1); }
console.log("\ntudo certo");
