# Sintoniza Smart TV (novo front do AI Studio): desenho do backend e o que falta

> **Para quem é:** o Gustavo e quem for implementar, seja uma pessoa, o Claude, o Antigravity ou o próprio AI Studio.
>
> **Origem:** repositório `Guaitolinii/Novo-App-de-TV`, commit `ee52d74`. O código é idêntico ao zip `sintoniza-smart-tv.zip` exportado do AI Studio.
>
> **Onde este documento mora:** no repositório principal do projeto (`visual-craft-assistant`, branch `v9`), junto com os demais planos e pesquisas do Sintoniza, porque ele depende deles e é continuação do mesmo projeto. O código do front novo continua no repositório próprio `Guaitolinii/Novo-App-de-TV`, que o AI Studio sincroniza.
>
> **Comparado com:** o projeto Sintoniza que já existe e funciona, no repositório `visual-craft-assistant`: o app do celular `sintoniza-link.html` e os apps de TV `sintoniza-tv/` e `sintoniza-tv-app/`.

---

## 1. Resumo

O app novo tem uma interface de TV bonita e bem organizada: início, canais, filmes, séries, favoritos, configurações, player e navegação por controle. **Só que é apenas front-end.** Não existe servidor, e quase todo o conteúdo exibido é de demonstração.

**O que funciona de verdade hoje:**
- importar **uma** lista M3U de canais, por URL, arquivo ou texto colado;
- tocar streams **HLS (.m3u8)** e MP4.

**O que é falso ou não existe:**
- **Filmes e séries:** 100% dados fixos de demonstração (`src/services/demoData.ts`).
- **Programação (EPG):** todo canal importado mostra "Transmissão ao vivo" com 50% de progresso, fixo.
- **Campo para o link de filmes/séries:** não existe. Só há o campo de canais.
- **Streams `.ts` (MPEG-TS):** não tocam. É o formato da maioria dos canais ao vivo Xtream.
- **Guardar a lista:** a lista inteira vai para o `localStorage` (limite de ~5 MB). Uma lista real estoura esse limite e **os canais somem ao reabrir o app**, sem nenhum aviso.
- **Favoritos:** se perdem a cada nova importação, porque o id do canal muda (`m3u-ch-${index}-${Date.now()}`).
- **Servidor:** o `package.json` traz `express`, `dotenv` e `@google/genai` do modelo do AI Studio, mas **nenhum arquivo usa**. Não há `server.ts`, e o Gemini não é chamado em lugar nenhum.

A proposta deste documento:
1. Um **backend pequeno** ("BFF", backend-for-frontend) em Node + Express. Ele recebe os **dois links**, conversa com o provedor IPTV e devolve os dados já no formato que o front espera.
2. As **mudanças mínimas no front** para usar esse backend: os dois campos de link e a troca dos dados de demonstração pelos reais.
3. A lista do que o nosso projeto atual faz e o novo front ainda não faz.

---

## 2. Como o nosso projeto atual funciona

O Sintoniza que já está em produção (o app do celular validado até a v8, e o app de TV vanilla v1.9.5) **não tem servidor próprio**: o aparelho conversa direto com o provedor IPTV. Tudo gira em torno de **dois links** que o usuário cola em Configurações.

```
                ┌──────────────── Configurações (localStorage) ────────────────┐
                │ sint_url      = link da LISTA DE CANAIS (M3U)                │
                │ sint_vod_url  = link do CATÁLOGO Filmes/Séries (Xtream)      │
                │ sint_epg_url  = link do GUIA de programação (opcional)       │
                └──────────────────────────────────────────────────────────────┘
                         │                    │                     │
                         ▼                    ▼                     ▼
             baixa o .m3u e faz     extrai base/usuário/senha   baixa o xmltv.php,
             o parse (parseM3U)     do link (parseXtream-       indexa por nome de
                         │          Credentials) e chama o      canal normalizado
                         │          player_api.php do provedor  (+ epgshare01 como
                         │                    │                  fonte suplementar)
                         ▼                    ▼                     ▼
                 fileiras de canais    fileiras de filmes/séries   "Agora / A seguir"
                 (ao vivo)             (por categoria), ficha      em cada canal
                                       da série com episódios
```

