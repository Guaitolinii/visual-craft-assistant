// Abre vários canais ao vivo de uma lista M3U no app WEB de produção (Chrome headless, conta de teste) e mede, por canal: se a imagem
// anda, o colchão, quanto demorou para começar, os pedidos ao proxy e o que o app/console reportou. Serve para comparar provedores.
// A lista vem de uma variável (nunca impressa): node scripts/dev/web-lista-probe.mjs <.env.ott.local> <VARIAVEL_COM_URL> "ESPN 2 FHD,SporTV 2 FHD" [segundos]
import { readFileSync } from "node:fs";
import { withPage } from "./cdp.mjs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const VAR = process.argv[3] || "OTT_LISTA_CANAIS";
const NOMES = (process.argv[4] || "ESPN 2 FHD").split(",").map((s) => s.trim());
const SEG = Number(process.argv[5]) || 40;
const texto = await (await fetch(env[VAR], { headers: { "user-agent": "VLC/3.0.20" } })).text();
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
  // gancho: pedidos ao proxy (host mascarado, status, duração, bytes) e erros de rede do hls.js
  await page.eval(`window.__w = { reqs: [], t0: Date.now() }; (() => {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); this.__p = this.__u.indexOf('/api/proxy') >= 0; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () { var x = this, t0 = Date.now(); if (x.__p) x.addEventListener('loadend', function () { window.__w.reqs.push([t0 - window.__w.t0, Date.now() - t0, x.status, (x.response && (x.response.byteLength || x.response.length)) || 0]); }); return send.apply(this, arguments); };
    var f = window.fetch; window.fetch = function (u) { var s = String(u && u.url || u), t0 = Date.now(), p = s.indexOf('/api/proxy') >= 0; var pr = f.apply(this, arguments); if (p) pr.then(function (r) { var c = r.clone(); var h = [r.headers.get('content-type'), r.headers.get('server'), r.headers.get('retry-after'), r.headers.get('cf-ray')]; if (r.status >= 400) c.text().then(function (tx) { window.__w.reqs.push([t0 - window.__w.t0, Date.now() - t0, r.status, 'fetch', h, tx.replace(/(username|password)=[^&s"]+/gi, '$1=***').slice(0, 220)]); }); else window.__w.reqs.push([t0 - window.__w.t0, Date.now() - t0, r.status, 'fetch', h]); }, function () { window.__w.reqs.push([t0 - window.__w.t0, Date.now() - t0, 0, 'fetch-erro']); }); return pr; };
  })()`);
  for (const nome of NOMES) {
    const existe = await page.eval(`!!window.__todos.find(c => c.name === ${JSON.stringify(nome)})`);
    if (!existe) { console.log(`\n[${nome}] não está na lista`); continue; }
    await page.eval(`window.__w.reqs = []; window.__w.t0 = Date.now(); selectChannel(window.__todos.find(c => c.name === ${JSON.stringify(nome)}))`);
    const t0 = Date.now();
    let primeiro = null, ultimoT = -1, andou = 0;
    const amostras = [];
    while ((Date.now() - t0) / 1000 < SEG) {
      const e = JSON.parse(await page.eval(`(() => { const v = document.getElementById('player-video'); let ahead = 0;
        for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) >= v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
        const l = document.getElementById('player-loader'); const err = document.querySelector('#player-error, .player-error, #player-overlay-msg');
        return JSON.stringify({ t: v.currentTime, ahead: Math.round(ahead * 10) / 10, rs: v.readyState, w: v.videoWidth, loader: !!(l && l.classList.contains('active')), vErr: v.error ? v.error.code + ':' + v.error.message : null, msg: err ? err.textContent.trim().slice(0, 80) : '' }); })()`));
      const dec = (Date.now() - t0) / 1000;
      if (primeiro === null && e.t > 0.3) primeiro = dec;
      if (e.t > ultimoT + 0.05) andou++;
      ultimoT = e.t;
      amostras.push({ s: Math.round(dec), ...e });
      await page.sleep(1000);
    }
    const w = JSON.parse(await page.eval("JSON.stringify(window.__w)"));
    const ult = amostras[amostras.length - 1];
    console.log(`\n[${nome}] começou a andar em: ${primeiro === null ? "NUNCA" : primeiro.toFixed(1) + " s"} | andou em ${andou}/${amostras.length} amostras | vídeo ${ult.w}px readyState ${ult.rs} | colchão ${ult.ahead} s | erro do <video>: ${ult.vErr || "nenhum"} | mensagem: ${ult.msg || "—"}`);
    console.log("  linha do tempo: " + amostras.filter((_, i) => i % 5 === 0).map((a) => `${a.s}s:t=${Math.round(a.t)}(${a.ahead})${a.loader ? "◌" : ""}`).join(" | "));
    const porStatus = {};
    w.reqs.forEach((r) => { porStatus[r[2]] = (porStatus[r[2]] || 0) + 1; });
    console.log(`  pedidos ao proxy: ${w.reqs.length} | por status: ${JSON.stringify(porStatus)} | mais lento: ${Math.max(0, ...w.reqs.map((r) => r[1]))} ms | 1ºs: ${JSON.stringify(w.reqs.slice(0, 3))}`);
  }
  const erros = page.console.filter((m) => /error|warn|fail|hls|mpegts|proxy/i.test(m)).map((m) => m.replace(/(username|password)=[^&\s"]+/gi, "$1=***").replace(/\/(live|movie|series)\/[^/\s"]+\/[^/\s"]+\//g, "/$1/***/***/")).slice(-25);
  console.log("\n[console da página, últimas linhas relevantes]\n" + erros.join("\n"));
  const inst = await page.eval(`localStorage.getItem('sint_web_install') || ''`);
  const jwt = await page.eval(`JSON.parse(localStorage.getItem('sintoniza_painel_sessao') || '{}').access_token || ''`);
  if (inst && jwt) await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/devices?instalacao=eq.${encodeURIComponent(inst)}`, { method: "DELETE", headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: "Bearer " + jwt } });
});
