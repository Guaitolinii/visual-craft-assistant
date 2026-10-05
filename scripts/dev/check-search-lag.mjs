// Verifica no Chrome (?noott=1, sem rede) a lista de canais em pedaços e a busca sem engasgo (v19):
//   (a) 1000 canais: só os primeiros cartões entram no DOM e o marcador de fim existe; rolar até o fim monta o resto
//   (b) a busca espera ~140 ms sem digitar: o evento "input" não redesenha a lista na hora (custo < 25 ms) e o resultado aparece logo depois
//   (c) cliques nos cartões continuam funcionando com UM ouvinte só no container: abrir o canal, favoritar, botões de lista/grade
//   (d) limpar a busca volta à lista inteira (em pedaços de novo)
// Sem conta e sem rede: o fetch é trocado por um falso que recusa tudo (só arquivos locais passam). Nada toca o backend real.
// Uso: node scripts/dev/check-search-lag.mjs
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
new Function(preScript); // lança SyntaxError se o fetch falso não puder ser instalado: nunca toca a rede real

// 1000 canais falsos: "Canal 0001"…"Canal 1000", metade "Esportes", metade "Filmes"
const M3U = "#EXTM3U\n" + Array.from({ length: 1000 }, (_, i) => {
  const n = String(i + 1).padStart(4, "0");
  return `#EXTINF:-1 tvg-id="c${n}" group-title="${i % 2 ? "Esportes" : "Filmes"}",Canal ${n}\nhttp://provedor.falso.invalid/live/${n}.m3u8`;
}).join("\n");

const cartoes = `document.querySelectorAll("#channel-container .channel-card, #channel-container .channel-list-item").length`;

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { desktop: true, width: 1440, height: 900, preScript }, async (page) => {
  await page.eval(`(() => { const c = parseM3U(${JSON.stringify(M3U)}); setState({ channels: c, categories: [...new Set(c.map(x => x.category))].sort() }); setSection("Todos os canais"); })()`);
  await page.sleep(800);

  // ── (a) em pedaços ──
  console.log("(a) lista em pedaços");
  const n0 = await page.eval(cartoes);
  confere(n0 > 0 && n0 <= 100, `só os primeiros cartões entram no DOM (${n0} de 1000)`);
  confere(await page.eval(`!!document.getElementById("catalog-sentinel")`), "o marcador de fim existe");
  for (let i = 0; i < 30 && (await page.eval(cartoes)) < 1000; i++) {
    await page.eval(`(() => { const s = document.getElementById("catalog-sentinel"); if (s) s.scrollIntoView(); else window.scrollTo(0, document.body.scrollHeight); })()`);
    await page.sleep(250);
  }
  const nFim = await page.eval(cartoes);
  confere(nFim === 1000, `rolando até o fim todos os 1000 cartões aparecem (${nFim})`);
  confere(await page.eval(`!document.getElementById("catalog-sentinel")`), "o marcador some quando acaba");

  // ── (b) busca com espera ──
  console.log("(b) busca");
  const r = await page.eval(`(async () => {
    const inp = document.getElementById("search-input");
    inp.focus();
    const antes = document.querySelectorAll("#channel-container .channel-card").length;
    let acc = "";
    const custos = [];
    for (const ch of "canal 05") {
      acc += ch;
      const t0 = performance.now();
      inp.value = acc;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      custos.push(Math.round(performance.now() - t0));
    }
    const logoApos = document.querySelectorAll("#channel-container .channel-card").length;
    await new Promise(r => setTimeout(r, 450));
    const depois = document.querySelectorAll("#channel-container .channel-card").length;
    return { antes, logoApos, depois, custos, emFoco: document.activeElement === inp, limpar: getComputedStyle(document.getElementById("search-clear")).display, titulo: document.getElementById("catalog-title").textContent };
  })()`);
  confere(Math.max(...r.custos) < 25, `digitar não redesenha a lista a cada letra (custo por letra, ms: ${r.custos})`);
  confere(r.logoApos === r.antes, "durante a digitação a lista ainda não mudou");
  confere(r.depois === 100, `depois da espera aparecem os 100 canais "Canal 05xx" (${r.depois})`);
  confere(r.emFoco && r.limpar !== "none", "o campo continua em foco e o botão limpar aparece");
  confere(/Resultados para "canal 05"/.test(r.titulo), "o título mostra a busca: " + r.titulo);

  // ── (c) cliques com ouvinte único ──
  console.log("(c) cliques");
  const c = await page.eval(`(async () => {
    const card = document.querySelector("#channel-container .channel-card");
    const id = +card.querySelector("[data-channel-id]").dataset.channelId;
    const favBtn = card.querySelector("[data-fav-id]");
    const favAntes = isFav(id);
    favBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const favDepois = isFav(id);
    const sel0 = _state.selected && _state.selected.id;
    document.querySelector("#channel-container [data-channel-id]").click();
    await new Promise(r => setTimeout(r, 200));
    return { id, favAntes, favDepois, selecionado: _state.selected && _state.selected.id, sel0 };
  })()`);
  confere(!c.favAntes && c.favDepois, "o coração do cartão favorita o canal");
  confere(c.selecionado === c.id, "o clique no cartão abre o canal certo");

  // ── (d) limpar ──
  console.log("(d) limpar a busca");
  await page.eval(`document.getElementById("search-clear").click()`);
  await page.sleep(600);
  const n1 = await page.eval(cartoes);
  confere(n1 > 0 && n1 < 1000, `limpar volta à lista inteira em pedaços (não monta os 1000 de uma vez) (${n1})`);
  confere(await page.eval(`!!document.getElementById("catalog-sentinel")`), "o marcador de fim voltou");
  // modo lista
  await page.eval(`setState({ viewMode: "list" })`);
  await page.sleep(500);
  const nl = await page.eval(`document.querySelectorAll("#channel-container .channel-list-item").length`);
  confere(nl > 0 && nl <= 100, `modo lista também monta em pedaços (${nl})`);
});

if (falhas.length) { console.error(`✖ ${falhas.length} verificação(ões) falharam`); process.exit(1); }
console.log("✔ ok");