### 2.1 Link 1: canais (M3U)
- É uma URL de lista `.m3u`/`m3u_plus`, por exemplo `http://provedor/get.php?username=U&password=S&type=m3u_plus`.
- `parseM3U` lê cada `#EXTINF` e extrai nome, logo, grupo (`group-title`) e URL do stream.
- Nome, categoria e logo passam por **sanitização**, porque o texto vem do provedor e poderia injetar HTML.

### 2.2 Link 2: filmes e séries (Xtream Codes)
- É a mesma forma de URL. Dela o app tira `base`, `username` e `password` (`parseXtreamCredentials`).
- Com isso chama a **API Xtream** do provedor (`{base}/player_api.php?username=U&password=S&action=...`):

| Ação | Para quê |
|---|---|
| `get_vod_categories` | categorias de filmes |
| `get_vod_streams&category_id=X` | filmes de uma categoria (nome, capa, ano, nota, extensão) |
| `get_series_categories` | categorias de séries |
| `get_series&category_id=X` | séries de uma categoria |
| `get_series_info&series_id=X` | temporadas e episódios de uma série |

- **URL para tocar um filme:** `{base}/movie/{usuario}/{senha}/{stream_id}.{extensao}`.
- **URL para tocar um episódio:** `{base}/series/{usuario}/{senha}/{episodio_id}.{extensao}`.
- **Deduplicação:** o provedor repete o mesmo título em várias categorias; o app agrupa por nome + ano.

### 2.3 Link 3 (opcional): guia de programação (EPG)
- É o `xmltv.php` do provedor, no formato XMLTV.
- O app indexa a programação por **nome de canal normalizado**, porque a lista M3U não traz `tvg-id` confiável. A normalização tira região, "HD", "FHD", "4K", colchetes e acentos.
- Também usa apelidos: por exemplo, "Premiere 1" no guia aparece como "Premiere Clubes".
- **Fonte suplementar:** o epgshare01 preenche os canais que o provedor não cobre.
- O guia é guardado em cache com uma janela de **1 h para trás e 48 h para frente**, e atualizado a cada 6 h.

### 2.4 O que mais o nosso app faz
- **Favoritos:** guardados pelo **nome** do canal (`sint_fav`), porque o nome não muda quando a lista é recarregada.
- **Listas pessoais:** Recentes, "Continuar assistindo" (com o ponto onde parou, `sint_continue`) e "Minha Lista" (`sint_mylist`).
- **Selos de streaming** (Netflix, Max e outros) nos cartões de filme/série. Uma GitHub Action diária cruza o catálogo com o TMDB e publica `vod-providers.json` na branch `vod-data`.
- **Proxy de streams** (Cloudflare Worker, pasta `cloudflare-proxy/`), usado quando a página roda em HTTPS e o stream é HTTP ("conteúdo misto"):
  - repassa `.ts` em streaming;
  - reescreve `.m3u8`;
  - usa o User-Agent do VLC, que muitos provedores exigem.
- **Formatos de stream:** `.m3u8` via hls.js; `.ts` via **mpegts.js**, com tentativa de promover `.ts` → `.m3u8`, que é o padrão Xtream.
- **Links padrão no build:** as URLs podem vir dos segredos do GitHub e são injetadas no build. **Nunca ficam no código-fonte.**
- **Downloads** de filmes e séries, só no celular.

### 2.5 Lições que só aprendemos testando na TV LG real (43LM631C0SB, Chromium ~79)
Cada uma quebrou o app inteiro pelo menos uma vez. O front novo tem **todas elas** pendentes (ver seção 5.2):
1. **Sintaxe moderna quebra tudo.** Recursos como `?.` ou `{...obj}` deixam a página inteira em branco. O build precisa transpilar para o Chromium 68–79.
2. **O botão Voltar da LG** chega como `keyCode 461`, com `key: "Unidentified"`. Sem `disableBackHistoryAPI: true` no `appinfo.json`, ele **fecha o app**.
3. **A TV informa uma tela de 1280×720.** Tamanhos fixos em px de 1920 cortam o layout.
4. **App instalado roda em `file://`:**
   - caminhos absolutos (`/assets/...`) não carregam;
   - `<script type="module">` é recusado em silêncio.
5. **O foco precisa aparecer MUITO na tela**, senão parece que o controle não funciona.
6. **Campos de URL precisam aceitar colar**, pelo ponteiro do Magic Remote e pelo app LG ThinQ. Teclado na tela só como alternativa.

