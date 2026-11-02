// scripts/canais-saude/build.mjs
// Gerador do canais-saude.json e CLI para execução local e no GitHub Actions.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseM3u,
  lerChaveEnv,
  sondar,
  classificar,
} from "../monitor-canais/lib.mjs";

export const CONFIG_PADRAO = {
  grupos: ["Esportes"],
  nomes: [
    "band sports",
    "fifa+",
    "formula 1",
    "futebol de rua",
    "sportynet",
    "red bull",
    "pluto tv esportes",
    "ge fast",
  ],
  amostrasPorHost: 3,
  minCanaisPorHost: 6,
  leituraMs: 8000,
  conexaoMs: 25000,
  concorrencia: 2,
  maxFalhaPct: 90,
};

/**
 * Normaliza o nome do canal gerando a chave padronizada para o arquivo de saúde:
 * sem acentos (NFD sem marcas combinantes), minúsculas, espaços colapsados e aparado.
 * @param {string} nome
 * @returns {string}
 */
export function saudeChave(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai o host de uma URL de canal. Retorna null se a URL for inválida.
 * @param {string} urlStr
 * @returns {string | null}
 */
export function extrairHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.host || null;
  } catch {
    return null;
  }
}

/**
 * Verifica se um canal pertence à categoria de esporte com base no grupo ou no nome.
 * @param {{ nome?: string, grupo?: string }} canal
 * @param {object} config
 * @returns {boolean}
 */
export function ehEsporte(canal, config) {
  const grupos = config?.grupos || [];
  const nomes = config?.nomes || [];
  const grupoLower = String(canal?.grupo || "").toLowerCase();
  const nomeLower = String(canal?.nome || "").toLowerCase();

  const temGrupo = grupos.some((g) =>
    grupoLower.includes(String(g).toLowerCase())
  );
  const temNome = nomes.some((n) => nomeLower.includes(String(n).toLowerCase()));

  return temGrupo || temNome;
}

/**
 * Sonda uma URL com teto de tempo total: leituraMs + 2 * conexaoMs + 30000 ms.
 * Se o tempo estourar, retorna erro: "travou".
 */
async function sondarComTeto(sondarFn, url, leituraMs, conexaoMs) {
  const cMs = Number(conexaoMs) || 0;
  const lMs = Number(leituraMs) || 0;
  const tetoMs = lMs + cMs * 2 + 30000;

  let timer;
  const travouPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({
        http: 0,
        saltos: 0,
        hostFinal: "",
        ttfbMs: null,
        bytes: 0,
        kbps: 0,
        paradas: 0,
        maiorLacunaMs: tetoMs,
        tipo: "vazio",
        erro: "travou",
      });
    }, tetoMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(sondarFn(url, { leituraMs: lMs, conexaoMs: cMs })),
      travouPromise,
    ]);
  } catch {
    return {
      http: 0,
      saltos: 0,
      hostFinal: "",
      ttfbMs: null,
      bytes: 0,
      kbps: 0,
      paradas: 0,
      maiorLacunaMs: 0,
      tipo: "vazio",
      erro: "conexao",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa uma lista de tarefas com concorrência máxima limitada.
 */
async function executarComConcorrencia(itens, limite, fn) {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limite, itens.length) },
    async () => {
      while (index < itens.length) {
        const i = index++;
        await fn(itens[i]);
      }
    }
  );
  await Promise.all(workers);
}

/**
 * Classifica o resultado da sondagem de um canal segundo a regra:
 * - "limitado": HTTP 429
 * - "removido": erro é dominio-estacionado, http-404, playlist-http-404 ou xui-*
 * - "vivo": classificar(s) === "vivo"
 * - "instavel": classificar(s) === "instavel" OU morto por outros erros (timeout, conexao, 403, 5xx, etc.)
 */
function classificarResultadoSondagem(s) {
  if (s.http === 429 || classificar(s) === "limitado") {
    return { estado: "limitado", m: null };
  }

  if (
    s.erro === "dominio-estacionado" ||
    s.erro === "http-404" ||
    s.erro === "playlist-http-404" ||
    (typeof s.erro === "string" && s.erro.startsWith("xui-"))
  ) {
    return { estado: "removido", m: s.erro };
  }

  if (classificar(s) === "vivo") {
    return { estado: "vivo", m: null };
  }

  return { estado: "instavel", m: s.erro || "instavel" };
}

