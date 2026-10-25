# Aba "Jogos" (jogos de hoje e de amanhã com abertura direta no canal) — Design

Data: 2026-10-25. Autor do pedido: Gustavo. Escopo: web, celular (Android/iOS, mesmo `sintoniza-link.html`) e TV LG (Novo-App-de-TV).

## 1. Objetivo

Uma aba especial **Jogos** com todos os jogos do momento, de hoje e de amanhã (horário de Brasília). Cada jogo é um card; ao tocar, o player abre no canal que transmite. A lista de jogos é gerada de forma automática no GitHub, sem trabalho manual diário.

## 2. Decisões do Gustavo

| Decisão | Origem |
|---|---|
| Futebol primeiro; os outros esportes em seções abaixo | resposta de 2026-10-25 |
| Jogo sem canal confirmado aparece mesmo assim, com os canais prováveis do campeonato | resposta de 2026-10-25 |
| Item próprio "Jogos" no menu (lateral na web, barra inferior no celular, menu da TV) | resposta de 2026-10-25 |
| A TV entra no escopo desta versão | pedido de 2026-10-25 |
| Tudo automatizado no GitHub | pedido de 2026-10-25 |
| Fonte dos jogos: tabela da ESPN + guia de TV + regras por campeonato (abordagem B) | desenho aprovado em 2026-10-25 |

## 3. Levantamento feito em 2026-10-25 (base das decisões)

- **Lista da conta (xjet), 138 candidatos a canal de esporte: 0 transmitem.** O provedor recusa a conta (`player_api` devolve HTTP 401 e `auth: 0`; os canais dão HTTP 500 ou um corpo de 2,6 KB). Não é problema de canal, e vale para canais, filmes e séries dessa lista. Pré-requisito externo: o Gustavo resolver a conta com o provedor. Enquanto isso, na lista dele nenhum jogo abre, por mais correto que esteja o mapeamento.
- **Lista padrão, 48 candidatos: 16 transmitem** (SporTV, SporTV 2, SporTV 3, ESPN HD, Combate, GE TV, Premiere 1, 3, 5 e 8, UFC Fight Pass, NSports, FIFA+, Pluto Esportes, Red Bull TV, ge Fast). Premiere 2, 4, 6 e 7 dão 404: são canais de evento que só ligam em dia de jogo. A disponibilidade varia ao longo do dia.
- **Guia de TV (`epg-extra.json`, já gerado a cada 6 h na branch `vod-data`):** 18 canais de esporte e 88 candidatos a jogo entre hoje e amanhã, no formato `Time A x Time B - Ao Vivo`. Reprises vêm com o prefixo `VT -`. Premiere e Globo **não** trazem nomes de jogos (só "Com o PREMIERE dá jogo!"), então o Brasileirão nesses canais não aparece pelo guia.
- **ESPN (API pública, sem chave):** `site.api.espn.com/apis/site/v2/sports/soccer/<campeonato>/scoreboard?dates=AAAAMMDD` devolve os jogos do dia. O intervalo de datas (`AAAAMMDD-AAAAMMDD`) não funciona: usar uma data por consulta. Não informa o canal brasileiro.
- **TheSportsDB:** a chave gratuita antiga está desativada e a de teste devolve poucos eventos. Não será usada.
- Códigos de campeonato da ESPN verificados (existem e respondem): `bra.1`, `bra.2`, `bra.3`, `bra.copa_do_brazil` (o nome com "brasil" responde vazio), `conmebol.libertadores`, `conmebol.sudamericana`, `uefa.champions`, `uefa.europa`, `uefa.europa.conf`, `eng.1`, `esp.1`, `ita.1`, `ger.1`, `fra.1`, `por.1`, `arg.1`, `usa.1`, `mex.1`, `fifa.world`, `fifa.cwc`, `conmebol.america`, `uefa.nations`, `concacaf.champions`.

## 4. Arquitetura

Um gerador no GitHub produz **um** arquivo, `jogos.json`, que os dois clientes (web/celular e TV) leem e cruzam com a lista de canais da própria conta.

```
GitHub Actions (a cada 3 h)
  ├─ ESPN: jogos de hoje, amanhã e depois de amanhã por campeonato ─┐
  ├─ epg-extra.json (mesma branch): jogos e canais do guia de TV ───┼─> scripts/jogos/build.mjs ─> jogos.json (branch vod-data)
  └─ regras.json + aliases-times.json (campeonato → canais prováveis; nomes de times) ┘
                                                         │
          web/celular (sintoniza-link.html) <────────────┤──────────> TV (Novo-App-de-TV: GamesView)
          cruza com os canais da conta e abre o player   │           cruza com os canais da conta e abre o player
```

### 4.1 Gerador (`scripts/jogos/build.mjs`, repositório do app)