---

## 3. O que o novo front tem (inventário)

| Área | Arquivo | Situação |
|---|---|---|
| Navegação por controle (D-pad) | `context/TvNavigationContext.tsx`, `common/TvFocusable.tsx` | Existe (grade de foco própria). Voltar só por `Escape`/`Backspace`. |
| Início | `components/HomeView.tsx` | Existe, alimentado por demonstração. |
| Canais | `components/ChannelsView.tsx` | Existe; mostra canais importados, com EPG falso. |
| Filmes / Séries | `MoviesView.tsx`, `SeriesView.tsx` | Existem, **só com demonstração**. |
| Favoritos | `FavoritesView.tsx` | Existe (`isFavorite` dentro de cada objeto; perde-se ao reimportar). |
| Configurações | `SettingsView.tsx` | **Um campo só** (lista M3U), mais arquivo, colar texto e 2 listas públicas de exemplo. |
| Player | `PlayerView.tsx` | hls.js para `.m3u8`; o resto vai direto no `<video>`, então `.ts` não toca. |
| Controle virtual | `VirtualRemote.tsx` | Para testar no navegador; precisa sumir na TV real. |
| Tipos | `types/tv.ts` | `Channel`, `Movie`, `Series`, `Season`, `Episode`, `WatchHistoryItem`, `TVAppSettings`. **Bons, e o backend deve devolver exatamente esses formatos.** |
| Persistência | `App.tsx` | Tudo em `localStorage` (`sintoniza_channels`, `_movies`, `_series`, `_history`, `_playlist_url`). |

---

## 4. Desenho do backend

### 4.1 Decisão: um BFF em Node + Express, sem estado

**Por que ter um servidor**, se o nosso app atual vive sem um:

- **O parse pesado sai da TV.**
  - Uma lista real tem 10 a 50 mil canais.
  - Um XMLTV tem dezenas de MB.
  - A TV tem CPU fraca, e o parse dela trava a interface. O servidor faz isso e entrega só o que a tela precisa, **paginado**.
- **Resolve CORS e conteúdo misto num lugar só.** Hoje o front precisa do provedor liberando CORS (a maioria não libera) e de HTTP dentro de HTTPS.
- **Um formato único para o front.** O servidor já devolve `Channel`, `Movie`, `Series` e `Episode` no formato de `types/tv.ts`, e o front não precisa saber nada de Xtream.
- **Já é o que o modelo do AI Studio espera.** Ele traz `express`, `dotenv` e `tsx` e publica no Cloud Run. Não é tecnologia nova.

**"Sem estado"** quer dizer:
- o servidor **não guarda os links nem as senhas** do usuário;
- o front manda o link em cada pedido, num cabeçalho;
- o servidor usa, guarda em cache na memória por pouco tempo (chaveado por um hash do link, nunca pelo link em claro) e descarta.

Isso evita ter banco de dados e login nesta fase. Contas e assinaturas ficam para a Fase 2 (seção 6), que já tem pesquisa pronta.

```
┌────────────── TV (front React) ──────────────┐        ┌──────────── BFF (Express / Cloud Run) ────────────┐        ┌──── Provedor IPTV ────┐
│ Configurações: 2 links (+ EPG opcional)       │  HTTPS │  /api/live/*     parse do M3U, pagina, cache      │  HTTP  │ lista .m3u            │
│ guarda no aparelho (IndexedDB/localStorage)   │───────▶│  /api/vod/*      player_api.php (filmes)          │───────▶│ player_api.php        │
│ manda os links no cabeçalho X-Sintoniza-*     │        │  /api/series/*   player_api.php (séries)          │        │ xmltv.php             │
│ toca o stream: direto ou via /stream          │◀───────│  /api/epg/now    parse do XMLTV, "agora/a seguir"  │◀───────│ streams .ts / .m3u8   │
└───────────────────────────────────────────────┘        │  /stream         proxy HTTP→HTTPS (.ts / .m3u8)   │        └───────────────────────┘
                                                         └───────────────────────────────────────────────────┘
```

### 4.2 Os dois links (e o terceiro, opcional)

O front manda os links em **cabeçalhos**, nunca na URL, para não ficarem em log de servidor nem no histórico:

