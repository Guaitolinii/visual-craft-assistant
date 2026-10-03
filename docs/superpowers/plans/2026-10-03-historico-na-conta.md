# "Continuar assistindo" e "Vistos recentemente" na conta (web, celular e TV iguais) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o histórico de cada perfil passa a viver na conta, como em um streaming: o filme/episódio que a pessoa parou no celular aparece em "Continuar assistindo" na TV e no navegador (no mesmo minuto, com título e capa), e os canais assistidos recentemente também. Remover um item remove em todos.

**Architecture:** tabela `perfil_historico` (por perfil) + RPCs com token do aparelho (`hist_put`, `hist_list`, `hist_remove`). Cada app continua "local primeiro" e sincroniza como já faz com favoritos (união na primeira vez; depois a conta manda, mantendo pendentes/removidos). Os itens da conta guardam só ids e metadados (nunca link de stream); o app monta o link a partir da própria lista/credenciais, como o envio para a TV já faz (`castResolve`).

**Repos/branches** (nunca `main`; sem push; sem baixar pacotes):
- Site/backend/TV: `C:\Users\guait\Documents\Novo-App-de-TV`, branch `app-tv-ott-ativacao` (Tasks H1–H2).
- App (celular + web): `C:\Users\guait\Documents\visual-craft-assistant`; **criar `v15` a partir da `v14`** (bump iOS 1.5/15, Android 1.5/15, `APP_VERSION="v15"`, `build-mobile-v15.yml`, mesmo método dos bumps anteriores) (Task H3).
- Ordem: H1 primeiro; depois H2 (TV) e H3 (app) em paralelo.

> 🔐 `.env.ott.local` guarda segredos: nunca imprimir. Depois de qualquer `npm run ott:setup`, confirmar `mailer_autoconfirm = false`. Limites de taxa (`device_start` 20/h, `device_claim` 10/10 min): rodar `ott:smoke` uma vez.
> ⚠️ `sintoniza-link.html` é CRLF (sem `sed -i`). TV Chrome 53 (sem AbortController, `gap` em flex, `:is()/:where()/:has()`, `backdrop-filter`). Funções do `ott-core` testadas entram em `tests/ott/loadOtt.js`; puras do script principal em `PURE_HELPER_NAMES`.

## Contrato

**Chave do item** (mesma nos três apps; só ids): filme `f:<stream_id>`, episódio `e:<episode_id>`, canal `c:<nome normalizado>` (mesma normalização dos favoritos: minúsculas, sem acento, espaços colapsados, ≤120).

**Item da conta:** `{ k, tipo:'filme'|'episodio'|'canal', titulo, capa, meta, pos, dur, em }` — `meta` (objeto JSON ≤ 1500 caracteres): filme `{ ext, ano }`; episódio `{ ext, serieId, serieTitulo, serieCapa, temporada, numero, ano }`; canal `{ grupo }`. `pos`/`dur` em segundos (0 para canal), `em` = `atualizado` (ISO). Até **40 itens por perfil** (o mais antigo é descartado). Filme/episódio com `pos ≥ dur − 60` ou `pos ≥ 0.97·dur` saem de "Continuar assistindo" (o item pode continuar na conta como visto, mas as telas só mostram "continuar" para os não terminados).

**RPCs** (token do aparelho em `p_token`; o perfil precisa ser da conta; erros de negócio `P0001` em português):

| RPC | Resposta |
|---|---|
| `hist_put(p_token, p_perfil uuid, p_chave, p_tipo, p_titulo, p_capa, p_meta jsonb, p_pos int, p_dur int)` | `{status:'ok'}` (upsert; `atualizado = now()`; poda para 40) |
| `hist_list(p_token, p_perfil)` | `{status:'ok', itens:[…]}` mais recentes primeiro |
| `hist_remove(p_token, p_perfil, p_chave)` | `{status:'ok'}` |

**Regra de sincronização** (`planHistSync`): como em `fav`: 1ª vez do perfil no aparelho → união (o que só existe local sobe); depois a conta manda, mantendo `pendentes` (locais ainda não enviados) e aplicando `removidos` (remoções que falharam offline). Em conflito do mesmo item vale o mais recente (`em`). Quando sincronizar: ao escolher o perfil, ao voltar ao app (visível), a cada 2 minutos, e a cada `hist_put` (throttle 20 s para filme/episódio durante a reprodução; na hora ao pausar/sair e ao selecionar canal).

---

### Task H1: Migração 0013 — histórico por perfil

