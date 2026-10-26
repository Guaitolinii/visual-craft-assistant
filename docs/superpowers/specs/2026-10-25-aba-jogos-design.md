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
| **NFL e NBA entram de forma garantida** (e a NHL junto, pela mesma API), com tabela própria da ESPN, e não só pelo que o guia de TV trouxer | pedido de 2026-10-25 |
| **Agenda do ge ligada** como terceira fonte (jogos e "onde assistir" do Brasileirão e outros), aceitando o risco de raspar página de terceiro | resposta de 2026-10-25 |

## 3. Levantamento feito em 2026-10-25 (base das decisões)

- **Lista da conta (xjet), 138 candidatos a canal de esporte: 0 transmitiram na sonda feita da máquina de desenvolvimento.** Com as credenciais guardadas no `.env.ott.local`, o provedor recusou (`player_api` devolveu HTTP 401 e `auth: 0`; os canais deram HTTP 500 ou um corpo de 2,6 KB). **O Gustavo testou depois no app e conseguiu acessar os canais**, então a recusa vale para as credenciais guardadas na máquina de desenvolvimento (ou para a conexão dela), não para a conta que ele usa. Consequência prática: a sonda automática de canais não pode usar essas credenciais, e a verificação de saúde dos canais fica fora desta versão.
- **Lista padrão, 48 candidatos: 16 transmitem** (SporTV, SporTV 2, SporTV 3, ESPN HD, Combate, GE TV, Premiere 1, 3, 5 e 8, UFC Fight Pass, NSports, FIFA+, Pluto Esportes, Red Bull TV, ge Fast). Premiere 2, 4, 6 e 7 dão 404: são canais de evento que só ligam em dia de jogo. A disponibilidade varia ao longo do dia.
- **Guia de TV (`epg-extra.json`, já gerado a cada 6 h na branch `vod-data`):** 18 canais de esporte e 88 candidatos a jogo entre hoje e amanhã, no formato `Time A x Time B - Ao Vivo`. Reprises vêm com o prefixo `VT -`. Premiere e Globo **não** trazem nomes de jogos (só "Com o PREMIERE dá jogo!"), então o Brasileirão nesses canais não aparece pelo guia.
- **ESPN (API pública, sem chave):** `site.api.espn.com/apis/site/v2/sports/soccer/<campeonato>/scoreboard?dates=AAAAMMDD` devolve os jogos do dia. O intervalo de datas (`AAAAMMDD-AAAAMMDD`) não funciona: usar uma data por consulta. Não informa o canal brasileiro.
- **TheSportsDB:** a chave gratuita antiga está desativada e a de teste devolve poucos eventos; a lista de TV não traz nada para o Brasil. Não será usada.
- **Como os outros fazem (pesquisa de 2026-10-25):**
  - Não existe API pública documentada com o canal brasileiro por jogo. Os guias brasileiros (Olhar Digital, apps "Futebol na TV" e "Guia de jogos") são curados à mão ou raspados. As APIs pagas (por exemplo a lista de emissoras por jogo da Sportmonks) pedem chave e não confirmam cobertura do Brasil.
  - Os projetos de guia de TV no GitHub (`iptv-org/epg`, `japanterebi-xmltv`) usam o mesmo padrão que já usamos: um GitHub Actions agendado gera o arquivo e publica.
  - A API de tabela da Globo (`api.globoesporte.globo.com/tabela/.../rodada/N/jogos/`) responde com os jogos do Brasileirão 2026, mas o campo `transmissao` é `null` para jogos futuros e só traz status depois. Não acrescenta nada à ESPN.
  - A página `ge.globo.com/agenda/` embute os dados do jogo em `window.dataSportsSchedule` (por dia e campeonato) e também em JSON-LD `SportsEvent`. Cada jogo tem `liveWatchSources` com o nome de onde assistir (`sportv`, `Premiere`, `Globo`, e também Disney+, Globoplay, Cartola, SportyNet). Em 2026-10-25 trazia 29 jogos (16 com "onde assistir") e para 2026-10-26 trazia 5 (4 com "onde assistir", incluindo Premiere e SporTV). O nome é da marca, não do número do canal (não diz Premiere 1 ou 5). É o único lugar encontrado que responde "o Brasileirão passa na Premiere ou no SporTV?" por jogo. É uma página de terceiro: ler por programa é raspagem, sem permissão explícita e sujeita a mudar sem aviso.
