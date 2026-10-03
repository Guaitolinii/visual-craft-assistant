// Verifica no Chrome a sincronia do minuto com a conta (conta e backend FINGIDOS: nenhum aparelho real é criado,
// o backend real nem é tocado). Abre com ?noott=1, liga o modo conta na mão, troca o fetch por um falso que responde
// progress_get/put/clear e cast_* registrando os corpos, e finge o <video> (duração, currentTime, play, pause).
//   (a) a retomada escolhe o minuto mais recente entre o celular e a conta
//   (b) a gravação na conta: no máximo a cada 20 s, e na hora ao pausar / ir para segundo plano; ao terminar apaga
//   (c) o envio à TV leva positionSec e pausa o celular quando a TV começa a tocar o item que está aqui
//   (d) o aviso (toast) fica acima da tela cheia
// Uso: node scripts/dev/check-sync-ui.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
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

  // ── prepara: conta fingida, fetch falso e <video> falso ──
  await page.eval(`(() => {
    window.__rpc = [];                       // chamadas às RPCs: { nome, json }
    window.__server = null;                  // o que progress_get devolve: { sec, durationSec, updatedAt } ou null
    window.__tvs = [{ id: "11111111-1111-1111-1111-111111111111", modelo: "LG da Sala", online: true }];
    window.__status = 0;
    window.fetch = async (url, init) => {
      const u = String(url);
      const resp = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj });
      if (u.includes("/rest/v1/rpc/")) {
        const nome = u.split("/rpc/")[1];
        const body = JSON.parse(init.body);
        window.__rpc.push({ nome, json: body, texto: init.body });
        if (nome === "cast_targets") return resp({ status: "ok", tvs: window.__tvs });
        if (nome === "cast_send") return resp({ status: "ok", id: "cmd-" + window.__rpc.length, online: true });
        if (nome === "cast_status") { window.__status++; return resp({ status: "ok", estado: window.__status % 2 === 1 ? "delivered" : "played", motivo: "" }); }
        if (nome === "progress_get") {
          const s = window.__server;
          return resp(s ? { status: "ok", found: true, position_sec: s.sec, duration_sec: s.durationSec, updated_at: new Date(s.updatedAt).toISOString() } : { status: "ok", found: false });
        }
        return resp({ status: "ok" });
      }
      return resp([]);
    };
    _ott.cfg = { url: "https://falso.supabase.co", anonKey: "chave-falsa", panelUrl: "https://sintonizatv.com.br" };
    localStorage.setItem(OTT_KEYS.TOKEN, "token-falso");
    document.body.classList.add("ott-mode");

    // <video> falso: duração de 6000 s, posição controlada pelo teste, play imediato, pause contado
    const v = document.getElementById("player-video");
    window.__ct = 0; window.__seeks = []; window.__pauses = 0;
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => window.__ct, set: (x) => { window.__ct = x; window.__seeks.push(x); } });
    Object.defineProperty(v, "duration", { configurable: true, get: () => 6000 });
    Object.defineProperty(v, "readyState", { configurable: true, get: () => 4 });
    Object.defineProperty(v, "src", { configurable: true, get: () => "", set: () => {} });
    v.play = () => Promise.resolve();
    // como no navegador: o evento "pause" chega depois (assíncrono) e load() volta a posição para 0
    v.pause = () => { window.__pauses++; setTimeout(() => v.dispatchEvent(new Event("pause")), 0); };
    v.load = () => { window.__ct = 0; };
    window.__abre = (id, resumeAt) => playVodSelection("http://h.exemplo/movie/u/p/" + id + ".mp4", {
      id, contType: "vod", title: "Filme X", resumeAt, continueId: "resume-vod-" + id,
      castInfo: { kind: "vod", item: { stream_id: id, name: "Filme X" } },
    });
    window.__semAvisoPendente = () => (window.__rpc.length = 0);
  })()`);
  const rpc = (nome) => page.eval(`window.__rpc.filter(r => r.nome === ${JSON.stringify(nome)}).map(r => r.json)`);

  // ── (a) retomada: o mais recente vale ──
  // celular tem 500 s gravados há 1 h; a conta tem 2000 s gravados agora → vale a conta
  await page.eval(`localStorage.setItem("sint_continue", JSON.stringify({ "resume-vod-10": { id: "resume-vod-10", type: "vod", title: "Filme X", url: "x", progress: 500, duration: 6000, ts: Date.now() - 3600000 } }));
    window.__server = { sec: 2000, durationSec: 6000, updatedAt: Date.now() }; window.__abre(10, 500)`);
  const foi2000 = await espera(`window.__seeks.includes(2000)`, 6000);
  const consulta = await rpc("progress_get");
  confere(consulta.length === 1 && consulta[0].p_key === "vod:10" && consulta[0].p_token === "token-falso", "a abertura deveria consultar progress_get com a chave vod:10: " + JSON.stringify(consulta));
  confere(foi2000, "com a conta mais nova o vídeo deveria ir para 2000 s; seeks: " + JSON.stringify(await page.eval(`window.__seeks`)));

  // conta mais velha que o celular → vale o do celular (500 s)
  await page.eval(`window.__seeks = []; window.__server = { sec: 2000, durationSec: 6000, updatedAt: Date.now() - 7200000 }; window.__abre(10, 500)`);
  const foi500 = await espera(`window.__seeks.includes(500)`, 6000);
  confere(foi500 && !(await page.eval(`window.__seeks.includes(2000)`)), "com a conta mais velha o vídeo deveria ir para 500 s; seeks: " + JSON.stringify(await page.eval(`window.__seeks`)));

  // sem registro na conta e sem minuto local → nenhum seek
  await page.eval(`localStorage.removeItem("sint_continue"); window.__seeks = []; window.__server = null; window.__abre(11, 0)`);
  await page.sleep(800);
  confere((await page.eval(`window.__seeks.length`)) === 0, "sem minuto nenhum o vídeo não deveria dar seek");

  // conta que não responde: a abertura continua (espera no máximo 2,5 s) e vale o do celular
  await page.eval(`window.__seeks = []; const f0 = window.fetch;
    window.fetch = (url, init) => String(url).includes("progress_get") ? new Promise(() => {}) : f0(url, init);
    window.__abre(12, 300); window.__f0 = f0`);
  const caiuNoLocal = await espera(`window.__seeks.includes(300)`, 6000);
  confere(caiuNoLocal, "com a conta fora do ar a retomada deveria cair no minuto do celular (300 s)");
  await page.eval(`window.fetch = window.__f0`);

  // episódio: a chave é ep:<id do episódio>
  await page.eval(`window.__semAvisoPendente(); window.__server = null;
    playEpisode({ episodeId: "501", containerExtension: "mp4", season: "2", episodeNum: "5", series: { series_id: 7, name: "Série Y" }, creds: parseXtreamCredentials("http://h.exemplo/get.php?username=u&password=p") })`);
  await page.sleep(600);
  const consultaEp = await rpc("progress_get");
  confere(consultaEp.length === 1 && consultaEp[0].p_key === "ep:501", "o episódio deveria consultar a chave ep:501: " + JSON.stringify(consultaEp));

  // ── (b) gravação na conta ──
  await page.eval(`window.__semAvisoPendente(); window.__abre(10, 0)`);
  await page.sleep(600);
  await page.eval(`window.__semAvisoPendente(); window.__ct = 100; document.getElementById("player-video").dispatchEvent(new Event("timeupdate"))`);
  let puts = await rpc("progress_put");
  confere(puts.length === 1, "o primeiro timeupdate depois de 10 s deveria gravar 1 vez, gravou " + puts.length);
  confere(puts[0] && puts[0].p_key === "vod:10" && puts[0].p_kind === "vod" && puts[0].p_position === 100 && puts[0].p_duration === 6000, "corpo do progress_put errado: " + JSON.stringify(puts[0]));
  await page.eval(`pushProgressToAccount(false); pushProgressToAccount(false)`);
  puts = await rpc("progress_put");
  confere(puts.length === 1, "dentro de 20 s não pode gravar de novo (sem force), gravou " + puts.length);
  await page.eval(`window.__ct = 130; document.getElementById("player-video").dispatchEvent(new Event("pause"))`);
  puts = await rpc("progress_put");
  confere(puts.length === 2 && puts[1].p_position === 130, "pausar deveria gravar na hora (130 s): " + JSON.stringify(puts));
  await page.eval(`window.__ct = 140; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" })`);
  puts = await rpc("progress_put");
  confere(puts.length === 3 && puts[2].p_position === 140, "ir para segundo plano deveria gravar na hora (140 s): " + JSON.stringify(puts));
  // menos de 10 s de filme não grava
  await page.eval(`window.__semAvisoPendente(); window.__ct = 4; pushProgressToAccount(true)`);
  confere((await rpc("progress_put")).length === 0, "menos de 10 s não deveria gravar");
  // terminou: apaga na conta
  await page.eval(`window.__ct = 6000; document.getElementById("player-video").dispatchEvent(new Event("ended"))`);
  const apagou = await rpc("progress_clear");
  confere(apagou.length === 1 && apagou[0].p_key === "vod:10", "ao terminar deveria apagar vod:10 na conta: " + JSON.stringify(apagou));

  // ── (c) envio à TV: posição e pausa do celular ──
  await page.eval(`window.__semAvisoPendente(); window.__abre(10, 0)`);
  await page.sleep(600);
  await page.eval(`window.__semAvisoPendente(); window.__tvs = [window.__tvs[0]]; window.__status = 0; window.__ct = 754.8; window.__pauses = 0; window.__vistos = [];
    window.__obs = setInterval(() => { const t = document.getElementById("toast").textContent; if (t && !window.__vistos.includes(t)) window.__vistos.push(t); }, 100);
    document.getElementById("tv-cast-btn").click()`);
  const tocou = await espera(`window.__vistos.includes("Tocando na TV")`);
  confere(tocou, "o aviso 'Tocando na TV' não apareceu: " + JSON.stringify(await page.eval(`window.__vistos`)));
  const envio = await rpc("cast_send");
  confere(envio.length === 1 && envio[0].p_kind === "vod" && envio[0].p_payload.positionSec === 754 && envio[0].p_payload.streamId === "10", "cast_send deveria levar positionSec 754: " + JSON.stringify(envio));
  confere(!/http/i.test(JSON.stringify(envio)), "o envio não pode conter links");
  confere((await rpc("progress_put")).some(p => p.p_position === 754), "antes de enviar deveria gravar o minuto atual na conta");
  confere((await page.eval(`window.__pauses`)) >= 1, "quando a TV toca (played) o celular deveria pausar");
  await espera(`!_castBusy`);

  // enviar OUTRO filme (que não é o que toca aqui) não pausa o celular
  await page.eval(`window.__status = 0; window.__pauses = 0; window.__vistos = []; castToTv("vod", { stream_id: 99, name: "Outro filme" })`);
  await espera(`window.__vistos.includes("Tocando na TV")`);
  confere((await page.eval(`window.__pauses`)) === 0, "enviar outro filme não deveria pausar o que toca aqui");
  await espera(`!_castBusy`);

  // canal ao vivo: o envio não leva positionSec e a pausa também vale
  await page.eval(`window.__semAvisoPendente(); window.__status = 0; window.__pauses = 0; window.__vistos = []; selectChannel(getChannels()[0], false)`);
  await page.sleep(500);
  await page.eval(`document.getElementById("tv-cast-btn").click()`);
  await espera(`window.__vistos.includes("Tocando na TV")`);
  const envioCanal = await rpc("cast_send");
  confere(envioCanal.length === 1 && envioCanal[0].p_kind === "channel" && !("positionSec" in envioCanal[0].p_payload), "canal ao vivo não leva positionSec: " + JSON.stringify(envioCanal));
  await espera(`!_castBusy`);
  await page.eval(`clearInterval(window.__obs)`);

  // ── (d) o aviso aparece em tela cheia ──
  await page.eval(`window.__abre(10, 0)`);
  await page.sleep(500);
  await page.eval(`enterPseudoFullscreen()`);
  await page.sleep(500);
  await page.eval(`showToast("Enviando para a TV...", 8000)`);
  await page.sleep(500);
  const z = await page.eval(`(() => {
    const t = document.getElementById("toast"), p = document.getElementById("player-screen");
    const r = t.getBoundingClientRect();
    return { cheia: p.classList.contains("pseudo-fullscreen"), zToast: +getComputedStyle(t).zIndex, zTela: +getComputedStyle(p).zIndex, visivel: t.classList.contains("visible") && r.width > 0 && getComputedStyle(t).opacity === "1" };
  })()`);
  console.log("tela cheia / z-index:", JSON.stringify(z));
  confere(z.cheia, "a tela cheia deveria estar ativa");
  confere(z.visivel && z.zToast > z.zTela, "o aviso deveria ficar acima da tela cheia: " + JSON.stringify(z));
  await captura("sync-toast-tela-cheia");

  if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
  console.log("✔ ok");
});