- Roda em Node 20 sem dependências. Funções puras e testáveis: leitura da ESPN, leitura do guia, casamento de times, classificação de esporte, montagem do arquivo.
- **Janela:** hoje, amanhã e depois de amanhã no fuso `America/Sao_Paulo`. O terceiro dia evita ficar sem "amanhã" entre a meia-noite e a próxima execução.
- **ESPN:** uma consulta por campeonato e por dia (23 × 3 = 69 consultas por execução), com tempo limite de 15 s cada. Falha de uma consulta não derruba as outras.
- **Guia de TV:** lê o `epg-extra.json` do próprio checkout da `vod-data`. Um programa é jogo se o título tem `A x B` (ou `vs`) e **não** começa com `VT -`. Prefixos como `NFL:`, `NBA:`, `NHL:` e `Liga Evolución de Futsal:` definem competição e esporte; `A x B` sem prefixo em canal de futebol é futebol. O início e o fim vêm do próprio guia.
- **Casamento ESPN ↔ guia:** nomes de times normalizados (sem acento, minúsculas, sem `fc/ec/sc/cf/ac`, com tabela de apelidos) e horário com diferença de no máximo 45 min. Casou: o canal do guia vira o canal **confirmado** do jogo (pode haver mais de um). Não casou: o jogo da ESPN fica com os **canais prováveis** do campeonato (de `regras.json`); o jogo que só existe no guia entra como está (é o caso de NFL, NBA, NHL e outros esportes).
- **Fim do jogo:** o do guia quando existe; senão início mais a duração do esporte (futebol 2 h, NFL 3,5 h, NBA e NHL 2,5 h, vôlei e futsal 2 h, lutas 4 h, demais 2,5 h).
- **Falha segura:** igual ao guia extra, o passo de geração falha sem gravar nada se ESPN **e** guia falharem; com uma das duas fontes, gera com a outra. O arquivo bom anterior permanece na branch. Nenhum `continue-on-error`.

### 4.2 Formato do arquivo `jogos.json`

```json
{
  "v": 1,
  "gerado": 1792960000,
  "fuso": "America/Sao_Paulo",
  "jogos": [
    {
      "id": "espn-401234567",
      "esporte": "futebol",
      "competicao": "Brasileirão Série A",
      "casa": { "nome": "Flamengo", "escudo": "https://a.espncdn.com/..." },
      "fora": { "nome": "Palmeiras", "escudo": "https://a.espncdn.com/..." },
      "inicio": 1792980000,
      "fim": 1792987200,
      "canais": ["sportv 2"],
      "provaveis": ["premiere 1", "premiere 2", "sportv"]
    }
  ]
}
```

- Horários em segundos desde 1970 (UTC). `casa`/`fora` existem só em jogo de dois lados; evento sem lados (luta, corrida) usa `titulo`.
- `canais`: nomes de canal no mesmo estilo do guia (minúsculos, sem HD/FHD/SD), **confirmados** pelo guia. `provaveis`: só quando `canais` está vazio.
- `esporte` é um de: `futebol`, `nfl`, `nba`, `nhl`, `volei`, `futsal`, `basquete`, `lutas`, `outros`.
- Tamanho esperado: menos de 100 KB.

### 4.3 Workflow `jogos.yml`

- `cron` a cada 3 h mais `workflow_dispatch`, no padrão de `epg-extra.yml`: checkout da `vod-data`, baixa o script da branch de código (`CODE_REF`), roda, commita só o `jogos.json` e faz push.
- **O arquivo do workflow precisa estar na `main`** para o agendamento valer (como foi feito com `epg-extra.yml`). Colocar só esse arquivo na `main` é uma ação que exige o "pode" explícito do Gustavo no momento.

### 4.4 Regras editáveis (`scripts/jogos/regras.json` e `aliases-times.json`)

- `regras.json`: para cada campeonato, nome de exibição, esporte e a lista de canais prováveis (por exemplo Brasileirão Série A: `premiere 1` a `premiere 8`, `sportv`, `sportv 2`, `sportv 3`, `globo`). Mudar rótulo ou canal não exige mexer em código.
- `aliases-times.json`: apelidos entre o nome da ESPN e o do guia (por exemplo "Inter Milan" ↔ "Inter de Milão", "Atlético-GO" ↔ "Atlético Goianiense").

## 5. Cliente web e celular (`sintoniza-link.html`)