- **NFL, NBA e NHL na ESPN** (mesma API, outro caminho): `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`, `.../basketball/nba/scoreboard` e `.../hockey/nhl/scoreboard`, com `?dates=AAAAMMDD`. Em 2026-10-25: NFL 12 jogos, NBA 7, NHL 5; em 2026-10-26: NFL 1, NBA 9, NHL 3. Os horários vêm em **UTC** (o jogo "DAL @ PHI" de `2026-10-27T00:15Z` é 21h15 de 26/10 em Brasília e bate com o guia de TV, que o mostra na ESPN 2 às 21h15). Nomes completos de time em inglês, os mesmos do guia.
- **Futebol americano universitário (pedido do Gustavo, "se tivermos acesso"): temos.** `.../football/college-football/scoreboard?dates=AAAAMMDD&groups=80&limit=200` (`groups=80` é a divisão principal, a FBS; sem isso a lista vem com centenas de jogos de divisões menores). Em 2026-10-24 (sábado) devolveu 44 jogos (por exemplo `PITT @ MIA`, `BYU @ UCF`, `IU @ MICH`); em domingo e segunda não há jogo; na terça-feira à noite há poucos (`DEL @ WKU` em 2026-10-27). É esperado: a maioria dos jogos é no sábado. O guia de TV mostra o programa "Futebol Americano Universitário" na ESPN 6 (hoje como reprise "VT"), então a ESPN 6 é o canal provável, com ESPN 5, 4 e 3 como alternativas. O esporte no arquivo é `ncaaf`, com o rótulo "College Football".
- Códigos de campeonato de futebol da ESPN verificados (existem e respondem): `bra.1`, `bra.2`, `bra.3`, `bra.copa_do_brazil` (o nome com "brasil" responde vazio), `conmebol.libertadores`, `conmebol.sudamericana`, `uefa.champions`, `uefa.europa`, `uefa.europa.conf`, `eng.1`, `esp.1`, `ita.1`, `ger.1`, `fra.1`, `por.1`, `arg.1`, `usa.1`, `mex.1`, `fifa.world`, `fifa.cwc`, `conmebol.america`, `uefa.nations`, `concacaf.champions`.

## 4. Arquitetura

Um gerador no GitHub produz **um** arquivo, `jogos.json`, que os dois clientes (web/celular e TV) leem e cruzam com a lista de canais da própria conta.

```
GitHub Actions (a cada 3 h)
  ├─ ESPN: futebol por campeonato + NFL, NBA e NHL, hoje/amanhã/depois ─┐
  ├─ agenda do ge (1 página): jogos e "onde assistir" (SporTV/Premiere/Globo) ─┤
  ├─ epg-extra.json (mesma branch): jogos e canais do guia de TV ─────────┼─> scripts/jogos/build.mjs ─> jogos.json (branch vod-data)
  └─ regras.json + aliases-times.json (campeonato → canais prováveis; nomes de times) ┘
                                                         │
          web/celular (sintoniza-link.html) <────────────┤──────────> TV (Novo-App-de-TV: GamesView)
          cruza com os canais da conta e abre o player   │           cruza com os canais da conta e abre o player
```

### 4.1 Gerador (`scripts/jogos/build.mjs`, repositório do app)

