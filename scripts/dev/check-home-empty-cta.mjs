// Verifica no Chrome (viewport de celular, ?noott=1, toques reais) os atalhos Canais / Filmes / Séries do Início do perfil novo:
//   (a) perfil vazio (nada assistido, sem favoritos): retângulo "Nada assistido ainda" + "Comece por aqui" + 3 botões abaixo, >= 48 px,
//       sem rolagem horizontal em 360 / 390 / 430 px, feedback de toque (is-pressed) e sem destaque nativo
//   (b) somem ao ganhar um canal favorito, um item recente ou Minha Lista; voltam ao tirar tudo (re-render)
//   (c) o toque em Canais / Filmes / Séries leva à aba certa (mesma ação da barra inferior); sem lista de filmes, avisa como a barra
// Sem conta e sem rede: o fetch é trocado por um falso que recusa tudo (só arquivos locais passam). Nada toca o backend real.
// Uso: node scripts/dev/check-home-empty-cta.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

const VOD = "http://provedor.falso.invalid:80/get.php?username=u&password=p&type=m3u_plus";
const preScript = (comVod) => `(() => {
  ${comVod ? `if (!localStorage.getItem("__seeded")) { localStorage.setItem("sint_vod_url", ${JSON.stringify(VOD)}); localStorage.setItem("__seeded", "1"); }` : ""}
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    url = String(url);
    if (["file:", "data:", "blob:"].some(p => url.startsWith(p))) return realFetch(url, init);
    throw new TypeError("rede bloqueada no teste: " + url);
  };
})();`;

async function cena(titulo, { width = 390, height = 800, comVod = false } = {}, fn) {
  console.log("— " + titulo);
  new Function(preScript(comVod)); // lança SyntaxError se o fetch falso não puder ser instalado: nunca toca a rede real
  await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true, width, height, preScript: preScript(comVod) }, async (page) => {
    page.captura = async (nome) => { if (pasta) await page.screenshot(`${pasta}/${nome}.png`); };
    page.ctaVisivel = () => page.eval(`getComputedStyle(document.getElementById("home-cta")).display !== "none"`);
    // toque real no centro de um elemento
    page.tocaEm = async (sel) => {
      const c = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await page.tap(c.x, c.y);
      await page.sleep(500);
    };
    await fn(page);
  });
}

// ── (a) perfil vazio: posição, tamanho, largura e feedback de toque ──
for (const w of [360, 390, 430]) {
  await cena(`(a) perfil vazio em ${w} px`, { width: w }, async (page) => {
    confere(await page.ctaVisivel(), `${w}px: os atalhos deveriam aparecer no perfil vazio`);
    const r = await page.eval(`(() => {
      const box = document.getElementById("home-empty").getBoundingClientRect(), cta = document.getElementById("home-cta").getBoundingClientRect();
      const bt = ["channels", "movies", "series"].map(k => document.getElementById("home-cta-" + k));
      return {
        boxVisivel: getComputedStyle(document.getElementById("home-empty")).display !== "none", boxBottom: box.bottom, ctaTop: cta.top,
        titulo: document.getElementById("home-cta-title").textContent, frase: document.querySelector(".home-cta-lead").textContent,
        existem: bt.every(Boolean), alturas: bt.map(b => Math.round(b.getBoundingClientRect().height)), larguras: bt.map(b => Math.round(b.getBoundingClientRect().width)),
        textos: bt.map(b => b.querySelector("strong").textContent), icones: bt.map(b => b.querySelectorAll("svg").length),
        destaque: getComputedStyle(bt[0]).webkitTapHighlightColor, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        bodySw: document.body.scrollWidth, ordem: bt.map(b => b.getBoundingClientRect().top)
      };
    })()`);
    confere(r.boxVisivel && r.ctaTop >= r.boxBottom, `${w}px: o retângulo pontilhado deveria aparecer e os atalhos ficar ABAIXO dele: ${JSON.stringify(r)}`);
    confere(r.titulo === "Comece por aqui" && r.frase === "Escolha algo para assistir agora", `${w}px: chamada com texto errado: ${r.titulo} / ${r.frase}`);
    confere(r.existem && r.textos.join() === "Canais,Filmes,Séries", `${w}px: botões Canais, Filmes e Séries (nessa ordem) deveriam existir: ${r.textos}`);
    confere(r.alturas.every((h) => h >= 48) && r.larguras.every((l) => l >= 250), `${w}px: alvos de toque deveriam ter >= 48 px de altura e ocupar a largura: ${r.alturas} / ${r.larguras}`);
    confere(r.icones.every((n) => n === 2), `${w}px: cada botão deveria ter o ícone da aba e a seta (2 svg): ${r.icones}`);
    confere(r.sw <= r.cw && r.bodySw <= r.cw, `${w}px: não pode haver rolagem horizontal: ${r.sw} > ${r.cw}`);
    confere(/rgba\(0, 0, 0, 0\)|transparent/.test(r.destaque), `${w}px: o destaque nativo do toque deveria estar desligado: ${r.destaque}`);
    confere(r.ordem[0] < r.ordem[1] && r.ordem[1] < r.ordem[2], `${w}px: ordem vertical dos botões errada: ${r.ordem}`);
    if (w === 360) await page.captura("home-cta-360");
    if (w === 390) await page.captura("home-cta-390");
  });
}

