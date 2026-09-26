# Sintoniza Smart TV (AI Studio): ajustes necessários após o backend (commit `385e966`)

> **Para quem é:** o Gustavo, e quem for aplicar os ajustes (o próprio AI Studio, o Antigravity ou o Claude).
>
> **O que foi revisado:** o repositório `Guaitolinii/Novo-App-de-TV`, commit `385e966` ("feat: add mpegts support and update typography"), comparado com o que pede `2026-09-25-smart-tv-ai-studio-backend-e-lacunas.md`. Foram duas revisões em paralelo, uma do servidor e uma do front/TV. Os pontos críticos de cada uma foram conferidos direto no código.
>
> **Resumo:** o AI Studio fez um trabalho grande e bem estruturado. A organização de pastas, as rotas e os formatos seguem o desenho, e os três campos de link estão lá. **Mas o app ainda não roda na TV** (tela preta garantida), e o servidor tem **falhas de segurança sérias** que precisam ser fechadas antes de publicar qualquer coisa.

---

## Bloqueadores: sem isto, não dá para publicar nem testar

### A. O app não roda na TV LG

São as mesmas lições que custaram dias no app anterior.

| # | Onde | Problema | Ajuste |
|---|---|---|---|
| A1 | `vite.config.ts` | Sem `base: './'` e sem transpilar para o Chromium da TV. O Vite 8 mantém `?.`/`??` (que aparecem no código todo) e gera `<script type="module">` com caminhos `/assets/`. **Tela preta.** | `base: './'`, `@vitejs/plugin-legacy` com `targets: ['chrome >= 68', 'samsung >= 6']` e `renderModernChunks: false`, `build.target: 'es2017'`. É a mesma config que já funciona em `visual-craft-assistant/sintoniza-tv-app/vite.config.ts`. |
| A2 | `package.json` | **Tailwind 4 exige Chrome 111+.** Ele usa `@layer`, `color-mix()` e `oklch`, e o Chrome 79 da TV provavelmente descarta esses blocos: a página fica sem estilo. | Voltar para **Tailwind 3.4**. A alternativa é plugin de cascade layers com fallbacks de cor, e em qualquer caso validar o CSS gerado na TV. |
| A3 | `src/services/api.ts` | `fetch('/api/...')` relativo. Instalado na TV, o app roda em `file://`, e isso vira `file:///api`: nada carrega. O `proxiedStreamUrl` também chega relativo (`/stream?u=`). | Usar `VITE_API_URL` como base absoluta, com um helper `apiUrl(p)` aplicado a todas as chamadas **e** ao `proxiedStreamUrl` antes de tocar. |
| A4 | `public/` | **Falta o `icon.png`.** O empacotador da LG recusa gerar o `.ipk` sem ele. | Adicionar o ícone. A chance de fazer a logo preencher o quadrado, a pendência antiga do app anterior. |
| A5 | `public/config.xml` | Samsung: falta `<content src="index.html"/>`; o `package` do `tizen:application` precisa ter exatamente 10 caracteres (`sintoniza` tem 9); `exec` não é atributo válido. | Corrigir conforme o `sintoniza-tv/config.xml` que já existe no projeto. |
| A6 | `package.json` | `esbuild ^0.25` conflita com o Vite 8, e o `npm install` falha. O AI Studio usa o bun, que não reclama disso. | Remover o `esbuild`. Remover também `@google/genai` e `motion` (sem uso) e adicionar `@vitejs/plugin-legacy`. |

### B. Configurações: dois defeitos graves

| # | Onde | Problema | Ajuste |
|---|---|---|---|
| B1 | `SettingsView.tsx:186` (e campos de VOD e EPG) | **A máscara destrói a senha.** O campo mostra `maskUrl(url)`, mas o `onChange` grava o que está no campo. Ao digitar uma letra, a senha real é trocada por `••••••`. A regex da máscara também está errada (`[^&\\s]` exclui a letra "s", não espaço). | Mostrar mascarado **só fora de edição**: `value={editing ? url : maskUrl(url)}` com `onFocus`/`onBlur`. Regex `/[^&\s]+/`, mascarando também credenciais no caminho (`/live/usuario/senha/`). |
| B2 | `SettingsView.tsx` | **Quem só tem D-pad não consegue configurar.** Os campos e os botões "⌨" não são `TvFocusable`; as setas nunca chegam neles. | Envolver cada campo e cada botão "⌨" em `TvFocusable`, com `onSelect` focando o campo ou abrindo o teclado. |