**Files:** Create `supabase/migrations/0013_ott_historico.sql`; Modify `scripts/ott-smoke.mjs` (verificações novas antes do resumo final, reaproveitando TV/celular e o perfil já criados na seção de favoritos para não gastar limite de taxa; confira que o limite de 11 `device_claim` não é ultrapassado).

- [ ] **Step 1: Migração** (idempotente; mesmo padrão de `0010_ott_favoritos.sql`; leia-o antes):

```sql
create table if not exists public.perfil_historico (
  perfil_id  uuid not null references public.perfis(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  chave      text not null check (chave ~ '^[fec]:.{1,120}$'),
  tipo       text not null check (tipo in ('filme', 'episodio', 'canal')),
  titulo     text not null default '' check (char_length(titulo) <= 120),
  capa       text not null default '' check (capa = '' or (char_length(capa) <= 300 and capa ~ '^https?://')),
  meta       jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 1500),
  pos        integer not null default 0 check (pos >= 0),
  dur        integer not null default 0 check (dur >= 0),
  atualizado timestamptz not null default now(),
  primary key (perfil_id, chave)
);
create index if not exists perfil_historico_lista on public.perfil_historico (perfil_id, atualizado desc);
alter table public.perfil_historico enable row level security;
revoke all on public.perfil_historico from anon, authenticated;
```
e as três funções `security definer` (`set search_path = public, extensions`), validando token com `public.cast_device`, perfil da conta (`Perfil inválido.`), `check_rate('hist:'||d.id, 240, 1 min)` no `hist_put`, chave/tipo coerentes (`f`→filme, `e`→episodio, `c`→canal), `meta` objeto, capa só `http(s)`, `hist_put` com `on conflict (perfil_id, chave) do update` e poda: `delete from perfil_historico where perfil_id = p and chave not in (select chave from perfil_historico where perfil_id = p order by atualizado desc limit 40)`. `revoke ... from public` e `grant execute ... to anon, authenticated` (assinaturas exatas).
- [ ] **Step 2: Smoke** — gravar filme/episódio/canal por um aparelho e ler por outro do mesmo perfil; ordem por recência; atualizar o mesmo item não duplica; poda em 40 (inserir 42); `hist_remove`; perfil de outra conta recusado; token falso → `unknown_device`; `meta` grande recusada; capa `javascript:` recusada; excluir o perfil leva o histórico junto (cascade).
- [ ] **Step 3:** `npm run ott:setup` (confirmar `mailer_autoconfirm = false`), `npm run ott:smoke` uma vez, `npx tsc --noEmit -p . && npm test`.
- [ ] **Step 4: Commit** — "feat(backend): histórico de cada perfil na conta (hist_put/hist_list/hist_remove)".

### Task H2: TV — "Continuar assistindo" e "Vistos recentemente" pela conta

**Files:** Create `src/services/histSync.ts`, `src/hooks/useHistSync.ts`; Modify `src/services/history.ts` (+ onde o `PlayerView` grava), `src/components/HomeView.tsx`/`HistoryActionSheet.tsx` (remover → `hist_remove`), `src/services/castResolve.ts` (reuso para abrir itens vindos da conta); Test `tests/hist-sync.test.ts`.

- [ ] **Step 1: Testes (devem falhar)** de funções puras em `histSync.ts`: `histKey(entry)` (`movie:vod_5`→`f:5`, `episode:ep_9`→`e:9`, canal→`c:<nome>`; ids estranhos → `null`), `itemsFromHistory(entries)` (meta de episódio com série/temporada/número/ext; capa só `http(s)`; `pos`/`dur` inteiros), `entriesFromItems(itens)` (item da conta → `HistoryEntry` mínimo: `streamUrl` vazio até resolver; título, poster, `positionSec`, `durationSec`, `updatedAt` via `parseIsoMs`), `planHistSync({primeira, local, conta, pendentes, removidos})` (união na 1ª vez; conta manda depois; pendentes sobem; removidos são apagados da conta e não voltam; conflito → mais recente), `isFinished(item)` (`pos ≥ dur−60` ou ≥ 97%), clientes `histList/histPut/histRemove` (RPCs; `histList` lança se `status !== 'ok'`, como `favList`, para `unknown_device` não apagar o local), e o limite de 40.
- [ ] **Step 2: Implementar e ligar** — `useHistSync` (como o `useFavSync`: ao entrar no perfil, ao voltar ao app, a cada 2 min; versão do estado para descartar sincronização obsoleta; sem `setState` quando nada mudou; pendentes/removidos em `sintoniza_histsync__<perfil>`, que entra em `PER_PROFILE_KEYS`); `PlayerView`: junto do `saveProgress` (a cada 15–20 s e ao sair/pausar) chamar `histPut`; seleção de canal grava `c:<nome>`; "Remover dessa lista" chama `histRemove` (e `progressClear`, já existente); abrir um item que veio da conta (sem `streamUrl`): resolver pelo `resolveCast` (`vod`/`episode` com `streamId`/`seriesId`/`titulo`/`temporada`/`numero`) e abrir o player no minuto `pos`; se a TV não achar o item, avisar "Não encontrado na lista desta TV" sem travar. Canais da conta resolvem pelo nome (como nos favoritos). Itens finalizados não aparecem em "Continuar assistindo".
- [ ] **Step 3:** `node --import tsx --test tests/hist-sync.test.ts && npx tsc --noEmit -p . && npm test && npm run build:ott` + `check:tv` (se `check:tv` só lê `dist/`, copie `dist-ott/assets` para o scratchpad). No Chrome do PC com o mock (`scripts/ott-mock-server.mjs`: acrescente `hist_*`): um filme parado "no celular" (injetado no mock) aparece em "Continuar assistindo" da TV com título/capa/minuto; abrir o item toca no minuto; remover na TV some no mock; trocar de perfil não mistura; offline mantém o local (pendentes). Capturas lidas e apagadas.
- [ ] **Step 4: Commit** — "feat(tv): Continuar assistindo e Vistos recentemente sincronizam com a conta".

