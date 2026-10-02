// Verifica no Chrome o "Assistir na TV" do celular (conta e backend FINGIDOS: nenhum aparelho real é criado).
// Abre com ?noott=1 (sem a tela de ativação), liga o modo conta na mão e troca o fetch por um falso que
// responde cast_targets / cast_send / cast_status e registra os corpos enviados.
// Uso: node scripts/dev/check-tv-cast-ui.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

await withPage(pathToFileURL("sintoniza-link.html").href + "?noott=1", { native: true }, async (page) => {
  const captura = async (nome) => { if (pasta) await page.screenshot(`${pasta}/${nome}.png`); };
  // espera uma condição (expressão JS) por até `ms`
  const espera = async (expr, ms = 15000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (await page.eval(expr)) return true; await page.sleep(150); }
    return false;
  };

  // ── prepara a conta fingida e o fetch falso ──
  await page.eval(`(() => {
    window.__rpc = [];          // chamadas às RPCs de cast: { nome, body }
    window.__tvs = [{ id: "11111111-1111-1111-1111-111111111111", modelo: "LG da Sala", online: true }];
    window.__status = 0;        // quantas vezes cast_status foi chamado
    window.fetch = async (url, init) => {
      const u = String(url);
      const resp = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj });
      if (u.includes("/rest/v1/rpc/")) {
        const nome = u.split("/rpc/")[1];
        const body = JSON.parse(init.body);
        window.__rpc.push({ nome, body: init.body, json: body });
        if (nome === "cast_targets") return resp({ status: "ok", tvs: window.__tvs });
        if (nome === "cast_send") return resp({ status: "ok", id: "cmd-" + window.__rpc.length, online: true });
        if (nome === "cast_status") { window.__status++; return resp({ status: "ok", estado: window.__status % 2 === 1 ? "delivered" : "played", motivo: "" }); }
        return resp({ status: "ok" });
      }
      if (u.includes("get_series_info")) {
        return resp({ episodes: { "2": [{ id: "501", title: "Cinco", episode_num: 5, season: 2, container_extension: "mp4" }] } });
      }
      return resp([]);
    };
    _ott.cfg = { url: "https://falso.supabase.co", anonKey: "chave-falsa", panelUrl: "https://sintonizatv.com.br" };
    localStorage.setItem(OTT_KEYS.TOKEN, "token-falso");
    document.body.classList.add("ott-mode");
  })()`);

  // ── 1. Player: canal selecionado, botão da barra do player ──
  await page.eval(`selectChannel(getChannels()[0], false)`);
  await page.sleep(400);
  const nomeCanal = await page.eval(`getChannels()[0].name`);
  const btnVisivel = await page.eval(`(() => { const b = document.getElementById("tv-cast-btn"); return getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0; })()`);
  confere(btnVisivel, "o botão #tv-cast-btn deveria aparecer com canal selecionado e conta ativa");
  await captura("1-player");
  await page.eval(`window.__vistos = []; window.__obs = setInterval(() => { const t = document.getElementById("toast").textContent; if (t && !window.__vistos.includes(t)) window.__vistos.push(t); }, 100); document.getElementById("tv-cast-btn").click()`);
  const tocou = await espera(`window.__vistos.includes("Tocando na TV")`);
  const vistos = await page.eval(`window.__vistos`);
  console.log("avisos vistos:", vistos);
  confere(vistos.includes("Enviando para a TV..."), "o aviso 'Enviando para a TV...' não apareceu");
  confere(tocou, "o aviso final 'Tocando na TV' não apareceu");
  const envioCanal = await page.eval(`window.__rpc.filter(r => r.nome === "cast_send").map(r => r.body)`);
  confere(envioCanal.length === 1, "deveria haver 1 cast_send, houve " + envioCanal.length);
  const corpo = envioCanal[0] ? JSON.parse(envioCanal[0]) : {};
  confere(corpo.p_kind === "channel", "p_kind deveria ser channel");
  confere(corpo.p_payload && corpo.p_payload.name === nomeCanal, "o nome do canal deveria ir no payload");
  confere(!/http/i.test(envioCanal[0] || ""), "o corpo do cast_send não pode conter links (http)");
  confere(corpo.p_to === "11111111-1111-1111-1111-111111111111", "p_to errado");
  await espera(`!_castBusy`);

  // ── 2. Cartões de canal (grade e lista): botão da TV sem sobrepor favorito/guia ──
  // finge que os canais têm guia (EPG) para conferir que o botão da TV não sobrepõe o "A seguir"
  await page.eval(`window.hasEpgSchedule = () => true; window.getNowPlayingTitle = () => "Jornal da Noite"`);
  const geom = async (modo) => {
    await page.eval(`setState({ section: "catalog", active: "Todos os canais", query: "" }); `);
    await page.eval(`setState({ viewMode: ${JSON.stringify(modo)} })`);
    await page.sleep(500);
    // rola até o cartão e tira o aviso da frente para a captura
    await page.eval(`document.getElementById("toast").classList.remove("visible"); document.querySelector(${JSON.stringify(modo === "grid" ? ".channel-card" : ".channel-list-item")}).scrollIntoView({ block: "center" })`);
    await page.sleep(300);
    return page.eval(`(() => {
      const card = document.querySelector(${JSON.stringify(modo === "grid" ? ".channel-card" : ".channel-list-item")});
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const tv = card.querySelector(".tv-btn"), fav = card.querySelector(".fav-btn, .fav-btn-list"), epg = card.querySelector(".epg-btn"), main = card.querySelector(".card-main, .list-main");
      return { tv: r(tv), fav: r(fav), epg: r(epg), card: r(card), irmao: !!tv && tv.parentElement === card && !main.contains(tv) };
    })()`);
  };
  const cruza = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  for (const modo of ["grid", "list"]) {
    const g = await geom(modo);
    console.log("geometria " + modo + ":", JSON.stringify(g));
    confere(g.tv && g.tv.w > 0, "botão da TV não aparece no modo " + modo);
    confere(g.irmao, "o botão da TV deve ser irmão do botão principal (modo " + modo + ")");
    confere(!cruza(g.tv, g.fav), "o botão da TV sobrepõe o favorito (modo " + modo + ")");
    confere(g.epg && !cruza(g.tv, g.epg), "o botão da TV sobrepõe o guia (modo " + modo + ")");
    await captura("2-canais-" + modo);
  }
  // clique no botão do cartão envia o canal certo
  await page.eval(`window.__rpc.length = 0; window.__vistos = []; document.querySelector("[data-tv-channel-id]").click()`);
  await espera(`window.__vistos.includes("Tocando na TV")`);
  const ch0 = await page.eval(`(() => { const id = +document.querySelector("[data-tv-channel-id]").dataset.tvChannelId; return getChannels().find(c => c.id === id).name; })()`);
  const envioCartao = await page.eval(`window.__rpc.filter(r => r.nome === "cast_send").map(r => r.json)`);
  confere(envioCartao.length === 1 && envioCartao[0].p_payload.name === ch0, "o botão do cartão deveria enviar o canal do cartão");
  await espera(`!_castBusy`);

  // ── 3. Duas TVs: abre a folha de escolha e envia para a escolhida ──
  await page.eval(`window.__tvs = [
    { id: "11111111-1111-1111-1111-111111111111", modelo: "LG da Sala", online: true },
    { id: "22222222-2222-2222-2222-222222222222", modelo: "Samsung do Quarto", online: false }
  ]; window.__rpc.length = 0; window.__vistos = []; document.getElementById("tv-cast-btn").click()`);
  const folha = await espera(`!document.getElementById("tv-sheet").classList.contains("hidden")`, 5000);
  confere(folha, "a folha #tv-sheet deveria abrir com duas TVs");
  await page.sleep(200);
  const botoes = await page.eval(`[...document.querySelectorAll("#tv-sheet-list .tv-sheet-btn")].map(b => b.textContent.replace(/\\s+/g, " ").trim())`);
  console.log("botões da folha:", botoes);
  confere(botoes.length === 2, "a folha deveria ter 2 botões, tem " + botoes.length);
  await captura("3-folha-tv");
  await page.eval(`document.querySelectorAll("#tv-sheet-list .tv-sheet-btn")[1].click()`);
  await espera(`window.__vistos.includes("Tocando na TV")`);
  const envio2 = await page.eval(`window.__rpc.filter(r => r.nome === "cast_send").map(r => r.json)`);
  confere(envio2.length === 1 && envio2[0].p_to === "22222222-2222-2222-2222-222222222222", "deveria enviar para a segunda TV");
  const fechada = await page.eval(`document.getElementById("tv-sheet").classList.contains("hidden")`);
  confere(fechada, "a folha deveria fechar depois da escolha");
  await espera(`!_castBusy`);
  // cancelar não envia nada
  await page.eval(`window.__rpc.length = 0; document.getElementById("tv-cast-btn").click()`);
  await espera(`!document.getElementById("tv-sheet").classList.contains("hidden")`, 5000);
  await page.eval(`document.getElementById("tv-sheet-cancel").click()`);
  await espera(`!_castBusy`, 5000);
  const semEnvio = await page.eval(`window.__rpc.filter(r => r.nome === "cast_send").length`);
  confere(semEnvio === 0, "cancelar a folha não deve enviar nada");
  await page.eval(`window.__tvs = [window.__tvs[0]]`);

  // ── 4. Modal de filme: botão visível e envia 'vod' ──
  await page.eval(`window.__rpc.length = 0; window.__vistos = [];
    openVodModal({ stream_id: 10, name: "Filme X", releaseDate: "2023-05-01", container_extension: "mp4" }, "vod", parseXtreamCredentials("http://h.exemplo/get.php?username=u&password=p"))`);
  await page.sleep(500);
  const modalVis = await page.eval(`(() => { const b = document.getElementById("vod-modal-tv"); return getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0; })()`);
  confere(modalVis, "#vod-modal-tv deveria estar visível no modal de filme");
  await captura("4-modal-filme");
  await page.eval(`document.getElementById("vod-modal-tv").click()`);
  await espera(`window.__vistos.includes("Tocando na TV")`);
  const envioVod = await page.eval(`window.__rpc.filter(r => r.nome === "cast_send").map(r => r.json)`);
  confere(envioVod.length === 1 && envioVod[0].p_kind === "vod" && envioVod[0].p_payload.streamId === "10" && envioVod[0].p_payload.year === 2023, "o modal do filme deveria enviar kind vod, streamId 10, ano 2023: " + JSON.stringify(envioVod));
  confere(!/http/i.test(JSON.stringify(envioVod)), "o envio do filme não pode conter links");
  await espera(`!_castBusy`);

  // ── 5. Modal de série: sem botão geral, um botão da TV por episódio (fora do .ep-btn) ──
  await page.eval(`window.__rpc.length = 0; window.__vistos = [];
    openVodModal({ series_id: 7, name: "Série Y" }, "series", parseXtreamCredentials("http://h.exemplo/get.php?username=u&password=p"))`);
  await espera(`document.querySelector("[data-ep-tv]")`, 5000);
  await page.sleep(300);
  const serie = await page.eval(`(() => {
    const t = document.querySelector("[data-ep-tv]");
    const b = document.getElementById("vod-modal-tv");
    return { geralOculto: getComputedStyle(b).display === "none", dentroDeBotao: !!t.closest(".ep-btn"), irmaoDoEpBtn: t.previousElementSibling && t.previousElementSibling.classList.contains("ep-btn"), visivel: t.getBoundingClientRect().width > 0 };
  })()`);
  console.log("série:", serie);
  confere(serie.geralOculto, "o botão geral do modal deveria sumir na série");
  confere(!serie.dentroDeBotao && serie.irmaoDoEpBtn, "o botão da TV do episódio deve ser irmão do .ep-btn");
  confere(serie.visivel, "o botão da TV do episódio deveria estar visível");
  await captura("5-modal-serie");
  await page.eval(`document.querySelector("[data-ep-tv]").click()`);
  await espera(`window.__vistos.includes("Tocando na TV")`);
  const envioEp = await page.eval(`window.__rpc.filter(r => r.nome === "cast_send").map(r => r.json)`);
  confere(envioEp.length === 1 && envioEp[0].p_kind === "episode" && envioEp[0].p_payload.seriesId === "7" && envioEp[0].p_payload.season === 2 && envioEp[0].p_payload.episode === 5, "o episódio deveria enviar kind episode, série 7, T2E5: " + JSON.stringify(envioEp));
  await espera(`!_castBusy`);

  // ── 6. Cartões de filme/série não têm botão da TV; sem conta ativa nada aparece ──
  const cartao = await page.eval(`(() => { const h = vodCardHtml({ stream_id: 3, name: "Filme Z" }, "vod"); return /tv-only|data-tv/.test(h); })()`);
  confere(!cartao, "o cartão de filme/série não pode ter botão da TV");
  await page.eval(`closeVodModal(); document.body.classList.remove("ott-mode"); render()`);
  await page.sleep(300);
  const semConta = await page.eval(`[...document.querySelectorAll("#tv-cast-btn, .tv-btn, #vod-modal-tv, .ep-tv-btn")].filter(el => el.getBoundingClientRect().width > 0).length`);
  confere(semConta === 0, "sem conta ativa nenhum botão da TV pode aparecer (" + semConta + " visíveis)");
  await page.eval(`clearInterval(window.__obs)`);

  if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
  console.log("✔ ok");
});