### C. Segurança do servidor (antes de publicar no Cloud Run)

| # | Onde | Problema | Ajuste |
|---|---|---|---|
| C1 | `server/lib/upstream.ts:59`, `server/routes/stream.ts:47` | **SSRF por redirecionamento.** O servidor segue redirects (`redirect: 'follow'`) sem revalidar o destino. Um provedor malicioso responde `302 → 169.254.169.254` e o servidor acessa a rede interna do Cloud Run. | `redirect: 'manual'` num laço de no máximo 3 saltos, validando cada destino. |
| C2 | `server/lib/safeUrl.ts` | **SSRF por IPv6 e DNS.** `[::ffff:169.254.169.254]` e `[::]` passam na checagem. Se o DNS falha, a checagem *aprova*. E o IP checado pode não ser o mesmo que o `fetch` usa. | Tirar colchetes; tratar `::ffff:x.x.x.x` como IPv4; bloquear `::`, `64:ff9b::/96`, `100.64/10` e `198.18/15`; recusar se o DNS falhar; conectar no IP validado (um agent do `undici` com `lookup` próprio). |
| C3 | `server/lib/streamToken.ts:3` | **Segredo do token escrito no código**, como valor padrão. Quem lê o repositório forja tokens e usa o servidor como proxy aberto. | Sem valor padrão: recusar subir se `STREAM_TOKEN_SECRET` faltar ou tiver menos de 32 caracteres. |
| C4 | `server/routes/vod.ts`, `server/routes/series.ts` | **A chave de cache ignora a senha.** Quem mandar o mesmo host e usuário com *qualquer* senha recebe o catálogo em cache, e junto os links com a senha verdadeira. | Incluir a senha no hash da chave: `hashKey(base\|usuario\|senha\|acao\|categoria)`. |
| C5 | `server/lib/streamToken.ts` | O token só é assinado, não cifrado: usuário e senha ficam legíveis na URL (`?u=`) e vão para os logs. A comparação da assinatura também não é segura contra ataques de tempo. | Cifrar com AES-256-GCM, validade curta (~6 h), `crypto.timingSafeEqual`, limite de streams simultâneos por IP. |
| C6 | `server/routes/stream.ts:108-124` | **O `/stream` nunca fecha a conexão com o provedor.** Canal ao vivo não termina: cada troca de canal deixa um download infinito rodando, gastando banda, e pode esgotar a única conexão permitida pelo plano do usuário. | `AbortController` cancelado em `req.on('close')` e `pipeline(Readable.fromWeb(body), res)`, que respeita o ritmo do cliente. |
| C7 | `server/lib/upstream.ts` | Limite de tamanho e timeout não valem para o corpo da resposta. Uma lista sem `Content-Length`, ou um arquivo compactado malicioso, derruba o servidor por memória. | Ler em pedaços somando bytes, abortar acima de 100 MB, e manter o prazo até o fim da leitura. |
| C8 | `server/index.ts` | CORS com `*`, sem rate limit, sem `trust proxy`. | Lista branca (origem `null` do app instalado mais `ALLOWED_ORIGINS`), 60 req/min em `/api`, `app.set('trust proxy', 1)`, `Access-Control-Max-Age`. |
| C9 | `server/lib/upstream.ts:11` | A função que esconde senhas dos logs tem o mesmo erro de regex: `password=segredo` **não** é mascarado. | Portar `sanitizeDiagnosticText` do `sintoniza-link.html` (troca qualquer URL por `[url]`). |

### D. O servidor não sobe em produção

| # | Onde | Problema | Ajuste |
|---|---|---|---|
| D1 | `package.json` (`"start": "node server.ts"`) | Imports sem extensão (`'./server/index'`) falham no Node sem bundler; imports de tipos (`Express`, `Request`, `Channel`) quebram em runtime; `NODE_ENV` não é definido, então sobe em modo desenvolvimento. | Empacotar com esbuild (`esbuild server.ts --bundle --platform=node --outfile=dist-server/index.js`) e `"start": "NODE_ENV=production node dist-server/index.js"` (no Windows, via `cross-env`). Usar `import type` onde for só tipo. |

---

## Importantes: funciona, mas com defeito visível

