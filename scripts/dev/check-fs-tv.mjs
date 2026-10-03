// Verifica no Chrome a tela cheia do celular: o botão de enquadramento (#fs-fit-btn) saiu e entrou o "Assistir na TV"
// (#fs-tv-btn). Conta e backend FINGIDOS (nenhum aparelho real é criado). Usa toques reais (duplo toque para entrar
// e sair) e confere que entrar/sair da tela cheia não gera erro de JavaScript (o risco era a remoção do syncFsFitButton).
// Uso: node scripts/dev/check-fs-tv.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true }, async (page) => {
  const captura = async (nome) => { if (pasta) await page.screenshot(`${pasta}/${nome}.png`); };
  const espera = async (expr, ms = 15000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (await page.eval(expr)) return true; await page.sleep(150); }
    return false;
  };
  const cheia = () => page.eval(`document.getElementById("player-screen").classList.contains("pseudo-fullscreen")`);
  // centro de um elemento, em pixels da tela
  const centro = (sel) => page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);

  // ── conta fingida, fetch falso, <video> falso e coletor de erros ──
  await page.eval(`(() => {
    window.__erros = [];
    window.addEventListener("error", e => window.__erros.push("erro: " + e.message));
    window.addEventListener("unhandledrejection", e => window.__erros.push("promessa: " + (e.reason && e.reason.message || e.reason)));
    const ce = console.error; console.error = (...a) => { window.__erros.push("console.error: " + a.join(" ")); ce.apply(console, a); };
    window.__rpc = [];
    window.fetch = async (url, init) => {
      const u = String(url);
      const resp = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj });
      if (u.includes("/rest/v1/rpc/")) {
        const nome = u.split("/rpc/")[1];
        window.__rpc.push({ nome, json: JSON.parse(init.body) });
        if (nome === "cast_targets") return resp({ status: "ok", tvs: [{ id: "11111111-1111-1111-1111-111111111111", modelo: "LG da Sala", online: true }] });
        if (nome === "cast_send") return resp({ status: "ok", id: "cmd-1", online: true });
        if (nome === "cast_status") return resp({ status: "ok", estado: "played", motivo: "" });
        if (nome === "progress_get") return resp({ status: "ok", found: false });
      }
      return resp({ status: "ok" });
    };
    _ott.cfg = { url: "https://falso.supabase.co", anonKey: "chave-falsa", panelUrl: "https://sintonizatv.com.br" };
    localStorage.setItem(OTT_KEYS.TOKEN, "token-falso");
    document.body.classList.add("ott-mode");
    const v = document.getElementById("player-video");
    window.__ct = 0;
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => window.__ct, set: (x) => { window.__ct = x; } });
    Object.defineProperty(v, "duration", { configurable: true, get: () => 6000 });
    Object.defineProperty(v, "readyState", { configurable: true, get: () => 4 });
    Object.defineProperty(v, "src", { configurable: true, get: () => "", set: () => {} });
    v.play = () => Promise.resolve();
    v.load = () => { window.__ct = 0; };
  })()`);
  const envios = () => page.eval(`window.__rpc.filter(r => r.nome === "cast_send").map(r => r.json)`);

  // Entra pela tela cheia com dois toques reais no player; devolve se abriu
  const entraComDuploToque = async () => {
    const box = await page.eval(`(() => { const r = document.querySelector("#player-screen .player-media").getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.2), y: Math.round(r.top + r.height * 0.3) }; })()`);
    await page.tap(box.x, box.y);
    await page.sleep(120);
    await page.tap(box.x + 3, box.y + 2);
    await page.sleep(500);
    return cheia();
  };
  // O toque que abriu a tela cheia pode esconder os controles (o clique cai na camada): um toque simples traz de volta
  const mostraControles = async () => {
    if (!(await page.eval(`document.getElementById("fs-ui").classList.contains("visible")`))) { await page.tap(60, 300); await page.sleep(500); }
  };
  // Sai da tela cheia com dois toques reais num canto livre da camada
  const saiComDuploToque = async () => {
    const x = 60, y = 300;
    await page.tap(x, y);
    await page.sleep(120);
    await page.tap(x + 3, y + 2);
    await page.sleep(500);
    return !(await cheia());
  };

  // ── 1. Canal ao vivo: entra, confere os botões, envia pelo #fs-tv-btn, sai pelo duplo toque ──
  await page.eval(`selectChannel(getChannels()[0], false)`);
  await page.sleep(600);
  confere(await entraComDuploToque(), "o duplo toque deveria abrir a tela cheia");
  const botoes = await page.eval(`(() => {
    const tv = document.getElementById("fs-tv-btn");
    const r = tv ? tv.getBoundingClientRect() : null;
    return {
      fitExiste: !!document.getElementById("fs-fit-btn"),
      tvExiste: !!tv,
      tvVisivel: !!tv && getComputedStyle(tv).display !== "none" && r.width > 0 && r.height > 0,
      rotacaoExiste: !!document.getElementById("fs-rotate-btn"),
      sairExiste: !!document.getElementById("fs-exit-btn"),
      aria: tv && tv.getAttribute("aria-label"),
      icone: tv && (tv.querySelector("svg") ? tv.querySelector("svg").getAttribute("class") || "svg" : "sem svg"),
    };
  })()`);
  console.log("botões na tela cheia:", JSON.stringify(botoes));
  confere(!botoes.fitExiste, "#fs-fit-btn não deveria mais existir");
  confere(botoes.tvExiste && botoes.tvVisivel, "#fs-tv-btn deveria estar visível na tela cheia com conta ativa");
  confere(botoes.rotacaoExiste && botoes.sairExiste, "os botões de girar e sair devem continuar");
  await mostraControles();
  await captura("fs-tv-canal");
  const pTv = await centro("#fs-tv-btn");
  await page.tap(pTv.x, pTv.y);
  await espera(`window.__rpc.some(r => r.nome === "cast_send")`, 5000);
  let e = await envios();
  confere(e.length === 1 && e[0].p_kind === "channel" && !!e[0].p_payload.name, "tocar no #fs-tv-btn deveria enviar o canal: " + JSON.stringify(e));
  confere(!/http/i.test(JSON.stringify(e)), "o envio não pode conter links");
  await espera(`!_castBusy`);
  confere(await cheia(), "enviar à TV não deveria sair da tela cheia");
  confere(await saiComDuploToque(), "o duplo toque deveria sair da tela cheia");

  // ── 2. Filme: entra de novo, o #fs-tv-btn envia o minuto atual (positionSec) ──
  await page.eval(`window.__rpc.length = 0;
    playVodSelection("http://h.exemplo/movie/u/p/10.mp4", { id: 10, contType: "vod", title: "Filme X", continueId: "resume-vod-10", castInfo: { kind: "vod", item: { stream_id: 10, name: "Filme X" } } })`);
  await page.sleep(700);
  await page.eval(`window.__ct = 754.8`);
  confere(await entraComDuploToque(), "o duplo toque deveria abrir a tela cheia do filme");
  await mostraControles();
  await captura("fs-tv-filme");
  const pTv2 = await centro("#fs-tv-btn");
  await page.tap(pTv2.x, pTv2.y);
  await espera(`window.__rpc.some(r => r.nome === "cast_send")`, 5000);
  e = await envios();
  confere(e.length === 1 && e[0].p_kind === "vod" && e[0].p_payload.streamId === "10" && e[0].p_payload.positionSec === 754, "o botão da tela cheia deveria enviar o filme em 754 s: " + JSON.stringify(e));
  await espera(`!_castBusy`);

  // ── 3. Sai pelo botão #fs-exit-btn (toque real) ──
  await mostraControles();
  const pSair = await centro("#fs-exit-btn");
  await page.tap(pSair.x, pSair.y);
  await page.sleep(500);
  confere(!(await cheia()), "o #fs-exit-btn deveria sair da tela cheia");

  // ── 4. Fora da tela cheia o enquadramento continua no seletor #fit-select ──
  const fit = await page.eval(`(() => { const s = document.getElementById("fit-select"); s.value = "cover"; s.dispatchEvent(new Event("change")); return document.getElementById("player-video").style.objectFit; })()`);
  confere(fit === "cover", "o #fit-select deveria continuar trocando o enquadramento (objectFit=" + fit + ")");

  // ── 5. Entra e sai mais uma vez e confere que não houve erro de JavaScript ──
  confere(await entraComDuploToque(), "o duplo toque deveria abrir a tela cheia (2ª vez)");
  confere(await saiComDuploToque(), "o duplo toque deveria sair da tela cheia (2ª vez)");
  const erros = await page.eval(`window.__erros`);
  confere(erros.length === 0, "erros de JavaScript ao entrar/sair da tela cheia: " + JSON.stringify(erros));

  // ── 6. Sem conta ativa o botão da TV não aparece na tela cheia ──
  await page.eval(`document.body.classList.remove("ott-mode")`);
  confere(await entraComDuploToque(), "o duplo toque deveria abrir a tela cheia (sem conta)");
  const semConta = await page.eval(`(() => { const t = document.getElementById("fs-tv-btn"); return getComputedStyle(t).display; })()`);
  confere(semConta === "none", "sem conta ativa o #fs-tv-btn deveria ficar escondido (display=" + semConta + ")");
  await saiComDuploToque();

  if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
  console.log("✔ ok");
});
