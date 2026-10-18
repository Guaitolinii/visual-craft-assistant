// Varredura de canais ao vivo no app WEB de produção (Chrome headless, conta de teste): abre N canais espalhados pela lista, um depois do outro,
// e diz por canal se a imagem andou, em quanto tempo e, se não, o que o proxy/console reportou. Limpa o aparelho de teste no fim (mesmo se falhar).
// A lista vem de uma variável (nunca impressa). Uso:
//   node scripts/dev/web-canais-varredura.mjs <.env.ott.local> <VARIAVEL_COM_URL> [quantidade=30] [segundos_por_canal=14] [--grupo=texto]
import { readFileSync } from "node:fs";
import { withPage } from "./cdp.mjs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const VAR = process.argv[3] || "OTT_CONTA_CANAIS";
const N = Number(process.argv[4]) || 30;
const SEG = Number(process.argv[5]) || 14;
const GRUPO = (process.argv.find((a) => a.startsWith("--grupo=")) || "").split("=")[1] || "";
// a variável pode ser uma URL ou o caminho de um arquivo .m3u local (útil para testar só uma seleção de canais)
const texto = /^https?:/i.test(env[VAR]) ? await (await fetch(env[VAR], { headers: { "user-agent": "VLC/3.0.20" } })).text() : readFileSync(env[VAR], "utf8");
const mascara = (s) => String(s).replace(/(username|password)=[^&\s"]+/gi, "$1=***").replace(/\/(live|movie|series)\/[^/\s"]+\/[^/\s"]+\//g, "/$1/***/***/");
await withPage("https://sintonizatv.com.br/", { desktop: true, width: 1440, height: 900 }, async (page) => {
  try {
    await page.eval(`(async () => {
      const cfg = await (await fetch('/app-config.json')).json();
      const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(env.OTT_TEST_EMAIL)}, password: ${JSON.stringify(env.OTT_TEST_PASSWORD)} }) });
      const j = await r.json();
      localStorage.setItem('sintoniza_painel_sessao', JSON.stringify({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + 3000, user: { id: j.user.id, email: j.user.email } }));
    })()`);
    await page.eval(`location.href = '/app/'`);
    await page.sleep(9000);
    await page.eval(`(() => { const b = document.querySelector('#profile-grid button'); if (b) b.click(); })()`);
    await page.sleep(3000);
    await page.eval(`(() => { const canais = parseM3U(${JSON.stringify(texto)}); setState({ channels: canais, categories: [...new Set(canais.map(c => c.category))].sort() }); window.__todos = canais; })()`);
    await page.eval(`window.__w = { reqs: [] }; (() => {
      var f = window.fetch; window.fetch = function (u) { var s = String(u && u.url || u), t0 = Date.now(), p = s.indexOf('/api/proxy') >= 0; var pr = f.apply(this, arguments); if (p) pr.then(function (r) { window.__w.reqs.push(r.status); }, function () { window.__w.reqs.push('erro'); }); return pr; };
    })()`);
    const nomes = JSON.parse(await page.eval(`(() => { const l = window.__todos.filter(c => ${JSON.stringify(GRUPO)} === '' || String(c.category).toLowerCase().includes(${JSON.stringify(GRUPO.toLowerCase())})); const n = ${N}; const passo = Math.max(1, Math.floor(l.length / n)); const o = []; for (let i = 0; i < l.length && o.length < n; i += passo) o.push(l[i].name); return JSON.stringify(o); })()`));
    // conexões ao proxy ainda abertas (começaram e não terminaram): se crescer a cada troca de canal, o app deixa conexões vazando
    await page.send("Network.enable");
    const abertas = new Set();
    const abertasVideo = new Map(); // conexões diretas ao servidor de vídeo ainda abertas: id -> host (se crescer a cada troca, o app deixa conexões vazando)
    page.on("Network.requestWillBeSent", (p) => { if (p.request.url.includes("/api/proxy")) abertas.add(p.requestId); else if (/fofura|cdn-xt/.test(p.request.url)) { try { abertasVideo.set(p.requestId, new URL(p.request.url).host); } catch (e) { /* ignora */ } } });
    page.on("Network.loadingFinished", (p) => { abertas.delete(p.requestId); abertasVideo.delete(p.requestId); });
    page.on("Network.loadingFailed", (p) => { abertas.delete(p.requestId); abertasVideo.delete(p.requestId); });
    // status das respostas dos servidores de vídeo (fora o proxy, o Supabase e imagens) por canal: mostra o que o provedor devolve quando falha
    let statusServidor = {};
    page.on("Network.responseReceived", (p) => { const u = p.response.url; if (/\/api\/proxy|supabase|\.png|\.jpg|\.svg|\.webp|sintonizatv\.com\.br/.test(u)) return; let h = ""; try { h = new URL(u).host.replace(/^s\d+\./, "sN."); } catch (e) { return; } const k = h + " " + p.response.status; statusServidor[k] = (statusServidor[k] || 0) + 1; });
    page.on("Network.loadingFailed", (p) => { if (p.errorText && !/ABORTED|ORB|NAME_NOT_RESOLVED/.test(p.errorText)) { const k = "falha de rede: " + p.errorText + (p.corsErrorStatus ? " " + p.corsErrorStatus.corsError : ""); statusServidor[k] = (statusServidor[k] || 0) + 1; } });
    let ok = 0, falhou = 0; const falhas = [];
    for (const nome of nomes) {
      statusServidor = {};
      await page.eval(`window.__w.reqs = []; selectChannel(window.__todos.find(c => c.name === ${JSON.stringify(nome)}))`);
      const t0 = Date.now(); let primeiro = null, e = null;
      while ((Date.now() - t0) / 1000 < SEG) {
        e = JSON.parse(await page.eval(`(() => { const v = document.getElementById('player-video'); const m = document.querySelector('#player-error-msg, .player-error p, #player-overlay-msg'); return JSON.stringify({ t: v.currentTime, w: v.videoWidth, msg: m ? m.textContent.trim().slice(0, 50) : '' }); })()`));
        if (e.t > 0.5) { primeiro = (Date.now() - t0) / 1000; break; }
        await page.sleep(500);
      }
      const reqs = JSON.parse(await page.eval("JSON.stringify(window.__w.reqs)"));
      const nAbertas = abertas.size;
      const st = {}; reqs.forEach((r) => { st[r] = (st[r] || 0) + 1; });
      if (primeiro !== null) { ok++; console.log(`  ✓ ${nome.padEnd(34)} ${primeiro.toFixed(1)} s | ${e.w}px | proxy ${JSON.stringify(st)} | abertas ${nAbertas} vídeo ${abertasVideo.size}`); }
      else { falhou++; falhas.push(nome); console.log(`  ✗ ${nome.padEnd(34)} não tocou em ${SEG} s | proxy ${JSON.stringify(st)} | abertas ${nAbertas} | servidor ${JSON.stringify(statusServidor)}`); }
    }
    console.log(`\nResultado: ${ok} tocaram, ${falhou} falharam de ${nomes.length}`);
    const logs = page.console.filter((m) => /error|warn|fail|mpegts|hls/i.test(m)).map(mascara);
    const cont = {}; logs.forEach((m) => { const k = m.replace(/\d+/g, "N").slice(0, 90); cont[k] = (cont[k] || 0) + 1; });
    console.log("Mensagens mais frequentes do console:\n" + Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `  ${v}× ${k}`).join("\n"));
  } finally {
    const inst = await page.eval(`localStorage.getItem('sint_web_install') || ''`);
    const jwt = await page.eval(`JSON.parse(localStorage.getItem('sintoniza_painel_sessao') || '{}').access_token || ''`);
    if (inst && jwt) await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/devices?instalacao=eq.${encodeURIComponent(inst)}`, { method: "DELETE", headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: "Bearer " + jwt } });
  }
});
