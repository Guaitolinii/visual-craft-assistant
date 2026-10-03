# Favoritos por perfil na conta, entrada "como nos streamings" e pré-carregamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) os favoritos de cada perfil (canais, filmes e séries) vivem **na conta**: o que o "fulaninho2" salvou no celular aparece nos favoritos dele na TV e vice-versa; (2) ao abrir o app a **primeira coisa** é escolher quem está assistindo (a não ser que só exista um perfil), sem a Início aparecer antes; (3) nesses segundos de entrada o app **pré-carrega filmes e séries em segundo plano**, de forma leve, para a primeira busca não pesar.

**Architecture:** tabela `perfil_favoritos` por perfil (chave estável entre apps) + RPCs com token do aparelho (`fav_list`, `fav_set`, `fav_merge`). Cada app continua "local primeiro" (o que já existe) e **sincroniza**: ao escolher o perfil e ao voltar ao app puxa a lista da conta; a cada marcar/desmarcar empurra a mudança; na primeira vez de cada aparelho/perfil faz a **união** (nada se perde). Pré-carregamento: aquecer o catálogo em fatias pequenas depois da escolha do perfil, com um indicador discreto e sem travar a navegação.

**Tech Stack:** Supabase SQL/RPC, TypeScript/React (TV, Chrome 53), HTML/JS puro (celular), `node:test`, Chrome CDP.

**Repositórios e branches** (nunca na `main`; sem push dentro das tasks; o Gustavo pede download/instalação):
- Backend e TV: `C:\Users\guait\Documents\Novo-App-de-TV`, branch `app-tv-ott-ativacao` (Tasks F1–F3).
- Celular: `C:\Users\guait\Documents\visual-craft-assistant`, branch `v12` (Tasks F4–F5); a versão para entrega é decidida na F7.
- Ordem: F1 primeiro; depois TV (F2→F3) e celular (F4→F5) em paralelo (repos diferentes); F6 e F7 por último.

> 🔐 `.env.ott.local` guarda segredos: nunca imprimir. **Depois de qualquer `npm run ott:setup`, confirme que `mailer_autoconfirm` continua `false`** (GET `https://api.supabase.com/v1/projects/<ref>/config/auth`; o setup já não o religa; nunca use `OTT_AUTOCONFIRM`). Limites de taxa: `device_start` 20/h, `device_claim` 10/10 min: rode smoke/e2e uma vez.
> ⚠️ `sintoniza-link.html` é CRLF: nada de `sed -i`; Edit/Write ou script Node `.cjs` no scratchpad; releia antes de editar. No script principal do celular nenhuma referência a `ott*` fora de funções; funções do `ott-core` testadas entram na lista de `tests/ott/loadOtt.js`; funções puras do script principal entram em `PURE_HELPER_NAMES` e devem rodar com os mocks do carregador.
> ⚠️ TV Chrome 53: sem `AbortController`, sem `gap` em flex, sem `:is()/:where()/:has()`, sem `backdrop-filter`; só `opacity`/`transform` em animações; `parseIsoMs` para datas do Postgres; sem `setState` a cada tick; `npm run build:ott` + `check:tv` (se só lê `dist/`, copie `dist-ott/assets` para o scratchpad).

## Contrato

**Chave do favorito** (igual nos dois apps; só ids/nomes, nunca links):

| Tipo | Chave | Observação |
|---|---|---|
| `canal` | `c:<nome normalizado>` | nome em minúsculas, sem acentos, espaços colapsados, até 120 caracteres (o celular guarda favoritos de canal por **nome**; a TV tem ids próprios, então resolve pelo nome) |
| `filme` | `f:<stream_id>` | TV: `movie.id = vod_<id>`; celular: `item.stream_id` |
| `serie` | `s:<series_id>` | TV: `series.id = series_<id>`; celular: `item.series_id` |

**Item sincronizado:** `{ k, tipo, titulo, capa, ano }` (`titulo` ≤ 120, `capa` ≤ 300 e só `http(s)://` ou vazio, `ano` 0 se desconhecido). Máximo 500 itens por perfil.

**RPCs novas** (token do aparelho em `p_token`; o perfil precisa ser da conta):

| RPC | Resposta |
|---|---|
| `fav_list(p_token, p_perfil uuid)` | `{status:'ok', itens:[Item…]}` (mais recentes primeiro) / `{status:'unknown_device'}` |
| `fav_set(p_token, p_perfil, p_chave, p_tipo, p_titulo, p_capa, p_ano, p_on boolean)` | `{status:'ok'}`; `p_on=false` remove |
| `fav_merge(p_token, p_perfil, p_itens jsonb)` | `{status:'ok', total}`; upsert em lote (até 300 itens por chamada), sem remover nada |

**Regra de sincronização** (`syncFavorites`): na primeira vez de um perfil num aparelho (flag local `favsync` do perfil ausente) → **união**: o que só existe no aparelho é enviado (`fav_merge`), o resultado é a união; nas vezes seguintes → a **conta manda** (o local passa a ser exatamente a lista da conta, mantendo no aparelho só o que ainda não foi enviado, marcado como pendente). Marcar/desmarcar → grava local na hora e empurra `fav_set` (falha de rede = fica pendente e sai na próxima sincronização). Puxa: ao escolher o perfil, ao voltar ao app (visível) e a cada 2 minutos com o app aberto.

---

# PARTE 1 — Backend e TV (repositório `Novo-App-de-TV`)

### Task F1: Migração 0010 — favoritos por perfil

**Files:**
- Create: `supabase/migrations/0010_ott_favoritos.sql`
- Modify: `scripts/ott-smoke.mjs` (verificações novas antes do resumo final; helpers `check`, `rpc`, `jwt`)

- [ ] **Step 1: Migração**

