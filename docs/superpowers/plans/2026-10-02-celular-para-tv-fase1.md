# Enviar do celular para a TV (Fase 1) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** no celular, tocar em "Assistir na TV" (canal, filme, episódio) e a TV da mesma conta abre e reproduz sozinha, em poucos segundos.

**Architecture:** relé pela conta (decisão do estudo `2026-10-02-estudo-celular-para-tv.md`). O celular grava um comando numa fila no Supabase (`cast_commands`) por RPC; a TV, já ativada, consulta a fila a cada 3 s (`cast_poll`), acha o item na própria lista (o link do stream com usuário e senha **nunca trafega**), toca e responde (`cast_ack`); o celular acompanha o resultado (`cast_status`). Casamento por IDs do provedor (`stream_id`/`series_id`) com fallback por título.

**Tech Stack:** Supabase (SQL/RPC), TypeScript/React/Vite (TV, Chrome 53), HTML/JS puro (celular), `node:test`, Chrome via CDP.

**Repositórios:**
- Backend e TV: `C:\Users\guait\Documents\Novo-App-de-TV`, branch `app-tv-ott-ativacao` (Tasks C1–C3). Nunca na `main`.
- Celular: `C:\Users\guait\Documents\visual-craft-assistant`, branch `v10` (Tasks C4–C7). Nunca na `main`.
- Ordem: **C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8**.

> 🔐 `.env.ott.local` (repo da TV) guarda segredos: nunca imprimir chaves, senhas nem tokens. Usar só via `npm run ott:*`.
> ⚠️ `sintoniza-link.html` é CRLF: nada de `sed -i`; edite com Edit/Write ou script Node que preserve CRLF; releia antes de editar.
> ⚠️ TV roda Chrome 53: sem `AbortController`/`AbortSignal.timeout`, sem `Date.parse` de datas do Postgres (use `parseIsoMs`), sem `gap` em flex, sem `:is()/:where()/:has()`. Rodar `npm run build && npm run check:tv` ao fim da parte da TV.

## Contrato (usado por todas as tasks)

Tipos de envio e conteúdo (`payload`, JSON, no máximo 2000 caracteres, **sem links de stream**):

| `kind` | `payload` | Como a TV acha |
|---|---|---|
| `channel` | `{ "name": "Globo SP", "group": "Abertos" }` | Canal com nome igual (sem acento/caixa); desempate pelo grupo |
| `vod` | `{ "streamId": "12345", "title": "Filme X", "year": 2023 }` | `vod_<streamId>`; senão título (+ano) |
| `episode` | `{ "seriesId": "678", "title": "Série Y", "season": 2, "episode": 5 }` | `series_<seriesId>` → temporada/episódio; senão título da série |

RPCs (todas recebem o `p_token` do aparelho, nunca o JWT do usuário):

| RPC | Quem | Resposta |
|---|---|---|
| `cast_targets(p_token)` | celular | `{status:'ok', tvs:[{id, modelo, online}]}` ou `{status:'unknown_device'}` |
| `cast_send(p_token, p_to uuid, p_kind, p_payload jsonb)` | celular | `{status:'ok', id, online}` / `{status:'unknown_device'}` / `{status:'blocked'}`; erro de negócio vira exceção `P0001` com mensagem em português |
| `cast_poll(p_token)` | TV | `{status:'ok', command: null}` ou `{status:'ok', command:{id, kind, payload, from}}` / `{status:'unknown_device'}` |
| `cast_ack(p_token, p_id uuid, p_status text, p_motivo text)` | TV | `{status:'ok'}`; `p_status` = `played` ou `failed` |
| `cast_status(p_token, p_id uuid)` | celular | `{status:'ok', estado:'pending'|'delivered'|'played'|'failed'|'expired', motivo}` / `{status:'not_found'}` |

---

# PARTE 1 — Backend e TV (repositório `Novo-App-de-TV`)

### Task C1: Migração 0007 — fila de comandos e RPCs

**Files:**
- Create: `supabase/migrations/0007_ott_cast.sql`
- Modify: `scripts/ott-smoke.mjs` (verificações novas, antes do resumo final)

- [ ] **Step 1: Escrever a migração**

```sql
-- 0007: envio do celular para a TV (relé pela conta). Fila de comandos + RPCs com token do aparelho.
-- Ninguém acessa a tabela direto: só pelas funções (security definer).

create table if not exists public.cast_commands (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  to_device   uuid not null references public.devices(id) on delete cascade,
  from_device uuid references public.devices(id) on delete set null,
  kind        text not null check (kind in ('channel', 'vod', 'episode')),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending', 'delivered', 'played', 'failed', 'expired')),
  motivo      text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 minutes'
);
create index if not exists cast_commands_fila on public.cast_commands (to_device, status, created_at);
alter table public.cast_commands enable row level security;
revoke all on public.cast_commands from anon, authenticated;

-- Aparelho ativo a partir do token (uso interno)
create or replace function public.cast_device(p_token text)
returns public.devices
language sql
stable
security definer
set search_path = public, extensions
as $$
  select * from public.devices
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and ativo
   limit 1
$$;
revoke execute on function public.cast_device(text) from public, anon, authenticated;

-- Celular: lista as TVs ativas da mesma conta
create or replace function public.cast_targets(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d      public.devices;
  v_list json;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  select coalesce(json_agg(json_build_object(
           'id', t.id, 'modelo', t.modelo,
           'online', coalesce(t.ultimo_acesso > now() - interval '2 minutes', false)
         ) order by t.ultimo_acesso desc nulls last), '[]'::json)
    into v_list
    from public.devices t
   where t.user_id = d.user_id and t.tipo = 'tv' and t.ativo;
  return json_build_object('status', 'ok', 'tvs', v_list);
end;
$$;

-- Celular: grava um comando para uma TV da mesma conta
create or replace function public.cast_send(p_token text, p_to uuid, p_kind text, p_payload jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d    public.devices;
  t    public.devices;
  p    public.profiles;
  v_id uuid;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  perform public.check_rate('cast:' || d.id::text, 30, interval '1 minute');
  select * into p from public.profiles where id = d.user_id;
  if public.access_state(p) <> 'ok' then
    return json_build_object('status', 'blocked');
  end if;
  if p_kind is null or p_kind not in ('channel', 'vod', 'episode') then
    raise exception 'Tipo de envio inválido.' using errcode = 'P0001';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 2000 then
    raise exception 'Conteúdo inválido para enviar à TV.' using errcode = 'P0001';
  end if;
  select * into t from public.devices
   where id = p_to and user_id = d.user_id and tipo = 'tv' and ativo;
  if not found then
    raise exception 'TV não encontrada na sua conta.' using errcode = 'P0001';
  end if;

  delete from public.cast_commands where created_at < now() - interval '1 day';
  -- só o último envio vale: os pendentes antigos dessa TV são descartados
  update public.cast_commands set status = 'expired' where to_device = t.id and status = 'pending';
  insert into public.cast_commands (user_id, to_device, from_device, kind, payload)
  values (d.user_id, t.id, d.id, p_kind, p_payload)
  returning id into v_id;
  return json_build_object('status', 'ok', 'id', v_id,
                           'online', coalesce(t.ultimo_acesso > now() - interval '2 minutes', false));
end;
$$;

-- TV: pega o próximo comando (uma única vez) e marca presença
create or replace function public.cast_poll(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
  c public.cast_commands;
begin
  d := public.cast_device(p_token);
  if d.id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  if d.user_id is null or d.tipo <> 'tv' then
    return json_build_object('status', 'ok', 'command', null::json);
  end if;
  -- presença da TV (alimenta o "online" do celular); grava no máximo a cada 20 s
  update public.devices set ultimo_acesso = now()
   where id = d.id and (ultimo_acesso is null or ultimo_acesso < now() - interval '20 seconds');
  update public.cast_commands set status = 'expired'
   where to_device = d.id and status = 'pending' and expires_at <= now();
  update public.cast_commands set status = 'delivered'
   where id = (select id from public.cast_commands
                where to_device = d.id and status = 'pending' and expires_at > now()
                order by created_at limit 1 for update skip locked)
  returning * into c;
  if c.id is null then
    return json_build_object('status', 'ok', 'command', null::json);
  end if;
  return json_build_object('status', 'ok', 'command', json_build_object(
    'id', c.id, 'kind', c.kind, 'payload', c.payload,
    'from', coalesce((select modelo from public.devices where id = c.from_device), '')
  ));
end;
$$;

-- TV: resultado do comando
create or replace function public.cast_ack(p_token text, p_id uuid, p_status text, p_motivo text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
begin
  d := public.cast_device(p_token);
  if d.id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  update public.cast_commands
     set status = case when p_status = 'played' then 'played' else 'failed' end,
         motivo = left(coalesce(p_motivo, ''), 120)
   where id = p_id and to_device = d.id and status = 'delivered';
  return json_build_object('status', 'ok');
end;
$$;

-- Celular: como está o comando que ele enviou
create or replace function public.cast_status(p_token text, p_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
  c public.cast_commands;
begin
  d := public.cast_device(p_token);
  if d.id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  select * into c from public.cast_commands where id = p_id and from_device = d.id;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  return json_build_object('status', 'ok',
    'estado', case when c.status = 'pending' and c.expires_at <= now() then 'expired' else c.status end,
    'motivo', c.motivo);
end;
$$;

revoke execute on function public.cast_targets(text) from public;
revoke execute on function public.cast_send(text, uuid, text, jsonb) from public;
revoke execute on function public.cast_poll(text) from public;
revoke execute on function public.cast_ack(text, uuid, text, text) from public;
revoke execute on function public.cast_status(text, uuid) from public;
grant execute on function public.cast_targets(text) to anon, authenticated;
grant execute on function public.cast_send(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.cast_poll(text) to anon, authenticated;
grant execute on function public.cast_ack(text, uuid, text, text) to anon, authenticated;
grant execute on function public.cast_status(text, uuid) to anon, authenticated;
```