| Cabeçalho | Conteúdo | Obrigatório |
|---|---|---|
| `X-Sintoniza-Channels` | link da lista de canais (M3U) | para `/api/live/*` |
| `X-Sintoniza-Vod` | link do catálogo de Filmes/Séries (Xtream) | para `/api/vod/*` e `/api/series/*` |
| `X-Sintoniza-Epg` | link do guia XMLTV | não; sem ele, o servidor tenta `{base}/xmltv.php` com as credenciais do link de canais |

Regras:
- Os dois links podem ser do mesmo provedor, com a mesma URL; é o caso comum. O app atual trata os dois separados porque há gente com fornecedores diferentes para TV e para filmes.
- O servidor **valida** cada link antes de usar (seção 4.6, proteção contra SSRF).

### 4.3 Endpoints

Todos devolvem JSON. Em caso de erro, `{ "error": { "code": "...", "message": "..." } }`, com mensagem em português pronta para mostrar na tela.

#### Canais (Link 1)

| Método e rota | Devolve | Observações |
|---|---|---|
| `GET /api/live/groups` | `{ groups: [{ name, count }], total }` | categorias da lista (`group-title`) e a quantidade de canais em cada |
| `GET /api/live/channels?group=&offset=0&limit=60&q=` | `{ items: Channel[], total, nextOffset }` | paginado; `q` busca por nome; `Channel` no formato de `types/tv.ts` |
| `GET /api/live/channels/:id` | `Channel` | um canal (usado ao zapear) |

Detalhes:
- **`Channel.id` é estável:** hash do nome normalizado + grupo. Não usa índice nem data. É o que conserta os favoritos que somem.
- **`resolution`** é inferido do nome (4K/FHD/HD/SD), como o front já faz.
- **`currentProgram` / `nextProgram`** vêm do EPG (abaixo). Sem guia para aquele canal: `currentProgram: null`. **Isso exige uma pequena mudança no tipo do front**, que hoje trata o campo como obrigatório; nunca inventar "Transmissão ao vivo 50%".

#### Guia de programação (EPG)

| Método e rota | Devolve |
|---|---|
| `GET /api/epg/now?ids=<id1,id2,...>` | `{ [channelId]: { current: EPGProgram \| null, next: { title, startTime } \| null } }`, até 100 ids por chamada |

Detalhes:
- Mesma lógica do nosso `epg-helpers`, **portada para o servidor**:
  - `extractXmltvChannels`, `extractXmltvProgrammes`, `normalizeChannelName`;
  - apelidos (`CHANNEL_ALIASES`);
  - `mergeEpgIndexes` com o epgshare01 como fonte suplementar;
  - janela de 1 h para trás e 48 h para frente;
  - atualização a cada 6 h.
- Aceita `.xml` e `.xml.gz`.
- `startTime` e `endTime` no formato `"HH:mm"`, no fuso de São Paulo, e `progressPercent` calculado na hora, como o tipo do front espera.

#### Filmes (Link 2)

| Método e rota | Devolve | Ação Xtream usada |
|---|---|---|
| `GET /api/vod/categories` | `{ categories: [{ id, name }] }` | `get_vod_categories` |
| `GET /api/vod/movies?category=&offset=&limit=&q=` | `{ items: Movie[], total, nextOffset }` | `get_vod_streams` |
| `GET /api/vod/movies/:id` | `Movie` completo | `get_vod_info&vod_id=` |

Detalhes:
- A lista devolve o `Movie` com os campos que o Xtream dá de graça: `title`, `poster`, `year`, `rating`, `streamUrl`.
- O detalhe completa sinopse, duração, diretor, gênero e `backdrop`.
- **Deduplica** por nome + ano, como o nosso app faz.
- `streamUrl` = `{base}/movie/{usuario}/{senha}/{id}.{ext}`.

#### Séries (Link 2)

| Método e rota | Devolve | Ação Xtream usada |
|---|---|---|
| `GET /api/series/categories` | `{ categories: [{ id, name }] }` | `get_series_categories` |
| `GET /api/series?category=&offset=&limit=&q=` | `{ items: Series[], total, nextOffset }` | `get_series` (sem `seasons`, que fica vazio na lista) |
| `GET /api/series/:id` | `Series` com `seasons: Season[]` e episódios | `get_series_info&series_id=` |