```sql
-- 0010: favoritos de cada perfil na conta (canais, filmes, séries), iguais em todos os aparelhos.
-- Só pelas funções (security definer, token do aparelho).

create table if not exists public.perfil_favoritos (
  perfil_id  uuid not null references public.perfis(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  chave      text not null check (chave ~ '^[cfs]:.{1,120}$'),
  tipo       text not null check (tipo in ('canal', 'filme', 'serie')),
  titulo     text not null default '' check (char_length(titulo) <= 120),
  capa       text not null default '' check (capa = '' or (char_length(capa) <= 300 and capa ~ '^https?://')),
  ano        integer not null default 0 check (ano between 0 and 2100),
  created_at timestamptz not null default now(),
  primary key (perfil_id, chave)
);
create index if not exists perfil_favoritos_user on public.perfil_favoritos (user_id, perfil_id, created_at desc);
alter table public.perfil_favoritos enable row level security;
revoke all on public.perfil_favoritos from anon, authenticated;

create or replace function public.fav_list(p_token text, p_perfil uuid)
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
  if not exists (select 1 from public.perfis where id = p_perfil and user_id = d.user_id) then
    raise exception 'Perfil inválido.' using errcode = 'P0001';
  end if;
  select coalesce(json_agg(json_build_object('k', f.chave, 'tipo', f.tipo, 'titulo', f.titulo, 'capa', f.capa, 'ano', f.ano)
                           order by f.created_at desc), '[]'::json)
    into v_list
    from public.perfil_favoritos f where f.perfil_id = p_perfil;
  return json_build_object('status', 'ok', 'itens', v_list);
end;
$$;

create or replace function public.fav_set(
  p_token text, p_perfil uuid, p_chave text, p_tipo text,
  p_titulo text default '', p_capa text default '', p_ano integer default 0, p_on boolean default true)
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
  perform public.check_rate('fav:' || d.id::text, 120, interval '1 minute');
  if not exists (select 1 from public.perfis where id = p_perfil and user_id = d.user_id) then
    raise exception 'Perfil inválido.' using errcode = 'P0001';
  end if;
  if p_on then
    if (select count(*) from public.perfil_favoritos where perfil_id = p_perfil) >= 500
       and not exists (select 1 from public.perfil_favoritos where perfil_id = p_perfil and chave = p_chave) then
      raise exception 'Limite de 500 favoritos por perfil.' using errcode = 'P0001';
    end if;
    insert into public.perfil_favoritos (perfil_id, user_id, chave, tipo, titulo, capa, ano)
    values (p_perfil, d.user_id, p_chave, p_tipo, left(coalesce(p_titulo, ''), 120), coalesce(p_capa, ''), greatest(coalesce(p_ano, 0), 0))
    on conflict (perfil_id, chave) do update
       set titulo = excluded.titulo, capa = excluded.capa, ano = excluded.ano;
  else
    delete from public.perfil_favoritos where perfil_id = p_perfil and chave = p_chave;
  end if;
  return json_build_object('status', 'ok');
end;
$$;

create or replace function public.fav_merge(p_token text, p_perfil uuid, p_itens jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d   public.devices;
  it  jsonb;
  n   integer;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then
    return json_build_object('status', 'unknown_device');
  end if;
  perform public.check_rate('favm:' || d.id::text, 20, interval '1 minute');
  if not exists (select 1 from public.perfis where id = p_perfil and user_id = d.user_id) then
    raise exception 'Perfil inválido.' using errcode = 'P0001';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 300 then
    raise exception 'Lista inválida.' using errcode = 'P0001';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    continue when (it->>'k') is null or (it->>'k') !~ '^[cfs]:.{1,120}$'
               or (it->>'tipo') not in ('canal', 'filme', 'serie');
    continue when (select count(*) from public.perfil_favoritos where perfil_id = p_perfil) >= 500
               and not exists (select 1 from public.perfil_favoritos where perfil_id = p_perfil and chave = it->>'k');
    insert into public.perfil_favoritos (perfil_id, user_id, chave, tipo, titulo, capa, ano)
    values (p_perfil, d.user_id, it->>'k', it->>'tipo',
            left(coalesce(it->>'titulo', ''), 120),
            case when coalesce(it->>'capa', '') ~ '^https?://' and char_length(it->>'capa') <= 300 then it->>'capa' else '' end,
            case when (it->>'ano') ~ '^[0-9]{1,4}$' then (it->>'ano')::integer else 0 end)
    on conflict (perfil_id, chave) do nothing;
  end loop;
  select count(*) into n from public.perfil_favoritos where perfil_id = p_perfil;
  return json_build_object('status', 'ok', 'total', n);
end;
$$;

revoke execute on function public.fav_list(text, uuid) from public;
revoke execute on function public.fav_set(text, uuid, text, text, text, text, integer, boolean) from public;
revoke execute on function public.fav_merge(text, uuid, jsonb) from public;
grant execute on function public.fav_list(text, uuid) to anon, authenticated;
grant execute on function public.fav_set(text, uuid, text, text, text, text, integer, boolean) to anon, authenticated;
grant execute on function public.fav_merge(text, uuid, jsonb) to anon, authenticated;
```

- [ ] **Step 2: Smoke** (antes do resumo final; cria TV e celular na conta de teste como nas seções anteriores; usa o perfil principal de `perfil_list`)