- [ ] **Step 2: Acrescentar ao `scripts/ott-smoke.mjs`** (antes do resumo final; use os helpers `check`, `rpc`, `jwt` do arquivo; a seção seguinte à última numerada)

```js
// Envio do celular para a TV
const tvC = await rpc('device_start', { p_modelo: 'TV Cast Smoke', p_sistema: 'webOS' });
const celC = await rpc('device_start', { p_modelo: 'Celular Cast Smoke', p_sistema: 'Android', p_tipo: 'celular' });
await rpc('device_claim', { p_code: tvC.data.code }, jwt);
await rpc('device_claim', { p_code: celC.data.code }, jwt);
const tokTv = tvC.data.device_token;
const tokCel = celC.data.device_token;

const vazio = await rpc('cast_poll', { p_token: tokTv });
check('cast_poll sem comando devolve command nulo', vazio.status === 200 && vazio.data.status === 'ok' && vazio.data.command === null);

const alvos = await rpc('cast_targets', { p_token: tokCel });
const minhaTv = (alvos.data.tvs || []).find((t) => t.modelo === 'TV Cast Smoke');
check('cast_targets lista a TV da mesma conta (online após o poll)', !!minhaTv && minhaTv.online === true, JSON.stringify(alvos.data));

const envio = await rpc('cast_send', { p_token: tokCel, p_to: minhaTv.id, p_kind: 'channel', p_payload: { name: 'Globo SP', group: 'Abertos' } });
check('cast_send grava o comando', envio.status === 200 && envio.data.status === 'ok' && !!envio.data.id, JSON.stringify(envio.data));

const recebido = await rpc('cast_poll', { p_token: tokTv });
check('cast_poll entrega o comando com payload e origem', recebido.data.command && recebido.data.command.kind === 'channel' && recebido.data.command.payload.name === 'Globo SP' && recebido.data.command.from === 'Celular Cast Smoke', JSON.stringify(recebido.data));
const denovo = await rpc('cast_poll', { p_token: tokTv });
check('o comando é entregue uma única vez', denovo.data.command === null);

const antes = await rpc('cast_status', { p_token: tokCel, p_id: envio.data.id });
check('cast_status mostra "entregue"', antes.data.estado === 'delivered', JSON.stringify(antes.data));
await rpc('cast_ack', { p_token: tokTv, p_id: envio.data.id, p_status: 'played', p_motivo: '' });
const depois = await rpc('cast_status', { p_token: tokCel, p_id: envio.data.id });
check('cast_status mostra "tocando" após o ack', depois.data.estado === 'played', JSON.stringify(depois.data));

const ruim = await rpc('cast_send', { p_token: tokCel, p_to: minhaTv.id, p_kind: 'hack', p_payload: {} });
check('cast_send recusa tipo inválido', ruim.status >= 400 && /inválido/i.test((ruim.data && ruim.data.message) || ''), JSON.stringify(ruim.data));
const alheia = await rpc('cast_send', { p_token: tokCel, p_to: '00000000-0000-0000-0000-000000000000', p_kind: 'channel', p_payload: { name: 'x' } });
check('cast_send recusa TV que não é da conta', alheia.status >= 400 && /não encontrada/i.test((alheia.data && alheia.data.message) || ''), JSON.stringify(alheia.data));
const tokenFalso = await rpc('cast_send', { p_token: 'falso', p_to: minhaTv.id, p_kind: 'channel', p_payload: { name: 'x' } });
check('cast_send com token falso devolve unknown_device', tokenFalso.data.status === 'unknown_device');

await rpc('device_unlink', { p_token: tokTv });
await rpc('device_unlink', { p_token: tokCel });
```

- [ ] **Step 3: Aplicar e verificar**

Run: `npm run ott:setup` (aplica 0001–0007, idempotente; sem imprimir segredos) e depois `npm run ott:smoke`.
Expected: todas as linhas `OK` (antigas e novas) e `[ott] Tudo certo.` Se o smoke falhar por limite de aparelhos do usuário de teste, rodar a limpeza dos aparelhos de smoke antigos (pelo `device_unlink` com o token) e repetir.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0007_ott_cast.sql scripts/ott-smoke.mjs
git commit -m "feat(backend): fila de envio celular→TV (cast_targets/send/poll/ack/status)"
```

---

### Task C2: Cliente e resolvedor do envio na TV (lógica pura, testada)

**Files:**
- Create: `src/services/cast.ts`
- Create: `src/services/castResolve.ts`
- Test: `tests/cast.test.ts`

> Antes de codar, leia `src/services/ott.ts` (`callRpc`, `OttConfig`, `OTT_KEYS`, `parseIsoMs`), `src/services/api.ts` (`getLiveChannels`, `getVodMovies`, `getVodMovieDetail`, `getSeriesList`, `getSeriesDetail`: assinaturas reais), `src/services/searchIndex.ts` (`foldText`) e `src/context/TvNavigationContext.tsx` (`ActivePlayerState`). Os tipos abaixo são o desenho; confirme com `npx tsc --noEmit` e adapte nomes/assinaturas aos reais mantendo a intenção. O tipo `ActivePlayerState` pode ter de ser exportado do contexto.

- [ ] **Step 1: Escrever os testes (devem falhar)**

```ts
// Envio do celular para a TV: interpretação do poll, escolha do item e resolução do comando
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCastPoll, pickBest, castPoll, castAck, payloadYear } from '../src/services/cast';
import { resolveCast, type CastDeps } from '../src/services/castResolve';

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

test('interpreta o poll: sem comando, com comando e dono desconhecido', () => {
  assert.deepEqual(parseCastPoll({ status: 'ok', command: null }), { status: 'ok', command: null });
  const c = parseCastPoll({ status: 'ok', command: { id: 'a', kind: 'channel', payload: { name: 'Globo' }, from: 'Pixel' } });
  assert.deepEqual(c, { status: 'ok', command: { id: 'a', kind: 'channel', payload: { name: 'Globo' }, from: 'Pixel' } });
  assert.deepEqual(parseCastPoll({ status: 'unknown_device' }), { status: 'unknown_device' });
  assert.deepEqual(parseCastPoll(null), { status: 'invalid' });
  assert.deepEqual(parseCastPoll({ status: 'ok', command: { id: 'a', kind: 'hack', payload: {} } }), { status: 'invalid' });
});

