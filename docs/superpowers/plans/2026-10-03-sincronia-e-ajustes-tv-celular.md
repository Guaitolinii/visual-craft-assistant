# Sincronia celular↔TV e ajustes de TV e celular — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) o minuto de filmes e episódios acompanha a conta (celular e TV retomam de onde o outro parou) e o envio "Assistir na TV" começa no minuto do celular e pausa o celular; (2) ajustes da TV (primeiro cartão cortado, remover do "Continuar assistindo", tela de carregamento animada, foco inicial da Início, erro ao enviar filme em andamento); (3) na tela cheia do celular, o botão de enquadramento vira "Assistir na TV".

**Architecture:** progresso por conta no Supabase (`watch_progress`, RPCs com token do aparelho, "vale o mais recente"); cada app grava a cada ~20 s e ao pausar/sair, e consulta ao abrir o item. O envio passa `positionSec`. Funções puras testadas em cada app (regra de escolha do minuto, remoção do histórico, foco), integração fina nas telas.

**Tech Stack:** Supabase SQL/RPC, TypeScript/React (TV, Chrome 53), HTML/JS puro (celular), `node:test`, Chrome CDP, TV LG real para conferência.

**Repositórios e branches** (nunca na `main`; sem push dentro das tasks; **não baixar IPA/APK/pacotes**: o Gustavo pede quando quiser):
- Backend e TV: `C:\Users\guait\Documents\Novo-App-de-TV`, branch `app-tv-ott-ativacao` (Tasks D1–D7).
- Celular: `C:\Users\guait\Documents\visual-craft-assistant`, branch `v10` (Tasks D8–D10).
- Ordem: D1 primeiro; depois a Parte TV (D2→D7) e a Parte celular (D8→D10) podem andar em paralelo (repos diferentes); D11 e D12 por último.

> 🔐 `.env.ott.local` (TV) guarda segredos: nunca imprimir; usar só via `npm run ott:*`. Limites de taxa do backend (`device_start` 20/h, `device_claim` 10/10 min): não rodar smoke/e2e em sequência sem necessidade.
> ⚠️ `sintoniza-link.html` é CRLF: nada de `sed -i`; Edit/Write ou script Node que preserve CRLF; releia antes de editar. No script principal do celular, nenhuma referência a `ott*` fora de funções; funções do `ott-core` testadas entram na lista de `tests/ott/loadOtt.js`.
> ⚠️ TV Chrome 53: sem `AbortController`/`AbortSignal.timeout`, sem `gap` em flex, sem `:is()/:where()/:has()`; datas do Postgres com `parseIsoMs`. Ao fim de cada task de TV: `npx tsc --noEmit -p .`, `npm test`; ao fim da parte TV: `npm run build:ott` + `npm run check:tv` (se `check:tv` só lê `dist/`, copie `dist-ott/assets` para uma pasta temporária e rode o script sobre ela).

## Contrato

**Chave do item** (igual nos dois apps; só ids do provedor, nunca links): `vod:<stream_id>` para filme; `ep:<episode_id>` para episódio. TV: `movie.id = vod_<stream_id>` → `vod:<stream_id>`; `episode.id = ep_<id>` → `ep:<id>`. Celular: filme `item.stream_id`; episódio `episodeId` (o mesmo `meta.id` de `playEpisode`).

**Regra do minuto** (`pickResume`): considera a posição local (com a hora em que foi gravada) e a da conta (com `updated_at`); vale a **mais recente**; se só existir uma, vale ela; descarta menos de `minSec` (TV 30 s, celular 10 s) ou a menos de 60 s do fim (filme "acabado"); devolve 0 quando não vale nada. Um `startAtSec` explícito do envio (≥ 10 s) vale mais que tudo.

**RPCs novas** (token do aparelho em `p_token`):

| RPC | Resposta |
|---|---|
| `progress_put(p_token, p_key, p_kind, p_position, p_duration)` | `{status:'ok', updated_at}` / `{status:'unknown_device'}` |
| `progress_get(p_token, p_key)` | `{status:'ok', found:false}` ou `{status:'ok', found:true, position_sec, duration_sec, updated_at}` |
| `progress_clear(p_token, p_key)` | `{status:'ok'}` |

**Payload do envio** ganha `positionSec` (inteiro ≥ 0) em `vod` e `episode`.

---

# PARTE 1 — Backend (repositório `Novo-App-de-TV`)

### Task D1: Migração 0008 — progresso por conta

**Files:**
- Create: `supabase/migrations/0008_ott_progress.sql`
- Modify: `scripts/ott-smoke.mjs` (verificações novas antes do resumo final; helpers `check`, `rpc`, `jwt`)

- [ ] **Step 1: Migração**

```sql
-- 0008: progresso de filmes e episódios por conta (continuar de onde parou em qualquer aparelho).
-- Ninguém acessa a tabela direto: só pelas funções (security definer, token do aparelho).

create table if not exists public.watch_progress (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  item_key     text not null,
  kind         text not null check (kind in ('vod', 'episode')),
  position_sec integer not null check (position_sec >= 0),
  duration_sec integer not null default 0 check (duration_sec >= 0),
  by_device    uuid references public.devices(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table public.watch_progress enable row level security;
revoke all on public.watch_progress from anon, authenticated;

create or replace function public.progress_put(p_token text, p_key text, p_kind text, p_position integer, p_duration integer)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
  v_at timestamptz;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  perform public.check_rate('prog:' || d.id::text, 120, interval '1 minute');
  if p_key is null or p_key !~ '^(vod|ep):[A-Za-z0-9_-]{1,50}$' then
    raise exception 'Item inválido.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('vod', 'episode') then
    raise exception 'Tipo inválido.' using errcode = 'P0001';
  end if;
  insert into public.watch_progress (user_id, item_key, kind, position_sec, duration_sec, by_device, updated_at)
  values (d.user_id, p_key, p_kind, greatest(coalesce(p_position, 0), 0), greatest(coalesce(p_duration, 0), 0), d.id, now())
  on conflict (user_id, item_key) do update
     set kind = excluded.kind, position_sec = excluded.position_sec, duration_sec = excluded.duration_sec,
         by_device = excluded.by_device, updated_at = now()
  returning updated_at into v_at;
  delete from public.watch_progress where user_id = d.user_id and updated_at < now() - interval '90 days';
  return json_build_object('status', 'ok', 'updated_at', v_at);
end;
$$;

create or replace function public.progress_get(p_token text, p_key text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
  w public.watch_progress;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  select * into w from public.watch_progress where user_id = d.user_id and item_key = p_key;
  if not found then
    return json_build_object('status', 'ok', 'found', false);
  end if;
  return json_build_object('status', 'ok', 'found', true, 'position_sec', w.position_sec,
                           'duration_sec', w.duration_sec, 'updated_at', w.updated_at);
end;
$$;

create or replace function public.progress_clear(p_token text, p_key text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  delete from public.watch_progress where user_id = d.user_id and item_key = p_key;
  return json_build_object('status', 'ok');
end;
$$;

revoke execute on function public.progress_put(text, text, text, integer, integer) from public;
revoke execute on function public.progress_get(text, text) from public;
revoke execute on function public.progress_clear(text, text) from public;
grant execute on function public.progress_put(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.progress_get(text, text) to anon, authenticated;
grant execute on function public.progress_clear(text, text) to anon, authenticated;
```

- [ ] **Step 2: Smoke** (antes do resumo final; cria uma TV e um celular na conta de teste, como na seção de cast)