```js
// Favoritos por perfil na conta
const tvV = await rpc('device_start', { p_modelo: 'TV Fav Smoke', p_sistema: 'webOS' });
const celV = await rpc('device_start', { p_modelo: 'Celular Fav Smoke', p_sistema: 'Android', p_tipo: 'celular' });
await rpc('device_claim', { p_code: tvV.data.code }, jwt);
await rpc('device_claim', { p_code: celV.data.code }, jwt);
const tkTvV = tvV.data.device_token;
const tkCelV = celV.data.device_token;
const perfisV = await rpc('perfil_list', { p_token: tkTvV });
const pfA = perfisV.data.perfis[0].id;
const pfNovo = await rpc('perfil_save', { p_token: tkCelV, p_id: null, p_nome: 'Smoke Fav', p_avatar: 'estrela' });
const pfB = pfNovo.data.perfil.id;

await rpc('fav_set', { p_token: tkCelV, p_perfil: pfB, p_chave: 'f:99010', p_tipo: 'filme', p_titulo: 'Filme Smoke', p_capa: 'https://x/capa.jpg', p_ano: 2020, p_on: true });
await rpc('fav_set', { p_token: tkCelV, p_perfil: pfB, p_chave: 'c:globo sp', p_tipo: 'canal', p_titulo: 'Globo SP', p_capa: '', p_ano: 0, p_on: true });
const lB = await rpc('fav_list', { p_token: tkTvV, p_perfil: pfB });
check('a TV vê os favoritos que o celular salvou no perfil', lB.data.status === 'ok' && lB.data.itens.length === 2 && lB.data.itens.some((i) => i.k === 'f:99010' && i.titulo === 'Filme Smoke' && i.ano === 2020), JSON.stringify(lB.data));
const lA = await rpc('fav_list', { p_token: tkTvV, p_perfil: pfA });
check('os favoritos são separados por perfil', !lA.data.itens.some((i) => i.k === 'f:99010'));
await rpc('fav_set', { p_token: tkTvV, p_perfil: pfB, p_chave: 'f:99010', p_tipo: 'filme', p_titulo: '', p_capa: '', p_ano: 0, p_on: false });
const lB2 = await rpc('fav_list', { p_token: tkCelV, p_perfil: pfB });
check('desmarcar na TV some no celular', lB2.data.itens.length === 1 && lB2.data.itens[0].k === 'c:globo sp');
const mg = await rpc('fav_merge', { p_token: tkCelV, p_perfil: pfB, p_itens: [{ k: 's:99020', tipo: 'serie', titulo: 'Série Smoke', capa: '', ano: 2019 }, { k: 'x:ruim', tipo: 'filme' }, { k: 'f:99021', tipo: 'filme', titulo: 'Outro', capa: 'javascript:alert(1)', ano: 'abc' }] });
check('fav_merge grava os válidos e ignora o resto', mg.data.status === 'ok' && mg.data.total === 3, JSON.stringify(mg.data));
const lB3 = await rpc('fav_list', { p_token: tkTvV, p_perfil: pfB });
check('fav_merge limpa capa insegura e ano inválido', lB3.data.itens.find((i) => i.k === 'f:99021').capa === '' && lB3.data.itens.find((i) => i.k === 'f:99021').ano === 0);
const alheio = await rpc('fav_list', { p_token: tkTvV, p_perfil: '11111111-1111-1111-1111-111111111111' });
check('fav_list recusa perfil de outra conta', alheio.status >= 400 && /Perfil inválido/i.test((alheio.data && alheio.data.message) || ''));
const capaRuim = await rpc('fav_set', { p_token: tkTvV, p_perfil: pfB, p_chave: 'f:99030', p_tipo: 'filme', p_titulo: 'x', p_capa: 'javascript:alert(1)', p_ano: 0, p_on: true });
check('fav_set recusa capa que não é http(s)', capaRuim.status >= 400);
const falsoV = await rpc('fav_list', { p_token: 'falso', p_perfil: pfB });
check('fav_list com token falso devolve unknown_device', falsoV.data.status === 'unknown_device');
await rpc('perfil_delete', { p_token: tkCelV, p_id: pfB });
await rpc('device_unlink', { p_token: tkTvV });
await rpc('device_unlink', { p_token: tkCelV });
```

- [ ] **Step 3: Aplicar e verificar** — `npm run ott:setup`, depois leia `mailer_autoconfirm` (deve ser `false`), depois `npm run ott:smoke` uma vez → todas as linhas `OK` (as antigas e as novas) e `[ott] Tudo certo.`
- [ ] **Step 4: Commit** — `git add supabase/migrations/0010_ott_favoritos.sql scripts/ott-smoke.mjs && git commit -m "feat(backend): favoritos de cada perfil na conta (fav_list/fav_set/fav_merge)"`

---

### Task F2: A TV sincroniza os favoritos do perfil

**Files:**
- Create: `src/services/favSync.ts` (chaves, conversões, regra de sincronização, cliente das RPCs)
- Modify: `src/App.tsx` (favoritos `favoriteIds`/`favMeta`, `toggleFavorite`), `src/context/favorites.ts`
- Test: `tests/fav-sync.test.ts`

Fatos do código: `favoriteIds: Set<string>` (ids: `vod_<id>`, `series_<id>`, id do canal `ch_<hash>`) e `favMeta: Record<id, {id,type:'channel'|'movie'|'series',title,poster?,streamUrl?}>` em `MainTvApp`; por perfil via `profileStore.key(...)`; `toggleFavorite` em `App.tsx` (`toggleChannelFavorite/MovieFavorite/SeriesFavorite`); canais da TV têm `name` e `group`; a lista completa de canais fica em `api.ts` (`getLiveChannels`).

- [ ] **Step 1: Teste (deve falhar)**

```ts
// Favoritos por perfil na conta: chaves estáveis, conversão e regra de sincronização
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, favKey, itemsFromLocal, planSync, favList, favSet, favMerge, type FavItem } from '../src/services/favSync';

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

test('nome normalizado: minúsculas, sem acento, espaços colapsados', () => {
  assert.equal(normName('  Globo   SP '), 'globo sp');
  assert.equal(normName('Cinéma Ação'), 'cinema acao');
  assert.equal(normName('A'.repeat(200)).length, 120);
});

test('chave por tipo (a mesma que o celular usa)', () => {
  assert.equal(favKey({ type: 'channel', id: 'ch_1', title: 'Globo SP' }), 'c:globo sp');
  assert.equal(favKey({ type: 'movie', id: 'vod_123', title: 'F' }), 'f:123');
  assert.equal(favKey({ type: 'series', id: 'series_9', title: 'S' }), 's:9');
  assert.equal(favKey({ type: 'movie', id: 'estranho', title: 'F' }), null);
  assert.equal(favKey({ type: 'channel', id: 'ch_1', title: '  ' }), null);
});

test('itens locais viram itens da conta', () => {
  const meta = {
    ch_1: { id: 'ch_1', type: 'channel', title: 'Globo SP' },
    vod_5: { id: 'vod_5', type: 'movie', title: 'Filme X', poster: 'https://x/p.jpg' },
    series_2: { id: 'series_2', type: 'series', title: 'Série Y' },
  } as any;
  const itens = itemsFromLocal(['ch_1', 'vod_5', 'series_2', 'sem_meta'], meta);
  assert.deepEqual(itens.map((i) => i.k).sort(), ['c:globo sp', 'f:5', 's:2']);
  assert.equal(itens.find((i) => i.k === 'f:5')!.capa, 'https://x/p.jpg');
});

const I = (k: string): FavItem => ({ k, tipo: k[0] === 'c' ? 'canal' : k[0] === 'f' ? 'filme' : 'serie', titulo: k, capa: '', ano: 0 });

test('primeira sincronização: união; o que só existe no aparelho é enviado', () => {
  const p = planSync({ primeira: true, local: [I('f:1'), I('f:2')], conta: [I('f:2'), I('f:3')], pendentes: [] });
  assert.deepEqual(p.resultado.map((i) => i.k).sort(), ['f:1', 'f:2', 'f:3']);
  assert.deepEqual(p.enviar.map((i) => i.k), ['f:1']);
});

test('depois da primeira: a conta manda; pendentes (ainda não enviados) são mantidos e enviados', () => {
  const p = planSync({ primeira: false, local: [I('f:1'), I('f:2')], conta: [I('f:2'), I('f:3')], pendentes: ['f:1'] });
  assert.deepEqual(p.resultado.map((i) => i.k).sort(), ['f:1', 'f:2', 'f:3']);
  assert.deepEqual(p.enviar.map((i) => i.k), ['f:1']);
  const q = planSync({ primeira: false, local: [I('f:1'), I('f:2')], conta: [I('f:2')], pendentes: [] });
  assert.deepEqual(q.resultado.map((i) => i.k), ['f:2']); // f:1 foi removido em outro aparelho
  assert.deepEqual(q.enviar, []);
});

test('RPCs: lista, marca/desmarca e envia em lote', async () => {
  const f = fakeFetch({ status: 'ok', itens: [{ k: 'f:1', tipo: 'filme', titulo: 'X', capa: '', ano: 2020 }] });
  assert.deepEqual(await favList(cfg, 'tok', 'p1', f), [{ k: 'f:1', tipo: 'filme', titulo: 'X', capa: '', ano: 2020 }]);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: 'tok', p_perfil: 'p1' });
  const g = fakeFetch({ status: 'ok' });
  await favSet(cfg, 'tok', 'p1', { k: 'f:1', tipo: 'filme', titulo: 'X', capa: '', ano: 2020 }, true, g);
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: 'tok', p_perfil: 'p1', p_chave: 'f:1', p_tipo: 'filme', p_titulo: 'X', p_capa: '', p_ano: 2020, p_on: true });
  const h = fakeFetch({ status: 'ok', total: 2 });
  const muitos = Array.from({ length: 350 }, (_, i) => I('f:' + i));
  await favMerge(cfg, 'tok', 'p1', muitos, h);
  assert.equal(h.calls.length, 2); // 300 + 50
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --import tsx --test tests/fav-sync.test.ts` → FAIL.

