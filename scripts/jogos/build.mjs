// Gera o jogos.json da aba "Jogos". Uso:
//   node scripts/jogos/build.mjs --epg epg-extra.json --out jogos.json
// Junta ESPN (futebol, NFL, College Football, NBA, NHL), a agenda do ge e o guia de TV (epg-extra.json).
// FALHA SEGURA: se nenhuma fonte produzir jogos, sai com erro SEM gravar o arquivo (o arquivo bom anterior continua valendo).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { carregarRegras } from "./regras.mjs";
import { janelaDias, somarDias } from "./tempo.mjs";
import { buscarEspn } from "./espn.mjs";
import { extrairAgendaGe, jogosDoGe, URL_AGENDA_GE } from "./ge.mjs";
import { jogosDoGuia } from "./guia.mjs";
import { mesclarJogos } from "./mesclar.mjs";

const USER_AGENT = "SintonizaJogos/1.0 (+https://github.com/Guaitolinii/visual-craft-assistant)";

// fetch com tempo limite de 15 s e identificação honesta
export function fetchPadrao(url) {
  return fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" } });
}

// Produz { arquivo, resumo }. Lança se nenhuma fonte trouxe jogo.
export async function gerarJogos({ agoraSec, regras, aliases, epg, fetchFn, avisar }) {
  const janela = janelaDias(agoraSec, 3);
  // A ESPN agrupa os jogos pela data dos EUA: consulta-se também a véspera
  const diasEspn = [somarDias(janela.dias[0], -1), ...janela.dias];
  const resumo = { espn: { jogos: 0, falhas: 0 }, ge: { jogos: 0 }, guia: { jogos: 0 } };

  let espn = [];
  if (regras.fontes.espn) {
    const r = await buscarEspn({ competicoes: regras.competicoes, dias: diasEspn, fetchFn, duracaoHoras: regras.duracaoHoras, avisar });
    espn = r.jogos;
    resumo.espn = { jogos: espn.length, falhas: r.falhas };
  }

  let ge = [];
  if (regras.fontes.ge) {
    try {
      const r = await fetchFn(URL_AGENDA_GE);
      if (!r.ok) throw new Error("HTTP " + r.status);
      ge = jogosDoGe(extrairAgendaGe(await r.text()), regras);
    } catch (e) {
      avisar(`agenda do ge indisponível, seguindo sem ela: ${e.message}`);
    }
    resumo.ge = { jogos: ge.length };
  }

  let guia = [];
  if (regras.fontes.guia && epg) {
    guia = jogosDoGuia(epg, regras);
    resumo.guia = { jogos: guia.length };
  }

  if (!espn.length && !ge.length && !guia.length) throw new Error("nenhuma fonte produziu jogos");

  const jogos = mesclarJogos({ espn, ge, guia, aliases, janela });
  if (!jogos.length) throw new Error("nenhuma fonte produziu jogos dentro da janela");
  return { arquivo: { v: 1, gerado: agoraSec, fuso: "America/Sao_Paulo", jogos }, resumo };
}

function argumento(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : "";
}

// Linha de comando. Devolve o código de saída (0 = gravou; 1 = falhou e NÃO gravou).
export async function main(argv, deps = {}) {
  const log = deps.log || ((m) => console.log(m));
  const fetchFn = deps.fetchFn || fetchPadrao;
  const agoraSec = deps.agoraSec || Math.floor(Date.now() / 1000);
  const saida = argumento(argv, "--out") || "jogos.json";
  const epgPath = argumento(argv, "--epg");
  try {
    const regras = carregarRegras();
    const aliases = JSON.parse(readFileSync(new URL("./aliases-times.json", import.meta.url), "utf8"));
    let epg = null;
    if (epgPath) {
      try { epg = JSON.parse(readFileSync(epgPath, "utf8")); } catch (e) { log(`[jogos] guia de TV indisponível (${e.message}); seguindo sem ele`); }
    }
    const { arquivo, resumo } = await gerarJogos({ agoraSec, regras, aliases, epg, fetchFn, avisar: (m) => log(`[jogos] aviso: ${m}`) });
    writeFileSync(saida, JSON.stringify(arquivo));
    const porEsporte = {};
    arquivo.jogos.forEach((j) => { porEsporte[j.esporte] = (porEsporte[j.esporte] || 0) + 1; });
    log(`[jogos] ${arquivo.jogos.length} jogos gravados em ${saida} | ESPN ${resumo.espn.jogos} (${resumo.espn.falhas} consultas falharam), ge ${resumo.ge.jogos}, guia ${resumo.guia.jogos} | ${JSON.stringify(porEsporte)}`);
    return 0;
  } catch (e) {
    log(`[jogos] ERRO: ${e.message}; nada foi gravado`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((codigo) => process.exit(codigo));
}
