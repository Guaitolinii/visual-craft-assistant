// Assiste um canal ao vivo no app WEB de produção (Chrome headless, conta de teste) e mede a saúde: paradas, colchão (segundos à frente)
// e pedidos que falharam; com --queda=SEG derruba a rede do provedor (os pedidos ao /api/proxy) por SEG s no meio, para ver se a imagem
// aguenta. Mesma ideia do tv-live-watch (scripts/diag-tv). Não imprime URLs nem segredos.
// Uso: node scripts/dev/web-live-chaos.mjs <arquivo .env.ott.local> "ESPN HD" [minutos] [--queda=30]
import { readFileSync } from "node:fs";
import { withPage } from "./cdp.mjs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const NOME = process.argv[3] || "ESPN HD";
const MIN = Number(process.argv.find((a, i) => i > 3 && /^\d+(\.\d+)?$/.test(a))) || 4;
const QUEDA = Number((process.argv.find((a) => a.startsWith("--queda=")) || "").split("=")[1]) || 0;
const texto = await (await fetch(env.OTT_LISTA_CANAIS, { headers: { "user-agent": "VLC/3.0.20" } })).text();
const U = env.VITE_SUPABASE_URL, A = env.VITE_SUPABASE_ANON_KEY;
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
  // gancho: pedidos ao proxy (status/duração) e queda de rede sob demanda
  await page.eval(`window.__w = { reqs: [], caos: false, bloq: 0, t0: Date.now() }; (() => {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { var a = Array.prototype.slice.call(arguments); this.__u = String(u); this.__p = this.__u.indexOf('/api/proxy') >= 0; if (window.__w.caos && this.__p) { window.__w.bloq++; a[1] = 'http://127.0.0.1:9/x'; } return open.apply(this, a); };
    XMLHttpRequest.prototype.send = function () { var x = this, t0 = Date.now(); if (x.__p) x.addEventListener('loadend', function () { window.__w.reqs.push([t0 - window.__w.t0, Date.now() - t0, x.status]); }); return send.apply(this, arguments); };
  })()`);
  await page.eval(`selectChannel(window.__todos.find(c => c.name === ${JSON.stringify(NOME)}))`);
  const t0 = Date.now();
  const amostras = [];
  let caiu = false, voltou = false;
  while (Date.now() - t0 < MIN * 60000) {
    const dec = (Date.now() - t0) / 1000;
    if (QUEDA && !caiu && dec >= 60) { await page.eval("window.__w.caos = true"); caiu = true; console.log(`[web] ${Math.round(dec)}s: REDE DO PROVEDOR DERRUBADA por ${QUEDA} s`); }
    if (QUEDA && caiu && !voltou && dec >= 60 + QUEDA) { await page.eval("window.__w.caos = false"); voltou = true; console.log(`[web] ${Math.round(dec)}s: rede devolvida`); }
    const e = JSON.parse(await page.eval(`(() => { const v = document.getElementById('player-video'); let ahead = 0;
      for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) >= v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
      const loader = document.getElementById('player-loader');
      return JSON.stringify({ t: v.currentTime, ahead: Math.round(ahead * 10) / 10, paused: v.paused, loader: !!(loader && loader.classList.contains('active')), estagio: (typeof currentLiveLatencyStage !== 'undefined') ? currentLiveLatencyStage : null }); })()`));
    amostras.push({ s: dec, ...e });
    await page.sleep(1000);
  }
  const w = JSON.parse(await page.eval("JSON.stringify(window.__w)"));
  const linha = [];
  for (let k = 0; k < amostras.length; k += 5) { const x = amostras[k], prev = amostras[Math.max(0, k - 5)]; linha.push(Math.round(x.s) + "s:" + (Math.abs(x.t - prev.t) > 0.3 || k === 0 ? "P" : "S") + "(" + x.ahead + ")" + (x.loader ? " ◌" : "")); }
  let paradas = 0, maior = 0, desde = null;
  for (let k = 1; k < amostras.length; k++) { const parado = Math.abs(amostras[k].t - amostras[k - 1].t) < 0.05 && !amostras[k].paused; if (parado) { if (desde === null) desde = k; } else if (desde !== null) { const d = k - desde; if (d >= 2) paradas++; maior = Math.max(maior, d); desde = null; } }
  const ah = amostras.map((a) => a.ahead);
  console.log("[web] linha do tempo: " + linha.join(" | "));
  console.log(`[web] colchão (s à frente): mínimo ${Math.min(...ah)} | média ${Math.round((ah.reduce((a, b) => a + b, 0) / ah.length) * 10) / 10} | máximo ${Math.max(...ah)}`);
  console.log(`[web] paradas ≥ 2 s: ${paradas} | maior parada: ${maior} s | pedidos ao proxy: ${w.reqs.length} | falhas: ${w.reqs.filter((r) => r[2] !== 200).length} | bloqueados: ${w.bloq} | degrau de atraso no fim: ${amostras[amostras.length - 1].estagio}`);
  const inst = await page.eval(`localStorage.getItem('sint_web_install') || ''`);
  const jwt = await page.eval(`JSON.parse(localStorage.getItem('sintoniza_painel_sessao') || '{}').access_token || ''`);
  if (inst && jwt) await fetch(`${U}/rest/v1/devices?instalacao=eq.${encodeURIComponent(inst)}`, { method: "DELETE", headers: { apikey: A, Authorization: "Bearer " + jwt } });
});
