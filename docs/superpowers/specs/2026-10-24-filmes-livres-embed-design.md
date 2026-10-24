# Filmes Livres: categoria de filmes por embed oficial (spec)

Data: 2026-10-24 · Repositórios: `visual-craft-assistant` (app) e `Novo-App-de-TV` (banco, script de conta e cabeçalhos do site)
Base: branch `orquestrador/legendados` (commit 9ee9acb), de onde reaproveitamos o encanamento da categoria Legendados.

## 1. Objetivo

Levar para o app filmes **gratuitos e licenciados** que a fonte oferece como **embed** (página de player incorporável por iframe), sem converter nada para mp4. Os itens ficam numa categoria própria, "Filmes Livres", e abrem em uma tela de player diferente da dos demais filmes.

Fica fora de escopo: qualquer extração, proxy ou conversão do fluxo de vídeo de um embed. O player da fonte toca o vídeo; o app apenas o hospeda numa tela.

## 2. Decisões já tomadas

| Decisão | Origem |
|---|---|
| Categoria nova e separada da Legendados; as duas coexistem | Gustavo, 2026-10-24 |
| **Sem lista fixa de domínios**: qualquer URL `https` da lista vira item | Gustavo |
| **Iframe sem restrições**: sem `sandbox`, sem `referrerpolicy` (fontes autorizadas podem exigir referência e popups) | Gustavo |
| Quem cura o que entra é o dono da lista (Gist); o app não julga licença | Gustavo |
| Nome da categoria: "Filmes Livres" (constante fácil de trocar) | proposta aceita implicitamente |
| TV LG fica fora desta versão | proposta aceita implicitamente |

## 3. Riscos aceitos (por decisão do Gustavo)

- Sem `sandbox`, o conteúdo embutido pode abrir popups e tentar redirecionar a página do app. O isolamento entre origens do navegador continua valendo (o embed não lê o app nem o armazenamento dele).
- Sem lista de domínios, uma linha errada na lista abre qualquer site `https` dentro do app. Mitigação: só `https` (descarta `http`, `javascript:`, `data:`), e o script de conta imprime um resumo dos domínios da lista ao ligá-la, só informativo.
- Embed que recusa iframe (`X-Frame-Options`) deixa o quadro em branco e o app não detecta isso. Mitigação: botão fixo "Abrir no navegador".

## 4. Fonte de dados

M3U no mesmo formato da lista de Legendados, um item por par de linhas:

```
#EXTINF:-1 tvg-id="nosferatu-1922" tvg-logo="https://…/capa.jpg" group-title="Terror", Nosferatu (1922)
https://fonte.example/embed/nosferatu
```

- `tvg-id` obrigatório, só `[A-Za-z0-9_.-]{1,40}`; sem ele o item é descartado (mesma regra dos Legendados).
- Ano em `(AAAA)` no fim do nome, `group-title` vira o gênero, capa vem de `tvg-logo` (sanitizada como hoje).
- Link da segunda linha: precisa ser `https`. Se terminar em extensão de vídeo direto (`.mp4`, `.m3u8`, `.mkv`, `.ts`, `.m4v`, `.webm`, `.mov`), o item toca no **player nativo** (caminho dos Legendados). Qualquer outro `https` é **embed** e abre na tela de embed. Assim uma fonte que mude de formato não quebra a lista.
- Duplicados por `tvg-id` são descartados. O teto é de 5000 itens por lista.

Forma do item no app: `{ stream_id: "liv-<tvg-id>", name, stream_icon, category_name: "Filmes Livres", genre, year, is_livre: true, embed_url }` para embeds, ou `{…, direct_url, container_extension}` para link direto.

## 5. Conta e banco (repositório Novo-App-de-TV)

- Migração `0017_ott_embeds.sql`: `alter table public.profiles add column if not exists url_embeds text;` e `device_config` redefinida a partir da versão da 0016, acrescentando `'url_embeds', p.url_embeds` ao lado de `'url_legendados'` em cada lista devolvida.
- Quem grava: só o admin (a policy `profiles_admin_write` já existente); o cliente não marca a própria conta.
- Script `scripts/ott-embeds-conta.mjs` (molde: `ott-legendados-conta.mjs`): `npm run ott:embeds -- --email=… [--remover]`, lê `OTT_CONTA_EMBEDS`. Antes de gravar, baixa a lista e imprime itens totais, embeds, links diretos e domínios por contagem (sem imprimir a URL da lista). Nunca grava credenciais em log.
- Reversão: `--remover` desliga a categoria sem republicar o app.

## 6. App (repositório visual-craft-assistant, arquivo `sintoniza-link.html`)

**6.1 Configuração e armazenamento.** Chave `sint_embeds_url`. `OTT_LIST_KEYS.EMBEDS`; `ottParseDeviceConfig` propaga `url_embeds` (só `http/https`); `ottApplyPlaylist` grava/remove a chave sem invalidar o cache do guia (mesma exceção dos Legendados); a chave entra na limpeza de conta (`OTT_WEB_ACCOUNT_KEY_RES` e `ottWebWipeAccountData`). Não há valor semeado por padrão.

**6.2 Leitura da lista.** O analisador de M3U dos Legendados vira um núcleo compartilhado (`m3uExtraParse(texto, opções)`), e `legendadosParseM3u` passa a ser um invólucro fino, sem mudar o comportamento (os testes atuais continuam passando). `embedsParseM3u` é o segundo invólucro. `embedsFetch(url)` usa a mesma estratégia de busca (direta com timeout de 15 s, depois fallback pelo proxy). O cache de sessão é **por URL**, e não global.

