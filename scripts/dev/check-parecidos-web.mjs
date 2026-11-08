// Verifica no Chrome (?noott=1, sem rede) os "Títulos parecidos" na ficha de filme/série do app web (B3):
//   (a) a ficha de um filme mostra a fileira com parecidos da mesma categoria, sem o próprio filme
//   (b) clicar num parecido abre a ficha dele (título do modal muda)
//   (c) sem candidatos, a seção fica escondida; com o catálogo de outro tipo, também
// Sem rede: o fetch é trocado por um falso que recusa tudo. Uso: node scripts/dev/check-parecidos-web.mjs (na raiz)
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
  const filme = (id, nome, cat, ano) => ({ stream_id: id, name: nome, category_id: cat, stream_icon: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", year: String(ano), rating: "7.5" });
  await page.eval(`(() => {
    localStorage.setItem(LS.VOD_URL, "http://x.invalid/player_api.php?username=u&password=p");
    setState({ vodType: "movies" });
    window.__creds = { base: "http://x.invalid", username: "u", password: "p" };
    _vodCatalogCache = { vodType: "movies", categories: [{ category_id: "1", category_name: "XXX | Ação" }, { category_id: "2", category_name: "Drama" }], settled: true, categoryStatus: {},
      itemsByCategory: {
        "1": [${JSON.stringify(filme(1, "Alfa", "1", 2020))}, ${JSON.stringify(filme(2, "Bravo", "1", 2021))}, ${JSON.stringify(filme(3, "Charlie", "1", 2019))}],
        "2": [${JSON.stringify(filme(4, "Delta", "2", 2020))}],
      } };
  })()`);
  const visivel = `getComputedStyle(document.getElementById("vod-modal-similar")).display !== "none"`;
  const titulos = `Array.from(document.querySelectorAll("#vod-modal-similar-row .vod-card p")).map(p => p.textContent)`;

  console.log("(a) ficha do filme Alfa");
  await page.eval(`openVodModal(_vodCatalogCache.itemsByCategory["1"][0], "movies", window.__creds)`);
  confere(await page.eval(visivel), "a seção aparece");
  const t = JSON.parse(await page.eval(`JSON.stringify(${titulos})`));
  console.log("  parecidos:", t.join(", "));
  confere(t.includes("Bravo") && t.includes("Charlie"), "traz os da mesma categoria");
  confere(!t.includes("Alfa") && !t.includes("Delta"), "não traz o próprio nem outra categoria");

  console.log("(b) clique em um parecido");
  await page.eval(`document.querySelector('#vod-modal-similar-row .vod-card').click()`);
  await page.sleep(300);
  const novo = await page.eval(`document.getElementById("vod-modal-title").textContent`);
  confere(novo !== "Alfa" && /Bravo|Charlie/.test(novo), "a ficha passa a ser a do título clicado (" + novo + ")");

  console.log("(c) sem candidatos / catálogo de outro tipo");
  await page.eval(`openVodModal(_vodCatalogCache.itemsByCategory["2"][0], "movies", window.__creds)`);
  confere(!(await page.eval(visivel)), "Delta (sozinho na categoria): seção escondida");
  await page.eval(`openVodModal(_vodCatalogCache.itemsByCategory["1"][0], "series", window.__creds)`);
  confere(!(await page.eval(visivel)), "ficha de série com catálogo de filmes: seção escondida");
});

if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1); }
console.log("\ntudo certo");
