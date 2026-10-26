import { epochDeBrt } from "./tempo.mjs";

// Endereço da agenda do ge (a página embute os dados em window.dataSportsSchedule)
export const URL_AGENDA_GE = "https://ge.globo.com/agenda/";

// Lê um objeto JSON a partir da "{" na posição `ini`, respeitando strings e barras de escape
function lerObjetoJson(s, ini) {
  let profundidade = 0;
  let emTexto = false;
  let escape = false;
  for (let p = ini; p < s.length; p++) {
    const ch = s[p];
    if (emTexto) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') emTexto = false;
      continue;
    }
    if (ch === '"') emTexto = true;
    else if (ch === "{") profundidade++;
    else if (ch === "}") {
      profundidade--;
      if (profundidade === 0) return s.slice(ini, p + 1);
    }
  }
  throw new Error("agenda do ge: JSON incompleto");
}

// HTML da página -> objeto { "AAAA-MM-DD": { championshipsAgenda: [...] } }
export function extrairAgendaGe(html) {
  const i = html.indexOf("window.dataSportsSchedule");
  if (i < 0) throw new Error("agenda do ge: bloco window.dataSportsSchedule não encontrado");
  const k = html.indexOf("sport:", i);
  if (k < 0) throw new Error("agenda do ge: campo sport não encontrado");
  const abre = html.indexOf("{", k);
  if (abre < 0) throw new Error("agenda do ge: campo sport sem objeto");
  return JSON.parse(lerObjetoJson(html, abre));
}

// Agenda -> jogos de futebol no formato interno. As marcas (SporTV, Premiere...) viram canais prováveis pela tabela `marcas`.
export function jogosDoGe(agenda, regras) {
  const saida = [];
  const vistos = new Set();
  const dur = (regras.duracaoHoras.futebol || 2) * 3600;
  for (const dia of Object.keys(agenda || {})) {
    const agendaDia = agenda[dia];
    const campeonatos = agendaDia && Array.isArray(agendaDia.championshipsAgenda) ? agendaDia.championshipsAgenda : [];
    for (const camp of campeonatos) {
      const nomeCamp = String((camp.championship && camp.championship.name) || "");
      for (const balde of ["past", "now", "future"]) {
        for (const ev of Array.isArray(camp[balde]) ? camp[balde] : []) {
          const m = ev && ev.match;
          if (!m || !m.firstContestant || !m.secondContestant) continue;
          const inicio = epochDeBrt(m.startDate || dia, m.startHour || "00:00:00");
          const casaNome = m.firstContestant.popularName || m.firstContestant.name;
          const foraNome = m.secondContestant.popularName || m.secondContestant.name;
          if (!isFinite(inicio) || !casaNome || !foraNome) continue;
          const id = String(m.id);
          if (vistos.has(id)) continue;
          vistos.add(id);
          const provaveis = [];
          for (const fonte of Array.isArray(m.liveWatchSources) ? m.liveWatchSources : []) {
            const canais = regras.marcas[String(fonte.name || "").toLowerCase()] || [];
            canais.forEach((c) => { if (!provaveis.includes(c)) provaveis.push(c); });
          }
          saida.push({
            fonte: "ge",
            idFonte: id,
            esporte: "futebol",
            competicao: nomeCamp,
            casa: { nome: String(casaNome), escudo: String(m.firstContestant.badgePng || "") },
            fora: { nome: String(foraNome), escudo: String(m.secondContestant.badgePng || "") },
            inicio,
            fim: inicio + dur,
            canais: [],
            provaveis,
          });
        }
      }
    }
  }
  return saida;
}