Detalhes:
- `Episode.streamUrl` = `{base}/series/{usuario}/{senha}/{episodio_id}.{ext}`.
- As séries usam campos diferentes dos filmes para ano e data (`releaseDate`, `last_modified`); o nosso app já trata isso e a lógica deve ser portada igual.

#### Stream (proxy)

| Método e rota | Faz |
|---|---|
| `GET /stream?u=<token>` | busca o stream no provedor e repassa em HTTPS |

Detalhes:
- **Por que um token:** o front não manda a URL do stream crua. Ele recebe `streamUrl` já no formato `/stream?u=<token>`, e o token é a URL original assinada com HMAC usando um segredo do servidor, com prazo de validade. Sem isso, qualquer pessoa usaria o servidor como proxy aberto da internet.
- **O que o proxy faz**, portado do `cloudflare-proxy/src/worker.js` que já funciona:
  - `.ts` em streaming, sem carregar na memória;
  - `.m3u8` reescrito para que os segmentos também passem pelo proxy;
  - User-Agent do VLC;
  - repasse do cabeçalho `Range`.
- **Quando usar o proxy:**
  - só quando o front roda em HTTPS e o stream é HTTP (versão web, preview do AI Studio);
  - o app instalado na TV (`file://`) pode tocar o stream **direto** do provedor, sem gastar banda do servidor;
  - o servidor devolve as duas URLs, `streamUrl` (direta) e `proxiedStreamUrl`, e o front escolhe.

#### Saúde

| Método e rota | Devolve |
|---|---|
| `GET /api/health` | `{ ok: true, version }` |

### 4.4 Cache (memória do servidor, sem banco)

| O quê | Chave | Validade |
|---|---|---|
| Lista M3U já parseada | hash do link de canais | 30 min |
| Categorias e listas de filmes/séries | hash do link VOD + ação + categoria | 1 h |
| Detalhe de filme/série | hash do link VOD + id | 6 h |
| Índice do EPG | hash do link do guia | 6 h (mesma regra do app atual) |

Detalhes:
- Limite de memória com descarte do mais antigo (LRU).
- Quando dois pedidos chegam juntos para o mesmo link, **só um vai ao provedor** (sem "estouro de manada").
- Isso importa porque muitos provedores bloqueiam quem faz muitas chamadas seguidas.

### 4.5 Estrutura de pastas proposta

```
server/
  index.ts              ← cria o app Express, CORS, rotas, serve o dist/ do front em produção
  config.ts             ← lê as variáveis de ambiente (seção 4.7)
  lib/
    safeUrl.ts          ← validação de link (SSRF) — seção 4.6
    upstream.ts         ← fetch para o provedor: User-Agent VLC, timeout, limite de tamanho
    cache.ts            ← cache LRU em memória + "um pedido por vez por chave"
    streamToken.ts      ← assina/verifica o token do /stream (HMAC + validade)
  providers/
    m3u.ts              ← parse de M3U (porta do parseM3U + sanitização do nosso app)
    xtream.ts           ← parseXtreamCredentials, xtreamApiUrl, URLs de filme/episódio
    epg.ts              ← porta do epg-helpers (XMLTV, nomes, apelidos, merge)
    mappers.ts          ← converte resposta Xtream/M3U → Channel/Movie/Series/Episode (types/tv.ts)
  routes/
    live.ts  vod.ts  series.ts  epg.ts  stream.ts  health.ts
  tests/                ← Vitest: um arquivo de teste por arquivo de lib/ e providers/
```

Detalhes:
- `src/types/tv.ts` passa a ser **compartilhado** entre front e servidor. Mover para `shared/types.ts` e importar dos dois lados.
- Scripts no `package.json`:
  - `"dev:server": "tsx watch server/index.ts"`;
  - `"build:server": "esbuild server/index.ts --bundle --platform=node --outfile=dist-server/index.js"`;
  - `"start": "node dist-server/index.js"`.

### 4.6 Segurança (obrigatória, não opcional)

Um servidor que busca qualquer URL que o usuário mandar é, por natureza, um risco. Regras:

1. **Proteção contra SSRF.** Antes de buscar qualquer link:
   - aceitar só `http:` e `https:`;
   - resolver o DNS e **recusar** IP privado, local ou reservado: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (inclui o `169.254.169.254` de metadados do Cloud Run), `::1`, `fc00::/7`, `0.0.0.0`;
   - repetir essa verificação a cada redirecionamento (máximo 3).
