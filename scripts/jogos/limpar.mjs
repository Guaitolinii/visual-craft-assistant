// Funções de limpeza e saneamento para dados de fontes externas (ESPN, ge, guia)

export function limparTexto(valor, max = 80) {
  if (valor == null) return "";
  const s = String(valor)
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, max);
}

export function urlSegura(valor) {
  if (typeof valor !== "string") return "";
  const s = valor.trim();
  if (s.length > 300) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  return "";
}