### Task H3: App (celular e web) — histórico pela conta

**Files:** Modify `sintoniza-link.html` (ott-core + script principal), `tests/ott/loadOtt.js`, `tests/vod/loadVodHelpers.js`; Create `tests/ott/histsync.test.js`, `tests/ott/histsync-wiring.test.js`, `scripts/dev/check-histsync-ui.mjs`; bump v15.

- [ ] **Step 1:** `git checkout -b v15` (a partir da `v14`) + bump (script Node preservando CRLF).
- [ ] **Step 2: ott-core (testado)** — `ottHistKeyMovie/Episode/Channel`, `ottHistItemsFromContinue(map)` (de `sint_continue` + canais recentes `sint_recents`), `ottHistLocalFromItems(itens, creds)` (item da conta → entrada de `sint_continue` com `url` montada por `buildVodStreamUrl/buildSeriesEpisodeUrl` — como são funções do script principal, o `ott-core` devolve só os campos e a montagem acontece no script principal), `ottHistPlan` (mesma regra da TV), `ottHistList/Put/Remove` (RPCs; lançam se `status !== 'ok'`), `ottHistFinished`. Testes com `fakeFetch`; expor em `loadOtt.js`.
- [ ] **Step 3: Ligar** — `syncHistory()` (como `syncFavorites`): ao escolher o perfil, ao voltar ao app, a cada 2 min; `saveContinueWatching` (já a cada 5 s, throttled) → `ottHistPut` no máximo a cada 20 s e na hora ao pausar/`visibilitychange hidden`/`ended`; `selectChannel` → `ottHistPut` de canal; `removeContinueWatching` e a remoção de recentes → `ottHistRemove`; pendentes/removidos em `sint_p<id8>_histsync` (entra em `PER_PROFILE_BASES`); itens da conta viram cartões "Continuar assistindo" e "Vistos recentemente" (canais) com o minuto; abrir um cartão cujo `url` ainda não existe monta a URL a partir das credenciais Xtream atuais (`parseXtreamCredentials`) e do `ext`; se não houver credenciais, avisa. O app web usa o mesmo código (nada específico). Itens terminados não aparecem em "Continuar".
- [ ] **Step 4: Verificar** — `npm test`; `check-histsync-ui.mjs` (`?ott=1` com Capacitor simulado e fetch fingido que RECUSA rede real; valide a sintaxe do preScript): item que só a conta tem aparece em "Continuar assistindo" com título/capa/minuto; assistir (simulado) dispara `hist_put` com as chaves certas; remover dispara `hist_remove`; trocar de perfil não mistura; sem rede o local funciona e fica pendente; sem conta nenhuma RPC é chamada. Todos os `check-*.mjs` seguem `✔ ok`.
- [ ] **Step 5: Commit** — "feat(celular,web): Continuar assistindo e Vistos recentemente sincronizam com a conta" (e o bump em commit próprio).

### Task H4 (coordenação, não delegar): e2e real, publicação e entrega
E2E contra o backend real (celular e "TV" simulada pelas RPCs), publicar o site (`npm run deploy:site`, que reconstrói o app web), e — quando o Gustavo pedir — baixar IPA/APK v15 e instalar o `.ipk` na TV.
