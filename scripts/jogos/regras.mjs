import { readFileSync } from "node:fs";

export const ESPORTES = ["futebol", "nfl", "ncaaf", "nba", "nhl", "volei", "futsal", "basquete", "lutas", "outros"];

// Lê regras.json (ao lado deste arquivo, ou de `caminho`) e valida
export function carregarRegras(caminho) {
  const url = caminho || new URL("./regras.json", import.meta.url);
  const regras = JSON.parse(readFileSync(url, "utf8"));
  validarRegras(regras);
  return regras;
}

// Erro claro para regra quebrada: o gerador falha em vez de publicar lixo
export function validarRegras(r) {
  if (!r || typeof r !== "object") throw new Error("regras: arquivo inválido");
  if (!r.fontes || ["espn", "ge", "guia"].some((k) => typeof r.fontes[k] !== "boolean")) {
    throw new Error("regras: fontes precisa de espn, ge e guia booleanos");
  }
  if (!Array.isArray(r.canaisEsporte) || !r.canaisEsporte.length) {
    throw new Error("regras: canaisEsporte precisa ser lista não vazia de regex");
  }
  for (const c of r.canaisEsporte) {
    try {
      new RegExp(c, "i");
    } catch {
      throw new Error(`regras: canaisEsporte padrão inválido (${c})`);
    }
  }
  if (!r.duracaoHoras || ESPORTES.some((e) => !(r.duracaoHoras[e] > 0))) {
    throw new Error("regras: duracaoHoras precisa de um número positivo por esporte");
  }
  if (!Array.isArray(r.competicoes) || !r.competicoes.length) throw new Error("regras: competicoes vazia");
  const ids = new Set();
  for (const c of r.competicoes) {
    if (!c.id || ids.has(c.id)) throw new Error(`regras: id de competição repetido ou vazio (${c.id})`);
    ids.add(c.id);
    if (!ESPORTES.includes(c.esporte)) throw new Error(`regras: ${c.id} com esporte inválido (${c.esporte})`);
    if (!/^[a-z-]+\/[a-z0-9._-]+$/.test(String(c.espn))) throw new Error(`regras: ${c.id} com caminho da ESPN inválido`);
    if (!c.nome || !Array.isArray(c.provaveis) || !c.provaveis.length) throw new Error(`regras: ${c.id} sem nome ou sem canais prováveis`);
  }
  if (!r.marcas || typeof r.marcas !== "object" || Object.values(r.marcas).some((v) => !Array.isArray(v))) {
    throw new Error("regras: marcas precisa mapear nome para lista de canais");
  }
  if (!Array.isArray(r.esportePorPalavra)) throw new Error("regras: esportePorPalavra precisa ser lista");
  for (const p of r.esportePorPalavra) {
    new RegExp(p.padrao, "i"); // lança se não compilar
    if (!ESPORTES.includes(p.esporte)) throw new Error(`regras: esportePorPalavra com esporte inválido (${p.esporte})`);
  }
}