- [ ] **Step 3: Implementar `src/services/favSync.ts`**

```ts
// Favoritos por perfil na conta: chaves iguais às do celular, regra de sincronização e cliente das RPCs.
// Sem DOM; fetch puro via callRpc (Chrome 53).
import { callRpc, type OttConfig } from './ott';
import { foldText } from './searchIndex';

type FetchLike = (url: string, init?: any) => Promise<any>;

export interface FavItem { k: string; tipo: 'canal' | 'filme' | 'serie'; titulo: string; capa: string; ano: number }
export interface LocalFav { id: string; type: 'channel' | 'movie' | 'series'; title: string; poster?: string; year?: number }

// Mesmo critério do celular: minúsculas, sem acento, espaços colapsados, até 120 caracteres
export function normName(s: string): string {
  return foldText(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function favKey(f: { type: string; id: string; title: string }): string | null {
  if (f.type === 'channel') { const n = normName(f.title); return n ? 'c:' + n : null; }
  if (f.type === 'movie') { const m = /^vod_([A-Za-z0-9_-]{1,50})$/.exec(f.id); return m ? 'f:' + m[1] : null; }
  if (f.type === 'series') { const m = /^series_([A-Za-z0-9_-]{1,50})$/.exec(f.id); return m ? 's:' + m[1] : null; }
  return null;
}

function tipoOf(type: string): FavItem['tipo'] { return type === 'channel' ? 'canal' : type === 'movie' ? 'filme' : 'serie'; }

// Favoritos locais (ids + metadados) -> itens da conta; ids sem metadado ficam de fora (não dá para saber o título)
export function itemsFromLocal(ids: string[], meta: Record<string, any>): FavItem[] {
  const out: FavItem[] = [];
  for (let i = 0; i < ids.length; i++) {
    const m = meta[ids[i]];
    if (!m) continue;
    const k = favKey({ type: m.type, id: m.id, title: m.title });
    if (!k) continue;
    out.push({ k, tipo: tipoOf(m.type), titulo: String(m.title || '').slice(0, 120), capa: /^https?:\/\//.test(m.poster || '') && m.poster.length <= 300 ? m.poster : '', ano: Number(m.year) > 0 ? Number(m.year) : 0 });
  }
  return out;
}

export interface SyncInput { primeira: boolean; local: FavItem[]; conta: FavItem[]; pendentes: string[] }
export interface SyncPlan { resultado: FavItem[]; enviar: FavItem[] }

// Primeira vez: união. Depois: a conta manda; só os pendentes (ainda não enviados) sobrevivem do local.
export function planSync(i: SyncInput): SyncPlan {
  const naConta: Record<string, boolean> = {};
  for (let a = 0; a < i.conta.length; a++) naConta[i.conta[a].k] = true;
  const pend: Record<string, boolean> = {};
  for (let a = 0; a < i.pendentes.length; a++) pend[i.pendentes[a]] = true;
  const resultado = i.conta.slice();
  const enviar: FavItem[] = [];
  for (let a = 0; a < i.local.length; a++) {
    const it = i.local[a];
    if (naConta[it.k]) continue;
    if (i.primeira || pend[it.k]) { resultado.push(it); enviar.push(it); }
  }
  return { resultado, enviar };
}

export async function favList(cfg: OttConfig, token: string, perfil: string, fetchImpl?: FetchLike): Promise<FavItem[]> {
  const data: any = await callRpc(cfg, 'fav_list', { p_token: token, p_perfil: perfil }, fetchImpl);
  const raw = data && data.status === 'ok' && Array.isArray(data.itens) ? data.itens : [];
  const out: FavItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (r && typeof r.k === 'string') out.push({ k: r.k, tipo: r.tipo, titulo: String(r.titulo || ''), capa: String(r.capa || ''), ano: Number(r.ano) || 0 });
  }
  return out;
}

export async function favSet(cfg: OttConfig, token: string, perfil: string, it: FavItem, on: boolean, fetchImpl?: FetchLike): Promise<void> {
  await callRpc(cfg, 'fav_set', { p_token: token, p_perfil: perfil, p_chave: it.k, p_tipo: it.tipo, p_titulo: it.titulo, p_capa: it.capa, p_ano: it.ano, p_on: on }, fetchImpl);
}

// Envia em lotes de 300
export async function favMerge(cfg: OttConfig, token: string, perfil: string, itens: FavItem[], fetchImpl?: FetchLike): Promise<void> {
  for (let i = 0; i < itens.length; i += 300) {
    await callRpc(cfg, 'fav_merge', { p_token: token, p_perfil: perfil, p_itens: itens.slice(i, i + 300) }, fetchImpl);
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — `node --import tsx --test tests/fav-sync.test.ts && npx tsc --noEmit -p . && npm test`.

- [ ] **Step 5: Ligar ao app (sem teste unitário; conferir no Chrome com o mock)**
  1. **Estado local de sincronia por perfil** (em `profileStore`/`favSync` com `localStorage`): chave `sintoniza_favsync__<perfilId>` = `{ pendentes: string[], feito: true }` (`feito` ausente = primeira vez).
  2. **`syncFavorites()`** em `MainTvApp` (ou `useFavSync` hook): com conta ativa, token e perfil ativo → `favList` → `planSync` → `favMerge` dos `enviar` → aplica `resultado` ao estado (`setFavoriteIds`/`setFavMeta` e grava nas chaves por perfil). **Canais:** o item da conta tem só o nome; resolva o canal da TV pelo nome normalizado (índice por `normName` sobre os canais carregados em `api.ts`; se a lista ainda não carregou, espere o catálogo e tente de novo; canais que a TV não tem ficam guardados no estado da conta mas não aparecem). **Filmes/séries:** monte o meta mínimo (`id: 'vod_<id>'`/`'series_<id>'`, `title`, `poster: capa`, `year: ano`) para a tela de Favoritos mostrar; o detalhe completo (stream) já é buscado ao abrir o item como hoje.
  3. **Quando sincronizar:** ao escolher/entrar no perfil (depois do `onChange` do `profileStore`), quando o app volta a ficar visível (`visibilitychange`) e a cada 2 minutos com a TV em primeiro plano (`setTimeout` encadeado; pausa com `document.hidden`; sem setState quando nada mudou).
  4. **Marcar/desmarcar** (`toggleFavorite`): grava local como hoje e chama `favSet` (fire-and-forget); em falha, acrescenta a chave a `pendentes` (sai na próxima sincronização).
  5. Sem conta/OTT (modo manual) nada disso roda.
  6. O `useCastPoll` e o resto do app não podem ser afetados; o seletor de perfil continua o mesmo.
- [ ] **Step 6: Verificar** — `npx tsc --noEmit -p . && npm test`; no Chrome do PC com `scripts/ott-mock-server.mjs` (acrescente `fav_list/fav_set/fav_merge` ao mock, com armazenamento em memória por perfil): favoritar um filme na "TV" aparece no mock; um item que só o "celular" tem (injetado no mock) aparece nos Favoritos da TV (canal resolvido pelo nome, filme/série pelo meta); desmarcar remove no mock; a primeira vez faz união. Capturas lidas e apagadas.
- [ ] **Step 7: Commit** — `git add src tests scripts && git commit -m "feat(tv): favoritos do perfil sincronizam com a conta (celular e TV veem os mesmos)"`

---

### Task F3: Entrada "como nos streamings" na TV e pré-carregamento do catálogo

**Files:**
- Modify: `src/App.tsx`, `src/context/ProfileContext.tsx`, `src/components/profile/ProfilePicker.tsx` (garantir o seletor como primeira tela), `src/components/Header.tsx` (indicador discreto)
- Create: `src/services/warmCatalog.ts`
- Test: `tests/warm-catalog.test.ts`

Requisitos do Gustavo: ao abrir, a **primeira** tela é "Quem está assistindo?" (se houver 2+ perfis); só então a Início. Nada de Início aparecendo antes. Durante a espera, o app carrega filmes e séries em segundo plano, sem atrapalhar.

- [ ] **Step 1: Entrada sem "flash" da Início**
  - Com 2+ perfis no cache `sintoniza_profiles` (ou, sem cache, depois do `perfil_list`): o seletor ocupa a tela **desde o primeiro quadro** do app pronto (sem a Início aparecendo atrás). Enquanto a decisão não existe (sem cache e rede ainda respondendo), mostre o carregador animado (`LogoLoader`) em vez da Início.
  - Com 1 perfil: entra direto, sem seletor. Sem perfis/sem conta: como hoje.
  - O seletor continua sendo overlay dentro do `MainTvApp` (o envio do celular continua tocando por cima), mas o `HomeView` **não monta** até a escolha estar feita (`profileReady`), para a Início não renderizar nem disputar a CPU com o seletor; um `activePlayer` (envio) pode abrir mesmo assim.
  - Confirme na prática (Chrome do PC com o mock, 1920x1080, rede estrangulada e normal) que a ordem é: logo animada → seletor → (escolha) → Início, sem a Início aparecer antes. Se a LG estiver acessível, confirme também por **leitura** via CDP (captura da tela nos primeiros segundos), sem alterar nada na TV.

- [ ] **Step 2: Teste do pré-carregamento (deve falhar)** — `tests/warm-catalog.test.ts`:

```ts
// Pré-carregamento em fatias: roda em pedaços pequenos, respeita o tempo por fatia e pode ser cancelado
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWarmer } from '../src/services/warmCatalog';

