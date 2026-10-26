import { aaaammdd } from "./tempo.mjs";
import { limparTexto, urlSegura } from "./limpar.mjs";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/";

// Endereço do placar de uma competição em um dia (a ESPN aceita UMA data por consulta, no formato AAAAMMDD)
export function urlEspn(competicao, diaStr) {
  const extra = competicao.consulta ? "&" + competicao.consulta : "";
  return `${BASE}${competicao.espn}/scoreboard?dates=${aaaammdd(diaStr)}${extra}`;
}

// Resposta da ESPN -> lista de jogos no formato interno (canais vazios; prováveis = os da competição)
export function parseEspn(json, competicao, duracaoHoras) {
  const eventos = json && Array.isArray(json.events) ? json.events : [];
  const durSec = (duracaoHoras[competicao.esporte] || duracaoHoras.outros || 2.5) * 3600;
  const jogos = [];
  for (const e of eventos) {
    if (!e || typeof e !== "object") continue;
    const comp = Array.isArray(e.competitions) ? e.competitions[0] : null;
    const lados = comp && Array.isArray(comp.competitors) ? comp.competitors.filter((l) => l && typeof l === "object") : [];
    const inicio = Math.floor(Date.parse(e && e.date) / 1000);
    if (!e.id || !isFinite(inicio) || lados.length < 2) continue;
    const casaRaw = lados.find((l) => l.homeAway === "home") || lados[0];
    const foraRaw = lados.find((l) => l.homeAway === "away") || lados[1];
    const lado = (l) => ({
      nome: limparTexto((l.team && (l.team.displayName || l.team.shortDisplayName)) || ""),
      escudo: urlSegura(String((l.team && l.team.logo) || "")),
    });
    const casa = lado(casaRaw);
    const fora = lado(foraRaw);
    if (!casa.nome || !fora.nome) continue;
    jogos.push({
      fonte: "espn",
      idFonte: String(e.id),
      esporte: competicao.esporte,
      competicao: limparTexto(competicao.nome),
      casa,
      fora,
      inicio,
      fim: inicio + durSec,
      canais: [],
      provaveis: competicao.provaveis.slice(),
    });
  }
  return jogos;
}

// Consulta todas as competições em todos os dias (4 em paralelo). Falha de uma consulta não derruba as outras.
// fetchFn(url) devolve algo como a Response do fetch ({ ok, status, json() }).
export async function buscarEspn({ competicoes, dias, fetchFn, duracaoHoras, avisar }) {
  const tarefas = [];
  competicoes.forEach((c) => dias.forEach((d) => tarefas.push({ c, d })));
  const porId = new Map();
  let ok = 0;
  let falhas = 0;
  let proximo = 0;
  async function trabalhador() {
    while (proximo < tarefas.length) {
      const t = tarefas[proximo++];
      try {
        const r = await fetchFn(urlEspn(t.c, t.d));
        if (!r.ok) throw new Error("HTTP " + r.status);
        const json = await r.json();
        parseEspn(json, t.c, duracaoHoras).forEach((j) => { if (!porId.has(j.idFonte)) porId.set(j.idFonte, j); });
        ok++;
      } catch (e) {
        falhas++;
        avisar(`ESPN ${t.c.id} ${t.d}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador));
  return { jogos: [...porId.values()], ok, falhas };
}