/**
 * Sanitiza o motivo m garantindo que nunca contenha URLs, hosts, IPs ou exceda 80 caracteres.
 */
function sanitizarMotivo(m) {
  if (!m) return "instavel";
  let s = String(m)
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, "")
    .trim();
  return s.slice(0, 80);
}

/**
 * Gera o objeto de saúde de canais e o resumo de execução.
 *
 * @param {object} param0
 * @param {Array<{ nome: string, grupo: string, url: string }>} param0.canais
 * @param {object | null} [param0.anterior]
 * @param {number} [param0.agoraS]
 * @param {Function} [param0.sondarFn]
 * @param {object} [param0.config]
 * @returns {Promise<{ saude: object | null, resumo: object }>}
 */
/**
 * Impressão digital CURTA do endereço da lista (14 dígitos hexadecimais; cyrb53 do endereço sem espaços nas pontas).
 * O arquivo de saúde só vale para a lista medida: o app calcula a mesma coisa com o endereço que ele tem e só esconde canais se baterem.
 * Não é segredo criptográfico: o endereço da lista é longo e imprevisível, e o hash não é reversível na prática.
 * IDÊNTICA em sintoniza-link.html e src/services/saude.ts (mesmos números mágicos).
 * @param {unknown} url
 * @returns {string} "" se não houver endereço
 */
export function saudeListaId(url) {
  const s = typeof url === "string" ? url.trim() : "";
  if (!s) return "";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  let hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  while (hex.length < 14) hex = "0" + hex;
  return hex;
}