test('executa as etapas na ordem, uma por fatia, e avisa o andamento', async () => {
  const ordem: string[] = [];
  const andamento: number[] = [];
  const w = createWarmer({
    etapas: [
      { nome: 'filmes', run: async () => { ordem.push('filmes'); } },
      { nome: 'series', run: async () => { ordem.push('series'); } },
      { nome: 'indice', run: async () => { ordem.push('indice'); } },
    ],
    agendar: (fn) => { setTimeout(fn, 0); },
    onProgresso: (feitas, total) => andamento.push(feitas / total),
  });
  await w.iniciar();
  assert.deepEqual(ordem, ['filmes', 'series', 'indice']);
  assert.equal(andamento[andamento.length - 1], 1);
  assert.equal(w.estado(), 'pronto');
});

test('falha numa etapa não derruba as outras e não trava', async () => {
  const ordem: string[] = [];
  const w = createWarmer({
    etapas: [
      { nome: 'a', run: async () => { throw new Error('rede'); } },
      { nome: 'b', run: async () => { ordem.push('b'); } },
    ],
    agendar: (fn) => { setTimeout(fn, 0); },
  });
  await w.iniciar();
  assert.deepEqual(ordem, ['b']);
  assert.equal(w.estado(), 'pronto');
});

test('cancelar para antes da próxima etapa', async () => {
  const ordem: string[] = [];
  let w: any;
  w = createWarmer({
    etapas: [
      { nome: 'a', run: async () => { ordem.push('a'); w.cancelar(); } },
      { nome: 'b', run: async () => { ordem.push('b'); } },
    ],
    agendar: (fn) => { setTimeout(fn, 0); },
  });
  await w.iniciar();
  assert.deepEqual(ordem, ['a']);
  assert.equal(w.estado(), 'cancelado');
});

