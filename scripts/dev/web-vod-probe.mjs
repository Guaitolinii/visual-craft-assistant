// Testa no app WEB de produção (conta de teste) como um filme/episódio chega pelo proxy do site: status, tipo, Range e primeiros bytes.
// A lista vem de uma variável (nunca impressa). Uso: node scripts/dev/web-vod-probe.mjs <.env.ott.local> <VARIAVEL_COM_URL_VOD> [quantidade]
import { readFileSync } from "node:fs";
import { withPage } from "./cdp.mjs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const N = Number(process.argv[4]) || 3;
const lista = await (await fetch(env[process.argv[3] || "OTT_CONTA_VOD"], { headers: { "user-agent": "VLC/3.0.20" } })).text();
const linhas = lista.split(/\r?\n/);
const filmes = [];
for (let i = 0; i < linhas.length && filmes.length < N; i++) if (/^https?:\/\/[^/]+\/movie\//.test(linhas[i])) filmes.push(linhas[i]);
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
  for (const url of filmes) {
    const r = JSON.parse(await page.eval(`(async () => {
      const u = ${JSON.stringify(url)}; const p = webUrl(u); const t0 = Date.now();
      try {
        const res = await fetch(p, { headers: { Range: 'bytes=0-4095' } });
        const buf = new Uint8Array(await res.arrayBuffer());
        const txt = res.status >= 400 || res.headers.get('content-type') && /json|text|html/.test(res.headers.get('content-type')) ? new TextDecoder().decode(buf.subarray(0, 200)) : '';
        return JSON.stringify({ proxied: p !== u, status: res.status, ct: res.headers.get('content-type'), cr: res.headers.get('content-range'), bytes: buf.length, ms: Date.now() - t0, txt: txt.replace(/(username|password)=[^&\\s"]+/gi, '$1=***') });
      } catch (e) { return JSON.stringify({ erro: String(e), ms: Date.now() - t0 }); }
    })()`));
    console.log("filme:", JSON.stringify(r));
  }
  // simula a aba Filmes / Séries: todas as categorias de uma vez, como o app faz, contando o status de cada pedido
  for (const tipo of ["filmes", "series"]) {
    const r = JSON.parse(await page.eval(`(async () => {
      const creds = parseXtreamCredentials(${JSON.stringify(env[process.argv[3] || "OTT_CONTA_VOD"])}); const isSeries = ${tipo === "series"};
      const st = {}; const orig = window.fetch; const lentos = [];
      window.fetch = function (u) { const t0 = Date.now(); const p = orig.apply(this, arguments); p.then(function (r) { st[r.status] = (st[r.status] || 0) + 1; lentos.push(Date.now() - t0); }, function () { st.erro = (st.erro || 0) + 1; }); return p; };
      const t0 = Date.now(); let cats = [];
      try { cats = await vodFetchCategories(creds, isSeries); } catch (e) { return JSON.stringify({ erroCategorias: String(e) }); }
      const res = await Promise.allSettled(cats.map(c => vodFetchCategoryItems(creds, isSeries, c.category_id)));
      window.fetch = orig;
      const itens = res.reduce((a, x) => a + (x.status === 'fulfilled' ? x.value.length : 0), 0);
      return JSON.stringify({ categorias: cats.length, pedidos: st, categoriasComErro: res.filter(x => x.status === 'rejected').length, itensCarregados: itens, segundos: Math.round((Date.now() - t0) / 100) / 10, maisLentoMs: Math.max(0, ...lentos) });
    })()`));
    console.log(tipo + ":", JSON.stringify(r));
  }
  const inst = await page.eval(`localStorage.getItem('sint_web_install') || ''`);
  const jwt = await page.eval(`JSON.parse(localStorage.getItem('sintoniza_painel_sessao') || '{}').access_token || ''`);
  if (inst && jwt) await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/devices?instalacao=eq.${encodeURIComponent(inst)}`, { method: "DELETE", headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: "Bearer " + jwt } });
});