test('castPoll e castAck chamam as RPCs com o token', async () => {
  const f = fakeFetch({ status: 'ok', command: null });
  assert.deepEqual(await castPoll(cfg, 'tok', f), { status: 'ok', command: null });
  assert.ok(f.calls[0].url.endsWith('/rest/v1/rpc/cast_poll'));
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: 'tok' });
  const g = fakeFetch({ status: 'ok' });
  await castAck(cfg, 'tok', 'id1', false, 'não achei', g);
  assert.ok(g.calls[0].url.endsWith('/rest/v1/rpc/cast_ack'));
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: 'tok', p_id: 'id1', p_status: 'failed', p_motivo: 'não achei' });
});

test('pickBest prefere título e ano iguais; aceita candidato único; recusa ambíguo', () => {
  const items = [
    { title: 'Matrix', year: 1999 },
    { title: 'Matrix', year: 2003 },
    { title: 'Matrix Reloaded', year: 2003 },
  ];
  const t = (x: any) => x.title;
  const y = (x: any) => x.year;
  assert.equal(pickBest(items, 'matrix', 2003, t, y)?.year, 2003);
  assert.equal(pickBest(items, 'Matrix', 0, t, y)?.year, 1999);
  assert.equal(pickBest([{ title: 'Único Filme', year: 2020 }], 'Filme Único Diferente', 0, t, y)?.title, 'Único Filme');
  assert.equal(pickBest(items, 'Outro', 0, t, y), null);
  assert.equal(pickBest([], 'x', 0, t, y), null);
});

test('payloadYear aceita número ou texto e rejeita lixo', () => {
  assert.equal(payloadYear(2023), 2023);
  assert.equal(payloadYear('2023'), 2023);
  assert.equal(payloadYear('abc'), 0);
  assert.equal(payloadYear(null), 0);
});

const canais = [
  { id: 'ch_1', number: 1, name: 'Globo SP', group: 'Abertos', streamUrl: 'http://a/1', logo: '' },
  { id: 'ch_2', number: 2, name: 'Globo SP', group: 'HD', streamUrl: 'http://a/2', logo: '' },
  { id: 'ch_3', number: 3, name: 'SBT', group: 'Abertos', streamUrl: 'http://a/3', logo: '' },
] as any[];

const deps = (over: Partial<CastDeps> = {}): CastDeps => ({
  searchChannels: async (q) => canais.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())),
  getMovieById: async (id) => (id === 'vod_10' ? ({ id: 'vod_10', title: 'Filme X', year: 2023, streamUrl: 'http://v/10.mp4' } as any) : null),
  searchMovies: async () => [],
  getSeriesById: async (id) =>
    id === 'series_7'
      ? ({ id: 'series_7', title: 'Série Y', year: 2020, poster: 'p', seasons: [{ seasonNumber: 2, title: 'T2', episodes: [{ id: 'ep_1', episodeNumber: 5, seasonNumber: 2, title: 'Cinco', streamUrl: 'http://s/1.mp4' }] }] } as any)
      : null,
  searchSeries: async () => [],
  ...over,
});

test('resolve canal pelo nome e usa o grupo para desempatar', async () => {
  const r = await resolveCast({ id: '1', kind: 'channel', payload: { name: 'globo sp', group: 'HD' }, from: 'Pixel' }, deps());
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.player.type, 'channel');
    assert.equal(r.player.streamUrl, 'http://a/2');
    assert.equal(r.player.title, 'Globo SP');
  }
});

test('canal inexistente vira falha com motivo em português', async () => {
  const r = await resolveCast({ id: '1', kind: 'channel', payload: { name: 'Canal Fantasma' }, from: '' }, deps());
  assert.deepEqual(r, { ok: false, motivo: 'Canal não encontrado na lista desta TV.' });
});

test('resolve filme pelo stream_id', async () => {
  const r = await resolveCast({ id: '1', kind: 'vod', payload: { streamId: '10', title: 'Filme X', year: 2023 }, from: '' }, deps());
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.player.type, 'movie');
    assert.equal(r.player.streamUrl, 'http://v/10.mp4');
  }
});

test('filme sem id cai para a busca por título', async () => {
  const d = deps({ searchMovies: async () => [{ id: 'vod_99', title: 'Filme Z', year: 2021, streamUrl: 'http://v/99.mp4' } as any] });
  const r = await resolveCast({ id: '1', kind: 'vod', payload: { streamId: '404', title: 'Filme Z', year: 2021 }, from: '' }, d);
  assert.ok(r.ok && r.player.streamUrl === 'http://v/99.mp4');
});

test('resolve episódio por série, temporada e número', async () => {
  const r = await resolveCast({ id: '1', kind: 'episode', payload: { seriesId: '7', title: 'Série Y', season: 2, episode: 5 }, from: '' }, deps());
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.player.type, 'episode');
    assert.equal(r.player.streamUrl, 'http://s/1.mp4');
    assert.match(r.player.subtitle || '', /T2:E5/);
  }
});