test('chamar iniciar duas vezes não repete o trabalho', async () => {
  let n = 0;
  const w = createWarmer({ etapas: [{ nome: 'a', run: async () => { n++; } }], agendar: (fn) => { setTimeout(fn, 0); } });
  await Promise.all([w.iniciar(), w.iniciar()]);
  assert.equal(n, 1);
});
```

- [ ] **Step 3: Implementar `src/services/warmCatalog.ts`**

```ts
// Pré-carrega o catálogo (filmes, séries, índice de busca) em etapas pequenas, em segundo plano.
// Cada etapa roda numa "fatia" agendada (setTimeout/idle), nunca tudo de uma vez: não trava o controle remoto.
export interface WarmStep { nome: string; run: () => Promise<void> }
export interface WarmOptions {
  etapas: WarmStep[];
  agendar?: (fn: () => void) => void; // padrão: setTimeout 50 ms (a TV é lenta; deixa a UI respirar entre as etapas)
  onProgresso?: (feitas: number, total: number) => void;
}
export type WarmState = 'parado' | 'rodando' | 'pronto' | 'cancelado';

export function createWarmer(o: WarmOptions) {
  const agendar = o.agendar || ((fn: () => void) => { setTimeout(fn, 50); });
  let estado: WarmState = 'parado';
  let promessa: Promise<void> | null = null;
  return {
    estado: () => estado,
    cancelar() { if (estado === 'rodando') estado = 'cancelado'; },
    iniciar(): Promise<void> {
      if (promessa) return promessa;
      estado = 'rodando';
      promessa = new Promise<void>((resolve) => {
        let i = 0;
        const proxima = () => {
          if (estado === 'cancelado') { resolve(); return; }
          if (i >= o.etapas.length) { estado = 'pronto'; resolve(); return; }
          const etapa = o.etapas[i];
          etapa.run().then(() => {}, () => { /* falha: segue para a próxima, o app funciona sem o aquecimento */ }).then(() => {
            i++;
            if (o.onProgresso) o.onProgresso(i, o.etapas.length);
            agendar(proxima);
          });
        };
        agendar(proxima);
      });
      return promessa;
    },
  };
}
```

- [ ] **Step 4: Ligar o aquecimento** — em `App.tsx`/um hook `useWarmCatalog`: quando a conta está ativa e há lista de filmes/séries (`sintoniza_vod_url` ou Xtream da lista de canais), **começar já ao abrir o app (durante o seletor de perfis)** com as etapas, nesta ordem e de forma que cada uma reaproveite o cache de sessão do `api.ts` (sem requisições duplicadas): (1) `loadVodCatalog` (primeira página de filmes e séries, que a Início já usa), (2) `loadSearchCatalog` (catálogo "leve" para a busca, ver `docs/superpowers/plans/2026-09-28-busca-lenta-tv.md` para os cuidados de custo na TV), (3) `buildSearchIndex`/índice (fatiado por blocos de ~500 itens com `setTimeout`, se a função ainda não for incremental, torne-a incremental sem mudar o resultado). Sem `setState` por etapa além do indicador. **Indicador discreto:** um pequeno chip no cabeçalho ("Preparando filmes e séries…" com 3 pontos em `opacity`) visível só enquanto `estado() === 'rodando'` e a busca for aberta antes de terminar; some sozinho; nunca bloqueia a navegação nem a busca (se a busca for aberta antes de terminar, ela funciona como hoje, só mais lenta na primeira vez).
  Cancelar o aquecimento ao desvincular a conta/trocar de conta.
- [ ] **Step 5: Verificar** — `node --import tsx --test tests/warm-catalog.test.ts && npx tsc --noEmit -p . && npm test && npm run build:ott` + `check:tv`. No Chrome do PC (mock): perfil escolhido → Início aparece e o chip some quando termina; medir (console/perf) que o aquecimento não bloqueia a thread por mais de ~50 ms contínuos (fatias) e que a primeira busca depois do aquecimento é mais rápida que sem ele (registre os números).
- [ ] **Step 6: Commit** — `git add src tests && git commit -m "feat(tv): seletor de perfil como primeira tela e pré-carregamento do catálogo em segundo plano"`

---

# PARTE 2 — Celular (repositório `visual-craft-assistant`, branch `v12`)

### Task F4: O celular sincroniza os favoritos do perfil

**Files:**
- Modify: `sintoniza-link.html` (`<script id="ott-core">`: funções puras e clientes; script principal: ligação com `toggleFav`, `sint_fav`, `toggleMyListFor`, `loadMyList/saveMyList`, `refreshPersonalLists`)
- Modify: `tests/ott/loadOtt.js`; Test: `tests/ott/favsync.test.js`

Fatos do código: favoritos de canal = `_state.favorites` (nomes) em `sint_fav` por perfil (`profKey`), `toggleFav` (~L3279), `ensureEssentialFavorites` (favoritos fixos só no principal); filmes/séries favoritos = "Minha lista" (`sint_mylist`, entradas `{type:'vod'|'series', id, title, cover, item, ts}`, `loadMyList/saveMyList`, `toggleMyListFor`, `refreshPersonalLists`); `buildMyListEntry`; a aba Favoritos usa as duas.

- [ ] **Step 1: Teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };
const I = (k) => ({ k, tipo: k[0] === "c" ? "canal" : k[0] === "f" ? "filme" : "serie", titulo: k, capa: "", ano: 0 });

test("nome normalizado e chaves iguais às da TV", () => {
  const o = loadOtt();
  assert.equal(o.ottNormName("  Globo   SP "), "globo sp");
  assert.equal(o.ottNormName("Cinéma Ação"), "cinema acao");
  assert.equal(o.ottFavKeyChannel("Globo SP"), "c:globo sp");
  assert.equal(o.ottFavKeyChannel("   "), null);
  assert.equal(o.ottFavKeyVod("123"), "f:123");
  assert.equal(o.ottFavKeySeries("9"), "s:9");
  assert.equal(o.ottFavKeyVod("12;x"), null);
});

test("favoritos locais viram itens da conta", () => {
  const o = loadOtt();
  const canais = plain(o.ottFavItemsFromChannels(["Globo SP", "  ", "ESPN"]));
  assert.deepEqual(canais.map((i) => i.k), ["c:globo sp", "c:espn"]);
  const lista = plain(o.ottFavItemsFromMyList([
    { type: "vod", id: 5, title: "Filme X", cover: "https://x/p.jpg", item: { stream_id: 5, name: "Filme X", year: "2020" } },
    { type: "series", id: 2, title: "Série Y", cover: "", item: { series_id: 2, name: "Série Y" } },
    { type: "vod", id: "", title: "Sem id", item: {} },
  ]));
  assert.deepEqual(lista, [
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "https://x/p.jpg", ano: 2020 },
    { k: "s:2", tipo: "serie", titulo: "Série Y", capa: "", ano: 0 },
  ]);
});

test("itens da conta viram favoritos locais (canais por nome; filmes e séries com item mínimo)", () => {
  const o = loadOtt();
  const r = plain(o.ottFavLocalFromItems([
    { k: "c:globo sp", tipo: "canal", titulo: "Globo SP", capa: "", ano: 0 },
    { k: "f:5", tipo: "filme", titulo: "Filme X", capa: "https://x/p.jpg", ano: 2020 },
    { k: "s:2", tipo: "serie", titulo: "Série Y", capa: "", ano: 0 },
  ]));
  assert.deepEqual(r.canais, ["Globo SP"]);
  assert.equal(r.minhaLista.length, 2);
  assert.equal(r.minhaLista[0].type, "vod");
  assert.equal(r.minhaLista[0].id, "5");
  assert.equal(r.minhaLista[0].item.stream_id, "5");
  assert.equal(r.minhaLista[0].item.name, "Filme X");
  assert.equal(r.minhaLista[1].type, "series");
  assert.equal(r.minhaLista[1].item.series_id, "2");
});

test("regra de sincronização: primeira = união; depois a conta manda, mantendo pendentes", () => {
  const o = loadOtt();
  const p = plain(o.ottFavPlan({ primeira: true, local: [I("f:1"), I("f:2")], conta: [I("f:2"), I("f:3")], pendentes: [] }));
  assert.deepEqual(p.resultado.map((i) => i.k).sort(), ["f:1", "f:2", "f:3"]);
  assert.deepEqual(p.enviar.map((i) => i.k), ["f:1"]);
  const q = plain(o.ottFavPlan({ primeira: false, local: [I("f:1"), I("f:2")], conta: [I("f:2")], pendentes: [] }));
  assert.deepEqual(q.resultado.map((i) => i.k), ["f:2"]);
  const r = plain(o.ottFavPlan({ primeira: false, local: [I("f:1"), I("f:2")], conta: [I("f:2")], pendentes: ["f:1"] }));
  assert.deepEqual(r.enviar.map((i) => i.k), ["f:1"]);
});

test("RPCs de favoritos", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { status: "ok", itens: [{ k: "f:1", tipo: "filme", titulo: "X", capa: "", ano: 2020 }] } }));
  assert.deepEqual(plain(await o.ottFavList(cfg, "tok", "p1", f)), [{ k: "f:1", tipo: "filme", titulo: "X", capa: "", ano: 2020 }]);
  const g = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottFavSet(cfg, "tok", "p1", I("f:1"), true, g);
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: "tok", p_perfil: "p1", p_chave: "f:1", p_tipo: "filme", p_titulo: "f:1", p_capa: "", p_ano: 0, p_on: true });
  const h = fakeFetch(() => ({ body: { status: "ok", total: 1 } }));
  await o.ottFavMerge(cfg, "tok", "p1", Array.from({ length: 350 }, (_, n) => I("f:" + n)), h);
  assert.equal(h.calls.length, 2);
});
```
Run: `node --test "tests/ott/*.test.js"` → FAIL.