```js
// Progresso por conta
const tvP = await rpc('device_start', { p_modelo: 'TV Progresso Smoke', p_sistema: 'webOS' });
const celP = await rpc('device_start', { p_modelo: 'Celular Progresso Smoke', p_sistema: 'Android', p_tipo: 'celular' });
await rpc('device_claim', { p_code: tvP.data.code }, jwt);
await rpc('device_claim', { p_code: celP.data.code }, jwt);
const tokTvP = tvP.data.device_token;
const tokCelP = celP.data.device_token;

const semNada = await rpc('progress_get', { p_token: tokCelP, p_key: 'vod:99001' });
check('progress_get sem registro devolve found=false', semNada.data.status === 'ok' && semNada.data.found === false);
const gravou = await rpc('progress_put', { p_token: tokTvP, p_key: 'vod:99001', p_kind: 'vod', p_position: 1234, p_duration: 6000 });
check('progress_put grava o minuto (TV)', gravou.status === 200 && gravou.data.status === 'ok', JSON.stringify(gravou.data));
const leu = await rpc('progress_get', { p_token: tokCelP, p_key: 'vod:99001' });
check('o celular lê o minuto gravado pela TV', leu.data.found === true && leu.data.position_sec === 1234 && leu.data.duration_sec === 6000, JSON.stringify(leu.data));
await rpc('progress_put', { p_token: tokCelP, p_key: 'vod:99001', p_kind: 'vod', p_position: 2000, p_duration: 6000 });
const novo = await rpc('progress_get', { p_token: tokTvP, p_key: 'vod:99001' });
check('o último a gravar vale (celular → TV)', novo.data.position_sec === 2000);
const ruimP = await rpc('progress_put', { p_token: tokTvP, p_key: 'x;drop', p_kind: 'vod', p_position: 1, p_duration: 1 });
check('progress_put recusa chave inválida', ruimP.status >= 400 && /inválido/i.test((ruimP.data && ruimP.data.message) || ''), JSON.stringify(ruimP.data));
const falso = await rpc('progress_get', { p_token: 'falso', p_key: 'vod:99001' });
check('progress_get com token falso devolve unknown_device', falso.data.status === 'unknown_device');
await rpc('progress_clear', { p_token: tokTvP, p_key: 'vod:99001' });
const limpo = await rpc('progress_get', { p_token: tokCelP, p_key: 'vod:99001' });
check('progress_clear apaga o registro', limpo.data.found === false);
await rpc('device_unlink', { p_token: tokTvP });
await rpc('device_unlink', { p_token: tokCelP });
```

- [ ] **Step 3: Aplicar e verificar**

Run: `npm run ott:setup` e depois `npm run ott:smoke`
Expected: todas as linhas `OK` (antigas e novas) e `[ott] Tudo certo.`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_ott_progress.sql scripts/ott-smoke.mjs
git commit -m "feat(backend): progresso de filmes e episódios por conta (progress_put/get/clear)"
```

---

# PARTE 2 — TV (repositório `Novo-App-de-TV`, branch `app-tv-ott-ativacao`)

### Task D2: Regra do minuto e cliente de progresso (puro, testado)

**Files:**
- Create: `src/services/progressSync.ts`
- Test: `tests/progress-sync.test.ts`

> Leia antes `src/services/ott.ts` (`callRpc`, `OttConfig`, `parseIsoMs`) e `src/services/history.ts` (`resumeAt`, `HistoryEntry`).

- [ ] **Step 1: Teste (deve falhar)**

```ts
// Progresso por conta: chave do item, regra do minuto e chamadas das RPCs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressKey, pickResume, progressGet, progressPut, progressClear, PROGRESS_PUSH_MS } from '../src/services/progressSync';

const cfg = { url: 'https://x.supabase.co', anonKey: 'k' } as any;
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: any }[] = [];
  const f = async (url: string, init: any) => {
    calls.push({ url, init });
    const text = JSON.stringify(body);
    return { ok: status < 400, status, text: async () => text, json: async () => body } as any;
  };
  (f as any).calls = calls;
  return f as any;
}

test('chave do item: filme e episódio; canal não sincroniza', () => {
  assert.equal(progressKey({ type: 'movie', id: 'vod_123' }), 'vod:123');
  assert.equal(progressKey({ type: 'episode', id: 'ep_77' }), 'ep:77');
  assert.equal(progressKey({ type: 'channel', id: 'ch_1' }), null);
  assert.equal(progressKey({ type: 'movie', id: 'estranho' }), null);
  assert.equal(progressKey({ type: 'movie', id: 'vod_12;x' }), null);
});

const T = (iso: string) => Date.parse(iso);

test('o mais recente vale: conta mais nova que a local', () => {
  const r = pickResume({ localSec: 100, localTs: T('2026-10-03T10:00:00Z'), serverSec: 2000, serverTs: T('2026-10-03T11:00:00Z'), durationSec: 6000, minSec: 30 });
  assert.equal(r, 2000);
});

test('o mais recente vale: local mais novo que a conta', () => {
  const r = pickResume({ localSec: 3000, localTs: T('2026-10-03T12:00:00Z'), serverSec: 2000, serverTs: T('2026-10-03T11:00:00Z'), durationSec: 6000, minSec: 30 });
  assert.equal(r, 3000);
});

test('só uma das posições existe', () => {
  assert.equal(pickResume({ localSec: 0, localTs: 0, serverSec: 900, serverTs: T('2026-10-03T11:00:00Z'), durationSec: 6000, minSec: 30 }), 900);
  assert.equal(pickResume({ localSec: 900, localTs: T('2026-10-03T11:00:00Z'), serverSec: 0, serverTs: 0, durationSec: 6000, minSec: 30 }), 900);
});

test('descarta começo curto e final do filme', () => {
  assert.equal(pickResume({ localSec: 10, localTs: 5, serverSec: 0, serverTs: 0, durationSec: 6000, minSec: 30 }), 0);
  assert.equal(pickResume({ localSec: 5950, localTs: 5, serverSec: 0, serverTs: 0, durationSec: 6000, minSec: 30 }), 0);
  assert.equal(pickResume({ localSec: 5950, localTs: 5, serverSec: 0, serverTs: 0, durationSec: 0, minSec: 30 }), 5950);
});

test('posição do envio (startAtSec) vale mais que tudo', () => {
  const r = pickResume({ startAtSec: 1500, localSec: 3000, localTs: T('2026-10-03T12:00:00Z'), serverSec: 2000, serverTs: T('2026-10-03T13:00:00Z'), durationSec: 6000, minSec: 30 });
  assert.equal(r, 1500);
  const curto = pickResume({ startAtSec: 4, localSec: 3000, localTs: T('2026-10-03T12:00:00Z'), serverSec: 0, serverTs: 0, durationSec: 6000, minSec: 30 });
  assert.equal(curto, 3000);
});

test('progressGet interpreta a resposta e as datas do Postgres', async () => {
  const f = fakeFetch({ status: 'ok', found: true, position_sec: 1234, duration_sec: 6000, updated_at: '2026-10-03T11:00:00.123456+00:00' });
  assert.deepEqual(await progressGet(cfg, 'tok', 'vod:1', f), { sec: 1234, durationSec: 6000, ts: Date.UTC(2026, 9, 3, 11, 0, 0, 123) });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: 'tok', p_key: 'vod:1' });
  assert.equal(await progressGet(cfg, 'tok', 'vod:1', fakeFetch({ status: 'ok', found: false })), null);
  assert.equal(await progressGet(cfg, 'tok', 'vod:1', fakeFetch({ status: 'unknown_device' })), null);
});

