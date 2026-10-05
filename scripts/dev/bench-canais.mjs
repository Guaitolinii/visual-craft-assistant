// Mede, em produção (app web v19), como uma amostra de canais ao vivo se comporta por ~22 s cada:
// tempo até o 1º quadro, nº de paradas (waiting), tempo parado, quadros perdidos, tarefas longas da página, erros do hls.js, rota (direto/proxy).
// Sem imprimir URLs/segredos. Uso: node scripts/dev/bench-canais.mjs <arquivo .env.ott.local> <quantos> [passo]
import { readFileSync } from "node:fs";
import { withPage } from "./cdp.mjs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const QUANTOS = +process.argv[3] || 10, PASSO = +process.argv[4] || 90;
const texto = await (await fetch(env.OTT_LISTA_CANAIS, { headers: { "user-agent": "VLC/3.0.20" } })).text();
const U = env.VITE_SUPABASE_URL, A = env.VITE_SUPABASE_ANON_KEY;
const DUR = 22000;
await withPage("https://sintonizatv.com.br/", { desktop: true, width: 1440, height: 900 }, async (page) => {
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
  await page.eval(`window.__hlsErr = []; window.__lt = []; (() => { const w = console.warn; console.warn = function () { const a = Array.prototype.slice.call(arguments); if (String(a[0]).indexOf('HLS Event Error') >= 0) { const d = a[1] || {}; window.__hlsErr.push([d.details, d.fatal ? 'FATAL' : ''].filter(Boolean).join('/')); } return w.apply(console, a); }; })();
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const v = document.getElementById('player-video'); window.__w = { n: 0, ms: 0, t0: 0 };
    v.addEventListener('waiting', () => { window.__w.n++; window.__w.t0 = performance.now(); });
    v.addEventListener('playing', () => { if (window.__w.t0) { window.__w.ms += performance.now() - window.__w.t0; window.__w.t0 = 0; } });`);
  const total = await page.eval(`window.__todos.length`);
  const linhas = [];
  for (let k = 0; k < QUANTOS; k++) {
    const idx = (k * PASSO + 7) % total;
    await page.eval(`(() => { window.__hlsErr = []; window.__lt = []; window.__w = { n: 0, ms: 0, t0: 0 }; window.__t0 = performance.now(); window.__ff = 0; const v = document.getElementById('player-video'); const ch = window.__todos[${idx}]; window.__nome = ch.name; selectChannel(ch); const poll = setInterval(() => { if (!window.__ff && v.readyState >= 3 && v.currentTime > 0) { window.__ff = Math.round(performance.now() - window.__t0); clearInterval(poll); } }, 100); setTimeout(() => clearInterval(poll), 25000); })()`);
    await page.sleep(DUR);
    const m = JSON.parse(await page.eval(`(() => { const v = document.getElementById('player-video'); const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
      return JSON.stringify({ nome: String(window.__nome).slice(0, 22), primeiroQuadroMs: window.__ff || null, t: Math.round(v.currentTime), frames: q.totalVideoFrames, perdidos: q.droppedVideoFrames, paradas: window.__w.n, paradoMs: Math.round(window.__w.ms + (window.__w.t0 ? performance.now() - window.__w.t0 : 0)), tarefasLongas: window.__lt.length, maiorTarefa: Math.max(0, ...window.__lt), erros: window.__hlsErr.slice(0, 4), tipo: typeof currentStreamType !== 'undefined' ? currentStreamType : '?' }); })()`));
    linhas.push(m);
    console.log(JSON.stringify(m));
  }
  const inst = await page.eval(`localStorage.getItem('sint_web_install') || ''`);
  const jwt = await page.eval(`JSON.parse(localStorage.getItem('sintoniza_painel_sessao') || '{}').access_token || ''`);
  if (inst && jwt) { const r = await fetch(`${U}/rest/v1/devices?instalacao=eq.${encodeURIComponent(inst)}`, { method: "DELETE", headers: { apikey: A, Authorization: "Bearer " + jwt } }); console.log("aparelho de teste removido:", r.status); }
});