export async function gerarSaude({
  canais,
  anterior = null,
  agoraS,
  sondarFn = sondar,
  config = {},
  listaId = "",
}) {
  const agora = Number.isInteger(agoraS)
    ? agoraS
    : Math.floor(Date.now() / 1000);

  const cfg = { ...CONFIG_PADRAO, ...config };
  const totalCanais = Array.isArray(canais) ? canais.length : 0;

  // Lista com menos de 10 canais retorna saude: null
  if (!Array.isArray(canais) || totalCanais < 10) {
    return {
      saude: null,
      resumo: {
        total: totalCanais,
        sondados: 0,
        porEstado: { removido: 0, instavel: 0, vivo: 0 },
        servidoresRemovidos: 0,
        bloqueado: false,
      },
    };
  }

  // 1. Filtra canais válidos e agrupa por servidor
  const canaisValidos = canais.filter((c) => c && c.url && extrairHost(c.url));
  if (canaisValidos.length < 10) {
    return {
      saude: null,
      resumo: {
        total: totalCanais,
        sondados: 0,
        porEstado: { removido: 0, instavel: 0, vivo: 0 },
        servidoresRemovidos: 0,
        bloqueado: false,
      },
    };
  }

  const canaisPorHost = new Map();
  for (const c of canaisValidos) {
    const host = extrairHost(c.url);
    if (!canaisPorHost.has(host)) {
      canaisPorHost.set(host, []);
    }
    canaisPorHost.get(host).push(c);
  }

  // Cache de resultados por URL e lista de todas as sondagens individuais
  const resultadosPorUrl = new Map();
  const sondagensFeitas = [];

  function obterSondagem(url) {
    if (resultadosPorUrl.has(url)) {
      return resultadosPorUrl.get(url);
    }
    const promessa = (async () => {
      const res = await sondarComTeto(sondarFn, url, cfg.leituraMs, cfg.conexaoMs);
      sondagensFeitas.push(res);
      return res;
    })();
    resultadosPorUrl.set(url, promessa);
    return promessa;
  }

  // 2. Identifica e sonda canais de esporte
  const canaisEsporte = canaisValidos.filter((c) => ehEsporte(c, cfg));
  const urlsEsporte = Array.from(new Set(canaisEsporte.map((c) => c.url)));

  await executarComConcorrencia(
    urlsEsporte,
    cfg.concorrencia,
    async (url) => {
      await obterSondagem(url);
    }
  );

  // 4. Servidores inteiros: amostras determinísticas
  let servidoresRemovidosCount = 0;
  const hostsRemovidos = new Map(); // host -> motivo

  const hostsParaAvaliar = [];
  for (const [host, canaisHost] of canaisPorHost.entries()) {
    if (canaisHost.length >= cfg.minCanaisPorHost) {
      hostsParaAvaliar.push({ host, canaisHost });
    }
  }

  // Coleta URLs das amostras dos servidores que ainda não foram sondadas
  const urlsAmostrasParaSondar = new Set();
  const amostrasPorHostMap = new Map();

  for (const { host, canaisHost } of hostsParaAvaliar) {
    const len = canaisHost.length;
    const indices = [0, Math.floor(len / 2), len - 1];
    const amostras = indices.map((idx) => canaisHost[idx]);
    amostrasPorHostMap.set(host, amostras);
    for (const a of amostras) {
      if (!resultadosPorUrl.has(a.url)) {
        urlsAmostrasParaSondar.add(a.url);
      }
    }
  }

  if (urlsAmostrasParaSondar.size > 0) {
    await executarComConcorrencia(
      Array.from(urlsAmostrasParaSondar),
      cfg.concorrencia,
      async (url) => {
        await obterSondagem(url);
      }
    );
  }

  // Avalia resultado dos servidores
  for (const { host } of hostsParaAvaliar) {
    const amostras = amostrasPorHostMap.get(host);
    const resultadosAmostras = await Promise.all(
      amostras.map((a) => obterSondagem(a.url))
    );

    const primeiroErro = resultadosAmostras[0]?.erro;
    const ehMotivoServidor =
      primeiroErro === "dominio-estacionado" || primeiroErro === "http-404";

    const todasRemovidasMesmoMotivo =
      ehMotivoServidor &&
      resultadosAmostras.every((r) => r?.erro === primeiroErro);

    if (todasRemovidasMesmoMotivo) {
      servidoresRemovidosCount++;
      hostsRemovidos.set(host, primeiroErro);
    }
  }

  // 6. Trava de segurança: mais de maxFalhaPct% com erro de rede
  const totalSondados = sondagensFeitas.length;
  let errosRede = 0;
  for (const s of sondagensFeitas) {
    if (s.erro === "conexao" || s.erro === "timeout" || s.erro === "travou") {
      errosRede++;
    }
  }

  const pctFalha = totalSondados > 0 ? (errosRede / totalSondados) * 100 : 0;
  if (pctFalha > cfg.maxFalhaPct) {
    return {
      saude: null,
      resumo: {
        total: totalCanais,
        sondados: totalSondados,
        porEstado: { removido: 0, instavel: 0, vivo: 0 },
        servidoresRemovidos: 0,
        bloqueado: true,
      },
    };
  }

  // 3 & 4 & 5. Determinação do estado dos canais avaliados
  // Prioridade de estados: vivo (3) > instavel (2) > removido (1)
  const PESO_ESTADO = { vivo: 3, instavel: 2, removido: 1 };
  const avaliacoesPorChave = new Map(); // chave -> { estado, d, m }

  function registrarAvaliacao(nome, estado, motivo) {
    const chave = saudeChave(nome);
    if (!chave) return;

    // Continuidade de d
    let d;
    const anteriorCanal = anterior?.canais?.[chave];
    if (anteriorCanal && anteriorCanal.e === estado) {
      d = Number(anteriorCanal.d);
    } else {
      d = agora;
    }

    const novaAvaliacao = { estado, d, m: motivo };
    const existente = avaliacoesPorChave.get(chave);

    if (!existente) {
      avaliacoesPorChave.set(chave, novaAvaliacao);
      return;
    }

    const pesoNovo = PESO_ESTADO[estado] || 0;
    const pesoExistente = PESO_ESTADO[existente.estado] || 0;

    if (pesoNovo > pesoExistente) {
      avaliacoesPorChave.set(chave, novaAvaliacao);
    } else if (pesoNovo === pesoExistente) {
      // Empate: preserva o d mais antigo
      if (d < existente.d) {
        avaliacoesPorChave.set(chave, novaAvaliacao);
      }
    }
  }

  // Avalia canais de esporte (sondados individualmente)
  for (const c of canaisEsporte) {
    const resSondagem = await obterSondagem(c.url);
    const classif = classificarResultadoSondagem(resSondagem);

    if (classif.estado === "limitado") {
      const chave = saudeChave(c.nome);
      const anteriorCanal = anterior?.canais?.[chave];
      if (anteriorCanal && anteriorCanal.e) {
        // Mantém estado anterior
        registrarAvaliacao(c.nome, anteriorCanal.e, anteriorCanal.m);
      }
      // Se não havia estado anterior, canal fica sem decisão (fora do arquivo)
      continue;
    }

    registrarAvaliacao(c.nome, classif.estado, classif.m);
  }

  // Avalia canais não-esporte de servidores inteiros removidos
  for (const [host, motivoServidor] of hostsRemovidos.entries()) {
    const canaisDoHost = canaisPorHost.get(host) || [];
    for (const c of canaisDoHost) {
      if (!ehEsporte(c, cfg)) {
        registrarAvaliacao(c.nome, "removido", `servidor-${motivoServidor}`);
      }
    }
  }

  // Monta objeto final canais e estatísticas porEstado
  const canaisSaude = {};
  let contRemovido = 0;
  let contInstavel = 0;
  let contVivo = 0;

  for (const [chave, aval] of avaliacoesPorChave.entries()) {
    if (aval.estado === "vivo") {
      contVivo++;
      // Canal vivo NÃO entra no arquivo
      continue;
    }

    if (aval.estado === "removido") {
      contRemovido++;
      canaisSaude[chave] = {
        e: "removido",
        d: aval.d,
        m: sanitizarMotivo(aval.m),
      };
    } else if (aval.estado === "instavel") {
      contInstavel++;
      canaisSaude[chave] = {
        e: "instavel",
        d: aval.d,
        m: sanitizarMotivo(aval.m),
      };
    }
  }

  // Ordena as chaves alfabeticamente
  const chavesOrdenadas = Object.keys(canaisSaude).sort();
  const canaisOrdenados = {};
  for (const k of chavesOrdenadas) {
    canaisOrdenados[k] = canaisSaude[k];
  }

  const saude = {
    v: 1,
    gerado: agora,
    ...(listaId ? { lista: listaId } : {}),
    canais: canaisOrdenados,
  };

  const resumo = {
    total: totalCanais,
    sondados: totalSondados,
    porEstado: {
      removido: contRemovido,
      instavel: contInstavel,
      vivo: contVivo,
    },
    servidoresRemovidos: servidoresRemovidosCount,
    bloqueado: false,
  };

  return { saude, resumo };
}