2. **Limites:**
   - timeout de 15 s para catálogo e 30 s para lista M3U e EPG;
   - tamanho máximo de 100 MB para M3U e EPG, cortando a leitura ao passar;
   - rate limit por IP, 60 req/min em `/api` (o `/stream` fica de fora).
3. **Credenciais do usuário** (usuário e senha do provedor, que estão dentro dos links):
   - nunca em log, nem em mensagem de erro, nem em resposta de erro;
   - usar o mesmo `sanitizeDiagnosticText` do nosso app, que troca por `[url]`.
4. **Texto vindo do provedor** (nome de canal, título, sinopse, logo):
   - sanitizar no servidor, com as mesmas `sanitizeLabel` e `sanitizeImageUrl` do nosso app;
   - o front continua sem usar `dangerouslySetInnerHTML`.
5. **CORS:**
   - liberar a origem `null` (é a do app instalado em `file://`) e o domínio do próprio front;
   - nada de `*` com credenciais.
6. **Segredos só em variável de ambiente** (regra do projeto). Nunca no código.

### 4.7 Variáveis de ambiente

| Variável | Para quê | Obrigatória |
|---|---|---|
| `PORT` | porta do servidor (o Cloud Run define sozinho) | não |
| `STREAM_TOKEN_SECRET` | segredo do HMAC do `/stream` (32+ bytes aleatórios) | sim |
| `ALLOWED_ORIGINS` | domínios do front além de `null`, separados por vírgula | não |
| `EPG_SUPPLEMENTARY_URL` | fonte suplementar de EPG (padrão: epgshare01 BR1) | não |
| `DEFAULT_CHANNELS_URL` / `DEFAULT_VOD_URL` | links padrão, com o mesmo papel dos segredos do build do app atual | não |

A `GEMINI_API_KEY` **sai**, porque nada usa Gemini. Se um dia houver busca inteligente ou recomendação, ela volta com um endpoint próprio.

---

## 5. O que falta no front para usar o backend

### 5.1 Os dois links em Configurações (o pedido principal)

Hoje `SettingsView.tsx` tem **um** campo (lista M3U), mais importar arquivo e colar texto. A tela deve passar a ter:

| Campo | Chave no aparelho | Obrigatório |
|---|---|---|
| **Link da lista de canais (M3U)** | `sintoniza_channels_url` | sim |
| **Link de Filmes e Séries (Xtream)** | `sintoniza_vod_url` | não; sem ele, as abas Filmes e Séries mostram um aviso para configurar, e não dados falsos |
| **Link do guia de programação (EPG)** | `sintoniza_epg_url` | não; fica num bloco "Avançado" |

Regras dos campos (lições do app atual, seção 2.5):
- **`<input>` de verdade, editável**, para colar pelo ponteiro do Magic Remote e pelo app LG ThinQ. Ao lado de cada um, um botão "⌨" que abre o teclado na tela, para quem usa só o D-pad.
- **"Salvar e carregar"** faz duas coisas:
  - testa os links antes de salvar: `GET /api/live/groups` e `GET /api/vod/categories`;
  - mostra na hora quantos canais e categorias achou, ou a mensagem de erro que o servidor devolveu.
- **Mesmo provedor para os dois:** uma opção "usar o mesmo link para Filmes e Séries" copia o link de canais.
- Os links ficam **só no aparelho**. Mostrar mascarados (`http://provedor/get.php?username=•••`) quando o campo não estiver em edição.

### 5.2 Demais mudanças

1. **Camada de serviço:** criar `src/services/api.ts` com uma função por endpoint.
   - Anexa os cabeçalhos `X-Sintoniza-*` a partir das chaves do aparelho.
   - A URL do servidor vem de `import.meta.env.VITE_API_URL`.
2. **Tirar os dados de demonstração do caminho real:**
   - `App.tsx` passa a buscar do servidor, paginado, em vez de ler `INITIAL_*`;
   - o `demoData.ts` fica só para um "modo demonstração" explícito, nunca como padrão escondido.