test('progressPut e progressClear chamam as RPCs', async () => {
  const f = fakeFetch({ status: 'ok' });
  await progressPut(cfg, 'tok', 'ep:7', 'episode', 321.9, 2400.2, f);
  assert.ok(f.calls[0].url.endsWith('/rest/v1/rpc/progress_put'));
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: 'tok', p_key: 'ep:7', p_kind: 'episode', p_position: 321, p_duration: 2400 });
  const g = fakeFetch({ status: 'ok' });
  await progressClear(cfg, 'tok', 'ep:7', g);
  assert.ok(g.calls[0].url.endsWith('/rest/v1/rpc/progress_clear'));
  assert.ok(PROGRESS_PUSH_MS >= 15000);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --import tsx --test tests/progress-sync.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/services/progressSync.ts`**

```ts
// Progresso de filmes e episódios por conta: celular e TV retomam de onde o outro parou.
// Só ids do provedor viajam (nunca links). Sem DOM; fetch puro via callRpc (Chrome 53).
import { callRpc, parseIsoMs, type OttConfig } from './ott';

export const PROGRESS_PUSH_MS = 20000;
type FetchLike = (url: string, init?: any) => Promise<any>;

// Chave do item na conta; canal e ids estranhos não sincronizam
export function progressKey(item: { type: string; id: string }): string | null {
  const m = /^(vod|ep)_([A-Za-z0-9-]{1,50})$/.exec(item.id || '');
  if (!m) return null;
  if (item.type === 'movie' && m[1] === 'vod') return 'vod:' + m[2];
  if (item.type === 'episode' && m[1] === 'ep') return 'ep:' + m[2];
  return null;
}

export interface ResumeInput {
  startAtSec?: number; // posição pedida pelo envio do celular
  localSec: number;
  localTs: number;
  serverSec: number;
  serverTs: number;
  durationSec: number;
  minSec: number;
}

// Qual minuto usar ao abrir: envio explícito > o mais recente entre local e conta; 0 = começar do início
export function pickResume(i: ResumeInput): number {
  if (i.startAtSec && i.startAtSec >= 10) return Math.floor(i.startAtSec);
  let sec = 0;
  if (i.localSec > 0 && i.serverSec > 0) sec = i.serverTs > i.localTs ? i.serverSec : i.localSec;
  else sec = i.localSec > 0 ? i.localSec : i.serverSec;
  if (sec < i.minSec) return 0;
  if (i.durationSec > 0 && sec > i.durationSec - 60) return 0;
  return Math.floor(sec);
}

export interface ServerProgress { sec: number; durationSec: number; ts: number }

export async function progressGet(cfg: OttConfig, token: string, key: string, fetchImpl?: FetchLike): Promise<ServerProgress | null> {
  const data: any = await callRpc(cfg, 'progress_get', { p_token: token, p_key: key }, fetchImpl);
  if (!data || data.status !== 'ok' || data.found !== true) return null;
  return { sec: Number(data.position_sec) || 0, durationSec: Number(data.duration_sec) || 0, ts: parseIsoMs(String(data.updated_at || '')) };
}

export async function progressPut(cfg: OttConfig, token: string, key: string, kind: 'vod' | 'episode', positionSec: number, durationSec: number, fetchImpl?: FetchLike): Promise<void> {
  await callRpc(cfg, 'progress_put', { p_token: token, p_key: key, p_kind: kind, p_position: Math.floor(positionSec), p_duration: Math.floor(durationSec) }, fetchImpl);
}

export async function progressClear(cfg: OttConfig, token: string, key: string, fetchImpl?: FetchLike): Promise<void> {
  await callRpc(cfg, 'progress_clear', { p_token: token, p_key: key }, fetchImpl);
}
```

(Se `parseIsoMs` não for exportado de `ott.ts`, exporte-o: mudança mínima.)

- [ ] **Step 4: Rodar e ver passar** — `node --import tsx --test tests/progress-sync.test.ts && npx tsc --noEmit -p . && npm test` → PASS.

- [ ] **Step 5: Commit** — `git add src/services/progressSync.ts tests/progress-sync.test.ts && git commit -m "feat(tv): regra do minuto e cliente do progresso por conta"`

---

### Task D3: Player da TV usa o progresso da conta e o minuto do envio

**Files:**
- Modify: `src/components/PlayerView.tsx` (abertura `:341-365`, `onTimeUpdate` `:390-399`, `onLoadedMetadata` `:400-411`, desmontagem `:368-383`)
- Modify: `src/context/TvNavigationContext.tsx` (`ActivePlayerState` ganha `startAtSec?: number`)
- Modify: `src/services/castResolve.ts` (devolve `startAtSec` do `payload.positionSec`)
- Test: acrescentar em `tests/cast.test.ts`

- [ ] **Step 1: Testes do resolvedor (devem falhar)** — acrescentar em `tests/cast.test.ts`:

```ts
test('o minuto do celular vira startAtSec no filme e no episódio', async () => {
  const f = await resolveCast({ id: '1', kind: 'vod', payload: { streamId: '10', title: 'Filme X', year: 2023, positionSec: 754 }, from: '' }, deps());
  assert.ok(f.ok && f.player.startAtSec === 754);
  const e = await resolveCast({ id: '1', kind: 'episode', payload: { seriesId: '7', title: 'Série Y', season: 2, episode: 5, positionSec: 90 }, from: '' }, deps());
  assert.ok(e.ok && e.player.startAtSec === 90);
  const sem = await resolveCast({ id: '1', kind: 'vod', payload: { streamId: '10', title: 'Filme X', year: 2023 }, from: '' }, deps());
  assert.ok(sem.ok && sem.player.startAtSec === undefined);
});
```

Run: `node --import tsx --test tests/cast.test.ts` → FAIL.

- [ ] **Step 2: Implementar o resolvedor** — em `castResolve.ts`, função auxiliar e uso nos dois retornos (`resolveMovie`, `resolveEpisode`):

```ts
// Minuto do celular (segundos inteiros ≥ 0); ausente = não pedido
function startAt(p: Record<string, unknown>): number | undefined {
  const n = parseInt(str(p.positionSec), 10);
  return n >= 0 ? n : undefined;
}
```
e no `player` de filme e de episódio acrescentar `startAtSec: startAt(p)` (ajuste o `as ActivePlayerState`). Em `TvNavigationContext.tsx`, acrescentar `startAtSec?: number;` em `ActivePlayerState`.

Run: `node --import tsx --test tests/cast.test.ts` → PASS.

- [ ] **Step 3: Integrar no `PlayerView.tsx`** (sem teste de unidade: a regra já é testada; conferência no Chrome/TV na D11). Desenho:

1. No effect de abertura (`[histKey]`), para filme/episódio com conta ativa (`ottConfig` e token em `OTT_KEYS.DEVICE_TOKEN`) e `progressKey(...)` não nulo: disparar `progressGet(...)` e guardar o resultado em `serverProgressRef.current = { sec, durationSec, ts } | null` (falha de rede = `null`, sem erro na tela).
2. Em `onLoadedMetadata` (hoje usa `resumeAt(entry)`): trocar a decisão por
```ts
const entry = historyStore.get().find((e) => e.key === histKeyRef.current);
const at = pickResume({
  startAtSec: activePlayer.startAtSec,
  localSec: entry ? entry.positionSec || 0 : 0,
  localTs: entry ? entry.updatedAt : 0,
  serverSec: serverProgressRef.current ? serverProgressRef.current.sec : 0,
  serverTs: serverProgressRef.current ? serverProgressRef.current.ts : 0,
  durationSec: video.duration || (entry ? entry.durationSec || 0 : 0),
  minSec: 30,
});
if (at > 0) { video.currentTime = at; /* mantém o aviso "Continuando de mm:ss" existente */ }
```
Sem conta ativa o resultado equivale ao `resumeAt` de hoje (só local). O `startAtSec` vale uma única vez por abertura (`resumeCheckedRef` já garante).
3. Em `onTimeUpdate`, onde hoje grava a cada 15 s (`saveProgress`): também chamar `progressPut(...)` no máximo a cada `PROGRESS_PUSH_MS` (ref com a hora do último envio), só para filme/episódio, com `.catch(() => {})`.
4. Ao desmontar (`:368-383`) e quando o vídeo termina: no desmontar, enviar a última posição (`progressPut`, fire-and-forget); ao terminar (≥ duração − 60 s, mesma regra de `resumeAt`) chamar `progressClear`.
5. Nada disso pode chamar `setState` a cada tick; só refs. Falha de rede nunca interrompe a reprodução.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit -p . && npm test` (tudo verde).

