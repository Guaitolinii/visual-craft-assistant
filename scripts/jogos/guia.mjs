// Jogos a partir do guia de TV (epg-extra.json): { canais: { nome: [[inicio, fim, titulo, descricao], ...] } }
const REPRISE = /^\s*(vt|reprise|compacto|melhores momentos|p[oó]s[- ]jogo|pr[eé][- ]jogo)\b/i;
const CONFRONTO = /^(.*?)\s+(?:x|vs\.?|versus)\s+(.*)$/i;

const ROTULO_ESPORTE = {
  volei: "Vôlei",
  basquete: "Basquete",
  futsal: "Futsal",
  lutas: "Lutas",
};

// Esporte e nome da competição a partir do prefixo do título ("NFL", "Liga Evolución de Futsal"...)
// ou do texto completo (título + descrição) quando não há prefixo.
function classificar(prefixo, regras, textoSemPrefixo) {
  if (prefixo) {
    for (const r of regras.esportePorPalavra) {
      if (new RegExp(r.padrao, "i").test(prefixo)) return { esporte: r.esporte, competicao: r.competicao || prefixo };
    }
    return { esporte: "outros", competicao: prefixo };
  }

  const texto = textoSemPrefixo || "";
  for (const r of regras.esportePorPalavra) {
    if (r.generica) continue;
    if (new RegExp(r.padrao, "i").test(texto)) {
      const competicao = r.competicao || ROTULO_ESPORTE[r.esporte] || "Outros";
      return { esporte: r.esporte, competicao };
    }
  }
  return { esporte: "futebol", competicao: "Futebol" };
}

// Título de programa -> { esporte, competicao, casa, fora } ou null se não for um jogo ao vivo
export function interpretarTitulo(titulo, regras, descricao) {
  let t = String(titulo == null ? "" : titulo).trim();
  if (!t || REPRISE.test(t)) return null;
  t = t.replace(/\s*[-–—]\s*ao vivo\s*$/i, "").trim();
  let prefixo = "";
  const m = t.match(/^([^:]{2,60}):\s+(.*)$/);
  if (m) { prefixo = m[1].trim(); t = m[2].trim(); }
  const c = t.match(CONFRONTO);
  if (!c) return null;
  const casa = c[1].trim();
  const fora = c[2].trim();
  if (!casa || !fora) return null;
  const textoSemPrefixo = `${titulo} ${descricao || ""}`;
  const { esporte, competicao } = classificar(prefixo, regras, textoSemPrefixo);
  return { esporte, competicao, casa, fora };
}

// Todos os jogos do guia, um por programa (o mesmo jogo em dois canais vira dois itens; a mescla junta depois)
export function jogosDoGuia(epg, regras) {
  const canais = epg && epg.canais && typeof epg.canais === "object" ? epg.canais : {};
  const regexCanais = Array.isArray(regras && regras.canaisEsporte)
    ? regras.canaisEsporte.map((c) => new RegExp(c, "i"))
    : [];
  const saida = [];
  for (const canal of Object.keys(canais)) {
    if (!regexCanais.some((rx) => rx.test(canal))) continue;
    const programas = Array.isArray(canais[canal]) ? canais[canal] : [];
    for (const p of programas) {
      if (!Array.isArray(p)) continue;
      const j = interpretarTitulo(p[2], regras, p[3]);
      if (!j || !isFinite(p[0]) || !isFinite(p[1])) continue;
      saida.push({
        fonte: "guia",
        idFonte: "",
        esporte: j.esporte,
        competicao: j.competicao,
        casa: { nome: j.casa, escudo: "" },
        fora: { nome: j.fora, escudo: "" },
        inicio: p[0],
        fim: p[1],
        canais: [canal],
        provaveis: [],
      });
    }
  }
  return saida;
}
