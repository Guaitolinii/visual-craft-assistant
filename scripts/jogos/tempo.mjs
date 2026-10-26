// Horário de Brasília: UTC-3 fixo (o Brasil não tem horário de verão desde 2019).
// Todas as funções trabalham com epoch em SEGUNDOS e datas "AAAA-MM-DD".
export const BRT_OFFSET_SEC = -3 * 3600;

// Dia (AAAA-MM-DD) em Brasília de um instante
export function diaBrt(epochSec) {
  return new Date((epochSec + BRT_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

// Epoch da meia-noite de Brasília de um dia
export function inicioDoDiaBrt(diaStr) {
  return Date.parse(diaStr + "T00:00:00Z") / 1000 - BRT_OFFSET_SEC;
}

// Soma (ou subtrai) dias a uma data AAAA-MM-DD
export function somarDias(diaStr, n) {
  return new Date(Date.parse(diaStr + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

// Janela de `qtd` dias começando hoje (em Brasília): lista de dias e [inicio, fim) em epoch
export function janelaDias(nowSec, qtd = 3) {
  const hoje = diaBrt(nowSec);
  const dias = [];
  for (let i = 0; i < qtd; i++) dias.push(somarDias(hoje, i));
  return { dias, inicio: inicioDoDiaBrt(dias[0]), fim: inicioDoDiaBrt(somarDias(hoje, qtd)) };
}

// Data e hora de Brasília ("2026-10-26", "19:30:00" ou "19:30") para epoch
export function epochDeBrt(dataStr, horaStr) {
  const hora = /^\d{2}:\d{2}$/.test(horaStr) ? horaStr + ":00" : horaStr;
  return Date.parse(`${dataStr}T${hora}-03:00`) / 1000;
}

// "2026-10-25" -> "20261025" (formato do parâmetro dates da ESPN)
export function aaaammdd(diaStr) {
  return diaStr.replace(/-/g, "");
}
