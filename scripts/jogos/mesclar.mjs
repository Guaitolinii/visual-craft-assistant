import { pontuarJogo, normalizarTime } from "./times.mjs";

const TOLERANCIA_SEC = 45 * 60;

// Hash curto e estável (FNV-1a de 32 bits) para o id dos jogos que só o guia conhece
function hash(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Id do jogo: ESPN e ge usam o id da fonte; o guia usa os times (em ordem alfabética, então a ordem casa/fora não importa) e o início
export function idDoJogo(j, aliases) {
  if (j.fonte === "espn") return `espn-${j.idFonte}`;
  if (j.fonte === "ge") return `ge-${j.idFonte}`;
  const times = [normalizarTime(j.casa.nome, aliases), normalizarTime(j.fora.nome, aliases)].sort();
  return `guia-${hash(`${times[0]}|${times[1]}|${j.inicio}`)}`;
}

// Junta as fontes. A ESPN é a base; o ge acrescenta as marcas de transmissão (e os jogos que a ESPN não tem);
// o guia confirma o canal (e traz os jogos que só ele conhece). Depois filtra pela janela e ordena.
export function mesclarJogos({ espn, ge, guia, aliases, janela }) {
  const base = espn.map((j) => ({ ...j, canais: j.canais.slice(), provaveis: j.provaveis.slice() }));
  const acha = (j) => {
    let melhor = null;
    let melhorPts = 0;
    let menorDiff = Infinity;
    for (const x of base) {
      const pts = pontuarJogo(x, j, aliases, TOLERANCIA_SEC);
      if (pts === 0) continue;
      const diff = Math.abs(x.inicio - j.inicio);
      if (pts > melhorPts || (pts === melhorPts && diff < menorDiff)) {
        melhor = x;
        melhorPts = pts;
        menorDiff = diff;
      }
    }
    return melhor;
  };
  for (const g of ge) {
    const alvo = acha(g);
    if (alvo) {
      if (g.provaveis.length) alvo.provaveis = g.provaveis.slice();
    } else {
      base.push({ ...g, canais: [], provaveis: g.provaveis.slice() });
    }
  }
  for (const gu of guia) {
    const alvo = acha(gu);
    if (alvo) {
      gu.canais.forEach((c) => { if (!alvo.canais.includes(c)) alvo.canais.push(c); });
    } else {
      base.push({ ...gu, canais: gu.canais.slice(), provaveis: [] });
    }
  }

  return base
    .filter((j) => j.inicio < janela.fim && j.fim > janela.inicio)
    .map((j) => ({
      id: idDoJogo(j, aliases),
      esporte: j.esporte,
      competicao: j.competicao,
      casa: j.casa,
      fora: j.fora,
      inicio: j.inicio,
      fim: j.fim,
      canais: j.canais,
      provaveis: j.canais.length ? [] : j.provaveis,
    }))
    .sort((a, b) => a.inicio - b.inicio || a.id.localeCompare(b.id));
}