- **Menu:** item "Jogos" na barra lateral (grupo CATÁLOGO, depois de Canais) e na barra inferior do celular, com ícone próprio. Nova seção `jogos`, aberta por `setState({ section: "jogos" })`, sem exigir credenciais Xtream (a aba funciona só com a lista de canais).
- **Dados:** busca o `jogos.json` na branch `vod-data` (`raw.githubusercontent.com`, mesmo padrão do guia extra), guarda a última cópia boa no `localStorage` por até 24 h e usa essa cópia se a rede falhar.
- **Seções:** "Ao vivo agora" (início ≤ agora < fim), "Hoje" e "Amanhã" para futebol; depois "Outros esportes", agrupados por modalidade, cada grupo em ordem de horário com rótulo do dia. Jogo terminado há mais de 10 min some. Dia (hoje/amanhã) sempre calculado no fuso de Brasília.
- **Card:** escudos (ou iniciais, se faltar imagem), times, horário, campeonato, selo "AO VIVO" calculado no aparelho e o nome do canal (ou "Canal não confirmado").
- **Resolução do canal:** compara o nome normalizado de cada canal da conta (`normalizeChannelName`, a mesma regra do guia) com `canais` do jogo. As versões HD/FHD/SD do mesmo canal contam como um só; vale a ordem HD, FHD, SD.
- **Clique:** se o jogo tem canal confirmado e exatamente um deles existe na lista da conta, toca direto (`selectChannel`). Se há mais de um canal possível (vários confirmados presentes na lista, ou só `provaveis`), abre a folha "Onde assistir" com os canais da conta que casam, e o toque escolhe. Se nenhum canal da conta casa, aviso "Esse canal não está na sua lista".
- O player abre como já abre para canais nas outras telas do app (modo definido pelo app para a seção).

## 6. Cliente TV (Novo-App-de-TV)

- **Menu:** novo `NavigationSection` `'games'`, item "Jogos" no `Sidebar.tsx` com ícone de troféu, entre Canais e Filmes. Nova `GamesView.tsx` ligada em `App.tsx` como as demais visões.
- **Navegação por controle remoto:** cards registrados no mesmo registro de foco das outras telas (linhas por seção, colunas por card); OK abre; Voltar volta ao menu. A folha "Onde assistir" é um modal com foco próprio, no padrão do `HistoryActionSheet`.
- **Dados e lógica:** constante `JOGOS_URL` ao lado de `EPG_EXTRA_URL` (`services/api.ts`), mesmas regras de seções, resolução de canal e cache de 24 h do cliente web, em um serviço `services/jogos.ts` com funções puras, reaproveitando o `normalizeChannelName` de `services/epg.ts`. O player abre com `openPlayer` sobre os canais já carregados.
- **Limite do navegador da TV:** sintaxe até ES2016 (Chrome 53, webOS 4.5). O `npm run check:tv` precisa passar. Sem `async/await`, sem spread de objeto, sem `?.` e sem `??`.
- **Instalação na TV de testes:** só quando o Gustavo disser que a TV está liberada.

## 7. Falhas, limites e fora desta versão

- Sem rede e sem cópia guardada: a aba mostra "Jogos indisponíveis agora"; o resto do app segue igual.
- Lista de canais vazia ou conta recusada pelo provedor: os cards aparecem, mas o clique avisa que o canal não está na lista ou o player mostra o erro padrão.
- **Fora desta versão:** placar ao vivo, notificação de início de jogo, e a verificação diária da saúde dos canais (uma Action que sonda a lista padrão e publica quais canais respondem, para o app ordenar as opções). Fica registrada como próxima etapa.
- A API da ESPN não é documentada nem oficial. Se mudar ou bloquear, o gerador cai no guia sozinho e o app continua funcionando com menos jogos de futebol.

## 8. Testes

- **Gerador (`tests/jogos/`):** amostras reais reduzidas da ESPN e do guia como fixtures; casos para o filtro `VT -`, `A x B` com e sem prefixo, apelidos de times, tolerância de 45 min, janela de dias no fuso de Brasília, fim por esporte, canais prováveis e falha de uma ou das duas fontes.
- **Cliente web:** funções puras de seções (ao vivo, hoje, amanhã, outros) e de resolução de canal (variantes HD/FHD/SD, um canal, vários, nenhum), mais teste no Chrome real com um `jogos.json` de exemplo, como foi feito com as Séries Livres.
- **Cliente TV:** os mesmos casos em TypeScript, mais `npm test` e `npm run check:tv`.
- **Regressão:** suítes completas dos dois repositórios, e as demais telas (Canais, Filmes, Séries) sem mudança de comportamento.

## 9. Entrega

- App: branch `orquestrador/jogos` a partir da `v23`; vira a versão seguinte (workflow de build próprio) só com o "pode" do Gustavo, como a v23.
- TV: branch `orquestrador/jogos-tv` a partir de `orquestrador/embeds-conta` (a cadeia de TV mais recente).
- Execução com `/orquestrador` (Gemini constrói, Claude revisa e roda os testes), conforme o pedido.
