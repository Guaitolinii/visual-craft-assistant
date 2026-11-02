#!/usr/bin/env node
// scripts/monitor-canais/cli.mjs
// Linha de comando para monitoramento e resumo de canais IPTV

import fs from "node:fs";
import path from "node:path";
import {
  parseM3u,
  lerChaveEnv,
  filtrarCanais,
  executarRodada,
  lerSondagens,
  resumir,
  tabelaTexto,
} from "./lib.mjs";

/**
 * Faz o parse simples de argumentos no formato --chave valor ou --chave=valor
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
function parseArgs(args) {
  const params = {};
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (item.startsWith("--")) {
      const semTracos = item.slice(2);
      const idxIgual = semTracos.indexOf("=");
      if (idxIgual !== -1) {
        const k = semTracos.slice(0, idxIgual);
        const v = semTracos.slice(idxIgual + 1);
        params[k] = v;
      } else {
        const proximo = args[i + 1];
        if (proximo !== undefined && !proximo.startsWith("--")) {
          params[semTracos] = proximo;
          i++;
        } else {
          params[semTracos] = "true";
        }
      }
    }
  }
  return params;
}

/**
 * Lê o arquivo de ambiente e obtém a URL da chave especificada
 */
function obterUrlM3u(envFile, chave) {
  if (!envFile) {
    console.error("Erro: --env-file ausente");
    process.exit(1);
  }

  if (!fs.existsSync(envFile)) {
    console.error("Erro: arquivo de ambiente inexistente");
    process.exit(1);
  }

  let conteudoEnv;
  try {
    conteudoEnv = fs.readFileSync(envFile, "utf-8");
  } catch {
    console.error("Erro: falha ao ler o arquivo de ambiente");
    process.exit(1);
  }

  try {
    return lerChaveEnv(conteudoEnv, chave || "OTT_CONTA_CANAIS");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Baixa a lista M3U via fetch
 */
async function baixarListaM3u(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    console.error("Erro: falha na conexao ao baixar lista M3U");
    process.exit(1);
  }

  if (!res.ok) {
    console.error("Erro: falha ao obter lista M3U");
    process.exit(1);
  }

  const texto = await res.text();
  if (!texto || texto.trim().startsWith("<")) {
    console.error("nenhum canal");
    process.exit(1);
  }

  return texto;
}

// Subcomando: listar
async function comandoListar(params) {
  const url = obterUrlM3u(params["env-file"], params.chave);
  const textoM3u = await baixarListaM3u(url);
  const canaisBrutos = parseM3u(textoM3u);

  if (canaisBrutos.length === 0) {
    console.error("nenhum canal");
    process.exit(1);
  }

  let canais = canaisBrutos;
  if (params.grupos !== undefined || params.incluir !== undefined || params.excluir !== undefined) {
    const grupos = params.grupos
      ? params.grupos.split(",").map((g) => g.trim()).filter(Boolean)
      : ["*"];
    const excluir = params.excluir
      ? params.excluir.split(",").map((e) => e.trim()).filter(Boolean)
      : [];
    const incluir = params.incluir
      ? params.incluir.split(",").map((i) => i.trim()).filter(Boolean)
      : [];
    canais = filtrarCanais(canaisBrutos, { grupos, excluir, incluir });
  }

  if (canais.length === 0) {
    console.error("nenhum canal");
    process.exit(1);
  }

  if (params.nomes) {
    for (const c of canais) {
      console.log(c.nome);
    }
    return;
  }

  const contagemGrupos = new Map();
  for (const c of canais) {
    const g = c.grupo || "(sem grupo)";
    contagemGrupos.set(g, (contagemGrupos.get(g) || 0) + 1);
  }

  const ordenados = [...contagemGrupos.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [grupo, qtd] of ordenados) {
    console.log(`${grupo}: ${qtd}`);
  }
}

// Subcomando: monitorar
async function comandoMonitorar(params) {
  if (!params.grupos || !params.grupos.trim()) {
    console.error("Erro: --grupos ausente ou vazio");
    process.exit(1);
  }

  if (!params.out) {
    console.error("Erro: --out ausente");
    process.exit(1);
  }

  const minutos = Number(params.minutos ?? 90);
  if (isNaN(minutos) || minutos <= 0) {
    console.error("Uso: --minutos deve ser maior que zero");
    process.exit(1);
  }

  const intervalo = Number(params.intervalo ?? 6);
  if (isNaN(intervalo) || intervalo < 1) {
    console.error("Uso: --intervalo deve ser no minimo 1");
    process.exit(1);
  }

  const leituraSeg = Number(params.leitura ?? 8);
  if (isNaN(leituraSeg) || leituraSeg < 1) {
    console.error("Uso: --leitura deve ser no minimo 1");
    process.exit(1);
  }

  const conexaoSeg = Number(params.conexao ?? 25);
  if (isNaN(conexaoSeg) || conexaoSeg < 1) {
    console.error("Uso: --conexao deve ser no minimo 1");
    process.exit(1);
  }

  const leituraPrioritariaSeg = Number(params["leitura-prioritaria"] ?? 15);
  let concorrencia = Number(params.concorrencia ?? 2);
  if (isNaN(concorrencia) || concorrencia < 1) {
    concorrencia = 1;
  } else if (concorrencia > 4) {
    console.warn("Aviso: concorrencia maxima permitida e 4; usando 4.");
    concorrencia = 4;
  }

  const rotulo = params.rotulo || "geral";
  const grupos = params.grupos.split(",").map((g) => g.trim()).filter(Boolean);
  const excluir = params.excluir
    ? params.excluir.split(",").map((e) => e.trim()).filter(Boolean)
    : [];
  const incluir = params.incluir
    ? params.incluir.split(",").map((i) => i.trim()).filter(Boolean)
    : [];
  let prioritarios = null;
  if (params.prioritarios) {
    try {
      prioritarios = new RegExp(params.prioritarios, "i");
    } catch {
      console.error("Erro: regex de prioritarios invalida");
      process.exit(1);
    }
  }

  const url = obterUrlM3u(params["env-file"], params.chave);
  const textoM3u = await baixarListaM3u(url);
  const canaisBrutos = parseM3u(textoM3u);
  const canais = filtrarCanais(canaisBrutos, { grupos, excluir, incluir });

  if (canais.length === 0) {
    console.error("nenhum canal");
    process.exit(1);
  }

  const outDir = path.resolve(params.out);
  fs.mkdirSync(outDir, { recursive: true });

  const arquivoSondagens = path.join(outDir, `sondagens-${rotulo}.jsonl`);
  const arquivoEstado = path.join(outDir, `estado-${rotulo}.json`);

  const iniciadoEm = new Date().toISOString();
  const totalMs = minutos * 60 * 1000;
  const intervaloMs = intervalo * 60 * 1000;
  const rodadasPrevistas = Math.ceil(totalMs / intervaloMs);
  const tempoInicioGeral = Date.now();

  let rodada = 1;
  let encerrando = false;

  process.on("SIGINT", () => {
    encerrando = true;
    process.exit(0);
  });

  while (!encerrando) {
    const inicioRodada = Date.now();

    const resultado = await executarRodada(canais, {
      rodada,
      leituraPadraoMs: leituraSeg * 1000,
      leituraPrioritariaMs: leituraPrioritariaSeg * 1000,
      prioritarios,
      concorrencia,
      conexaoMs: conexaoSeg * 1000,
      gravar: (registro) => {
        fs.appendFileSync(arquivoSondagens, JSON.stringify(registro) + "\n", "utf-8");
      },
    });

    const estado = {
      rotulo,
      iniciadoEm,
      rodada,
      rodadasPrevistas,
      canais: canais.length,
      ultimaRodadaEm: new Date().toISOString(),
      porStatus: resultado.porStatus,
    };
    fs.writeFileSync(arquivoEstado, JSON.stringify(estado, null, 2), "utf-8");

    console.log(
      `[${new Date().toISOString()}] Rodada ${rodada}/${rodadasPrevistas}: ${resultado.total} canais ` +
        `(vivos: ${resultado.porStatus.vivo}, instaveis: ${resultado.porStatus.instavel}, ` +
        `mortos: ${resultado.porStatus.morto}, limitados: ${resultado.porStatus.limitado})`
    );

    const decorridoGeral = Date.now() - tempoInicioGeral;
    if (decorridoGeral >= totalMs || rodada >= rodadasPrevistas || encerrando) {
      break;
    }

    const proximaRodadaAlvo = tempoInicioGeral + rodada * intervaloMs;
    const esperaMs = Math.max(0, proximaRodadaAlvo - Date.now());
    if (esperaMs > 0) {
      await new Promise((r) => setTimeout(r, esperaMs));
    }

    rodada++;
  }
}

// Subcomando: resumir
async function comandoResumir(params) {
  if (!params.out) {
    console.error("Erro: --out ausente");
    process.exit(1);
  }

  const outDir = path.resolve(params.out);
  if (!fs.existsSync(outDir)) {
    console.error("sem dados");
    process.exit(1);
  }

  const rotulo = params.rotulo;
  const arquivos = fs
    .readdirSync(outDir)
    .filter((f) => {
      if (rotulo) {
        return f === `sondagens-${rotulo}.jsonl`;
      }
      return f.startsWith("sondagens-") && f.endsWith(".jsonl");
    });

  if (arquivos.length === 0) {
    console.error("sem dados");
    process.exit(1);
  }

  let conteudoTotal = "";
  for (const arq of arquivos) {
    conteudoTotal += fs.readFileSync(path.join(outDir, arq), "utf-8") + "\n";
  }

  if (!conteudoTotal.trim()) {
    console.error("sem dados");
    process.exit(1);
  }

  const { registros, invalidas } = lerSondagens(conteudoTotal);

  if (invalidas > 0) {
    console.log(`Linhas invalidas ignoradas: ${invalidas}`);
  }

  if (registros.length === 0) {
    console.error("sem dados");
    process.exit(1);
  }

  const resumo = resumir(registros);
  fs.writeFileSync(
    path.join(outDir, "resumo.json"),
    JSON.stringify(resumo, null, 2),
    "utf-8"
  );

  process.stdout.write(tabelaTexto(resumo));
}

// Ponto de entrada CLI
async function main() {
  const args = process.argv.slice(2);
  const subcomando = args[0];
  const params = parseArgs(args.slice(1));

  if (subcomando === "listar") {
    await comandoListar(params);
  } else if (subcomando === "monitorar") {
    await comandoMonitorar(params);
  } else if (subcomando === "resumir") {
    await comandoResumir(params);
  } else {
    console.error("Uso: node cli.mjs <listar|monitorar|resumir> [opcoes]");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Erro inesperado:", err.message || "falha");
  process.exit(1);
});