3. **Parar de guardar listas no `localStorage`.** Guardar só links, favoritos (pelos `id` estáveis do servidor), histórico e "continuar assistindo". A lista vem do servidor (que tem cache) sempre que abre.
4. **Favoritos por id estável:** um conjunto de ids (`sintoniza_fav_ids`), e não o `isFavorite` dentro de cada objeto, que se perde ao reimportar.
5. **EPG real:**
   - `currentProgram` pode ser `null` (mudar em `types/tv.ts`);
   - as telas mostram "Sem programação" em vez do texto falso;
   - busca `/api/epg/now` só para os canais visíveis na tela.
6. **Player:**
   - adicionar **mpegts.js** para `.ts`, como o nosso app;
   - tentar promover `.ts` → `.m3u8` antes;
   - escolher `streamUrl` (direto) na TV instalada e `proxiedStreamUrl` na versão web em HTTPS.
7. **Tudo que a TV real exige** (seção 2.5):
   - `appinfo.json` com `"disableBackHistoryAPI": true`, e `config.xml` para Samsung;
   - reconhecer o Voltar pelo `keyCode` **461** (LG) e **10009** (Samsung), além de `Escape`/`Backspace`;
   - `vite.config.ts` com `base: './'` e `@vitejs/plugin-legacy` com `targets: ['chrome >= 68', 'samsung >= 6']` e `renderModernChunks: false`;
   - layout com `vw`/`vh`, sem 1920 px fixo; testar em 1280×720;
   - esconder o `VirtualRemote` fora do navegador de desenvolvimento;
   - teste automático que falha o build se sair sintaxe acima do que essa TV aceita (o mesmo `acorn` que já usamos).
8. **Instalação quebrada:**
   - `esbuild: ^0.25.0` no `package.json` conflita com o Vite 8, que pede `^0.27`/`^0.28`, e o `npm install` falha;
   - subir para `^0.28.0` ou remover, porque o Vite já traz o seu;
   - remover `@google/genai` e `dotenv` do front (o `dotenv` passa a ser só do servidor).
9. **Fonte:** o `index.html` pede "Cabinet Grotesk" ao Google Fonts, mas essa fonte não existe lá (é da Fontshare) e cai no padrão do sistema. Trocar por uma que exista, ou hospedar o arquivo.

---

## 6. Fase 2 (fora deste escopo, já pesquisada)

Estas partes precisam de **banco e login**, então vêm depois do BFF funcionando. A base já está pesquisada em `docs/superpowers/research/` (neste mesmo repositório):

- **Contas e assinatura** (`2026-09-23-backend-usuarios-assinaturas.md`): Supabase (Postgres, Auth, RLS) com cobrança via Mercado Pago/Asaas.
- **Perfis por conta** (`2026-09-23-perfis-por-conta.md`): até 5 perfis, com favoritos e histórico por perfil.
- **Pareamento por código**, como a Netflix e o Prime fazem:
  - a TV mostra um código curto;
  - o usuário digita no celular e cola ali os dois links;
  - a TV recebe sozinha.
  - Isso acaba com a digitação de URL longa no controle. Precisa de um endpoint `POST /api/pair` e `GET /api/pair/:codigo` com vida curta, que pode morar neste mesmo BFF assim que existir um lugar para guardar o código por poucos minutos (Supabase ou um KV).
- **Selos de streaming:** o BFF pode ler o `vod-providers.json` que a GitHub Action já publica e devolver `streamingProviders` junto de cada filme/série.

---

## 7. Ordem sugerida de implementação

1. Consertar o `npm install` (versão do `esbuild`) e remover pacotes sem uso.
2. `server/` com `health`, `safeUrl`, `upstream` e `cache`, com testes.
3. `providers/m3u.ts` e `/api/live/*`. No front: campo de canais, favoritos por id, fim do `localStorage` de listas.
4. `providers/xtream.ts` e `/api/vod/*` e `/api/series/*`. No front: **campo de Filmes e Séries** e as abas com dados reais.
5. `providers/epg.ts` e `/api/epg/now`. No front: "Agora / A seguir" de verdade.
6. `/stream` com token. No front: mpegts.js e a escolha entre direto e proxy.
7. Empacotamento para a TV (seção 5.2, item 7) e teste no aparelho LG real, com o DevTools remoto conectado **antes** de abrir o app.
8. Fase 2 (seção 6).

Cada etapa deve terminar com testes automáticos passando, e as etapas 3 a 6 com um teste de ponta a ponta usando a lista real do Gustavo, e não só a demonstração.
