# Monitor de canais de esporte: desenho

Data: 2026-11-02. Pedido do Gustavo: descobrir quais canais de esporte (ESPN HD, Premiere, SporTV e os demais da categoria) não funcionam e deveriam, e quais caem demais, e sair com um plano de ação por canal.

## Decisões
- **Resultado:** relatório com ações (levar ao provedor, trocar por canal irmão, remover da lista). Não altera o app.
- **Janela:** 1 a 2 horas por rodada de monitoramento (não dias).
- **Duas rodadas:** uma de linha de base (agora) e uma no horário dos jogos, porque canais como Premiere 2/4/6/7 só entram no ar em dia de jogo e parecem mortos fora dele.
- **Fonte:** a lista de canais da conta (`OTT_CONTA_CANAIS`, 1.339 canais), grupos ESPN, SPORTV, PREMIERE CLUBE, COMBATE, ESPORTES, NBA, XSPORTS, SPORTYNET, Paramount+ (UFC) e os 4K de esporte.

## Ferramenta (`scripts/monitor-canais/`)
- `sondar`: lê só os primeiros segundos de cada canal (8 s; 15 s para ESPN, Premiere e SporTV) e mede status HTTP, saltos, host final, tempo até o primeiro byte, bitrate, paradas (intervalo maior ou igual a 2 s entre pedaços) e tipo (TS, HLS, HTML, vazio).
- `classificar`: `vivo`, `instavel`, `morto` ou `limitado` (HTTP 429 não conta como queda).
- `monitorar`: rodadas a cada 6 min, em JSONL por grupo, sem nunca gravar link, usuário ou senha.
- `resumir`: por canal (vivo %, quedas, kbps, veredito) e por família (ESPN FHD/HD/SD/4K), apontando o melhor irmão.
- Limite do provedor: no máximo 4 conexões simultâneas por processo; vários processos (um por grupo) rodam em paralelo com 2 conexões cada.

## Papéis
- Gemini (via `omp`) constrói a ferramenta; Claude revisa; Haiku commita.
- Quatro monitores em paralelo (ESPN, SporTV+Combate+ESPORTES, Premiere, NBA+XSports+SportyNet+Paramount+4K).
- Subagentes Haiku registram o resultado de cada grupo em um arquivo legível.
- Subagente Opus cruza os dados com os jogos do dia (`jogos.json`) e escreve o plano de ação por canal.

## Fora do escopo
Fallback automático no app para o canal irmão (proposto como próximo passo, depende do relatório); monitor contínuo no GitHub Actions (o IP do GitHub pode ser bloqueado pelo provedor).

## Atualização (2026-11-02, depois do primeiro teste real)
- **Fonte real:** a linha da conta (`OTT_CONTA_CANAIS`) não é aceita daqui (painel responde `auth:0`; todos os canais devolvem um vídeo de aviso de 2,6 KB ou HTTP 500). Quem tem os canais citados (ESPN HD, Premiere 1-8, SporTV 1-3...) é a **lista padrão** (`OTT_LISTA_CANAIS`, grupo "Esportes" com 40 canais mais Band Sports, FIFA+, SportyNet e Fórmula 1), e ela é medível daqui.
- **HLS de verdade:** a sonda baixa os últimos trechos (até 3) e mede bitrate, velocidade (`x`), paradas e playlist parada, em vez de só ler o manifesto. `--incluir` divide os canais por nome entre monitores paralelos.
- **Teto por sondagem:** `executarRodada` limita cada sondagem a `leitura + 45 s` (resultado `travou`), porque uma conexão presa parava a rodada inteira.
- **Medição no navegador:** `diagnostico-navegador.js` toca os canais um a um no player do próprio app (o que o usuário vê, com a recuperação do app) e grava o mesmo JSONL. Pode ser colado no Console do app logado, ou rodado por CDP.
