// Diagnóstico de canais de esporte DENTRO do app web (mede o que o usuário realmente vê).
// Como usar: abra https://sintonizatv.com.br/app/ logado, deixe a aba na frente (aba em segundo plano é
// desacelerada pelo Chrome), abra o Console (F12), cole este arquivo inteiro e aperte Enter
// (se o Chrome pedir, digite "allow pasting" antes). Um painel aparece no canto da tela.
// Ele toca um canal por vez no player do app (nunca mais de uma conexão), anota o resultado e, ao fim,
// baixa um arquivo sondagens-navegador.jsonl no mesmo formato da ferramenta do repositório
// (node scripts/monitor-canais/cli.mjs resumir --out <pasta com o arquivo>).
// Não grava links nem senhas: só nome, grupo, status e tempos. Não mexe no histórico nem nos recentes da conta.
// Opções (opcional, antes de colar): window.__diagCfg = { minutos: 75, segundos: 14, partidaMax: 20, grupos: ["ESPN"], excluir: [] }
(async () => {
  if (window.__diag && window.__diag.rodando) { console.log("Diagnóstico já está rodando. Use __diag.parar() para encerrar."); return; }

  // ── Configuração ────────────────────────────────────────────────────────────
  const cfg = Object.assign({
    minutos: 75,       // duração total do monitoramento (novas rodadas só começam se couberem)
    segundos: 14,      // quanto tempo observar cada canal depois que a imagem começou
    partidaMax: 20,    // quanto esperar a imagem começar antes de dar o canal como morto
    // trechos do nome do grupo (sem diferenciar maiúsculas) que definem os canais de esporte
    grupos: ["espn", "sportv", "premiere", "combate", "esportes", "nba", "xsports", "sportynet", "paramount", "4k"],
    // trechos do NOME que entram mesmo quando o grupo não é de esporte (ex.: Band Sports em "TV Aberta")
    nomes: [],
    // trechos do nome do canal que ficam de fora (não são esporte, mesmo estando no grupo)
    excluir: ["tnt s", "tnt novelas", "tnt fhd", "tnt hd", "tnt sd", "tnt 4k", "radio", "rádio", "mr olympia", "tve", "goat"],
  }, window.__diagCfg || {});

  // ── Utilidades ──────────────────────────────────────────────────────────────
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const minusc = (s) => String(s || "").toLowerCase();
  // mesma regra do familiaDoCanal da ferramenta: tira FHD/HD/SD/4K e junta espaços
  const familia = (nome) => minusc(nome).replace(/\b(fhd|hd|sd|4k)\b/g, " ").replace(/\s+/g, " ").trim();
  const video = document.getElementById("player-video");
  if (!video || typeof getChannels !== "function" || typeof playStream !== "function") {
    console.error("Não encontrei o player do app. Abra o app em /app/, logado, e cole de novo.");
    return;
  }

  // Seleciona os canais de esporte da lista do app
  const todos = getChannels() || [];
  const canais = todos.filter((c) => {
    const g = minusc(c.category), n = minusc(c.name);
    const entra = cfg.grupos.some((t) => g.includes(minusc(t))) || cfg.nomes.some((t) => n.includes(minusc(t)));
    return c.url && entra && !cfg.excluir.some((t) => n.includes(minusc(t)));
  });
  if (!canais.length) { console.error("Nenhum canal de esporte encontrado na lista do app (a lista está carregada?)."); return; }

  const estado = { rodando: true, pedidoParar: false, rodada: 0, indice: 0, registros: [], inicio: Date.now() };
  window.__diag = estado;
  const mudoAntes = video.muted;

  // ── Painel na tela ──────────────────────────────────────────────────────────
  const painel = document.createElement("div");
  painel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#eee;border:1px solid #c9a84c;border-radius:8px;padding:10px 12px;font:12px/1.4 Verdana,sans-serif;max-width:260px";
  painel.innerHTML = '<b style="color:#c9a84c">Diagnóstico de canais</b><div id="diag-txt">iniciando…</div>' +
    '<button id="diag-baixar" style="margin:6px 6px 0 0">Baixar</button><button id="diag-parar" style="margin-top:6px">Parar</button>';
  document.body.appendChild(painel);
  const txt = painel.querySelector("#diag-txt");
  const atualizarPainel = (extra) => {
    const vivos = estado.registros.filter((r) => r.rodada === estado.rodada && r.status === "vivo").length;
    txt.textContent = `rodada ${estado.rodada} · canal ${estado.indice}/${canais.length} · vivos nesta rodada: ${vivos}` + (extra ? " · " + extra : "");
  };

  // ── Baixar o resultado (JSONL, uma sondagem por linha) ───────────────────────
  const baixar = () => {
    const corpo = estado.registros.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([corpo], { type: "application/x-ndjson" }));
    a.download = "sondagens-navegador.jsonl";
    document.body.appendChild(a); a.click(); a.remove();
  };
  estado.baixar = baixar;
  estado.parar = () => { estado.pedidoParar = true; };
  painel.querySelector("#diag-baixar").onclick = baixar;
  painel.querySelector("#diag-parar").onclick = estado.parar;

  // ── Mede um canal: espera a imagem andar e observa paradas ───────────────────
  const medir = async (ch) => {
    // não usa selectChannel de propósito: ele grava recentes e histórico da conta
    setState({ selected: ch, playing: false });
    try { stopStream(); } catch (e) { /* sem stream anterior */ }
    video.muted = true; // autoplay sempre liberado sem som
    const t0 = performance.now();
    playStream(ch.url);
    let inicioMs = null, ultimoT = -1, ultimoMov = 0, paradas = 0, maiorLacuna = 0, erro = "";
    for (;;) {
      await esperar(250);
      if (estado.pedidoParar) break;
      const agora = performance.now();
      const t = video.currentTime || 0;
      if (inicioMs === null) {
        if (t > 0.5) { inicioMs = agora; ultimoMov = agora; ultimoT = t; }
        else {
          const caixa = document.querySelector(".player-error.active");
          if (caixa) { erro = (document.getElementById("player-error-msg") || {}).textContent || "erro-do-player"; break; }
          if (agora - t0 > cfg.partidaMax * 1000) { erro = "sem-imagem"; break; }
        }
      } else {
        if (t > ultimoT + 0.05) {
          const lacuna = agora - ultimoMov;
          if (lacuna >= 2000) paradas++;
          if (lacuna > maiorLacuna) maiorLacuna = lacuna;
          ultimoMov = agora; ultimoT = t;
        } else {
          const parado = agora - ultimoMov;
          if (parado > maiorLacuna) maiorLacuna = parado;
        }
        if (agora - inicioMs >= cfg.segundos * 1000) {
          if (agora - ultimoMov >= 2000) paradas++; // terminou no meio de uma parada
          break;
        }
      }
    }
    const status = inicioMs === null ? "morto" : (paradas > 0 || maiorLacuna >= 3000 ? "instavel" : "vivo");
    return {
      ts: new Date().toISOString(), rodada: estado.rodada, canal: ch.name, grupo: ch.category || "", familia: familia(ch.name),
      status, http: 0, saltos: 0, hostFinal: "", ttfbMs: inicioMs === null ? null : Math.round(inicioMs - t0),
      bytes: 0, kbps: 0, paradas, maiorLacunaMs: Math.round(maiorLacuna), tipo: "app", erro: String(erro).trim().slice(0, 80) || null,
    };
  };

  // ── Rodadas até acabar o tempo ──────────────────────────────────────────────
  const fimTotal = estado.inicio + cfg.minutos * 60000;
  const duracaoRodadaEst = canais.length * (cfg.segundos + 3) * 1000;
  console.log(`Diagnóstico: ${canais.length} canais de esporte, ~${Math.round(duracaoRodadaEst / 60000)} min por rodada, ${cfg.minutos} min no total.`);
  while (!estado.pedidoParar && Date.now() + duracaoRodadaEst * 0.5 < fimTotal) {
    estado.rodada++;
    for (let i = 0; i < canais.length && !estado.pedidoParar; i++) {
      estado.indice = i + 1;
      atualizarPainel(canais[i].name);
      estado.registros.push(await medir(canais[i]));
      await esperar(300);
    }
  }

  // ── Fim: limpa e entrega o arquivo ───────────────────────────────────────────
  try { stopStream(); } catch (e) { /* já parado */ }
  video.muted = mudoAntes;
  estado.rodando = false;
  const porStatus = {};
  estado.registros.forEach((r) => { porStatus[r.status] = (porStatus[r.status] || 0) + 1; });
  txt.textContent = `terminou: ${estado.rodada} rodada(s), ${estado.registros.length} medições ${JSON.stringify(porStatus)}. Baixando o arquivo…`;
  console.log("Diagnóstico terminou", porStatus);
  baixar();
})();