test('episódio que não existe vira falha', async () => {
  const r = await resolveCast({ id: '1', kind: 'episode', payload: { seriesId: '7', title: 'Série Y', season: 9, episode: 1 }, from: '' }, deps());
  assert.deepEqual(r, { ok: false, motivo: 'Episódio não encontrado na lista desta TV.' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test tests/cast.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/services/cast.ts`**

```ts
// Envio do celular para a TV: cliente das RPCs cast_poll/cast_ack e funções puras de escolha do item.
// Sem DOM e sem @supabase/supabase-js (Chrome 53): fetch puro via callRpc.
import { callRpc, type OttConfig } from './ott';
import { foldText } from './searchIndex';

export type CastKind = 'channel' | 'vod' | 'episode';
export interface CastCommand {
  id: string;
  kind: CastKind;
  payload: Record<string, unknown>;
  from: string;
}
export type CastPollResult =
  | { status: 'ok'; command: CastCommand | null }
  | { status: 'unknown_device' }
  | { status: 'invalid' };

type FetchLike = (url: string, init?: any) => Promise<any>;

const KINDS: CastKind[] = ['channel', 'vod', 'episode'];

// Interpreta a resposta do cast_poll sem confiar no formato
export function parseCastPoll(data: any): CastPollResult {
  if (!data || typeof data !== 'object') return { status: 'invalid' };
  if (data.status === 'unknown_device') return { status: 'unknown_device' };
  if (data.status !== 'ok') return { status: 'invalid' };
  const c = data.command;
  if (c === null || c === undefined) return { status: 'ok', command: null };
  if (!c || typeof c.id !== 'string' || KINDS.indexOf(c.kind) < 0 || !c.payload || typeof c.payload !== 'object') {
    return { status: 'invalid' };
  }
  return { status: 'ok', command: { id: c.id, kind: c.kind, payload: c.payload, from: typeof c.from === 'string' ? c.from : '' } };
}

export async function castPoll(cfg: OttConfig, token: string, fetchImpl?: FetchLike): Promise<CastPollResult> {
  return parseCastPoll(await callRpc(cfg, 'cast_poll', { p_token: token }, fetchImpl));
}

// Informa o resultado: played = começou a tocar; senão falhou, com o motivo (mostrado no celular)
export async function castAck(cfg: OttConfig, token: string, id: string, played: boolean, motivo: string, fetchImpl?: FetchLike): Promise<void> {
  await callRpc(cfg, 'cast_ack', { p_token: token, p_id: id, p_status: played ? 'played' : 'failed', p_motivo: motivo }, fetchImpl);
}

export function payloadYear(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v == null ? '' : v), 10);
  return n >= 1900 && n <= 2100 ? n : 0;
}

// Escolhe o melhor candidato: título+ano iguais; título igual; candidato único; senão nenhum (evita tocar o errado)
export function pickBest<T>(items: T[], wantedTitle: string, wantedYear: number, titleOf: (x: T) => string, yearOf: (x: T) => number): T | null {
  if (!items.length) return null;
  const want = foldText(wantedTitle);
  const same: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (foldText(titleOf(items[i])) === want) same.push(items[i]);
  }
  if (same.length) {
    if (wantedYear) {
      for (let i = 0; i < same.length; i++) if (yearOf(same[i]) === wantedYear) return same[i];
    }
    return same[0];
  }
  return items.length === 1 ? items[0] : null;
}
```

- [ ] **Step 4: Implementar `src/services/castResolve.ts`**

```ts
// Resolve um comando do celular em algo que o player da TV sabe tocar.
// O link do stream NUNCA vem do celular: sai da lista da própria TV (mesma conta).
import type { Channel, Movie, Series } from '../types/tv';
import { foldText } from './searchIndex';
import { payloadYear, pickBest, type CastCommand } from './cast';
import type { ActivePlayerState } from '../context/TvNavigationContext';

// Dependências injetáveis (nos testes, falsas; no app, ligadas ao api.ts)
export interface CastDeps {
  searchChannels(q: string): Promise<Channel[]>;
  getMovieById(id: string): Promise<Movie | null>;
  searchMovies(q: string): Promise<Movie[]>;
  getSeriesById(id: string): Promise<Series | null>; // já com temporadas e episódios
  searchSeries(q: string): Promise<Series[]>;
}

export type CastResolved = { ok: true; player: ActivePlayerState } | { ok: false; motivo: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

async function resolveChannel(p: Record<string, unknown>, deps: CastDeps): Promise<CastResolved> {
  const name = str(p.name);
  const group = foldText(str(p.group));
  const found = await deps.searchChannels(name);
  const want = foldText(name);
  const same: Channel[] = [];
  for (let i = 0; i < found.length; i++) if (foldText(found[i].name) === want) same.push(found[i]);
  let chosen: Channel | null = null;
  if (same.length) {
    chosen = same[0];
    for (let i = 0; i < same.length; i++) {
      if (group && foldText(same[i].group) === group) { chosen = same[i]; break; }
    }
  }
  if (!chosen) return { ok: false, motivo: 'Canal não encontrado na lista desta TV.' };
  return { ok: true, player: { type: 'channel', title: chosen.name, streamUrl: chosen.streamUrl, channel: chosen } as ActivePlayerState };
}

async function resolveMovie(p: Record<string, unknown>, deps: CastDeps): Promise<CastResolved> {
  const streamId = str(p.streamId);
  let movie: Movie | null = streamId ? await deps.getMovieById('vod_' + streamId) : null;
  if (!movie || !movie.streamUrl) {
    const found = await deps.searchMovies(str(p.title));
    movie = pickBest(found, str(p.title), payloadYear(p.year), (m) => m.title, (m) => m.year);
  }
  if (!movie || !movie.streamUrl) return { ok: false, motivo: 'Filme não encontrado na lista desta TV.' };
  const subtitle = [movie.genre, movie.year || ''].filter(Boolean).join(' · ');
  return { ok: true, player: { type: 'movie', title: movie.title, subtitle, streamUrl: movie.streamUrl, movie } as ActivePlayerState };
}

async function resolveEpisode(p: Record<string, unknown>, deps: CastDeps): Promise<CastResolved> {
  const seriesId = str(p.seriesId);
  const season = parseInt(str(p.season), 10);
  const number = parseInt(str(p.episode), 10);
  let series: Series | null = seriesId ? await deps.getSeriesById('series_' + seriesId) : null;
  if (!series) {
    const found = await deps.searchSeries(str(p.title));
    const best = pickBest(found, str(p.title), 0, (s) => s.title, (s) => s.year);
    series = best ? await deps.getSeriesById(best.id) : null;
  }
  const seasons = (series && series.seasons) || [];
  for (let i = 0; i < seasons.length; i++) {
    if (seasons[i].seasonNumber !== season) continue;
    const eps = seasons[i].episodes;
    for (let j = 0; j < eps.length; j++) {
      if (eps[j].episodeNumber === number && eps[j].streamUrl) {
        const ep = eps[j];
        return {
          ok: true,
          player: {
            type: 'episode',
            title: (series as Series).title,
            subtitle: 'T' + season + ':E' + number + ' · ' + ep.title,
            streamUrl: ep.streamUrl,
            poster: (series as Series).poster,
            episode: ep,
            series: Object.assign({}, series, { seasons: [] }),
          } as ActivePlayerState,
        };
      }
    }
  }
  return { ok: false, motivo: 'Episódio não encontrado na lista desta TV.' };
}

export async function resolveCast(cmd: CastCommand, deps: CastDeps): Promise<CastResolved> {
  try {
    if (cmd.kind === 'channel') return await resolveChannel(cmd.payload, deps);
    if (cmd.kind === 'vod') return await resolveMovie(cmd.payload, deps);
    return await resolveEpisode(cmd.payload, deps);
  } catch (e) {
    return { ok: false, motivo: 'Não foi possível abrir este conteúdo na TV.' };
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --import tsx --test tests/cast.test.ts && npx tsc --noEmit -p . && npm test`
Expected: PASS; sem erros de tipo (ajuste tipos/exports conforme o código real).

- [ ] **Step 6: Commit**

```bash
git add src/services/cast.ts src/services/castResolve.ts tests/cast.test.ts
git commit -m "feat(tv): cliente e resolvedor do envio celular→TV"
```

---

### Task C3: A TV consulta a fila e toca (laço, aviso, ligação ao app)

**Files:**
- Create: `src/hooks/useCastPoll.ts`
- Create: `src/components/CastToast.tsx`
- Modify: `src/App.tsx` (montar o hook e o toast dentro de `MainTvApp`)
- Modify: `src/index.css` só se precisar de classe nova (sem `gap`, sem `:is()`)
- Test: `tests/cast-loop.test.ts`

Desenho do laço (puro e testável, separado do React): `runCastStep(deps)` faz **uma** rodada: poll → se veio comando: resolve → abre o player → ack → devolve o que fazer em seguida (`delayMs`).

- [ ] **Step 1: Escrever o teste do passo (deve falhar)**

```ts
// Uma rodada do laço de envio celular→TV
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCastStep, CAST_POLL_MS, CAST_ERROR_MS } from '../src/hooks/useCastPoll';

const cmd = { id: 'c1', kind: 'channel' as const, payload: { name: 'Globo' }, from: 'Pixel' };

test('sem comando: espera o intervalo normal e não faz mais nada', async () => {
  const calls: string[] = [];
  const r = await runCastStep({
    poll: async () => ({ status: 'ok', command: null }),
    resolve: async () => { calls.push('resolve'); return { ok: false, motivo: '' }; },
    open: () => calls.push('open'),
    ack: async () => { calls.push('ack'); },
    notify: () => calls.push('notify'),
  });
  assert.deepEqual(r, { delayMs: CAST_POLL_MS, stop: false });
  assert.deepEqual(calls, []);
});

test('com comando resolvido: abre o player, avisa e confirma "tocando"', async () => {
  const calls: any[] = [];
  const r = await runCastStep({
    poll: async () => ({ status: 'ok', command: cmd }),
    resolve: async () => ({ ok: true, player: { type: 'channel', title: 'Globo', streamUrl: 'http://a' } as any }),
    open: (p) => calls.push(['open', p.title]),
    ack: async (id, played, motivo) => { calls.push(['ack', id, played, motivo]); },
    notify: (m) => calls.push(['notify', m]),
  });
  assert.equal(r.delayMs, CAST_POLL_MS);
  assert.deepEqual(calls, [['open', 'Globo'], ['notify', 'Enviado do celular Pixel'], ['ack', 'c1', true, '']]);
});

test('comando que não resolve: avisa o celular com o motivo', async () => {
  const calls: any[] = [];
  await runCastStep({
    poll: async () => ({ status: 'ok', command: cmd }),
    resolve: async () => ({ ok: false, motivo: 'Canal não encontrado na lista desta TV.' }),
    open: () => calls.push('open'),
    ack: async (id, played, motivo) => { calls.push(['ack', id, played, motivo]); },
    notify: (m) => calls.push(['notify', m]),
  });
  assert.deepEqual(calls, [['ack', 'c1', false, 'Canal não encontrado na lista desta TV.']]);
});

test('erro de rede: tenta de novo mais tarde; aparelho desconhecido: para', async () => {
  const e = await runCastStep({ poll: async () => { throw new Error('rede'); }, resolve: async () => ({ ok: false, motivo: '' }), open: () => {}, ack: async () => {}, notify: () => {} });
  assert.deepEqual(e, { delayMs: CAST_ERROR_MS, stop: false });
  const u = await runCastStep({ poll: async () => ({ status: 'unknown_device' }), resolve: async () => ({ ok: false, motivo: '' }), open: () => {}, ack: async () => {}, notify: () => {} });
  assert.equal(u.stop, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test tests/cast-loop.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/hooks/useCastPoll.ts`**

```ts
// A TV consulta a fila de envios do celular e toca o que chegou.
// Cadeia de setTimeout (não setInterval) para nunca empilhar requisições; pausa com a TV em segundo plano.
import { useEffect, useRef } from 'react';
import { castAck, castPoll, type CastPollResult } from '../services/cast';
import { resolveCast, type CastDeps, type CastResolved } from '../services/castResolve';
import { OTT_KEYS, ottConfig } from '../services/ott';
import type { ActivePlayerState } from '../context/TvNavigationContext';

export const CAST_POLL_MS = 3000;
export const CAST_ERROR_MS = 10000;

export interface CastStepDeps {
  poll(): Promise<CastPollResult>;
  resolve(cmd: { id: string; kind: any; payload: Record<string, unknown>; from: string }): Promise<CastResolved>;
  open(player: ActivePlayerState): void;
  ack(id: string, played: boolean, motivo: string): Promise<void>;
  notify(message: string): void;
}

// Uma rodada: devolve quanto esperar para a próxima e se o laço deve parar
export async function runCastStep(d: CastStepDeps): Promise<{ delayMs: number; stop: boolean }> {
  let res: CastPollResult;
  try {
    res = await d.poll();
  } catch (e) {
    return { delayMs: CAST_ERROR_MS, stop: false };
  }
  if (res.status === 'unknown_device') return { delayMs: CAST_ERROR_MS, stop: true };
  if (res.status !== 'ok') return { delayMs: CAST_ERROR_MS, stop: false };
  if (!res.command) return { delayMs: CAST_POLL_MS, stop: false };

  const cmd = res.command;
  const resolved = await d.resolve(cmd);
  if (resolved.ok) {
    d.open(resolved.player);
    d.notify(cmd.from ? 'Enviado do celular ' + cmd.from : 'Enviado do celular');
    try { await d.ack(cmd.id, true, ''); } catch (e) { /* o celular só perde o aviso */ }
  } else {
    try { await d.ack(cmd.id, false, resolved.motivo); } catch (e) { /* idem */ }
  }
  return { delayMs: CAST_POLL_MS, stop: false };
}

// Liga o laço ao app: deps do api.ts, openPlayer do contexto e o aviso na tela
export function useCastPoll(openPlayer: (p: ActivePlayerState) => void, notify: (m: string) => void, deps: CastDeps) {
  const latest = useRef({ openPlayer, notify, deps });
  latest.current = { openPlayer, notify, deps };

  useEffect(() => {
    if (!ottConfig) return;
    let alive = true;
    let timer: any = null;

    const token = () => {
      try { return localStorage.getItem(OTT_KEYS.DEVICE_TOKEN) || ''; } catch (e) { return ''; }
    };

    const loop = async () => {
      timer = null;
      const tk = token();
      if (!alive || !tk || (typeof document !== 'undefined' && document.hidden)) {
        if (alive) timer = setTimeout(loop, CAST_POLL_MS);
        return;
      }
      const step = await runCastStep({
        poll: () => castPoll(ottConfig as any, tk),
        resolve: (cmd) => resolveCast(cmd, latest.current.deps),
        open: (p) => latest.current.openPlayer(p),
        ack: (id, played, motivo) => castAck(ottConfig as any, tk, id, played, motivo),
        notify: (m) => latest.current.notify(m),
      });
      if (alive && !step.stop) timer = setTimeout(loop, step.delayMs);
    };

    const onVisible = () => {
      if (!document.hidden && alive && timer) { clearTimeout(timer); loop(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    timer = setTimeout(loop, 1000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
```

> Confirme em `ott.ts` que `ottConfig` e `OTT_KEYS` são exportados; se não forem, exporte-os (mudança mínima).

- [ ] **Step 4: Implementar o aviso `src/components/CastToast.tsx`**

```tsx
// Aviso curto "Enviado do celular ..." no topo da tela da TV.
// Só opacity (Chrome 53: sem transform pesado) e some sozinho; não recebe foco do controle.
import React, { useEffect } from 'react';

export function CastToast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  return (
    <div
      className="tv-fade-in"
      style={{
        position: 'fixed', top: '2.5rem', left: '50%', marginLeft: '-14rem', width: '28rem', zIndex: 60,
        textAlign: 'center', padding: '0.9rem 1.4rem', borderRadius: '0.9rem', pointerEvents: 'none',
        background: 'rgba(18,18,28,0.96)', border: '1px solid #F97316', color: '#F3F4F6', fontSize: '1.15rem', fontWeight: 600,
      }}
    >
      {message}
    </div>
  );
}
```

- [ ] **Step 5: Ligar em `src/App.tsx` (dentro de `MainTvApp`)**

Adicionar imports e, depois dos estados existentes, antes do `return`:

```tsx
import { useCastPoll } from './hooks/useCastPoll';
import { CastToast } from './components/CastToast';
import { getLiveChannels, getVodMovies, getVodMovieDetail, getSeriesList, getSeriesDetail } from './services/api';
import type { CastDeps } from './services/castResolve';

// ... dentro de MainTvApp, onde já existe `const { openPlayer, ... } = useTvNavigation()`:
const [castMessage, setCastMessage] = useState('');
const castDeps = useRef<CastDeps>({
  searchChannels: async (q) => (await getLiveChannels({ q, offset: 0, limit: 50 })).items,
  getMovieById: async (id) => getVodMovieDetail(id),
  searchMovies: async (q) => (await getVodMovies({ q, offset: 0, limit: 30 })).items,
  getSeriesById: async (id) => getSeriesDetail(id),
  searchSeries: async (q) => (await getSeriesList({ q, offset: 0, limit: 30 })).items,
}).current;
useCastPoll(openPlayer, setCastMessage, castDeps);
```

e, no JSX de `MainTvApp`, junto do `PlayerView`: `<CastToast message={castMessage} onDone={() => setCastMessage('')} />`. **Adapte** as chamadas às assinaturas reais de `api.ts` (parâmetros, retorno `{items}` ou lista, `fallback` obrigatório do detalhe, id com ou sem prefixo `vod_`/`series_`). Se `getVodMovieDetail`/`getSeriesDetail` esperam o id sem prefixo, ajuste `castDeps` (o resolvedor já manda `vod_<id>`/`series_<id>`; é o `castDeps` que adapta).

Cuidados de comportamento:
- Se havia modal de filme/série aberto (`selectedMovie`/`selectedSeries`), fechá-los antes de abrir o player (chame os setters existentes dentro do `open` do hook, via função em `App.tsx` que faz `setSelectedMovie(null); setSelectedSeries(null); openPlayer(p)`), para o Voltar do controle não cair num modal antigo.
- O poll vazio não pode chamar `setState` (evita re-render do app inteiro a cada 3 s).

- [ ] **Step 6: Testar, compilar para a TV, conferir sintaxe Chrome 53**

Run: `node --import tsx --test tests/cast-loop.test.ts && npx tsc --noEmit -p . && npm test && npm run build && npm run check:tv`
(`build:ott` se o script `build` não cobrir o modo OTT: use o mesmo que o repo usa para o app OTT, ex.: `npm run build:ott`, e rode `check:tv` sobre essa saída.)
Expected: tudo verde; `check:tv` sem sintaxe nova.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat(tv): TV consulta a fila do celular e toca canal, filme e episódio enviados"
```

---

# PARTE 2 — Celular (repositório `visual-craft-assistant`, branch `v10`)

> Antes de tudo: `node --test` deve estar em 240 verdes. Funções puras que dependem de `ott*` vão no `<script id="ott-core">` (e na lista de `tests/ott/loadOtt.js`); independentes, no script principal + `PURE_HELPER_NAMES` de `tests/vod/loadVodHelpers.js`. No script principal, nenhuma referência a `ott*` fora de funções.

### Task C4: Funções do `ott-core` para o envio (testadas)

**Files:**
- Modify: `sintoniza-link.html` (`<script id="ott-core">`, depois de `ottDeviceUnlink`)
- Modify: `tests/ott/loadOtt.js` (acrescentar as funções novas na lista `this.__ott = {...}`)
- Test: `tests/ott/cast.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };

test("monta o conteúdo do envio por tipo, sem links de stream", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottBuildCastPayload("channel", { name: "Globo SP", category: "Abertos", url: "http://segredo/x" })), { name: "Globo SP", group: "Abertos" });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "Filme X", year: "2023" })), { streamId: "10", title: "Filme X", year: 2023 });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 11, title: "Filme Y", releaseDate: "2019-05-01" })), { streamId: "11", title: "Filme Y", year: 2019 });
  assert.deepEqual(plain(o.ottBuildCastPayload("episode", { series_id: 7, name: "Série Y" }, { season: "2", episode: "5" })), { seriesId: "7", title: "Série Y", season: 2, episode: 5 });
  assert.equal(o.ottBuildCastPayload("channel", { name: "" }), null);
  assert.equal(o.ottBuildCastPayload("hack", { name: "x" }), null);
  const longo = plain(o.ottBuildCastPayload("channel", { name: "A".repeat(500), category: "B".repeat(500) }));
  assert.equal(longo.name.length, 120);
  assert.equal(longo.group.length, 80);
});

test("lista as TVs da conta", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", tvs: [{ id: "a", modelo: "LG", online: true }, { id: "", modelo: "x" }, { id: "b", modelo: "", online: false }] } }));
  const tvs = plain(await o.ottCastTargets(cfg, "tok", f));
  assert.deepEqual(tvs, [{ id: "a", modelo: "LG", online: true }, { id: "b", modelo: "TV", online: false }]);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok" });
  const sem = fakeFetch(() => ({ body: { status: "unknown_device" } }));
  await assert.rejects(o.ottCastTargets(cfg, "tok", sem), /ativar/i);
});

test("envia o comando e devolve o id", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", id: "cmd1", online: false } }));
  assert.deepEqual(plain(await o.ottCastSend(cfg, "tok", "tv1", "channel", { name: "Globo" }, f)), { id: "cmd1", online: false });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "tok", p_to: "tv1", p_kind: "channel", p_payload: { name: "Globo" } });
  const bloq = fakeFetch(() => ({ body: { status: "blocked" } }));
  await assert.rejects(o.ottCastSend(cfg, "tok", "tv1", "channel", { name: "x" }, bloq), /acesso/i);
  const erro = fakeFetch(() => ({ status: 400, body: { message: "TV não encontrada na sua conta." } }));
  await assert.rejects(o.ottCastSend(cfg, "tok", "tv1", "channel", { name: "x" }, erro), /TV não encontrada/);
});

test("consulta o estado do envio e traduz para o usuário", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", estado: "played", motivo: "" } }));
  assert.deepEqual(plain(await o.ottCastStatus(cfg, "tok", "cmd1", f)), { estado: "played", motivo: "" });
  assert.equal(o.ottCastStatusText("pending", ""), "Enviando para a TV...");
  assert.equal(o.ottCastStatusText("delivered", ""), "A TV recebeu, abrindo...");
  assert.equal(o.ottCastStatusText("played", ""), "Tocando na TV");
  assert.equal(o.ottCastStatusText("failed", "Canal não encontrado na lista desta TV."), "Canal não encontrado na lista desta TV.");
  assert.equal(o.ottCastStatusText("failed", ""), "A TV não conseguiu abrir este conteúdo.");
  assert.equal(o.ottCastStatusText("expired", ""), "A TV não respondeu. Confira se ela está ligada com o Sintoniza aberto.");
  assert.equal(o.ottCastIsFinal("played"), true);
  assert.equal(o.ottCastIsFinal("delivered"), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ott/cast.test.js`
Expected: FAIL (funções não definidas).

- [ ] **Step 3: Implementar no `ott-core`**

```js
// ── Envio do celular para a TV (relé pela conta) ──
const OTT_CAST_KINDS = ["channel", "vod", "episode"];

function ottClip(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function ottYearOf(item) {
  const raw = item && (item.year || String(item.releaseDate || "").slice(0, 4));
  const n = parseInt(raw, 10);
  return n >= 1900 && n <= 2100 ? n : 0;
}

// Conteúdo do envio: só nomes e ids (o link do stream, com usuário e senha, NUNCA vai)
function ottBuildCastPayload(kind, item, extra) {
  if (OTT_CAST_KINDS.indexOf(kind) < 0 || !item) return null;
  if (kind === "channel") {
    const name = ottClip(item.name, 120);
    return name ? { name, group: ottClip(item.category, 80) } : null;
  }
  const title = ottClip(item.name || item.title, 120);
  if (!title) return null;
  if (kind === "vod") {
    return { streamId: ottClip(item.stream_id, 40), title, year: ottYearOf(item) };
  }
  const e = extra || {};
  const season = parseInt(e.season, 10);
  const episode = parseInt(e.episode, 10);
  if (!(season >= 0) || !(episode >= 0)) return null;
  return { seriesId: ottClip(item.series_id, 40), title, season, episode };
}

// TVs ativas da mesma conta
async function ottCastTargets(cfg, token, fetchImpl) {
  const data = await ottCallRpc(cfg, "cast_targets", { p_token: token }, fetchImpl);
  if (!data || data.status === "unknown_device") throw new Error("Este aparelho não está ativado. Abra o app e ative com o código.");
  if (data.status !== "ok") throw new Error("Resposta inesperada do servidor.");
  return (Array.isArray(data.tvs) ? data.tvs : [])
    .filter((t) => t && ottStr(t.id))
    .map((t) => ({ id: t.id, modelo: ottStr(t.modelo) || "TV", online: t.online === true }));
}

// Grava o comando para a TV; devolve o id para acompanhar
async function ottCastSend(cfg, token, toId, kind, payload, fetchImpl) {
  const data = await ottCallRpc(cfg, "cast_send", { p_token: token, p_to: toId, p_kind: kind, p_payload: payload }, fetchImpl);
  if (!data || data.status === "unknown_device") throw new Error("Este aparelho não está ativado. Abra o app e ative com o código.");
  if (data.status === "blocked") throw new Error("Seu acesso está encerrado. Renove no painel.");
  if (data.status !== "ok" || !ottStr(data.id)) throw new Error("Resposta inesperada do servidor.");
  return { id: data.id, online: data.online === true };
}

async function ottCastStatus(cfg, token, id, fetchImpl) {
  const data = await ottCallRpc(cfg, "cast_status", { p_token: token, p_id: id }, fetchImpl);
  if (!data || data.status !== "ok") throw new Error("Não foi possível consultar o envio.");
  return { estado: ottStr(data.estado), motivo: ottStr(data.motivo) };
}

function ottCastIsFinal(estado) {
  return estado === "played" || estado === "failed" || estado === "expired";
}

function ottCastStatusText(estado, motivo) {
  if (estado === "played") return "Tocando na TV";
  if (estado === "delivered") return "A TV recebeu, abrindo...";
  if (estado === "failed") return motivo || "A TV não conseguiu abrir este conteúdo.";
  if (estado === "expired") return "A TV não respondeu. Confira se ela está ligada com o Sintoniza aberto.";
  return "Enviando para a TV...";
}
```

e, em `tests/ott/loadOtt.js`, acrescentar à lista exposta: `ottBuildCastPayload, ottCastTargets, ottCastSend, ottCastStatus, ottCastIsFinal, ottCastStatusText`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/ott/ && npm test`
Expected: PASS (240 + novos).

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/ott
git commit -m "feat(tv-cast): funções do envio para a TV no ott-core (payload, TVs, envio, estado)"
```

---

### Task C5: Fluxo "Assistir na TV" e escolha da TV (folha) + botão no player

**Files:**
- Modify: `sintoniza-link.html` (HTML `#tv-sheet`, CSS, controlador `castToTv`, botão `#tv-cast-btn` na barra do player, `selected.castInfo`)
- Test: `tests/ott/cast-markup.test.js`

- [ ] **Step 1: Escrever o teste de marcação (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a folha de escolha da TV e o botão do player existem", () => {
  for (const id of ["tv-sheet", "tv-sheet-title", "tv-sheet-list", "tv-sheet-cancel", "tv-cast-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
});

test("o botão do player só aparece com conta ativa (ott-mode)", () => {
  assert.match(html, /body:not\(\.ott-mode\) #tv-cast-btn \{ display: none; \}/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ott/cast-markup.test.js`
Expected: FAIL.

- [ ] **Step 3: HTML** (junto do `#action-sheet`)

```html
<!-- Folha: escolher para qual TV enviar -->
<div id="tv-sheet" class="hidden" aria-hidden="true">
  <div class="tv-sheet-panel" role="dialog" aria-label="Assistir na TV">
    <p class="tv-sheet-title" id="tv-sheet-title">Escolha a TV</p>
    <div id="tv-sheet-list"></div>
    <button type="button" class="action-sheet-btn" id="tv-sheet-cancel">Cancelar</button>
  </div>
</div>
```

Botão no player, na barra `.player-controls`, entre `.player-controls-spacer` e `#pip-btn`:

```html
<button class="ctrl-btn" id="tv-cast-btn" type="button" aria-label="Assistir na TV" title="Assistir na TV"><i data-lucide="tv" style="width:20px;height:20px"></i></button>
```

- [ ] **Step 4: CSS** (copie o visual do `#action-sheet`: veja suas regras ~960–989 e reaproveite as classes `.action-sheet-btn`)

```css
    #tv-sheet { position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,.6); display: flex; align-items: flex-end; justify-content: center; }
    #tv-sheet.hidden { display: none; }
    .tv-sheet-panel { width: 100%; max-width: 30rem; background: var(--card); border-radius: 1rem 1rem 0 0; padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: .5rem; }
    .tv-sheet-title { font-weight: 700; padding: .25rem .25rem .5rem; }
    .tv-sheet-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 3rem; padding: .5rem .9rem; border-radius: .75rem; border: 1px solid var(--border); background: var(--secondary); color: var(--foreground); font-size: 1rem; }
    .tv-sheet-btn small { color: var(--muted-fg); }
    body:not(.ott-mode) #tv-cast-btn { display: none; }
```

- [ ] **Step 5: Controlador no script principal** (junto do bloco "CONTA SINTONIZA")

```js
// ══════════════════════════════════════════════════════
// ASSISTIR NA TV (envio do celular para a TV da mesma conta)
// ══════════════════════════════════════════════════════
let _castBusy = false;

function closeTvSheet() {
  const sheet = document.getElementById("tv-sheet");
  sheet.classList.add("hidden");
  sheet.setAttribute("aria-hidden", "true");
}

// Pergunta qual TV quando a conta tem mais de uma
function chooseTv(tvs) {
  return new Promise(resolve => {
    const sheet = document.getElementById("tv-sheet");
    const list = document.getElementById("tv-sheet-list");
    list.innerHTML = tvs.map(t =>
      `<button type="button" class="tv-sheet-btn" data-tv-id="${String(t.id).replace(/[^a-f0-9-]/gi, "")}">
         <span>${sanitizeLabel(t.modelo)}</span><small>${t.online ? "online" : "sem sinal recente"}</small>
       </button>`).join("");
    const done = (id) => { closeTvSheet(); sheet.onclick = null; resolve(id); };
    sheet.onclick = (e) => {
      const btn = e.target.closest("[data-tv-id]");
      if (btn) done(btn.dataset.tvId);
      else if (e.target.id === "tv-sheet" || e.target.id === "tv-sheet-cancel") done(null);
    };
    sheet.classList.remove("hidden");
    sheet.setAttribute("aria-hidden", "false");
  });
}

// Fluxo completo: acha as TVs, envia e acompanha até a TV responder
async function castToTv(kind, item, extra) {
  if (_castBusy) return;
  const token = localStorage.getItem(OTT_KEYS.TOKEN);
  if (!_ott.cfg || !token) { showToast("Entre na sua conta Sintoniza para enviar à TV."); return; }
  const payload = ottBuildCastPayload(kind, item, extra);
  if (!payload) { showToast("Não foi possível enviar este item para a TV."); return; }
  _castBusy = true;
  try {
    const tvs = await ottCastTargets(_ott.cfg, token);
    if (!tvs.length) { showToast("Nenhuma TV ativada na sua conta. Ative a TV com o código no painel."); return; }
    const toId = tvs.length === 1 ? tvs[0].id : await chooseTv(tvs);
    if (!toId) return;
    const sent = await ottCastSend(_ott.cfg, token, toId, kind, payload);
    showToast(ottCastStatusText("pending", ""), 2500);
    // acompanha por até ~25 s; a TV consulta a cada 3 s
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const st = await ottCastStatus(_ott.cfg, token, sent.id);
      if (ottCastIsFinal(st.estado)) { showToast(ottCastStatusText(st.estado, st.motivo), 4000); return; }
      if (i === 1 && st.estado === "pending") showToast("Aguardando a TV...", 2500);
    }
    showToast(ottCastStatusText("expired", ""), 4500);
  } catch (e) {
    showToast(e.message || "Não foi possível enviar para a TV.", 4500);
  } finally {
    _castBusy = false;
  }
}
```

Dentro do `DOMContentLoaded` (junto de `ottBoot()`), ligar o botão do player e fechar a folha:

```js
  document.getElementById("tv-cast-btn").addEventListener("click", () => {
    const sel = _state.selected;
    if (!sel) return;
    if (!sel.isVod) castToTv("channel", sel);
    else if (sel.castInfo) castToTv(sel.castInfo.kind, sel.castInfo.item, sel.castInfo.extra);
    else showToast("Não foi possível enviar este item para a TV.");
  });
```

`selected.castInfo`: em `playVodSelection(url, meta)` aceitar `meta.castInfo` (`{kind, item, extra}`) e copiá-lo para o pseudo-canal; nos pontos que chamam `playVodSelection` (botão de filme do modal e `playEpisode`) passar `castInfo: { kind: "vod", item }` e `castInfo: { kind: "episode", item: series, extra: { season, episode: episodeNum } }`. Nos pontos de "continuar assistindo" (`data-vod-resume`), passar o mesmo quando o item guardado tiver `stream_id`/`series_id` (se não tiver, o botão avisa que não dá para enviar).

A visibilidade do botão segue `body.ott-mode` (CSS) e só faz sentido com algo tocando: acrescentar no render que atualiza o `#pip-btn`: `document.getElementById("tv-cast-btn").style.display = _state.selected ? "" : "none";` (sobrepondo o CSS só quando há seleção; sem `ott-mode` a regra de CSS com `display:none` precisa vencer: use `style.display = _state.selected ? "" : "none"` e deixe o CSS esconder sem conta).

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test tests/ott/ && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sintoniza-link.html tests/ott/cast-markup.test.js
git commit -m "feat(tv-cast): fluxo Assistir na TV, escolha da TV e botão no player"
```

---

### Task C6: Botões "Assistir na TV" no modal, nos episódios e nos canais

**Files:**
- Modify: `sintoniza-link.html` (modal de filme/série, linhas de episódio, cartões de canal grade/lista, CSS)
- Test: acrescentar a `tests/ott/cast-markup.test.js`

Âncoras (conferir no código real): `#vod-modal-actions` (HTML ~1780; botões `#vod-modal-play`, `#vod-modal-mylist`, `#vod-modal-download`); `openVodModal` (~6810, `playBtn.onclick` ~6835, esconde o download para série ~6850); lista de episódios (~6878–6887; delegação em `#vod-modal-episodes` ~7817); `cardHTML(ch)` (~5397) e `listHTML(ch)` (~5421) com listeners em `renderCatalog` (~5370–5384).

- [ ] **Step 1: Acrescentar ao teste (deve falhar)**

```js
test("há botão Assistir na TV no modal, nos episódios e nos canais", () => {
  assert.match(html, /id="vod-modal-tv"/);
  assert.match(html, /data-ep-tv=/);
  assert.match(html, /data-tv-channel-id=/);
  assert.match(html, /body:not\(\.ott-mode\) \.tv-only \{ display: none; \}/);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/ott/cast-markup.test.js` → FAIL.

- [ ] **Step 3: Implementar**

CSS: `body:not(.ott-mode) .tv-only { display: none; }` e estilos `.tv-btn` (redondo, 2.4rem, como `.fav-btn`/`.ep-dl-btn`), `.ep-tv-btn` (3rem como `.ep-dl-btn`), `.channel-card .tv-btn` posicionado absoluto como o `.fav-btn` do cartão (canto oposto; conferir CSS ~744 para não sobrepor `.epg-btn`).

Modal (HTML): acrescentar em `#vod-modal-actions`, depois do `#vod-modal-download`:
```html
<button class="btn-ghost tv-only" id="vod-modal-tv" type="button"><i data-lucide="tv" style="width:18px;height:18px"></i> Assistir na TV</button>
```
Em `openVodModal(item, vodType, creds)`: para filme, `document.getElementById("vod-modal-tv").onclick = () => castToTv("vod", item)`; para série, ocultar (cada episódio tem o seu botão): `style.display = "none"` quando `vodType === "series"`, e exibir `""` para filme (respeitando a regra CSS `.tv-only`).

Episódios: na linha de cada `div.ep-row`, depois do `ep-dl-btn` (e **fora** do `button.ep-btn`, para não aninhar botão em botão), acrescentar:
```js
`<button class="ep-tv-btn tv-only" type="button" data-ep-tv="${epId}" data-ep-season="${season}" data-ep-num="${num}" aria-label="Assistir na TV"><i data-lucide="tv" style="width:18px;height:18px"></i></button>`
```
e na delegação de `#vod-modal-episodes`, **antes** do `.ep-btn`:
```js
const tvBtn = e.target.closest("[data-ep-tv]");
if (tvBtn) {
  castToTv("episode", _vodModalItem.item, { season: tvBtn.dataset.epSeason, episode: tvBtn.dataset.epNum });
  return;
}
```
(use os nomes de campo reais dos dados do episódio — `season`, `episode_num` — e a variável real do item da série).

Canais: em `cardHTML(ch)` e `listHTML(ch)` acrescentar, ao lado de `.fav-btn`: `<button class="tv-btn tv-only" type="button" data-tv-channel-id="${ch.id}" aria-label="Assistir na TV"><i data-lucide="tv" style="width:16px;height:16px"></i></button>`; em `renderCatalog`, junto dos listeners existentes (5370–5384):
```js
container.querySelectorAll("[data-tv-channel-id]").forEach(el => {
  el.addEventListener("click", e => {
    e.stopPropagation();
    const ch = getChannels().find(c => c.id === +el.dataset.tvChannelId);
    if (ch) castToTv("channel", ch);
  });
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/ott/ && npm test`
Expected: PASS.

- [ ] **Step 5: Verificar visualmente no Chrome (modo app simulado, conta fingida)**

Criar `scripts/dev/check-tv-cast-ui.mjs` (padrão dos outros `check-*.mjs`, `withPage(..., { native: true }, ...)`, abrindo com `?noott=1`): fingir `fetch` das RPCs `cast_targets` (uma TV), `cast_send` (id fixo) e `cast_status` (primeiro `delivered`, depois `played`), marcar `document.body.classList.add("ott-mode")`, preparar `_ott.cfg` e `localStorage.sint_ott_token`, selecionar um canal e chamar o botão `#tv-cast-btn`; checar que o `#toast` passa por "Enviando para a TV..." e termina em "Tocando na TV", que o corpo de `cast_send` tem `p_kind:"channel"` e **não** contém `http`. Depois abrir o modal de um filme e conferir que `#vod-modal-tv` está visível. Com duas TVs, conferir que `#tv-sheet` abre com 2 botões e que escolher um envia para o id certo.

Run: `node scripts/dev/check-tv-cast-ui.mjs`
Expected: `✔ ok`.

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/ott scripts/dev/check-tv-cast-ui.mjs
git commit -m "feat(tv-cast): botão Assistir na TV no modal, nos episódios e nos canais"
```

---

### Task C7: Ponta a ponta contra o backend real (celular → fila → "TV" simulada)

**Files:**
- Create: `scripts/dev/e2e-cast.mjs`

O celular é a página real (Chrome/CDP, `?ott=1`), ativada de verdade; a "TV" é o script (RPCs reais `device_start`/`device_claim`/`cast_poll`/`cast_ack`), igual ao smoke. Prova: botão → backend → TV recebe o payload certo (sem link) → `ack` → o celular mostra "Tocando na TV".

- [ ] **Step 1: Escrever o script** (mesmo estilo e leitura segura do `.env.ott.local` do `e2e-ott-gate.mjs`; caminho do arquivo por argumento; nunca imprime segredos)

Fluxo:
1. Cria a "TV": `device_start` (tipo tv) e `device_claim` com o JWT do usuário de teste.
2. Abre o celular em `?ott=1`, limpa o `localStorage`, espera o código, ativa com `device_claim`, espera `ott-mode`.
3. No celular: seleciona o primeiro canal da lista (`selectChannel(getChannels()[0])`) e dispara `castToTv("channel", ch)`.
4. A "TV" faz `cast_poll` em laço (até 20 s) e recebe `kind=channel` com `payload.name === ch.name`; verifica que `JSON.stringify(payload)` não contém `http`.
5. A "TV" chama `cast_ack` (`played`).
6. Verifica no celular que o `#toast` contém "Tocando na TV" (espera até 10 s).
7. Limpeza: `device_unlink` da TV e do celular (token do `localStorage`); também em caso de falha (`finally`).

- [ ] **Step 2: Rodar**

Run: `node scripts/dev/e2e-cast.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"`
Expected: `✔ ok: celular → fila → TV → ack → "Tocando na TV"`.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev/e2e-cast.mjs
git commit -m "test(tv-cast): envio do celular para a TV de ponta a ponta contra o backend real"
```

---

### Task C8: Teste na TV real (LG) e fechamento

- [ ] **Step 1: Empacotar o app OTT da TV com o recurso novo**

No repo da TV: `npm run lojas:ott` (gera os pacotes; saída em `Downloads/Sintoniza-lojas/` como antes). Conferir o `.ipk` novo.

- [ ] **Step 2: Instalar na TV de teste, se estiver acessível** (consulte a nota de memória `lg-tv-acesso-dev`: IP muda por DHCP — achar pela porta 9922; `ares` com o dispositivo "Lg Tv"; CDP na porta 9998). Se a TV estiver desligada ou inacessível, **pule** e registre no relatório. Se acessível: instalar o `.ipk`, abrir o app OTT, e no celular simulado (script do C7, mas sem simular a TV) enviar um canal real; conferir pela captura de tela via CDP que o player abre e o aviso "Enviado do celular ..." aparece. Não desinstale nem altere outros apps da TV.

- [ ] **Step 3: Regressões**

Repo da TV: `npm test`, `npx tsc --noEmit -p .`, `npm run build:ott && npm run check:tv`, `npm run ott:smoke`.
Repo do celular: `npm test` e os `scripts/dev/check-*.mjs` (todos `✔ ok`).

- [ ] **Step 4: Atualizar a documentação**

No estudo `2026-10-02-estudo-celular-para-tv.md`, trocar a seção "Status" por "Fase 1 implementada" com o que mudou em relação ao desenho (casamento por `streamId`/`seriesId`; `tvgId` e `tmdbId` não existem nos apps; resume de posição e "dica de Wi-Fi" ficam para a Fase 2).

- [ ] **Step 5: Commit** dos dois repositórios (docs) e envio (push) das branches `v10` e `app-tv-ott-ativacao`.

---

## Auto-revisão

- **Cobertura do pedido ("implemente o estudo conforme mapeou"):** backend (C1), TV recebe e toca (C2–C3), celular com botões em todos os lugares onde se procura conteúdo (C4–C6), prova ponta a ponta (C7) e TV real (C8). Fora da Fase 1, como no estudo: pausar/continuar/volume pelo celular, dica de Wi-Fi, apelido da TV, retomar posição.
- **Segurança:** o payload só leva nomes e ids; o teste do C7 confere que não há `http`. Só aparelhos da mesma conta se enxergam (verificado no servidor); comandos expiram em 2 min; limite de 30 envios por minuto; tabela sem acesso direto.
- **Nomes consistentes:** `cast_targets/send/poll/ack/status`, `ottCastTargets/Send/Status/IsFinal/StatusText`, `ottBuildCastPayload`, `castToTv`, `castInfo`, `parseCastPoll/castPoll/castAck/pickBest/payloadYear`, `resolveCast/CastDeps`, `runCastStep/useCastPoll/CAST_POLL_MS/CAST_ERROR_MS`.
- **Riscos:** (1) `getVodMovieDetail`/`getSeriesDetail` e `ActivePlayerState` têm assinaturas a confirmar no código real (as tasks mandam compilar e adaptar); (2) o poll de 3 s é o primeiro laço frequente com rede na TV: medir o impacto na TV real no C8; (3) mesmo conteúdo com título diferente entre apps cai no casamento por título e pode falhar (a TV avisa o motivo no celular).