- [ ] **Step 5: Commit** — `git add src tests && git commit -m "feat(tv): player retoma pelo minuto mais recente da conta e pelo minuto do envio"`

---

### Task D4: Erro "Conteúdo indisponível" ao enviar filme em andamento

**Files:**
- Modify: `src/components/PlayerView.tsx` (`onError`/`failStepRef`, retomada)
- Modify: `src/services/castResolve.ts` e `src/App.tsx` (`castDeps.getMovieById`)
- Test: `tests/cast.test.ts`

Hipóteses do mapa (confirmar antes de corrigir): (1) o `seek` da retomada logo no `loadedmetadata` faz o `<video>` falhar (provedor sem Range) e "Tentar novamente" repete o mesmo seek; (2) `getVodMovieDetail` sem `fallback` monta `streamUrl` com extensão `.mp4` por omissão quando o arquivo real é outra.

- [ ] **Step 1: Reproduzir e ler o erro real** (sistemático, antes de mexer): na TV de teste (192.168.1.13; porta 9922 aberta; CDP 9998; ver memória `lg-tv-acesso-dev.md`), SEM alterar vínculo nem apagar histórico, enviar pelas RPCs (como o celular, conta de teste ligando uma TV de teste via troca temporária do token **somente se imprescindível, restaurando depois**) o filme que está no histórico, e ler via CDP o `video.error.code`, `video.src` e o `currentTime` do momento da falha; comparar o `streamUrl` do `activePlayer` com o do histórico (`localStorage.sintoniza_history`). Registrar o que foi visto. Se a TV não estiver acessível, seguir para o Step 2 e implementar ambas as correções defensivas.

- [ ] **Step 2: Teste do resolvedor com a listagem (deve falhar)** — em `tests/cast.test.ts`:

```ts
test('filme: prefere o item da listagem (extensão correta) ao detalhe sem extensão', async () => {
  const d = deps({
    getMovieById: async () => ({ id: 'vod_10', title: 'Filme X', year: 2023, streamUrl: 'http://v/10.mp4' } as any),
    findListedMovie: async (id) => (id === 'vod_10' ? ({ id: 'vod_10', title: 'Filme X', year: 2023, streamUrl: 'http://v/10.mkv' } as any) : null),
  });
  const r = await resolveCast({ id: '1', kind: 'vod', payload: { streamId: '10', title: 'Filme X', year: 2023 }, from: '' }, d);
  assert.ok(r.ok && r.player.streamUrl === 'http://v/10.mkv');
});
```

- [ ] **Step 3: Implementar** — `CastDeps` ganha `findListedMovie?(id: string): Promise<Movie | null>` (opcional); em `resolveMovie`, antes de `getMovieById`: se `deps.findListedMovie` existir, tentar `await deps.findListedMovie('vod_' + streamId)` (com try/catch) e usar se tiver `streamUrl`. Em `App.tsx`, `findListedMovie` busca no índice/lista que o `api.ts` já mantém (`movieById`, ou `getVodMovies({ q: <título>, ... })` filtrando `id`), nunca montando URL por omissão.

- [ ] **Step 4: Retomada segura no `PlayerView`** — se o `<video>` falhar (`error`) **depois de um seek de retomada** (flag `resumedRef.current === true` e `currentTime` ainda < 2 s ou `error.code` 3/4): refazer UMA vez o carregamento **sem retomada** (`startOverRef.current = true`, ignorar `pickResume` nessa tentativa) antes de mostrar "Conteúdo indisponível"; nesse caso mostrar o aviso "Não foi possível continuar do minuto salvo; começando do início". "Tentar novamente" também deve começar do início quando a falha anterior foi pós-seek.

- [ ] **Step 5: Testes e verificação** — `node --import tsx --test tests/cast.test.ts && npx tsc --noEmit -p . && npm test`. Se o Step 1 revelou outra causa, corrigir essa (menor mudança, com teste quando for lógica pura) e dizer no relatório.

- [ ] **Step 6: Commit** — `git add src tests && git commit -m "fix(tv): enviar filme em andamento não cai em 'Conteúdo indisponível' (listagem e retomada segura)"`

---

### Task D5: Primeiro cartão cortado e remover do "Continuar assistindo"

**Files:**
- Modify: `src/services/history.ts` (`removeEntry` puro; `historyStore.remove`)
- Modify: `src/components/HomeView.tsx` (`:271-313`)
- Modify: `src/context/TvNavigationContext.tsx` (`TvFocusable` com `onLongPress`; teclado)
- Create: `src/components/HistoryRemoveSheet.tsx`
- Test: `tests/history-remove.test.ts`

- [ ] **Step 1: Teste (deve falhar)**

```ts
// Remover item do "Continuar assistindo" e escolher o foco seguinte
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeEntry, neighborAfterRemove } from '../src/services/history';

const e = (key: string) => ({ key, type: 'movie', id: key, title: key, streamUrl: 'x', updatedAt: 1 }) as any;

test('remove só a entrada pedida', () => {
  const list = [e('movie:vod_1'), e('movie:vod_2'), e('episode:ep_3')];
  assert.deepEqual(removeEntry(list, 'movie:vod_2').map((x: any) => x.key), ['movie:vod_1', 'episode:ep_3']);
  assert.equal(removeEntry(list, 'nao:existe').length, 3);
});

test('o foco vai para o vizinho de depois; o último vai para o anterior; lista vazia = null', () => {
  const keys = ['a', 'b', 'c'];
  assert.equal(neighborAfterRemove(keys, 'a'), 'b');
  assert.equal(neighborAfterRemove(keys, 'b'), 'c');
  assert.equal(neighborAfterRemove(keys, 'c'), 'b');
  assert.equal(neighborAfterRemove(['a'], 'a'), null);
  assert.equal(neighborAfterRemove(keys, 'zzz'), null);
});
```

Run: `node --import tsx --test tests/history-remove.test.ts` → FAIL.

- [ ] **Step 2: Implementar em `history.ts`**

```ts
// Remove uma entrada do histórico (lista nova; a original não muda)
export function removeEntry(list: HistoryEntry[], key: string): HistoryEntry[] {
  return list.filter((e) => e.key !== key);
}

// Para onde vai o foco depois de remover: o de depois, senão o de antes, senão ninguém
export function neighborAfterRemove(keys: string[], removed: string): string | null {
  const i = keys.indexOf(removed);
  if (i < 0) return null;
  if (i + 1 < keys.length) return keys[i + 1];
  return i > 0 ? keys[i - 1] : null;
}
```
e no `historyStore` (`:147-163`) acrescentar `remove(key: string)` = `commit(removeEntry(<lista atual>, key), true)` seguindo o padrão do `record`/`clear` existentes (mesma função de persistência e notificação).

- [ ] **Step 3: Cartão cortado** — em `HomeView.tsx:277` o trilho `flex items-stretch gap-5 overflow-x-auto no-scrollbar py-2 px-1` corta o anel de foco (box-shadow 6 px + `scale(1.03)` ≈ 15 px) no primeiro cartão. Trocar o respiro por `px-4 py-3` e compensar o alinhamento com margem negativa equivalente no contêiner do trilho (`-mx-4`), mantendo o `computeScrollLeft` (`scrollFocus.ts`) funcionando. Sem `gap` em flex no Chrome 53: o projeto já tem a classe `no-flex-gap`; se `gap-5` for substituído pelo projeto, manter o mesmo padrão usado nas outras linhas.

