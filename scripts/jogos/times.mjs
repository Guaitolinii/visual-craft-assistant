// Comparação de nomes de times entre fontes (ESPN em inglês/Espanhol, ge e guia em português).
const PALAVRAS_VAZIAS = new Set([
  "fc", "ec", "sc", "cf", "ac", "afc", "cd", "fk", "sv", "ssc",
  "club", "clube", "de", "do", "da", "dos", "das", "the", "football", "futebol",
]);

// Nome -> forma comparável. `aliases` mapeia nome normalizado -> nome canônico normalizado.
export function normalizarTime(nome, aliases = {}) {
  let t = String(nome == null ? "" : nome)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!t) return "";
  if (Object.prototype.hasOwnProperty.call(aliases, t)) t = aliases[t];
  const resto = t.split(" ").filter((p) => p && !PALAVRAS_VAZIAS.has(p)).join(" ");
  return resto || t;
}

// Mesmo time: nomes iguais depois de normalizar, ou o mais curto contido (palavra por palavra) no mais longo
export function mesmoTime(a, b, aliases = {}) {
  const na = normalizarTime(a, aliases);
  const nb = normalizarTime(b, aliases);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  const curto = ta.length <= tb.length ? ta : tb;
  const longo = ta.length <= tb.length ? tb : ta;
  return curto.join("").length >= 4 && curto.every((p) => longo.includes(p));
}

// Mesmo jogo: os dois times (mesmo trocados de lado) e início com diferença de até `toleranciaSec`
export function mesmoJogo(a, b, aliases = {}, toleranciaSec = 45 * 60) {
  if (!a || !b || !a.casa || !a.fora || !b.casa || !b.fora) return false;
  if (Math.abs(a.inicio - b.inicio) > toleranciaSec) return false;
  const direto = mesmoTime(a.casa.nome, b.casa.nome, aliases) && mesmoTime(a.fora.nome, b.fora.nome, aliases);
  const trocado = mesmoTime(a.casa.nome, b.fora.nome, aliases) && mesmoTime(a.fora.nome, b.casa.nome, aliases);
  return direto || trocado;
}
