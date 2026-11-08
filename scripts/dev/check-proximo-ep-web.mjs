// Verifica no Chrome (?noott=1, sem rede) o próximo episódio automático do app web (W1):
//   (a) fim de um episódio com próximo: o cartão aparece com o nome do próximo e a contagem de 10 s
//   (b) Cancelar esconde o cartão e não toca nada; Assistir agora toca o próximo (mesma série, mesmas credenciais)
//   (c) a contagem zerando toca o próximo sozinha
//   (d) último episódio, preferência desligada e filme: o cartão não aparece
// Sem conta e sem rede: o fetch é trocado por um falso que recusa tudo. Nada toca o backend real.
// Uso: node scripts/dev/check-proximo-ep-web.mjs   (rodar na raiz do projeto)
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
  // Cenário: série com 2 temporadas; toca T1E2; troca o tocador por um espião
  await page.eval(`(() => {
    window.__chamadas = [];
    window.__eps = [
      { id: "11", season: 1, episode_num: 1, title: "Piloto", container_extension: "mp4" },
      { id: "12", season: 1, episode_num: 2, title: "Segundo", container_extension: "mp4" },
      { id: "21", season: 2, episode_num: 1, title: "Volta", container_extension: "mkv" },
    ];
    window.__serie = { name: "Série Falsa", series_id: 7 };
    window.__creds = { base: "http://x.invalid", username: "u", password: "p" };
    playEpisode = (args) => { window.__chamadas.push(args); };
    window.__fimDe = (id, season, episode, tipo) => {
      _proxEp.episodes = window.__eps.slice(); _proxEp.series = window.__serie; _proxEp.creds = window.__creds;
      const castInfo = tipo === "filme" ? { kind: "movie", item: window.__serie, extra: {} } : { kind: "episode", item: window.__serie, extra: { season, episode, episodeId: id } };
      setState({ selected: { id: "resume-series-" + id, name: "x", isVod: true, castInfo, continueId: "resume-series-" + id } });
      document.getElementById("player-video").dispatchEvent(new Event("ended"));
    };
  })()`);
  const visivel = `!document.getElementById("proximo-ep-card").classList.contains("hidden")`;

  console.log("(a) fim do T1E2 com próximo (T2E1)");
  await page.eval(`localStorage.removeItem("sintoniza_pref_proximo_ep"); window.__fimDe("12", 1, 2)`);
  confere(await page.eval(visivel), "o cartão aparece");
  const nome = await page.eval(`document.getElementById("proximo-ep-nome").textContent`);
  console.log("  nome:", nome);
  confere(/Série Falsa/.test(nome) && /2/.test(nome), "o nome do próximo traz a série e a temporada 2");
  confere(/10 s/.test(await page.eval(`document.getElementById("proximo-ep-tempo").textContent`)), "mostra a contagem de 10 s");

  console.log("(b) Cancelar e Assistir agora");
  await page.eval(`document.getElementById("proximo-ep-cancelar-btn").click()`);
  confere(!(await page.eval(visivel)), "Cancelar esconde o cartão");
  confere((await page.eval(`window.__chamadas.length`)) === 0, "Cancelar não toca nada");
  await page.eval(`window.__fimDe("12", 1, 2)`);
  await page.eval(`document.getElementById("proximo-ep-assistir-btn").click()`);
  const c1 = JSON.parse(await page.eval(`JSON.stringify(window.__chamadas)`));
  confere(c1.length === 1 && c1[0].episodeId === "21" && c1[0].season === 2 && c1[0].containerExtension === "mkv", "Assistir agora toca o T2E1 (id 21, mkv)");
  confere(c1[0] && c1[0].series && c1[0].series.name === "Série Falsa" && c1[0].creds && c1[0].creds.username === "u", "mesma série e mesmas credenciais");
  confere(!(await page.eval(visivel)), "o cartão some ao tocar");

  console.log("(c) a contagem zerando toca sozinha");
  await page.eval(`window.__chamadas.length = 0; window.__fimDe("11", 1, 1); _proxEp.fimMs = Date.now() + 1200;`);
  await page.sleep(2600);
  const c2 = JSON.parse(await page.eval(`JSON.stringify(window.__chamadas)`));
  confere(c2.length === 1 && c2[0].episodeId === "12", "ao zerar toca o T1E2 (uma vez só)");
  await page.sleep(1500);
  confere((await page.eval(`window.__chamadas.length`)) === 1, "o relógio parou (não toca de novo)");

  console.log("(d) casos sem cartão");
  await page.eval(`window.__chamadas.length = 0; window.__fimDe("21", 2, 1)`);
  confere(!(await page.eval(visivel)), "último episódio da série: sem cartão");
  await page.eval(`localStorage.setItem("sintoniza_pref_proximo_ep", "0"); window.__fimDe("11", 1, 1)`);
  confere(!(await page.eval(visivel)), "preferência desligada: sem cartão");
  await page.eval(`localStorage.removeItem("sintoniza_pref_proximo_ep"); window.__fimDe("11", 1, 1, "filme")`);
  confere(!(await page.eval(visivel)), "filme: sem cartão");
  await page.eval(`window.__fimDe("11", 1, 1); selectChannel({ id: "c1", name: "Canal", url: "http://x.invalid/a.m3u8" }, false)`);
  confere(!(await page.eval(visivel)), "trocar para um canal cancela o cartão");
});

if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1); }
console.log("\ntudo certo");
