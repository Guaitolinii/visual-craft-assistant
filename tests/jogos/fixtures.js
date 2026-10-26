// Amostras reduzidas dos formatos reais (capturadas em 2026-10-25) para os testes do gerador.

// ESPN: LaLiga (futebol). Horário em UTC.
export const ESPN_LALIGA = {
  leagues: [{ name: "Spanish LALIGA" }],
  events: [
    {
      id: "401882828",
      date: "2026-10-26T20:00Z",
      name: "Osasuna at Sevilla",
      competitions: [{
        competitors: [
          { homeAway: "home", team: { displayName: "Sevilla", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/243.png" } },
          { homeAway: "away", team: { displayName: "Osasuna", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/97.png" } },
        ],
      }],
    },
  ],
};

// ESPN: NFL. "DAL @ PHI" às 00:15Z de 27/10 = 21h15 de 26/10 em Brasília.
export const ESPN_NFL = {
  leagues: [{ name: "National Football League" }],
  events: [
    {
      id: "401873009",
      date: "2026-10-27T00:15Z",
      name: "Dallas Cowboys at Philadelphia Eagles",
      competitions: [{
        competitors: [
          { homeAway: "home", team: { displayName: "Philadelphia Eagles", logo: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/phi.png" } },
          { homeAway: "away", team: { displayName: "Dallas Cowboys", logo: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/dal.png" } },
        ],
      }],
    },
  ],
};

// ESPN: Brasileirão Série A (jogo de 26/10 às 19h30 em Brasília = 22:30Z)
export const ESPN_BRA1 = {
  leagues: [{ name: "Brazilian Serie A" }],
  events: [
    {
      id: "700001",
      date: "2026-10-26T22:30Z",
      name: "Grêmio at Coritiba",
      competitions: [{
        competitors: [
          { homeAway: "home", team: { displayName: "Coritiba", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/3456.png" } },
          { homeAway: "away", team: { displayName: "Grêmio", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/6273.png" } },
        ],
      }],
    },
  ],
};

// Guia de TV (epg-extra.json): { canais: { nome: [[inicio, fim, titulo, descricao], ...] } }, epoch em segundos.
const t = (iso) => Date.parse(iso) / 1000;
export const EPG_AMOSTRA = {
  v: 1,
  gerado: t("2026-10-25T20:50:00Z"),
  canais: {
    espn: [
      [t("2026-10-26T20:05:00Z"), t("2026-10-26T22:00:00Z"), "Osasuna x Sevilla - Ao Vivo", "LaLiga"],
      [t("2026-10-26T15:00:00Z"), t("2026-10-26T17:00:00Z"), "VT - Independiente x Boca Juniors", "reprise"],
      [t("2026-10-26T12:00:00Z"), t("2026-10-26T13:00:00Z"), "Sportscenter Abre o Jogo - Ao Vivo", "estúdio"],
    ],
    "espn 2": [
      [t("2026-10-27T00:15:00Z"), t("2026-10-27T03:30:00Z"), "NFL: Dallas Cowboys x Philadelphia Eagles - Ao Vivo", "NFL"],
      [t("2026-10-26T17:00:00Z"), t("2026-10-26T19:00:00Z"), "VT - NFL: Los Angeles Rams x Las Vegas Raiders", "reprise"],
    ],
    "espn 3": [
      [t("2026-10-27T00:15:00Z"), t("2026-10-27T03:30:00Z"), "NFL: Dallas Cowboys x Philadelphia Eagles - Ao Vivo", "NFL"],
      [t("2026-10-26T23:30:00Z"), t("2026-10-27T02:00:00Z"), "NBA: San Antonio Spurs x Dallas Mavericks - Ao Vivo", "NBA"],
    ],
    "espn 6": [
      [t("2026-10-26T19:00:00Z"), t("2026-10-26T23:00:00Z"), "Futebol Americano Universitário: Houston x Utah - Ao Vivo", "college"],
    ],
    "band sports": [
      [t("2026-10-26T20:00:00Z"), t("2026-10-26T22:00:00Z"), "Liga Evolución de Futsal: Brasil x Venezuela", "futsal"],
      [t("2026-10-26T12:00:00Z"), t("2026-10-26T14:00:00Z"), "Paulista de Basquete: Franca x Mogi", "basquete"],
    ],
    "premiere 3": [
      [t("2026-10-26T10:00:00Z"), t("2026-10-27T10:00:00Z"), "Com o PREMIERE dá jogo!", "chamada"],
    ],
  },
};

// Agenda do ge (página HTML com o JSON embutido). Note o "}" dentro de uma string: o leitor precisa respeitar strings.
export const GE_HTML = `<html><head><script>
  window.feedData = {"title":"Agenda"};
  window.dataSportsSchedule = {
    sport: {"2026-10-26":{"championshipsAgenda":[{"championship":{"name":"Campeonato Brasileiro","note":"texto com } chave"},"future":[{"__typename":"SoccerEvent","match":{"id":346999,"startDate":"2026-10-26","startHour":"19:30:00","firstContestant":{"popularName":"Coritiba","badgePng":"https:\\/\\/s.sde.globo.com\\/media\\/cfc.png"},"secondContestant":{"popularName":"Grêmio","badgePng":"https:\\/\\/s.sde.globo.com\\/media\\/gre.png"},"liveWatchSources":[{"name":"Premiere"},{"name":"Cartola"}]}}],"now":[],"past":[]},{"championship":{"name":"Campeonato Brasileiro Série B"},"future":[{"__typename":"SoccerEvent","match":{"id":347001,"startDate":"2026-10-26","startHour":"21:30:00","firstContestant":{"popularName":"Remo","badgePng":""},"secondContestant":{"popularName":"Paysandu","badgePng":""},"liveWatchSources":[{"name":"sportv"},{"name":"Disney+"}]}}],"now":[],"past":[]}]}}
  };
</script></head><body></body></html>`;