- [ ] **Step 4: Segurar OK abre "Remover"** — mudança **isolada**: só nós com `onLongPress` passam a agir no `keyup`; o resto da TV continua igual.
  - `TvFocusable` aceita `onLongPress?: () => void`.
  - No tratamento de `Enter`/espaço (`TvNavigationContext.tsx:484-604`): se o nó focado tem `onLongPress`: no primeiro `keydown` (`!e.repeat`) guardar `enterDownAt = Date.now()` e `enterConsumed = false` e **não** selecionar; em `keydown` repetido (`e.repeat`) com `Date.now() - enterDownAt >= 600` e `!enterConsumed`: `enterConsumed = true` e chamar `onLongPress()`. Acrescentar um `keyup` para `Enter`/espaço: se o nó tem `onLongPress` e `!enterConsumed` → fazer o `select` normal (toque curto abre o filme). Nós sem `onLongPress` seguem no `keydown` como hoje.
  - `HistoryRemoveSheet.tsx`: pequena camada (`FocusLayer` + `useBackLayer`, padrão do `MovieDetailModal`) com o título do item e dois botões focáveis: "Remover do histórico" e "Cancelar" (foco inicial em "Cancelar"). Remover chama `historyStore.remove(key)` e `setFocusedKey(neighborAfterRemove(...))` (ou o título da linha se não houver vizinho). Back fecha.
  - Dica visível abaixo do título "Continuar Assistindo": texto discreto "Segure OK para remover".
  - O histórico também alimenta "Vistos recentemente" (Canais/Filmes/Séries): remover some de lá também (comportamento desejado; mencionar no relatório).
  - Ao remover, se a conta estiver ativa e a entrada for filme/episódio, chamar também `progressClear` (fire-and-forget), para o minuto não "voltar" do celular.

- [ ] **Step 5: Verificar** — `node --import tsx --test tests/history-remove.test.ts && npx tsc --noEmit -p . && npm test`; conferir no Chrome do PC (`npm run dev` com a lista de teste, ou o servidor de mock do repo) que o primeiro cartão não é cortado (captura) e que segurar Enter no cartão abre a folha, Enter curto abre o filme, remover foca o vizinho.

- [ ] **Step 6: Commit** — `git add src tests && git commit -m "feat(tv): remover do Continuar assistindo (segurar OK) e primeiro cartão sem corte"`

---

### Task D6: Foco e rolagem inicial da Início

**Files:**
- Modify: `src/components/HomeView.tsx` (efeito de chegada do herói)
- Create: `src/context/homeFocus.ts`
- Test: `tests/home-focus.test.ts`

- [ ] **Step 1: Teste (deve falhar)**

```ts
// Foco inicial da Início: quando o destaque chega depois, o foco volta para ele e a tela para o topo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFocusHeroOnArrival } from '../src/context/homeFocus';

test('o destaque chegou e o usuário ainda não mexeu: foca o destaque', () => {
  assert.equal(shouldFocusHeroOnArrival({ hasFeatured: true, focusedKey: 'home-channels-block', userMoved: false }), true);
});
test('sem destaque, ou usuário já navegou, ou foco em outro lugar: não mexe', () => {
  assert.equal(shouldFocusHeroOnArrival({ hasFeatured: false, focusedKey: 'home-channels-block', userMoved: false }), false);
  assert.equal(shouldFocusHeroOnArrival({ hasFeatured: true, focusedKey: 'home-channels-block', userMoved: true }), false);
  assert.equal(shouldFocusHeroOnArrival({ hasFeatured: true, focusedKey: 'history-item-x', userMoved: false }), false);
});
```

- [ ] **Step 2: Implementar `homeFocus.ts`**

```ts
// O destaque (herói) da Início só aparece depois que o catálogo carrega e empurra os blocos para baixo.
// Se o usuário ainda não navegou e o foco continua no bloco inicial, o foco deve ir para o destaque.
export function shouldFocusHeroOnArrival(i: { hasFeatured: boolean; focusedKey: string; userMoved: boolean }): boolean {
  return i.hasFeatured && !i.userMoved && i.focusedKey === 'home-channels-block';
}
```

- [ ] **Step 3: Ligar no `HomeView.tsx`** — `userMoved` = ref que vira `true` na primeira tecla de direção/mouse do usuário (ouça o mesmo canal de teclas que o contexto usa ou um listener `keydown` de setas só enquanto a Início está montada). Efeito: quando `featured` passar de nulo para definido e `shouldFocusHeroOnArrival(...)` for verdadeiro → `setFocusedKey('hero-watch-btn')` e `window.scrollTo(0, 0)`. Também chamar `window.scrollTo(0, 0)` na montagem da Início (já existe `scrollTo` ao trocar de seção; confirmar que cobre a montagem inicial).

- [ ] **Step 4: Verificar** — `node --import tsx --test tests/home-focus.test.ts && npx tsc --noEmit -p . && npm test`; no Chrome do PC com atraso artificial no catálogo (ou mock), conferir por captura que ao abrir a Início o destaque aparece inteiro, sem cortar, sem mexer o controle.

- [ ] **Step 5: Commit** — `git add src tests && git commit -m "fix(tv): Início abre com o destaque inteiro (foco e rolagem quando o catálogo chega)"`

---

### Task D7: Tela de carregamento animada (abertura, OTT e Início)

**Files:**
- Modify: `src/components/ott/OttGate.tsx` (estado `booting`, `:244-250`)
- Modify: `src/App.tsx` (`:298-300` "Carregando lista de canais...")
- Modify: `index.html` (primeiro quadro antes do React) e `public/loader/*.svg` (cópias das camadas)
- Modify: `src/index.css` (CSS crítico, se necessário)

Fato do mapa: o `LogoLoader` (camadas `opacity`/`transform`, que seguem animando com a thread principal ocupada) só é usado nas grades de catálogo. A abertura mostra tela escura e depois a logo **estática** com `animate-pulse`.

- [ ] **Step 1: Medir antes** — se a TV estiver acessível, rodar `scripts/diag-tv/tv-loader-record.mjs` (se existir; senão gravar com `Page.startScreencast` como nas notas da memória) e registrar quantos quadros distintos há durante o carregamento; fechar o item "Testar na TV" do plano `2026-09-30-logo-vetorial-em-todos-os-apps.md`. Se inacessível, anotar "não medido".