**Servidor**
1. **EPG fora da paridade com o app atual** (`server/providers/epg.ts`):
   - não aceita `.xml.gz`;
   - indexa por id XMLTV em vez de nome de canal;
   - não decodifica `&amp;`, e ignora `start_timestamp`;
   - a normalização remove "brasil", então "ESPN Brasil" casa com "ESPN";
   - a busca por `includes` casa "globo" com "globonews";
   - não tem a fonte suplementar (epgshare01);
   - a janela é 2 h/24 h em vez de 1 h/48 h;
   - uma falha não fica em cache e bate no provedor a cada pedido.

   **Portar o bloco `epg-helpers` do `sintoniza-link.html` inteiro**, que já está testado e validado.
2. **Deduplicação de filmes errada:** títulos só em japonês ou coreano viram "" e se fundem; ano ausente vira o ano atual. Portar `dedupeVodItemsByTitle` e `vodItemYearKey`.
3. **Ids de canal duplicados:** mesmo nome e grupo, que é o caso dos links reserva, geram o mesmo id, quebrando favoritos e a renderização. Acrescentar sufixo `_2`, `_3`, sem perder o separador.
4. **Cache não é LRU nem limita memória:** são 800 entradas sem limite de peso, e uma lista de 50 mil canais pesa dezenas de MB. Limitar por tamanho.
5. **Texto do provedor sem sanitização completa:** falta `sanitizeImageUrl` em logos e capas, e títulos e sinopses do Xtream não passam por `sanitizeLabel`. O `sanitizeLabel` local ainda remove `&` e `'` ("Tom & Jerry" vira "Tom  Jerry").
6. **Reescrita do `.m3u8`:** os segmentos são resolvidos contra a URL original, mas o Xtream redireciona para outro servidor e eles quebram. Usar a URL final. Também faltam `#EXT-X-KEY` e `#EXT-X-MAP` com `URI=`.

**Front**
7. **Teclado na tela:**
   - não tem maiúsculas, e usuário e senha Xtream diferenciam maiúsculas;
   - não recebe foco ao abrir;
   - o foco "vaza" para os botões atrás dele;
   - Voltar com o teclado aberto sai de Configurações e perde o que foi digitado.
8. **Voltar ignora modais:** com o detalhe de filme, de série ou o teclado aberto, Voltar leva direto para a Início. Precisa de uma pilha de "o que o Voltar fecha primeiro" no contexto de navegação.
9. **Enter do teclado do sistema dispara o botão focado:** o "Concluir" do teclado da LG manda Enter e pode acionar, por exemplo, "Limpar Dados Locais". Se o Enter vier de um campo, só tirar o foco dele.
10. **Player:**
    - listener de teclado duplicado com o global (↑/↓ troca de canal e também move o foco por trás);
    - OK não faz play/pause;
    - botões do erro não são focáveis;
    - falta a promoção `.ts → .m3u8`;
    - "Tentar novamente" perde o link do proxy.
11. **Dados de demonstração aparecem como se fossem reais:** se o servidor falhar, o erro é engolido e a demonstração continua na tela. É exatamente o que o desenho pedia para evitar. Usar uma flag `demoMode` explícita e mostrar o erro.
12. **Clicar num filme ou série na Início ou em Favoritos não faz nada:** o item selecionado nunca é mostrado.
13. **Canais limitados a 120, e filmes e séries a 60, sem paginação.** Grupo e busca filtram só esses 120 localmente. Buscar do servidor por grupo, busca e paginação.
14. **Favoritos somem se o item não estiver carregado:** guardar um mínimo por id (título, capa, tipo).
15. **Teste de conexão:** falha de Filmes/Séries é silenciosa, não testa séries, não tem timeout (spinner eterno em lista lenta), e "Failed to fetch" aparece em inglês.

---

## Menores

- Campos de URL:
  - sem `autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url"`, o teclado da TV vira "Http://";
  - como o `body` tem `select-none`, liberar `user-select: text` nos campos.