// ── feedback de toque: o dedo em cima marca is-pressed; ao soltar tira ──
await cena("(a2) feedback de toque", {}, async (page) => {
  const c = await page.eval(`(() => { const r = document.getElementById("home-cta-movies").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y }] });
  await page.sleep(300);
  const preso = await page.eval(`(() => { const b = document.getElementById("home-cta-movies"); return { cls: b.classList.contains("is-pressed"), tr: getComputedStyle(b).transform }; })()`);
  confere(preso.cls && preso.tr !== "none", `com o dedo em cima o botão deveria ficar is-pressed e encolher: ${JSON.stringify(preso)}`);
  await page.captura("home-cta-pressionado");
  await page.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await page.sleep(300);
  confere(!(await page.eval(`document.getElementById("home-cta-movies").classList.contains("is-pressed")`)), "ao soltar o dedo o is-pressed deveria sair");
});

// ── (b) somem com favorito / recente / Minha Lista e voltam ao esvaziar ──
await cena("(b) somem ao ganhar algo e voltam ao esvaziar", {}, async (page) => {
  const estado = () => page.eval(`({ cta: getComputedStyle(document.getElementById("home-cta")).display !== "none", vazio: getComputedStyle(document.getElementById("home-empty")).display !== "none" })`);
  confere((await estado()).cta, "começa com os atalhos visíveis");
  // canal favorito
  await page.eval(`toggleFav(getChannels()[0].id)`);
  let e = await estado();
  confere(!e.cta, "com um canal favorito os atalhos deveriam sumir");
  confere(e.vazio, "o retângulo 'Nada assistido ainda' continua (nada assistido), só os atalhos somem");
  await page.eval(`toggleFav(getChannels()[0].id)`);
  confere((await estado()).cta, "tirando o favorito os atalhos deveriam voltar");
  // canal recente
  await page.eval(`setState({ recents: [{ id: getChannels()[0].id, type: "channel", ts: Date.now() }] })`);
  e = await estado();
  confere(!e.cta && !e.vazio, "com um canal recente os atalhos e o retângulo deveriam sumir: " + JSON.stringify(e));
  await page.eval(`setState({ recents: [] })`);
  confere((await estado()).cta, "sem recentes os atalhos deveriam voltar");
  // Minha Lista
  await page.eval(`toggleMyListFor({ stream_id: 9, name: "Filme X", stream_icon: "" }, "vod")`);
  e = await estado();
  confere(!e.cta, "com algo na Minha Lista os atalhos deveriam sumir: " + JSON.stringify(e));
  await page.eval(`toggleMyListFor({ stream_id: 9, name: "Filme X", stream_icon: "" }, "vod")`);
  confere((await estado()).cta, "esvaziando a Minha Lista os atalhos deveriam voltar");
  // continuar assistindo (histórico de filme/série)
  await page.eval(`localStorage.setItem(profKey(CONTINUE_KEY), JSON.stringify({ "vod-1": { id: 1, type: "vod", title: "Filme", progress: 10, duration: 100, ts: Date.now() } })); renderHomeLists()`);
  confere(!(await estado()).cta, "com um filme em 'continuar assistindo' os atalhos deveriam sumir");
});

// ── (c) o toque leva à aba certa ──
await cena("(c1) toque em Canais", {}, async (page) => {
  await page.tocaEm("#home-cta-channels");
  const r = await page.eval(`({ sec: _state.section, active: _state.active, tab: !!document.querySelector('.mobile-tab[data-section="Todos os canais"].active'), y: window.scrollY, cat: getComputedStyle(document.getElementById("catalog-section")).display !== "none", home: getComputedStyle(document.getElementById("home-lists")).display !== "none" })`);
  confere(r.sec === "catalog" && r.active === "Todos os canais" && r.tab && r.cat && !r.home && r.y === 0, "o toque em Canais deveria abrir a aba Canais (como a barra inferior): " + JSON.stringify(r));
});
for (const [id, tipo, rotulo] of [["movies", "movies", "Filmes"], ["series", "series", "Séries"]]) {
  await cena(`(c) toque em ${rotulo} (com lista de filmes)`, { comVod: true }, async (page) => {
    await page.tocaEm(`#home-cta-${id}`);
    const r = await page.eval(`({ sec: _state.section, tipo: _state.vodType, tab: !!document.querySelector('.mobile-tab[data-vod-view="${tipo}"].active') })`);
    confere(r.sec === "vod" && r.tipo === tipo && r.tab, `o toque em ${rotulo} deveria abrir a aba ${rotulo} (como a barra inferior): ` + JSON.stringify(r));
  });
}
await cena("(c3) sem lista de filmes: avisa, como a barra inferior", {}, async (page) => {
  await page.tocaEm("#home-cta-movies");
  const r = await page.eval(`({ sec: _state.section, toast: document.getElementById("toast").textContent })`);
  confere(r.sec === "catalog" && /credenciais Xtream/.test(r.toast), "sem credenciais Xtream o toque deveria avisar e ficar na Início (igual à barra inferior): " + JSON.stringify(r));
});

if (falhas.length) { console.error("✖ " + falhas.length + " falha(s)"); process.exit(1); }
console.log("✔ ok");