- [ ] **Step 2: Implementar no `ott-core`** — `ottNormName` (minúsculas, sem acento via `normalize('NFD')`, espaços colapsados, 120), `ottFavKeyChannel/Vod/Series`, `ottFavItemsFromChannels(nomes)`, `ottFavItemsFromMyList(entradas)` (usa `entry.item.stream_id`/`series_id` ou `entry.id`; `cover` só se `^https?://` e ≤ 300; ano de `item.year` ou `releaseDate`), `ottFavLocalFromItems(itens)` → `{ canais: [titulo…], minhaLista: [{type:'vod'|'series', id, title, cover, ts, item:{stream_id|series_id, name, stream_icon/cover, year}}…] }` (item mínimo; sem `container_extension`), `ottFavPlan` (mesma regra da TV: `{resultado, enviar}`), `ottFavList/Set/Merge` (lotes de 300, RPCs `fav_list/fav_set/fav_merge`). Exponha os nomes novos em `tests/ott/loadOtt.js`.
  Run: `node --test "tests/ott/*.test.js" && npm test` → PASS.

- [ ] **Step 3: Ligar ao app** (script principal; tudo só com conta e perfil ativo; falha de rede = ignora, vale o local)
  1. Estado por perfil (`localStorage`): `sint_p<id8>_favsync` = `{feito:true, pendentes:[chaves]}` (acrescente `favsync` às bases por perfil de `profKeyFor` se preciso, com o teste de `profile-keys` atualizado).
  2. `syncFavorites()`: monta o `local` (`ottFavItemsFromChannels(_state.favorites)` + `ottFavItemsFromMyList(loadMyList())`), `ottFavList`, `ottFavPlan`, `ottFavMerge` dos `enviar`, e aplica o `resultado` com `ottFavLocalFromItems`: reescreve `sint_fav` (nomes) e `sint_mylist` (mantendo as entradas locais que já têm `item` completo e `ts`; só acrescenta/remove o que mudou) e chama `refreshPersonalLists()` e o re-render dos favoritos. O `ensureEssentialFavorites` (favoritos fixos do principal) roda **antes** da primeira sincronização para entrar na união.
  3. Quando: depois de `profileChoose`/`profileBoot` (perfil definido), ao voltar o app a ficar visível, e a cada 2 minutos com o app aberto (`setInterval` simples; sem trabalho se nada mudou).
  4. Marcar/desmarcar: `toggleFav` e `toggleMyListFor` gravam local como hoje e chamam `ottFavSet(...)` (fire-and-forget); em falha, acrescentam a chave a `pendentes`.
  5. O envio para a TV e o resto do app não podem ser afetados.