- Tipografia fixa em px/rem pequena para 1280×720 a 3 metros: usar `html { font-size: 1.25vw }` com mínimo.
- `appinfo.json` com `"resolution": "1920x1080"`: confirmar no aparelho, que informa uma tela de 1280×720.
- Fontes via Google Fonts dependem de internet. Melhor embutir com `@fontsource`.
- Classe dinâmica `object-${aspectRatio}` não é gerada pelo Tailwind: usar `style={{ objectFit }}`.
- `url.includes('.ts')` casa com nomes de domínio: usar `/\.ts(\?|$)/`.
- Paginação sem limites contra valores negativos ou NaN; erros sempre 400 em vez de 502/504; `parseXtreamCredentials` perde a porta `:80` explícita; a URL do xmltv é montada sem codificar usuário e senha.
- "Limpar dados" sem confirmação.
- **Desempenho:** o app anterior trocou React por **Preact** por causa do hardware fraco da TV. Vale o mesmo aqui (`preact/compat` como alias), depois que o resto estiver funcionando.
- **Testes:** não há nenhum. Prioridade para as funções puras de segurança e parsing: `isPrivateIp`/`validateSafeUrl`, o token, `sanitizeDiagnosticText`, `parseM3U` e ids, datas e nomes do EPG, e o dedupe de filmes.

---

## O que está bom e deve ser mantido

- Estrutura `server/` com rotas e formatos exatamente como o desenho (`{items, total, nextOffset}`, `{groups, total}`, `{categories}`).
- Links só por cabeçalho `X-Sintoniza-*`; nada de link em URL.
- Chaves de cache com hash SHA-256; uma só busca ao provedor para pedidos simultâneos.
- `streamUrl` e `proxiedStreamUrl` separados; o proxy é usado só quando precisa (página HTTPS com stream HTTP).
- Configurações com os **três campos**: canais obrigatório, Filmes/Séries opcional com "usar o mesmo link", EPG em "Avançado".
- Campos reais que aceitam colar, com botão "⌨" ao lado; o teste de conexão antes de salvar mostra as contagens.
- Nada de listas grandes no `localStorage`; favoritos por id estável.
- EPG nulo mostra "Sem programação" em vez de dado falso, e é pedido só para os canais visíveis.
- mpegts.js para `.ts`, hls.js para `.m3u8`.
- Voltar da LG (461) e da Samsung (10009) e `disableBackHistoryAPI: true`.
- Foco bem visível; sem `dangerouslySetInnerHTML`; controle virtual começa oculto.

---

## Ordem sugerida

1. **A1–A6 e D1:** o app precisa instalar, compilar e abrir na TV.
2. **B1–B2:** configurar sem destruir a senha e só com o D-pad.
3. **C1–C9:** antes de publicar o servidor em qualquer endereço público.
4. Importantes 1–15.
5. Menores, testes e troca para Preact.

Depois de 1 e 2: empacotar, instalar na LG com o DevTools remoto conectado **antes** de abrir, e testar com a lista real, só com o D-pad.

---

## Texto pronto para colar no AI Studio

> Aplique os ajustes do documento `2026-09-25-smart-tv-ai-studio-ajustes.md`, nesta ordem, um bloco por vez, sem quebrar o que já funciona:
> (1) **TV:** `vite.config.ts` com `base:'./'` e `@vitejs/plugin-legacy` (`targets: ['chrome >= 68','samsung >= 6']`, `renderModernChunks: false`, `build.target: 'es2017'`); voltar Tailwind para 3.4; `api.ts` usando `VITE_API_URL` como base absoluta em todas as chamadas e também no `proxiedStreamUrl`; adicionar `public/icon.png`; corrigir `config.xml` da Samsung; remover `esbuild`, `@google/genai` e `motion` do `package.json`.
> (2) **Configurações:** mascarar o link só quando o campo não estiver em edição (hoje a máscara substitui a senha real ao digitar); tornar os campos e os botões "⌨" alcançáveis pelo D-pad com `TvFocusable`.
> (3) **Segurança do servidor:** redirect manual com revalidação (máx. 3); corrigir `safeUrl` para IPv6, IPv4 mapeado e falha de DNS (recusar); remover o segredo padrão do `streamToken` e exigir `STREAM_TOKEN_SECRET`; incluir a senha na chave de cache de filmes e séries; cancelar a conexão com o provedor quando o cliente fecha o `/stream`; limitar tamanho e tempo na leitura do corpo; CORS com lista branca mais rate limit; corrigir a regex que esconde senhas dos logs.
> (4) **Produção:** empacotar o servidor com esbuild e `start` em `NODE_ENV=production`.
> Não use dados de demonstração como padrão; se o servidor falhar, mostre o erro na tela.