**6.3 Fileira.** Uma fileira "Filmes Livres" no topo da aba Filmes, logo abaixo da fileira Legendados (quando ambas existem), com "Ver todos". A fileira dos Legendados é generalizada em `extraRowHtml(catId, título, itens, contType)`; `legendadosRowHtml` vira invólucro. Só aparece em Filmes e só se a conta tem `url_embeds`. Categoria `livres` no cache, em paralelo ao catálogo, sem bloqueá-lo (mesmo guard de troca de aba dos Legendados).

**6.4 Roteamento por item.** Função pura `vodItemPlayKind(item)` devolve `"embed"`, `"direct"` ou `"xtream"`. `openVodModal` e o clique de cartão (incluindo Minha Lista) a usam no lugar de `item.is_legendado`: embed abre a tela de embed, direct toca por `playVodSelection(item.direct_url, …)`, xtream segue como hoje. Itens extras (legendado ou livre) não exigem credenciais Xtream e escondem Baixar e "Assistir na TV". `VOD_ITEM_FIELDS` ganha `embed_url` e `is_livre`.

**6.5 Tela de embed.** Overlay `#embed-screen` em tela cheia, acima do modal de filme:
- Barra com botão voltar, título do filme e "Abrir no navegador" (link `target="_blank"`, `rel="noopener"`).
- `<iframe>` com `allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"` e `allowfullscreen`; **sem `sandbox` e sem `referrerpolicy`**.
- Ao abrir: pausa o player nativo (`stopStream()` se houver reprodução), fecha o modal do filme, faz `history.pushState` e define `src`. Ao fechar: `src = "about:blank"` (para o áudio) e remove o overlay.
- Fechar: botão voltar, `Escape` e `popstate` (o botão voltar do navegador e o botão físico do Android fecham a tela em vez de sair do app).
- Mostra um aviso suave após 8 s sem evento `load`, junto do botão "Abrir no navegador".
- Sem "continuar assistindo" (o app não vê o progresso dentro do iframe), sem Baixar, sem Chromecast, sem "Assistir na TV".

**6.6 Funções puras novas** (registradas em `tests/vod/loadVodHelpers.js`): `embedsEnabled`, `embedsParseM3u`, `vodItemPlayKind`, `embedFrameHtml`.

## 7. Site (repositório Novo-App-de-TV, `panel/public/_headers`)

Hoje `/app/*` tem `Permissions-Policy: autoplay=(self), fullscreen=(self), picture-in-picture=(self)`. Isso bloqueia tela cheia e autoplay dentro de iframe de outro domínio, e sem lista de domínios não dá para listar origens. A regra passa a:

```
/app/*
  Permissions-Policy: autoplay=*, fullscreen=*, picture-in-picture=*, encrypted-media=*
  X-Robots-Tag: noindex, nofollow
```

`X-Frame-Options: DENY` da regra `/*` continua (ele protege as nossas páginas de serem embutidas, não afeta o que o app embute).

## 8. Plataformas

Web (`/app/`) e celular (Capacitor) com o mesmo código. A TV LG não muda. No Android, o botão físico de voltar passa pelo histórico (`popstate`). No iOS, a tela tem botão próprio.

## 9. Testes

Repositório do app (node:test, `tests/vod/embeds.test.js`):
- Analisador: só `https`; descarta `http`, `javascript:`, `data:`; `tvg-id` inválido; duplicados; teto de 5000; mistura de embed e link direto; ano, gênero e capa.
- `embedsEnabled`, cache por URL, configuração de conta (`url_embeds` em `ottParseDeviceConfig`, `ottApplyPlaylist`, limpeza).
- `vodItemPlayKind` para os três tipos e para itens de Minha Lista.
- `embedFrameHtml`: escapa a URL; tem `allow` e `allowfullscreen`; **não** contém `sandbox` nem `referrerpolicy` (documenta a decisão do Gustavo).
- Regressão: os testes de Legendados continuam passando sem alteração (o núcleo compartilhado não pode mudar o comportamento).

Repositório Novo-App-de-TV (`tests/`): cabeçalho de `/app/*` com `fullscreen=*` e `autoplay=*`, e o `tests/seo-site.test.ts` atual intacto (`X-Frame-Options: DENY` e o `noindex` de `/app/*`).

Manual (Playwright, depois de publicar um branch de teste): item de embed abre, toca, entra em tela cheia, voltar fecha e para o áudio; item com link direto toca no player nativo; Legendados e Filmes Livres coexistem; conta sem `url_embeds` não vê a categoria.

## 10. Execução

- Branches: `orquestrador/embeds` (app) e `orquestrador/embeds-conta` (Novo-App-de-TV), sem push.
- Fluxo: `omp` (Gemini) constrói por tarefa, Claude revisa e testa, Haiku commita com lista fechada de arquivos.
- Migração, ligar a conta e publicar só com confirmação explícita do Gustavo. O deploy usa worktree limpo do commit revisado.

## 11. Pontos em aberto

Nenhum que bloqueie. Ajustes de rótulo ("Filmes Livres") e do teto de 5000 itens podem ser trocados depois sem mudar o desenho.