- [ ] **Step 2: Implementar**
  - `OttGate` em `booting`: trocar a `<img logoMark animate-pulse>` pelo componente `LogoLoader` (mantendo o texto "Conectando ao Sintoniza...").
  - `App.tsx` "Carregando lista de canais...": usar `LogoLoader` com o texto.
  - `index.html`: dentro de `<div id="root">` colocar o mesmo marcado do `LogoLoader` (as 5 camadas `<img>` apontando para `loader/base.svg`, `onda1..3.svg`, `antena.svg` em `public/loader/`, copiadas de `src/assets/loader/`) com o CSS crítico (`.logo-loader`, `.logo-camada`, `@keyframes`) em um `<style>` do próprio `index.html`, para a animação começar **antes** do bundle de ~1,4 MB parsear (animação de opacidade roda no compositor). O React substitui o conteúdo do `#root` ao montar. Caminhos relativos (sem `/` inicial) para funcionar dentro do pacote `.ipk`.
  - Sem `gap`, `:is()`, `:where()`; só `opacity`/`transform`.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit -p . && npm test && npm run build:ott && npm run check:tv` (ver nota do topo). No Chrome do PC: abrir `dist-ott/index.html` com a rede estrangulada e confirmar por capturas seguidas que a logo anima antes do app aparecer. Na TV, se acessível, instalar o `.ipk` e gravar de novo (Step 1) comparando.

- [ ] **Step 4: Commit** — `git add index.html public src && git commit -m "feat(tv): carregamento animado na abertura, no OTT e na Início"`

---

# PARTE 3 — Celular (repositório `visual-craft-assistant`, branch `v10`)

Linha de base: `npm test` = 249 verdes. Os `scripts/dev/check-*.mjs` abrem com `?noott=1` e fingem o backend.

### Task D8: `ott-core`: minuto da conta e posição no envio (testado)

**Files:**
- Modify: `sintoniza-link.html` (`<script id="ott-core">`)
- Modify: `tests/ott/loadOtt.js` (lista exposta)
- Test: `tests/ott/progress.test.js`

- [ ] **Step 1: Teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };
const T = (iso) => Date.parse(iso);

test("chave do item na conta: filme e episódio; lixo vira null", () => {
  const o = loadOtt();
  assert.equal(o.ottProgressKey("vod", "123"), "vod:123");
  assert.equal(o.ottProgressKey("episode", "77"), "ep:77");
  assert.equal(o.ottProgressKey("vod", ""), null);
  assert.equal(o.ottProgressKey("vod", "12;x"), null);
  assert.equal(o.ottProgressKey("channel", "1"), null);
});

test("regra do minuto: o mais recente vale; começo curto e final são descartados", () => {
  const o = loadOtt();
  const base = { localSec: 0, localTs: 0, serverSec: 0, serverTs: 0, durationSec: 6000, minSec: 10 };
  assert.equal(o.ottPickResume({ ...base, localSec: 100, localTs: T("2026-10-03T10:00:00Z"), serverSec: 2000, serverTs: T("2026-10-03T11:00:00Z") }), 2000);
  assert.equal(o.ottPickResume({ ...base, localSec: 3000, localTs: T("2026-10-03T12:00:00Z"), serverSec: 2000, serverTs: T("2026-10-03T11:00:00Z") }), 3000);
  assert.equal(o.ottPickResume({ ...base, serverSec: 900, serverTs: 5 }), 900);
  assert.equal(o.ottPickResume({ ...base, localSec: 5, localTs: 5 }), 0);
  assert.equal(o.ottPickResume({ ...base, localSec: 5950, localTs: 5 }), 0);
});

test("lê, grava e apaga o progresso na conta", async () => {
  const o = loadOtt();
  const g = fakeFetch(() => ({ body: { status: "ok", found: true, position_sec: 1234, duration_sec: 6000, updated_at: "2026-10-03T11:00:00.123456+00:00" } }));
  assert.deepEqual(plain(await o.ottProgressGet(cfg, "tok", "vod:1", g)), { sec: 1234, durationSec: 6000, ts: Date.UTC(2026, 9, 3, 11, 0, 0, 123) });
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: "tok", p_key: "vod:1" });
  assert.equal(await o.ottProgressGet(cfg, "tok", "vod:1", fakeFetch(() => ({ body: { status: "ok", found: false } }))), null);
  const p = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressPut(cfg, "tok", "ep:7", "episode", 321.9, 2400.2, p);
  assert.deepEqual(JSON.parse(p.calls[0].init.body), { p_token: "tok", p_key: "ep:7", p_kind: "episode", p_position: 321, p_duration: 2400 });
  const c = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressClear(cfg, "tok", "ep:7", c);
  assert.ok(c.calls[0].url.endsWith("/rpc/progress_clear"));
});

test("o envio leva a posição atual (positionSec) em filme e episódio, não em canal", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "Filme X", year: "2023" }, { positionSec: 754.8 })), { streamId: "10", title: "Filme X", year: 2023, positionSec: 754 });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "Filme X" })), { streamId: "10", title: "Filme X", year: 0 });
  assert.deepEqual(plain(o.ottBuildCastPayload("episode", { series_id: 7, name: "Série Y" }, { season: "2", episode: "5", positionSec: 90 })), { seriesId: "7", title: "Série Y", season: 2, episode: 5, positionSec: 90 });
  assert.deepEqual(plain(o.ottBuildCastPayload("channel", { name: "Globo" }, { positionSec: 99 })), { name: "Globo", group: "" });
});
```

Run: `node --test "tests/ott/*.test.js"` → FAIL.

- [ ] **Step 2: Implementar no `ott-core`** (junto das funções de cast)

```js
// ── Progresso por conta (celular e TV retomam de onde o outro parou) ──
function ottProgressKey(kind, id) {
  const clean = String(id == null ? "" : id).trim();
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(clean)) return null;
  if (kind === "vod") return "vod:" + clean;
  if (kind === "episode") return "ep:" + clean;
  return null;
}

// Qual minuto usar: o mais recente entre o local e o da conta; descarta começo curto e final do filme
function ottPickResume(i) {
  let sec = 0;
  if (i.localSec > 0 && i.serverSec > 0) sec = i.serverTs > i.localTs ? i.serverSec : i.localSec;
  else sec = i.localSec > 0 ? i.localSec : i.serverSec;
  if (sec < i.minSec) return 0;
  if (i.durationSec > 0 && sec > i.durationSec - 60) return 0;
  return Math.floor(sec);
}

async function ottProgressGet(cfg, token, key, fetchImpl) {
  const data = await ottCallRpc(cfg, "progress_get", { p_token: token, p_key: key }, fetchImpl);
  if (!data || data.status !== "ok" || data.found !== true) return null;
  return { sec: Number(data.position_sec) || 0, durationSec: Number(data.duration_sec) || 0, ts: ottParseIsoMs(ottStr(data.updated_at)) };
}

async function ottProgressPut(cfg, token, key, kind, positionSec, durationSec, fetchImpl) {
  await ottCallRpc(cfg, "progress_put", { p_token: token, p_key: key, p_kind: kind, p_position: Math.floor(positionSec), p_duration: Math.floor(durationSec) }, fetchImpl);
}

async function ottProgressClear(cfg, token, key, fetchImpl) {
  await ottCallRpc(cfg, "progress_clear", { p_token: token, p_key: key }, fetchImpl);
}
```

e alterar `ottBuildCastPayload` (existente) para ler `extra.positionSec` em `vod` e `episode`:

```js
  const e = extra || {};
  const pos = Math.max(0, Math.floor(Number(e.positionSec) || 0));
  if (kind === "vod") {
    const v = { streamId: ottClip(item.stream_id, 40), title, year: ottYearOf(item) };
    if (pos > 0) v.positionSec = pos;
    return v;
  }
  const season = parseInt(e.season, 10);
  const episode = parseInt(e.episode, 10);
  if (!(season >= 0) || !(episode >= 0)) return null;
  const ep = { seriesId: ottClip(item.series_id, 40), title, season, episode };
  if (pos > 0) ep.positionSec = pos;
  return ep;
```
(adaptar ao corpo real da função, mantendo os ramos de `channel`). Em `tests/ott/loadOtt.js`, expor `ottProgressKey, ottPickResume, ottProgressGet, ottProgressPut, ottProgressClear`.

- [ ] **Step 3: Rodar e ver passar** — `npm test` (249 + novos).

- [ ] **Step 4: Commit** — `git add sintoniza-link.html tests/ott && git commit -m "feat(sync): progresso por conta e posição no envio (ott-core)"`

---

### Task D9: Celular retoma e grava pelo progresso da conta; envia a posição; pausa ao transmitir; aviso visível em tela cheia

**Files:**
- Modify: `sintoniza-link.html` (retomada em `playVodSelection` e `applyPendingResume`; gravação no `timeupdate` `:8076-8099`, `pause`, `ended`, `visibilitychange`; `castToTv`; handlers de envio; CSS do `.toast`)
- Test: `tests/ott/sync-wiring.test.js` (marcação) e `scripts/dev/check-sync-ui.mjs`