- Roda em Node 20 sem dependências. Funções puras e testáveis: leitura da ESPN, leitura do guia, casamento de times, classificação de esporte, montagem do arquivo.
- **Janela:** hoje, amanhã e depois de amanhã no fuso `America/Sao_Paulo`. O terceiro dia evita ficar sem "amanhã" entre a meia-noite e a próxima execução.
- **ESPN:** uma consulta por competição e por dia, com tempo limite de 15 s cada. As competições ficam em `regras.json` como pares `esporte/liga` (futebol: `soccer/bra.1` etc.; e `football/nfl`, `football/college-football` (com `groups=80&limit=200`), `basketball/nba`, `hockey/nhl`), no total 27 × 4 = 108 consultas por execução: a ESPN agrupa os jogos pela **data dos EUA** (Costa Leste), então para cobrir os três dias de Brasília consulta-se também a véspera (véspera, hoje, amanhã e depois de amanhã) e depois se filtra pela janela de Brasília. Falha de uma consulta não derruba as outras. O horário da ESPN é UTC; o gerador converte para o dia de Brasília. **NFL, College Football e NBA são competições de primeira classe:** têm grupo próprio na aba, esporte `nfl`, `ncaaf` e `nba`, e entram mesmo que o guia de TV não traga o jogo.
- **Agenda do ge (ligada):** uma única requisição por execução a `https://ge.globo.com/agenda/` (que cobre de dois dias antes a dois dias depois), com um `User-Agent` honesto (`SintonizaJogos/1.0 (+https://github.com/Guaitolinii/visual-craft-assistant)`). O gerador localiza `window.dataSportsSchedule`, extrai o JSON de `sport` por contagem de chaves e percorre `sport["AAAA-MM-DD"].championshipsAgenda[]`, em cada campeonato os eventos de `future`, `now` e `past` (tipo `SoccerEvent`). De cada `match`: `firstContestant`/`secondContestant` (`popularName` e `badgePng`), `startDate` e `startHour` (horário de Brasília), `round`, `phase` e `liveWatchSources[].name`. Os nomes de marca viram canais prováveis pela tabela `marcas` de `regras.json`: `sportv` → `sportv`, `sportv 2`, `sportv 3`; `Premiere` → `premiere 1` a `premiere 8`; `Globo` → `globo`; `ESPN` → `espn` a `espn 6`; `SportyNet` → `sportynet`; marcas sem canal de TV (Disney+, Globoplay, Cartola) são ignoradas. Os jogos do ge que a ESPN não tem (por exemplo Série B, Libertadores Feminina, Copa do Mundo Feminina Sub-17) entram como jogos próprios. Se a página mudar de formato, responder erro ou bloquear, o gerador registra um aviso e segue sem o ge.
- **Guia de TV:** lê o `epg-extra.json` do próprio checkout da `vod-data`. Um programa é jogo se o título tem `A x B` (ou `vs`) e **não** começa com `VT -`. Prefixos como `NFL:`, `NBA:`, `NHL:` e `Liga Evolución de Futsal:` definem competição e esporte; `A x B` sem prefixo em canal de futebol é futebol. O início e o fim vêm do próprio guia.
- **Casamento entre as fontes:** nomes de times normalizados (sem acento, minúsculas, sem `fc/ec/sc/cf/ac`, com tabela de apelidos) e horário com diferença de no máximo 45 min. O jogo base é o da ESPN; o do ge casa com ele, e o do guia de TV também. O canal do guia que casa vira o canal **confirmado** do jogo (pode haver mais de um). Sem canal do guia: os **canais prováveis** vêm das marcas do ge, quando o ge traz o jogo, e senão do campeonato em `regras.json`. O jogo que só existe no guia entra como está (outros esportes).
- **Fim do jogo:** o do guia quando existe; senão início mais a duração do esporte (futebol 2 h, NFL 3,5 h, NBA e NHL 2,5 h, vôlei e futsal 2 h, lutas 4 h, demais 2,5 h).
- **Falha segura:** igual ao guia extra, o passo de geração falha sem gravar nada se nenhuma das três fontes (ESPN, ge, guia de TV) produzir jogos; com pelo menos uma, gera com o que tiver. O arquivo bom anterior permanece na branch. Nenhum `continue-on-error`.

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
- `esporte` é um de: `futebol`, `nfl`, `ncaaf`, `nba`, `nhl`, `volei`, `futsal`, `basquete`, `lutas`, `outros`.
- Tamanho esperado: menos de 100 KB.

### 4.3 Workflow `jogos.yml`

- `cron` a cada 3 h mais `workflow_dispatch`, no padrão de `epg-extra.yml`: checkout da `vod-data`, baixa o script da branch de código (`CODE_REF`), roda, commita só o `jogos.json` e faz push.
- **O arquivo do workflow precisa estar na `main`** para o agendamento valer (como foi feito com `epg-extra.yml`). Colocar só esse arquivo na `main` é uma ação que exige o "pode" explícito do Gustavo no momento.

### 4.4 Regras editáveis (`scripts/jogos/regras.json` e `aliases-times.json`)