- [ ] **Step 4: Verificar no Chrome** (`check-favsync-ui.mjs`, `?ott=1` com Capacitor simulado e `fetch` fingido que NÃO deixa passar rede real, como no `check-profiles-ui.mjs` corrigido): um item que só a conta tem (filme e canal) aparece nos Favoritos do celular; favoritar um canal e um filme dispara `fav_set` com as chaves certas; desmarcar dispara `fav_set` `p_on:false`; primeira vez faz união (`fav_merge` com o que só o celular tinha); trocar de perfil sincroniza o outro perfil; com a rede fingida falhando, o local continua funcionando e a chave vira pendente. Capturas lidas e apagadas; todos os outros `check-*.mjs` seguem `✔ ok`.
- [ ] **Step 5: Commit** — `git add sintoniza-link.html tests scripts/dev && git commit -m "feat(celular): favoritos do perfil sincronizam com a conta (celular e TV veem os mesmos)"`

---

### Task F5: Celular: entrada com o seletor como primeira tela e pré-carregamento

**Files:**
- Modify: `sintoniza-link.html`
- Test: `tests/ott/warm-markup.test.js`, `scripts/dev/check-warm-ui.mjs`

- [ ] **Step 1: Entrada** — confirme (Chrome com Capacitor simulado, 3 perfis) que a primeira coisa visível é o seletor (do cache `sint_profiles`, sem esperar a rede), nunca a Início antes; com 1 perfil entra direto; sem cache mostra a tela de espera (já existe). Corrija o que não estiver assim.
- [ ] **Step 2: Pré-carregamento** — depois de definido o perfil (e já durante o seletor, se a lista de filmes estiver configurada), aquecer em segundo plano e em fatias (`setTimeout`/`requestIdleCallback`, nunca bloqueando por mais de ~50 ms): (1) catálogos de filmes e séries que a busca/abas usam (reaproveitando os caches existentes do app para não duplicar requisições; leia `loadVodCatalogs`/`_vodCardsIndex`/`searchVod...` no código real), (2) o índice usado na busca de VOD. Mostrar um **indicador discreto** (uma linha fina "Preparando filmes e séries…" abaixo da busca ou no topo, `opacity`/`transform` apenas) enquanto roda; some sozinho; nunca bloqueia navegar nem buscar. Cancelar ao desvincular. Funções puras (`createWarmer` igual ao da TV, com os mesmos testes em `PURE_HELPER_NAMES`/`tests/player/warm.test.js`).
- [ ] **Step 3: Teste de marcação (deve falhar)** — `assert.match(html, /function createWarmer\(/)` e `assert.match(html, /id="warm-chip"/)`; implementar; passar.
- [ ] **Step 4: Verificar** — `npm test`; `check-warm-ui.mjs`: o aquecimento roda em etapas (contar chamadas fingidas), o chip aparece e some, a busca funciona antes e depois do aquecimento, nenhuma tarefa longa (> 80 ms) na thread (use `PerformanceObserver`/`longtask` ou medição por `setInterval`); capturas lidas e apagadas.
- [ ] **Step 5: Commit** — `git add sintoniza-link.html tests scripts/dev && git commit -m "feat(celular): seletor de perfil como primeira tela e pré-carregamento do catálogo"`

---

# PARTE 3 — Fechamento

### Task F6: Ponta a ponta contra o backend real

**Files:** Create `scripts/dev/e2e-favoritos.mjs` (repo do celular; estilo de `e2e-perfis.mjs`).

- [ ] **Step 1:** fluxo: "TV" simulada pelas RPCs reais + celular real em Chrome (`?ott=1`, ativado): (1) o celular cria o perfil "E2E Fav"; (2) o celular favorita um canal e um filme (pelas funções do app) e a "TV" lê `fav_list` do perfil e vê os dois com as chaves `c:…`/`f:…`; (3) a "TV" favorita uma série (`fav_set`) e o celular, ao sincronizar, a recebe em "Minha lista" do perfil; (4) a "TV" desmarca o filme e o celular, ao sincronizar, o perde; (5) o perfil principal continua sem esses itens (isolamento); (6) limpeza em `finally` (`perfil_delete`, `device_unlink`). Nunca imprimir segredos; rodar uma vez (limites de taxa).
- [ ] **Step 2: Regressões** — TV: `npm test`, `npx tsc --noEmit -p .`, `npm run build:ott` + `check:tv`; celular: `npm test` e todos os `scripts/dev/check-*.mjs`; confirmar `mailer_autoconfirm = false`.
- [ ] **Step 3: Commit** — `git add scripts/dev/e2e-favoritos.mjs && git commit -m "test(favoritos): favoritos por perfil de ponta a ponta contra o backend real"`

### Task F7: Versão, envio e entrega (quando o Gustavo pedir)

- [ ] Criar a branch `v13` a partir da `v12` (iOS 1.3/13, Android 1.3/13, `APP_VERSION="v13"`, workflow `build-mobile-v13.yml`, mesmo método do bump v11/v12: o Sideloadly compara a versão do `Info.plist`), enviar `v13` e `app-tv-ott-ativacao` ao GitHub, e **só quando o Gustavo pedir**: baixar IPA/APK (`Downloads\Sintoniza-celular\...-v13.*`), gerar o pacote da TV (`npm run lojas:ott`), copiar para `Downloads\Sintoniza-lojas\` e instalar na LG (`ares-install -d "Lg Tv"`, IP achado pela porta 9922).

---

## Auto-revisão

- **Cobertura do pedido:** favoritos do perfil iguais no celular e na TV (F1, F2, F4); seletor como primeira tela, sem a Início antes, e só se houver 2+ perfis (F3, F5); pré-carregamento leve de filmes e séries com indicador discreto (F3, F5); teste real ponta a ponta (F6).
- **Nomes consistentes:** `perfil_favoritos`, `fav_list/fav_set/fav_merge`, `FavItem {k,tipo,titulo,capa,ano}`; TV `normName/favKey/itemsFromLocal/planSync/favList/favSet/favMerge`, `createWarmer`; celular `ottNormName/ottFavKeyChannel/ottFavKeyVod/ottFavKeySeries/ottFavItemsFromChannels/ottFavItemsFromMyList/ottFavLocalFromItems/ottFavPlan/ottFavList/ottFavSet/ottFavMerge`.
- **Riscos:** (1) canais casam por nome: se a lista da TV não tiver o canal, ele fica guardado na conta mas não aparece lá; (2) o filme favoritado pela TV chega ao celular sem a extensão do arquivo (o celular busca o detalhe ao abrir, como em qualquer item novo); (3) "a conta manda" depois da primeira vez: dois aparelhos mexendo no mesmo segundo podem sobrescrever um ao outro, o que só dura até a próxima sincronização (2 min); (4) listas de "Continuar assistindo" continuam por aparelho (só o minuto sincroniza); (5) o aquecimento na LG real precisa ser medido em aparelho.