Contratos do mapa: `playVodSelection(url, meta)` é o ponto único de início (`meta.resumeAt` → `pendingResumeAt`); `playEpisode` (id do episódio = `meta.id`); item tocando em `_state.selected` (`isVod`, `castInfo`, `continueId`); `video = #player-video`.

- [ ] **Step 1: Teste de marcação (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a retomada consulta a conta e o envio pausa o celular", () => {
  assert.match(html, /async function resolveResumeWithAccount\(/);
  assert.match(html, /function pushProgressToAccount\(/);
  assert.match(html, /function pausePlayerForCast\(/);
  assert.match(html, /positionSec: currentCastPosition\(\)/);
});

test("o aviso (toast) aparece também em tela cheia", () => {
  assert.match(html, /\.toast \{[^}]*z-index: 10002/);
});
```

Run: `node --test "tests/ott/*.test.js"` → FAIL.

- [ ] **Step 2: Implementar** (no script principal; tudo protegido por `ottEnabled()`/token; qualquer falha de rede = ignora)

```js
// ── Progresso por conta ──
let _lastProgressPushTs = 0;

function progressTokenAndCfg() {
  const token = localStorage.getItem(OTT_KEYS.TOKEN);
  return (_ott.cfg && token) ? { cfg: _ott.cfg, token } : null;
}

// Item atual -> { key, kind } para a conta (filme/episódio); canal e itens sem id não sincronizam
function currentProgressKey() {
  const sel = _state.selected;
  if (!sel || !sel.isVod || !sel.castInfo) return null;
  const ci = sel.castInfo;
  if (ci.kind === "vod") return { kind: "vod", key: ottProgressKey("vod", ci.item && ci.item.stream_id) };
  if (ci.kind === "episode") return { kind: "episode", key: ottProgressKey("episode", ci.extra && ci.extra.episodeId) };
  return null;
}

// Grava o minuto na conta (no máximo a cada 20 s, ou na hora com force)
function pushProgressToAccount(force) {
  const t = progressTokenAndCfg();
  const cur = currentProgressKey();
  const v = document.getElementById("player-video");
  if (!t || !cur || !cur.key || !v || !isFinite(v.duration) || v.currentTime < 10) return;
  if (!force && Date.now() - _lastProgressPushTs < 20000) return;
  _lastProgressPushTs = Date.now();
  ottProgressPut(t.cfg, t.token, cur.key, cur.kind, v.currentTime, v.duration).catch(() => {});
}

// Decide o minuto inicial: o mais recente entre o do celular (sint_continue) e o da conta; espera a conta no máximo 2,5 s
async function resolveResumeWithAccount(localSec, localTs, durationHint) {
  const t = progressTokenAndCfg();
  const cur = currentProgressKey();
  if (!t || !cur || !cur.key) return localSec;
  let server = null;
  try {
    server = await Promise.race([
      ottProgressGet(t.cfg, t.token, cur.key),
      new Promise(r => setTimeout(() => r(null), 2500)),
    ]);
  } catch (e) { server = null; }
  return ottPickResume({
    localSec: localSec || 0, localTs: localTs || 0,
    serverSec: server ? server.sec : 0, serverTs: server ? server.ts : 0,
    durationSec: durationHint || (server ? server.durationSec : 0), minSec: 10,
  });
}
```
Integração (descrita com os pontos do mapa):
1. `playEpisode`: incluir `episodeId` em `castInfo.extra` (`{ season, episode, episodeId }`) para a chave `ep:<id>`.
2. Em `playVodSelection(url, meta)`: o `pendingResumeAt` passa a ser decidido **depois** que `_state.selected` (com `castInfo`) existir: `resolveResumeWithAccount(meta.resumeAt, <ts do item em sint_continue ou 0>, <duração conhecida>)` e o resultado assume `pendingResumeAt`; a abertura do vídeo não espera mais de 2,5 s além do que já espera hoje. Quando não há conta/chave, o comportamento é o atual.
3. `timeupdate` (já salva `sint_continue` a cada 5 s): chamar também `pushProgressToAccount(false)`; nos eventos `pause`, `ended` (neste último, `ottProgressClear` da chave atual) e `visibilitychange` → `hidden`: `pushProgressToAccount(true)`. Ao remover um item do "continuar assistindo" no celular (`removeContinueWatching`), apagar também na conta (`ottProgressClear`), quando a chave for conhecida.
4. Envio: função `currentCastPosition()` devolve `Math.floor(video.currentTime)` se `_state.selected.isVod`, senão 0. Nos handlers do `#tv-cast-btn` e do novo botão da tela cheia, passar `{ ...(sel.castInfo.extra || {}), positionSec: currentCastPosition() }` como `extra`; antes de enviar, `pushProgressToAccount(true)`. No "continuar" (`castInfoFromResume`), `positionSec` do item salvo é usado só quando não há player aberto com o mesmo item.
5. `pausePlayerForCast()`: se `_state.selected && _state.selected.isVod`, `video.pause()` (o listener `pause` já atualiza ícones e `userPausedVod`); canal ao vivo: `video.pause(); setState({ playing: false }); showPlayerArt();` (igual ao `pauseAfterPipClosed`). Em `castToTv`, no `if (ottCastIsFinal(st.estado))`, quando `st.estado === "played"` e o item enviado é o que está tocando agora, chamar `pausePlayerForCast()` antes do toast.
6. CSS: `.toast { z-index: 10002; }` (hoje 99; o `#player-screen.pseudo-fullscreen` é 9999), para "Enviando…/Tocando na TV" aparecerem em tela cheia.

- [ ] **Step 3: Rodar e ver passar** — `node --test "tests/ott/*.test.js" && npm test`.

- [ ] **Step 4: Verificar no Chrome** — criar `scripts/dev/check-sync-ui.mjs` (padrão dos outros, `?noott=1`, backend e `fetch` fingidos): (a) com `progress_get` fingido devolvendo 2000 s mais novo que o local (500 s), abrir um filme e conferir que `pendingResumeAt`/`currentTime` vai para 2000; com a conta mais velha, vale o local; (b) simular `timeupdate` e conferir um `progress_put` a cada ≤ 20 s e na pausa; (c) disparar o envio com o vídeo em 754 s e conferir `positionSec: 754` no corpo do `cast_send`, e que o vídeo é pausado quando o `cast_status` devolve `played`; (d) o `#toast` fica visível em tela cheia (`getComputedStyle(...).zIndex`/`elementFromPoint`).
Run: `node scripts/dev/check-sync-ui.mjs` → `✔ ok`; rodar todos os `check-*.mjs` (todos `✔ ok`).

- [ ] **Step 5: Commit** — `git add sintoniza-link.html tests/ott scripts/dev/check-sync-ui.mjs && git commit -m "feat(sync): celular retoma pelo minuto mais recente da conta, envia a posição e pausa ao transmitir"`

---

### Task D10: Tela cheia: o botão de enquadramento vira "Assistir na TV"

**Files:**
- Modify: `sintoniza-link.html` (`#fs-ui` HTML ~1366; `syncFsFitButton` ~5010; `toggleFsFit` ~5020; listener ~7758; função `castCurrentToTv`)
- Test: acrescentar a `tests/ott/cast-markup.test.js`

Fato do mapa: o ícone de 4 setas dentro de `#fs-ui` é `#fs-fit-btn` (alterna `object-fit` contain/cover); o retângulo é `#fs-rotate-btn` (gira). Sair da tela cheia continua pelo `#fs-exit-btn` (ícone `minimize`) e pelo duplo toque. O enquadramento continua disponível fora da tela cheia (`#fit-select`).

- [ ] **Step 1: Teste (deve falhar)** — em `tests/ott/cast-markup.test.js`:

```js
test("na tela cheia o botão de TV substitui o de enquadramento", () => {
  assert.match(html, /id="fs-tv-btn"/);
  assert.doesNotMatch(html, /id="fs-fit-btn"/);
  assert.match(html, /function castCurrentToTv\(/);
  assert.doesNotMatch(html, /getElementById\("fs-fit-btn"\)/);
});
```

Run → FAIL.

- [ ] **Step 2: Implementar**
  - HTML (linha ~1366): trocar o `#fs-fit-btn` por
    `<button class="fs-btn tv-only" id="fs-tv-btn" type="button" aria-label="Assistir na TV"><i data-lucide="tv" style="width:20px;height:20px"></i></button>`.
  - Remover `syncFsFitButton` e as suas chamadas (`enterPseudoFullscreen`, `toggleFsFit`), e o listener de `#fs-fit-btn` (~7758); manter `toggleFsFit` só se ainda tiver outro chamador; senão remover (verificar com Grep antes). O `#fit-select` continua sendo o único controle do enquadramento (fora da tela cheia).
  - Extrair do handler do `#tv-cast-btn` a função:
    ```js
    // Envia o que está tocando para a TV (usado pelo botão da barra e pelo da tela cheia)
    function castCurrentToTv() {
      const sel = _state.selected;
      if (!sel) return;
      if (!sel.isVod) { castToTv("channel", sel); return; }
      if (!sel.castInfo) { showToast("Não foi possível enviar este item para a TV."); return; }
      pushProgressToAccount(true);
      const extra = Object.assign({}, sel.castInfo.extra || {}, { positionSec: currentCastPosition() });
      castToTv(sel.castInfo.kind, sel.castInfo.item, extra);
    }
    ```
    e ligar `#tv-cast-btn` e `#fs-tv-btn` a ela (`stopPropagation` no segundo para não alternar a visibilidade dos controles).
  - O `#fs-ui` já trata clique em botão só com `showFsControls()`; manter.

- [ ] **Step 3: Rodar e ver passar** — `npm test`.

- [ ] **Step 4: Verificar no Chrome** — estender `check-tv-cast-ui.mjs` (ou novo `check-fs-tv.mjs`): entrar em tela cheia (duplo toque real), conferir que `#fs-tv-btn` está visível (com `ott-mode`) e que `#fs-fit-btn` não existe; tocar nele → corpo do `cast_send` correto; sair pelo duplo toque e por `#fs-exit-btn`; sem erro de console ao entrar/sair da tela cheia (era o risco do `syncFsFitButton`). Captura para ver o botão e apagá-la depois.
Run: todos os `scripts/dev/check-*.mjs` → `✔ ok`.

- [ ] **Step 5: Commit** — `git add sintoniza-link.html tests/ott scripts/dev && git commit -m "feat(celular): na tela cheia o botão de enquadramento vira Assistir na TV"`

---

# PARTE 4 — Fechamento

### Task D11: Ponta a ponta (backend real) e conferência na TV

**Files:**
- Create: `scripts/dev/e2e-sync.mjs` (repo do celular; estilo de `e2e-cast.mjs`; lê o `.env.ott.local` da TV por caminho passado)

- [ ] **Step 1: e2e do progresso e do envio com posição** — fluxo contra o backend real, com "TV" simulada pelas RPCs e o celular real em Chrome (`?ott=1`, ativado de verdade):
  1. Cria a "TV" (`device_start` tipo tv, `device_claim`), ativa o celular.
  2. A "TV" grava `progress_put` (`vod:<id>`, 1234 s); o celular abre um filme de teste da lista e confere que o `currentTime`/`pendingResumeAt` vai para 1234 (a regra do mais recente: o `sint_continue` local do celular está vazio). Limpar `sint_continue` antes.
  3. O celular simula andar até 2000 s (`pushProgressToAccount(true)`); a "TV" lê `progress_get` e vê 2000.
  4. Com o filme em 2000 s, o celular dispara o envio; a "TV" faz `cast_poll` e recebe `payload.positionSec === 2000` (e nenhum `http` no payload); a "TV" dá `cast_ack played`; confere que o celular pausou (`video.paused`) e o toast.
  5. Limpeza em `finally`: `progress_clear`, `device_unlink` dos dois.
  Nunca imprimir segredos.

Run: `node scripts/dev/e2e-sync.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"` → `✔ ok`. (Respeitar os limites de taxa; se falhar por taxa, esperar a janela.)

- [ ] **Step 2: TV real, só leitura e instalação** — se a TV de teste estiver acessível (memória `lg-tv-acesso-dev.md`): `npm run build:ott && npm run lojas:ott` (pacote em `lojas/` do repo da TV; **não copiar para Downloads**), instalar o `.ipk` na TV de teste e conferir por CDP/captura: Início sem corte (D6), primeiro cartão do histórico inteiro (D5), segurar OK abre "Remover", carregamento animado (D7). Não alterar outros apps, nem vínculo, nem histórico do Gustavo além do estritamente necessário e restaurando depois (como foi feito antes com o token). Se inacessível, registrar "não testado na TV real".

- [ ] **Step 3: Regressões** — TV: `npm test`, `npx tsc --noEmit -p .`, `npm run ott:smoke`, `npm run build:ott`+`check:tv`; celular: `npm test` e todos os `scripts/dev/check-*.mjs`.

- [ ] **Step 4: Commit** — `git add scripts/dev/e2e-sync.mjs && git commit -m "test(sync): progresso por conta e envio com posição de ponta a ponta"`

### Task D12: Levar os ajustes de UI para a branch manual (opcional, sem forçar)

**Files:** branch `app-tv-links-manual` do repo da TV.

- [ ] **Step 1:** em `app-tv-links-manual`, tentar `git cherry-pick` dos commits de D5 (histórico), D6 (foco da Início) e a parte compartilhada de D7 (CSS e `index.html`); a parte do `OttGate` não existe nessa branch. Se houver conflito que exija decisão, abortar (`git cherry-pick --abort`), não forçar e registrar quais commits ficaram de fora. Rodar `npm test`, `npx tsc --noEmit -p .`, `npm run build && npm run check:tv`.
- [ ] **Step 2:** voltar para `app-tv-ott-ativacao` (`git checkout app-tv-ott-ativacao`) e deixá-la como branch ativa.

---

## Auto-revisão

- **Cobertura:** sincronia do minuto (D1–D3, D8–D9), envio no minuto do celular e pausa do celular (D3, D8, D9), primeiro cartão cortado e remover do "continuar assistindo" (D5), tela de carregamento animada (D7), foco/rolagem inicial (D6), erro ao enviar filme em andamento (D4), botão da tela cheia (D10). Fora, por decisão: mesclar as **listas** de "continuar assistindo" entre aparelhos (só o minuto sincroniza ao abrir o item) e o celular como controle remoto (nível 4).
- **Nomes consistentes:** `progressKey/pickResume/progressGet/progressPut/progressClear/PROGRESS_PUSH_MS` (TV) e `ottProgressKey/ottPickResume/ottProgressGet/ottProgressPut/ottProgressClear` (celular); `startAtSec` (TV) ↔ `positionSec` (payload); chaves `vod:<id>`/`ep:<id>`; `removeEntry/neighborAfterRemove/historyStore.remove`; `shouldFocusHeroOnArrival`; `castCurrentToTv/currentCastPosition/pausePlayerForCast/pushProgressToAccount/resolveResumeWithAccount`; `#fs-tv-btn`.
- **Riscos:** (1) D3/D5 mexem em `PlayerView` e no teclado global (long-press isolado em nós com `onLongPress` para não afetar o resto); (2) a causa real do erro de D4 só se confirma na TV (Step 1 manda ler o `video.error.code`); (3) o carregamento animado depende da medição em TV real (D7 Step 1 e D11 Step 2); (4) perder o botão de enquadramento da tela cheia é decisão do Gustavo: fica o `#fit-select` fora dela.