- `regras.json`: para cada competição, o par `esporte/liga` da ESPN, o nome de exibição, o esporte e a lista de canais prováveis, mais a tabela `marcas` do ge. Exemplos: Brasileirão Série A: `premiere 1` a `premiere 8`, `sportv`, `sportv 2`, `sportv 3`, `globo`; **NFL**: `espn`, `espn 2`, `espn 3`, `espn 4`, `espn 5`, `espn 6`; **College Football**: `espn 6`, `espn 5`, `espn 4`, `espn 3`; **NBA**: `espn`, `espn 2`, `espn 3`, `sportv`, `sportv 2`, `nba league pass 1` a `nba league pass 6`; NHL: `espn 3`, `espn 4`. Os canais de NFL, NBA e NHL foram tirados do que o guia de TV e as listas de canais já mostram (a NBA aparece na ESPN 3 no guia e existe o grupo "NBA League Pass" nas listas). Mudar rótulo ou canal não exige mexer em código.
- `aliases-times.json`: apelidos entre o nome da ESPN e o do guia (por exemplo "Inter Milan" ↔ "Inter de Milão", "Atlético-GO" ↔ "Atlético Goianiense").

## 5. Cliente web e celular (`sintoniza-link.html`)

- **Menu:** item "Jogos" na barra lateral (grupo CATÁLOGO, depois de Canais) e na barra inferior do celular, com ícone próprio. Nova seção `jogos`, aberta por `setState({ section: "jogos" })`, sem exigir credenciais Xtream (a aba funciona só com a lista de canais).
- **Dados:** busca o `jogos.json` na branch `vod-data` (`raw.githubusercontent.com`, mesmo padrão do guia extra), guarda a última cópia boa no `localStorage` por até 24 h e usa essa cópia se a rede falhar.
- **Seções:** "Ao vivo agora" (início ≤ agora < fim), "Hoje" e "Amanhã" para futebol; depois "Outros esportes", agrupados por modalidade na ordem **NFL, College Football, NBA, NHL** e então as demais (vôlei, futsal, basquete, lutas e outros), cada grupo em ordem de horário com rótulo do dia. Jogo terminado há mais de 10 min some. Dia (hoje/amanhã) sempre calculado no fuso de Brasília.
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
- A API da ESPN não é documentada nem oficial. Se mudar ou bloquear, o gerador usa o ge e o guia de TV, e o app continua funcionando com menos jogos (NFL e NBA dependeriam então só do guia).
- **Risco aceito pelo Gustavo (agenda do ge):** a leitura da página de terceiro pode quebrar sem aviso, ser bloqueada ou contrariar os termos de uso do site, que não foram verificados. Para desligar basta remover o ge do gerador (uma chave em `regras.json`: `fontes.ge: false`) sem mexer no resto. Não há outro uso dos dados do ge além de jogos, horários e a marca do canal.

## 8. Testes

- **Gerador (`tests/jogos/`):** amostras reais reduzidas da ESPN (futebol, NFL, College Football, NBA, NHL), do ge e do guia como fixtures; casos para o filtro `VT -`, `A x B` com e sem prefixo, apelidos de times, tolerância de 45 min, janela de dias no fuso de Brasília, conversão de horário UTC da ESPN (inclusive jogo de madrugada em UTC que cai no dia anterior em Brasília), fim por esporte, marcas do ge para canais prováveis (SporTV, Premiere, Globo, marca ignorada), jogo só do ge, NFL e NBA presentes mesmo sem o guia, `fontes.ge: false`, e falha de uma, duas ou das três fontes.
- **Cliente web:** funções puras de seções (ao vivo, hoje, amanhã, outros) e de resolução de canal (variantes HD/FHD/SD, um canal, vários, nenhum), mais teste no Chrome real com um `jogos.json` de exemplo, como foi feito com as Séries Livres.
- **Cliente TV:** os mesmos casos em TypeScript, mais `npm test` e `npm run check:tv`.
- **Regressão:** suítes completas dos dois repositórios, e as demais telas (Canais, Filmes, Séries) sem mudança de comportamento.

## 9. Entrega

- App: branch `orquestrador/jogos` a partir da `v23`; vira a versão seguinte (workflow de build próprio) só com o "pode" do Gustavo, como a v23.
- TV: branch `orquestrador/jogos-tv` a partir de `orquestrador/embeds-conta` (a cadeia de TV mais recente).
- Execução com `/orquestrador` (Gemini constrói, Claude revisa e roda os testes), conforme o pedido.