/**
 * Lê argumentos de linha de comando.
 */
function parseArgs(argv) {
  const opcoes = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env-var" && i + 1 < argv.length) {
      opcoes.envVar = argv[++i];
    } else if (arg === "--env-file" && i + 1 < argv.length) {
      opcoes.envFile = argv[++i];
    } else if (arg === "--chave" && i + 1 < argv.length) {
      opcoes.chave = argv[++i];
    } else if (arg === "--anterior" && i + 1 < argv.length) {
      opcoes.anterior = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      opcoes.out = argv[++i];
    } else if (arg === "--config" && i + 1 < argv.length) {
      opcoes.config = argv[++i];
    } else if (arg === "--agora" && i + 1 < argv.length) {
      opcoes.agora = parseInt(argv[++i], 10);
    }
  }
  return opcoes;
}

/**
 * Ponto de entrada CLI.
 */
export async function executarCli(argv) {
  const opcoes = parseArgs(argv);

  if (!opcoes.out) {
    console.error("Erro de uso: o parâmetro --out é obrigatório.");
    process.exitCode = 1;
    return;
  }

  const dirOut = path.dirname(path.resolve(opcoes.out));
  if (!fs.existsSync(dirOut)) {
    console.error("Erro: diretório de saída não existe.");
    process.exitCode = 1;
    return;
  }

  let urlLista = "";
  if (opcoes.envVar) {
    urlLista = (process.env[opcoes.envVar] || "").trim();
    if (!urlLista) {
      console.error(
        `Erro: variável de ambiente ${opcoes.envVar} não definida ou vazia.`
      );
      process.exitCode = 1;
      return;
    }
  } else if (opcoes.envFile && opcoes.chave) {
    if (!fs.existsSync(opcoes.envFile)) {
      console.error("Erro: arquivo de ambiente não encontrado.");
      process.exitCode = 1;
      return;
    }
    const textoEnv = fs.readFileSync(opcoes.envFile, "utf8");
    try {
      urlLista = lerChaveEnv(textoEnv, opcoes.chave);
    } catch {
      console.error("Erro ao ler chave de ambiente.");
      process.exitCode = 1;
      return;
    }
  } else {
    console.error(
      "Erro de uso: informe --env-var NOME ou --env-file ARQUIVO --chave NOME."
    );
    process.exitCode = 1;
    return;
  }

  // Carrega configuração
  let config = CONFIG_PADRAO;
  const caminhoConfig =
    opcoes.config ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json");
  if (fs.existsSync(caminhoConfig)) {
    try {
      config = JSON.parse(fs.readFileSync(caminhoConfig, "utf8"));
    } catch {
      console.error("Erro ao carregar arquivo de configuração.");
      process.exitCode = 1;
      return;
    }
  }

  // Carrega arquivo anterior se disponível
  let anterior = null;
  if (opcoes.anterior && fs.existsSync(opcoes.anterior)) {
    try {
      anterior = JSON.parse(fs.readFileSync(opcoes.anterior, "utf8"));
    } catch {
      anterior = null;
    }
  }

  // Baixa lista M3U
  let textoM3u = "";
  const abortCtrl = new AbortController();
  const timerFetch = setTimeout(() => abortCtrl.abort(), 60000);

  try {
    const resposta = await fetch(urlLista, { signal: abortCtrl.signal });
    if (!resposta.ok) {
      console.error("Erro ao baixar lista M3U: status HTTP não esperado.");
      process.exitCode = 1;
      return;
    }
    textoM3u = await resposta.text();
  } catch {
    console.error("Erro ao baixar lista M3U: falha na requisição.");
    process.exitCode = 1;
    return;
  } finally {
    clearTimeout(timerFetch);
  }

  // Validação da lista
  const textoLimpo = textoM3u.trim();
  if (
    textoLimpo.startsWith("<!DOCTYPE") ||
    textoLimpo.toLowerCase().includes("<html")
  ) {
    console.error("Erro: lista M3U inválida ou em formato HTML.");
    process.exitCode = 1;
    return;
  }

  const canais = parseM3u(textoM3u);
  if (canais.length === 0) {
    console.error("Erro: lista M3U sem canais válidos.");
    process.exitCode = 1;
    return;
  }

  if (canais.length < 10) {
    console.error("Execução bloqueada ou lista muito pequena.");
    process.exitCode = 2;
    return;
  }

  const { saude, resumo } = await gerarSaude({
    canais,
    anterior,
    agoraS: opcoes.agora,
    sondarFn: sondar,
    config,
    listaId: saudeListaId(urlLista),
  });

  if (!saude || resumo.bloqueado) {
    console.error("Execução bloqueada ou lista muito pequena.");
    process.exitCode = 2;
    return;
  }

  // Escrita atômica com indentação de 1 espaço
  const tmpOut = `${opcoes.out}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmpOut, JSON.stringify(saude, null, 1) + "\n", "utf8");
  fs.renameSync(tmpOut, opcoes.out);

  // Imprime resumo em uma linha (somente números e contagens)
  console.log(JSON.stringify(resumo));
  process.exitCode = 0;
}

// Execução direta como script
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  executarCli(process.argv.slice(2)).catch(() => {
    console.error("Erro fatal durante a execução.");
    process.exitCode = 1;
  });
}
