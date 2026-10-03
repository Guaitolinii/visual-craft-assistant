# App online em sintonizatv.com.br/app + aviso de novos cadastros — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) o Gustavo recebe um e-mail a cada novo cadastro (nome + e-mail da pessoa); (2) o site ganha a aba **App** (`/app/`): a pessoa se cadastra ou entra com a conta e usa o Sintoniza no navegador do computador; no celular (iPhone, Android, qualquer modelo) o atalho na tela inicial abre o **mesmo app como aplicativo independente (PWA)**, sem precisar do app instalado: **o atalho substitui o app nativo**.

**Architecture:** o app web é o mesmo `sintoniza-link.html` do celular, gerado por um build web (manifest, service worker, ícones, bibliotecas servidas pelo próprio site). A conta vem do login do site (Supabase Auth, mesma origem); ao abrir `/app/` o navegador se registra sozinho como um **aparelho do tipo `web`** (RPC nova `web_device_register`, sem código/QR) e a partir daí funciona como o app de celular (perfis, favoritos, minuto, enviar para a TV). Como o navegador esbarra em CORS e em conteúdo `http` dos provedores, o site ganha um **proxy** (`/api/proxy`, Cloudflare Pages Function) protegido pelo token do aparelho. O aviso de cadastro é um gatilho no banco (pg_net) que chama a função `/api/notify-signup`, que envia o e-mail pelo Resend.

**Tech Stack:** Cloudflare Pages + Pages Functions, Supabase (SQL/RPC, pg_net), React/Vite (painel), HTML/JS puro (app), Service Worker/Web App Manifest, Resend, `node:test`, Chrome via CDP/Playwright.

**Repositórios e branches** (nunca na `main`):
- Site, backend e funções: `C:\Users\guait\Documents\Novo-App-de-TV`, branch `app-tv-ott-ativacao` (Tasks W0–W3, W6–W8).
- App (build web + ajustes de execução no navegador): `C:\Users\guait\Documents\visual-craft-assistant`; **criar a branch `v14` a partir da `v13`** (Tasks W4–W5; bump de versão iOS 1.4/14, Android 1.4/14, `APP_VERSION="v14"`, workflow `build-mobile-v14.yml`, mesmo método do bump v13).
- Ordem: W0 → (W1, W2, W3 no repo do site) em paralelo com (W4 → W5 no repo do app) → W6 → W7 (junta tudo e publica) → W8 (testes na produção) → W9.

> 🔐 `.env.ott.local` (repo do site) guarda segredos: **nunca imprimir** chaves/senhas/tokens (nem em logs de teste). Segredos novos vão **só** para o Cloudflare Pages (secrets) e para a tabela `app_secrets` do banco; nunca para o repositório.
> 🔐 Depois de qualquer `npm run ott:setup`, confirme `mailer_autoconfirm = false` (GET `https://api.supabase.com/v1/projects/<ref>/config/auth`). Nunca usar `OTT_AUTOCONFIRM`.
> ⚠️ `sintoniza-link.html` é CRLF: nada de `sed -i`; Edit/Write ou script Node `.cjs` no scratchpad; releia antes de editar. Funções do `ott-core` testadas entram na lista de `tests/ott/loadOtt.js`; funções puras do script principal entram em `PURE_HELPER_NAMES`; no script principal nenhuma referência a `ott*` fora de funções.
> ⚠️ Para testar o app como "web" localmente use `http://127.0.0.1:<porta>/app/` (em `http://localhost` o `isNativeApp()` devolve true).
> ⚠️ Não baixar IPA/APK nem instalar nada na TV (o Gustavo pede). Publicar o site (`npm run deploy:panel`) **está autorizado** ao fim (W7).

## Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Onde mora o app web | `/app/` no mesmo domínio e projeto Pages do painel | Mesma origem: compartilha a sessão de login, sem CORS entre site e app |
| Código | Um só `sintoniza-link.html`; o build web faz as trocas (CDNs → arquivos próprios, meta/manifest/SW) e o runtime se adapta com `isWebApp()` | Uma base para celular, TV (cast) e web |
| Entrada | Sem sessão → `/?next=/app/` (login/cadastro do site) → volta ao app. Dentro do PWA a navegação do mesmo domínio continua no app | O PWA do iPhone tem armazenamento próprio: o login acontece **dentro do atalho** |
| Aparelho | Tipo novo `web`, limite próprio `profiles.max_web` (padrão 5; Safari e atalho contam separados), id de instalação estável (`sint_web_install`), token do aparelho no `localStorage` | Sem código/QR; não gasta vaga de TV nem de celular; reaproveita todas as RPCs por token |
| CORS/mixed content | Proxy `/api/proxy` (Pages Function) com token do aparelho (`t`), bloqueio de destinos privados (SSRF), repasse de `Range`, reescrita HLS só com `k=hls` | Provedores IPTV raramente têm CORS e muitos são `http` |
| Custo do proxy | Plano grátis do Workers/Pages Functions: 100 mil requisições/dia (cada segmento de vídeo conta ≈ 100 horas de uso/dia); acima disso, Workers Paid ≈ US$ 5/mês (10 milhões) | Registrar no relatório e no README |
| Downloads offline | Ocultos na web (já é assim sem Capacitor) | Sem equivalente web |
| PiP/AirPlay | Usa o PiP do navegador que já existe; sem trabalho extra | Já suportado |
| Aviso de cadastro | Gatilho em `auth.users` → `net.http_post` → `/api/notify-signup` (segredo compartilhado) → Resend → `NOTIFY_TO` | A chave do Resend fica só no Cloudflare |
| E-mail do domínio | Só pesquisa de custo (já respondida): grátis via Cloudflare Email Routing (receber) / Zoho; pago ~US$ 1 (Zoho Lite), R$ 33 (M365), R$ 33–42 (Google) | Não faz parte da implementação |

## Contratos

**Proxy:** `GET|HEAD /api/proxy?u=<url codificada>&t=<token do aparelho>[&k=hls]`. Sem `t` ou `t` inválido/expirado → 401 `{erro}`. Destino bloqueado → 400. Falha do provedor → 502. `k=hls`: reescreve linhas de URL e atributos `URI="..."` do manifesto `.m3u8` para `/api/proxy?u=…&t=…&k=hls` (segmentos e sub-manifestos; chaves `#EXT-X-KEY` viram `k=raw`). Sem `k`: repasse cru (listas M3U, `player_api.php`, EPG, vídeos mp4/mkv, imagens). Repassa `Range`/`If-Range` na ida e `Content-Range`, `Content-Length`, `Content-Type`, `Accept-Ranges` na volta; `User-Agent: VLC/3.0.20`; segue até 5 redirecionamentos validando cada destino; resposta em streaming; `Cache-Control: no-store` nos manifestos.

**RPCs novas:**

| RPC | Quem | Resposta |
|---|---|---|
| `web_device_register(p_instalacao text, p_modelo text, p_sistema text)` | `authenticated` (JWT) | `{status:'ok', device_token}` (reusa o aparelho da mesma instalação e rotaciona o token; erros de negócio `P0001` em português: limite, desativado, bloqueada) |
| `device_valid(p_token text)` | `anon` | `boolean` (aparelho ativo e conta com acesso `ok`); usada pelo proxy |

**Aviso:** `POST /api/notify-signup`, cabeçalho `x-webhook-secret`, corpo `{evento:'cadastro'|'confirmou', email, nome, total, quando}`.

---

# PARTE 1 — Site, backend e funções (repositório `Novo-App-de-TV`)

### Task W0: Verificações de partida (somente leitura) e variáveis

- [ ] **Step 1:** com o token do `.env.ott.local` (via script que NÃO imprime valores): (a) `GET https://api.resend.com/domains` → imprimir só `name` e `status` de cada domínio (precisa `verified` para `sintonizatv.com.br`; se não estiver, **pare esta parte e relate**: o aviso e a confirmação de e-mail dependem disso); (b) `GET https://api.cloudflare.com/client/v4/accounts/<id>/pages/projects/sintoniza-tv` → imprimir só os nomes das variáveis de `deployment_configs.production.env_vars` e `compatibility_date`; (c) conferir que o token do Cloudflare consegue `PATCH` do projeto (ver W1 Step 5; se for negado, relatar a permissão que falta: "Cloudflare Pages: Edit").
- [ ] **Step 2:** acrescentar ao `.env.ott.local` a linha `NOTIFY_TO=gustavo.guaitolini@pbastones.com.br` (pedido do Gustavo: "meu email"; é o e-mail da conta dele neste ambiente) **se ainda não existir**; não imprimir o arquivo. Documentar `NOTIFY_TO` no `.env.example` (sem valor).

### Task W1: Aviso de novo cadastro por e-mail

**Files:**
- Create: `supabase/migrations/0011_ott_aviso_cadastro.sql`
- Create: `functions/api/notify-signup.js`, `functions/_lib/signup.js`
- Create: `scripts/ott-aviso-cadastro.mjs`; Modify: `package.json` (`"ott:aviso": "node --env-file=.env.ott.local scripts/ott-aviso-cadastro.mjs"`), `.env.example`
- Test: `tests/signup-notify.test.ts`

- [ ] **Step 1: Teste da lógica pura (deve falhar)**

```ts
// Aviso de cadastro: segredo, escape de HTML e montagem do e-mail
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretOk, escapeHtml, buildSignupEmail, parseEvent } from '../functions/_lib/signup.js';

test('segredo: compara em tempo constante e recusa vazio', () => {
  assert.equal(secretOk('abc123', 'abc123'), true);
  assert.equal(secretOk('abc123', 'abc124'), false);
  assert.equal(secretOk('', ''), false);
  assert.equal(secretOk(null, 'x'), false);
  assert.equal(secretOk('x', undefined), false);
});

test('escapa HTML do nome e do e-mail (vêm da própria pessoa)', () => {
  assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('valida o corpo recebido', () => {
  assert.equal(parseEvent({ evento: 'cadastro', email: 'a@b.com', nome: 'Ana', total: 3, quando: '2026-10-03T10:00:00Z' })?.evento, 'cadastro');
  assert.equal(parseEvent({ evento: 'hack', email: 'a@b.com' }), null);
  assert.equal(parseEvent({ evento: 'cadastro' }), null);
  assert.equal(parseEvent(null), null);
  assert.equal(parseEvent({ evento: 'cadastro', email: 'a@b.com', nome: 'x'.repeat(500) })?.nome.length, 80);
});

test('e-mail de aviso: assunto, texto e HTML com os dados e sem tags soltas', () => {
  const m = buildSignupEmail({ evento: 'cadastro', email: 'ana@exemplo.com', nome: '<Ana>', total: 12, quando: '2026-10-03T13:05:00Z' }, 'sintonizatv.com.br');
  assert.match(m.subject, /Novo cadastro/);
  assert.match(m.text, /ana@exemplo.com/);
  assert.match(m.text, /12/);
  assert.ok(m.html.includes('&lt;Ana&gt;'));
  assert.ok(!m.html.includes('<Ana>'));
  const c = buildSignupEmail({ evento: 'confirmou', email: 'ana@exemplo.com', nome: 'Ana', total: 12, quando: '2026-10-03T13:09:00Z' }, 'sintonizatv.com.br');
  assert.match(c.subject, /confirmou/i);
});
```
Run: `node --import tsx --test tests/signup-notify.test.ts` → FAIL.

- [ ] **Step 2: Implementar `functions/_lib/signup.js`** (ESM, sem dependências; funciona em Workers e no Node)

```js
// Aviso de novos cadastros: funções puras (testadas no Node, usadas na Pages Function).
export function secretOk(recebido, esperado) {
  if (typeof recebido !== 'string' || typeof esperado !== 'string' || !recebido || !esperado) return false;
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function parseEvent(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.evento !== 'cadastro' && b.evento !== 'confirmou') return null;
  const email = typeof b.email === 'string' ? b.email.trim().slice(0, 200) : '';
  if (!email) return null;
  return {
    evento: b.evento,
    email,
    nome: typeof b.nome === 'string' ? b.nome.trim().slice(0, 80) : '',
    total: Number(b.total) > 0 ? Number(b.total) : 0,
    quando: typeof b.quando === 'string' ? b.quando : '',
  };
}

function quandoBr(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function buildSignupEmail(e, dominio) {
  const novo = e.evento === 'cadastro';
  const subject = novo ? `Novo cadastro no Sintoniza: ${e.nome || e.email}` : `Cadastro confirmou o e-mail: ${e.nome || e.email}`;
  const when = quandoBr(e.quando);
  const linhas = [
    novo ? 'Alguém acabou de criar uma conta no Sintoniza (e-mail ainda não confirmado).' : 'Esta pessoa confirmou o e-mail e já pode usar o Sintoniza.',
    '',
    `Nome: ${e.nome || '(não informado)'}`,
    `E-mail: ${e.email}`,
    when ? `Quando: ${when} (Brasília)` : '',
    e.total ? `Total de contas: ${e.total}` : '',
    '',
    `Painel: https://${dominio}/admin`,
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i < a.length - 1));
  const text = linhas.join('\n');
  const html = `<div style="font-family:Verdana,Arial,sans-serif;background:#08080D;color:#F3F4F6;padding:24px;border-radius:12px;max-width:520px">`
    + `<h2 style="color:#F97316;margin:0 0 12px">${novo ? 'Novo cadastro' : 'E-mail confirmado'}</h2>`
    + `<p style="margin:0 0 12px">${novo ? 'Alguém acabou de criar uma conta (e-mail ainda não confirmado).' : 'Esta pessoa confirmou o e-mail.'}</p>`
    + `<p style="margin:4px 0"><b>Nome:</b> ${escapeHtml(e.nome || '(não informado)')}</p>`
    + `<p style="margin:4px 0"><b>E-mail:</b> ${escapeHtml(e.email)}</p>`
    + (when ? `<p style="margin:4px 0"><b>Quando:</b> ${escapeHtml(when)} (Brasília)</p>` : '')
    + (e.total ? `<p style="margin:4px 0"><b>Total de contas:</b> ${e.total}</p>` : '')
    + `<p style="margin:16px 0 0"><a style="color:#F97316" href="https://${escapeHtml(dominio)}/admin">Abrir o painel</a></p></div>`;
  return { subject, text, html };
}
```

`functions/api/notify-signup.js`:

```js
// Recebe o aviso do banco (pg_net) e manda o e-mail pelo Resend. Segredos ficam no Cloudflare (nunca no repositório).
import { secretOk, parseEvent, buildSignupEmail } from '../_lib/signup.js';

export async function onRequestPost({ request, env }) {
  if (!secretOk(request.headers.get('x-webhook-secret'), env.NOTIFY_SECRET)) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  let body = null;
  try { body = await request.json(); } catch (e) { body = null; }
  const ev = parseEvent(body);
  if (!ev) return new Response(JSON.stringify({ erro: 'corpo inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const dominio = env.SITE_DOMAIN || 'sintonizatv.com.br';
  const msg = buildSignupEmail(ev, dominio);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Sintoniza <nao-responda@' + dominio + '>', to: [env.NOTIFY_TO], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  return new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 3: Migração `0011_ott_aviso_cadastro.sql`** (idempotente)

```sql
-- 0011: aviso por e-mail a cada novo cadastro. O banco só faz um POST assinado para o site;
-- a chave do Resend nunca fica no banco (só no Cloudflare). Falha do aviso nunca impede o cadastro.
create extension if not exists pg_net with schema extensions;

create table if not exists public.app_secrets (
  nome  text primary key,
  valor text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.notify_signup_event(p_evento text, p_email text, p_nome text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_url    text;
  v_total  bigint;
begin
  select valor into v_secret from public.app_secrets where nome = 'notify_secret';
  select valor into v_url    from public.app_secrets where nome = 'notify_url';
  if v_secret is null or v_url is null then return; end if;
  select count(*) into v_total from auth.users;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body    := jsonb_build_object('evento', p_evento, 'email', p_email, 'nome', coalesce(p_nome, ''), 'total', v_total, 'quando', now()),
    timeout_milliseconds := 5000
  );
exception when others then
  null; -- o aviso é "melhor esforço"
end;
$$;
revoke execute on function public.notify_signup_event(text, text, text) from public, anon, authenticated;

create or replace function public.trg_aviso_cadastro()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.notify_signup_event('cadastro', new.email, new.raw_user_meta_data->>'nome');
  return new;
end;
$$;

create or replace function public.trg_aviso_confirmou()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.notify_signup_event('confirmou', new.email, new.raw_user_meta_data->>'nome');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_aviso_cadastro on auth.users;
create trigger on_auth_user_aviso_cadastro after insert on auth.users
  for each row execute function public.trg_aviso_cadastro();

drop trigger if exists on_auth_user_aviso_confirmou on auth.users;
create trigger on_auth_user_aviso_confirmou after update of email_confirmed_at on auth.users
  for each row execute function public.trg_aviso_confirmou();
```

- [ ] **Step 4: Script `scripts/ott-aviso-cadastro.mjs`** (idempotente; **não imprime segredos**): (1) exige `RESEND_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NOTIFY_TO`; (2) confirma o domínio verificado no Resend (como o `ott-email.mjs`); (3) apaga a chave Resend anterior chamada `aviso-cadastro` (lista `GET /api-keys`, remove por nome) e cria uma nova `POST /api-keys {name:'aviso-cadastro', permission:'sending_access', domain_id}`; (4) gera `NOTIFY_SECRET` (32 bytes hex); (5) `PATCH https://api.cloudflare.com/client/v4/accounts/<id>/pages/projects/sintoniza-tv` com `deployment_configs.production.env_vars` = `RESEND_API_KEY` (`secret_text`), `NOTIFY_SECRET` (`secret_text`), `NOTIFY_TO` (`plain_text`), `SUPABASE_URL` e `SUPABASE_ANON_KEY` (`plain_text`, necessários ao proxy da W3), `SITE_DOMAIN` (`plain_text`); (6) grava no banco (Management API `POST /v1/projects/<ref>/database/query`) `insert into public.app_secrets ... on conflict (nome) do update` para `notify_secret` e `notify_url` (`https://<domínio>/api/notify-signup`); (7) imprime só "OK" por etapa e os **nomes** das variáveis definidas.

- [ ] **Step 5: Rodar, aplicar e testar**
  - `node --import tsx --test tests/signup-notify.test.ts && npx tsc --noEmit -p . && npm test` → PASS.
  - `npm run ott:setup` (aplica 0011; **depois confirme `mailer_autoconfirm = false`**), `npm run ott:aviso`.
  - O teste real vem na W7 (depois do deploy, que publica a função). Aqui, conferir por SQL (Management API) que o gatilho e a tabela existem e que `net.http_request_queue`/`net._http_response` registram chamadas.
- [ ] **Step 6: Commit** — `git add supabase functions scripts tests package.json .env.example && git commit -m "feat(site): aviso por e-mail a cada novo cadastro (gatilho + função + Resend)"`

### Task W2: Aparelho do tipo `web` (migração 0012 + painel)

**Files:**
- Create: `supabase/migrations/0012_ott_web.sql`
- Modify: `scripts/ott-smoke.mjs`, `panel/src/types.ts` (`tipo` ganha `'web'`; `Profile.max_web?`), `panel/src/pages/AccountPage.tsx`, `panel/src/pages/AdminPage.tsx`

- [ ] **Step 1: Migração**

```sql
-- 0012: navegadores/atalhos como aparelhos da conta (tipo "web"), sem código de ativação.
alter table public.devices drop constraint if exists devices_tipo_check;
alter table public.devices add constraint devices_tipo_check check (tipo in ('tv', 'celular', 'web'));
alter table public.devices add column if not exists instalacao text;
create unique index if not exists devices_instalacao on public.devices (user_id, instalacao) where instalacao is not null;
alter table public.profiles add column if not exists max_web integer not null default 5 check (max_web >= 0);

create or replace function public.web_device_register(p_instalacao text, p_modelo text default 'Navegador', p_sistema text default 'Web')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  p       public.profiles;
  d       public.devices;
  v_token text;
  n       integer;
begin
  if v_uid is null then
    raise exception 'Faça login para usar o app.' using errcode = '28000';
  end if;
  perform public.check_rate('web:' || v_uid::text, 30, interval '10 minutes');
  if p_instalacao is null or p_instalacao !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'Instalação inválida.' using errcode = 'P0001';
  end if;
  select * into p from public.profiles where id = v_uid;
  if public.access_state(p) = 'blocked' then
    raise exception 'Conta bloqueada. Fale com o suporte.' using errcode = 'P0001';
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  select * into d from public.devices where user_id = v_uid and instalacao = p_instalacao;
  if found then
    if not d.ativo then
      raise exception 'Este navegador foi desativado no painel.' using errcode = 'P0001';
    end if;
    update public.devices
       set token_hash = encode(digest(v_token, 'sha256'), 'hex'), ultimo_acesso = now(),
           modelo = left(coalesce(p_modelo, 'Navegador'), 80), sistema = left(coalesce(p_sistema, 'Web'), 40)
     where id = d.id;
  else
    select count(*) into n from public.devices where user_id = v_uid and ativo and tipo = 'web';
    if n >= p.max_web then
      raise exception 'Limite de % navegador(es) atingido. Remova um aparelho web no painel.', p.max_web using errcode = 'P0001';
    end if;
    insert into public.devices (user_id, token_hash, modelo, sistema, tipo, instalacao, ultimo_acesso)
    values (v_uid, encode(digest(v_token, 'sha256'), 'hex'), left(coalesce(p_modelo, 'Navegador'), 80), left(coalesce(p_sistema, 'Web'), 40), 'web', p_instalacao, now());
  end if;
  return json_build_object('status', 'ok', 'device_token', v_token);
end;
$$;

create or replace function public.device_valid(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  d public.devices;
  p public.profiles;
begin
  d := public.cast_device(p_token);
  if d.id is null or d.user_id is null then return false; end if;
  select * into p from public.profiles where id = d.user_id;
  return public.access_state(p) = 'ok';
end;
$$;

revoke execute on function public.web_device_register(text, text, text) from public, anon;
grant  execute on function public.web_device_register(text, text, text) to authenticated;
revoke execute on function public.device_valid(text) from public;
grant  execute on function public.device_valid(text) to anon, authenticated;
```
> Confirme no `0006` o nome real da constraint de `tipo` (`devices_tipo_check` por padrão) e as colunas reais de `devices` (`modelo`, `sistema`, `ultimo_acesso`); adapte se divergir.

- [ ] **Step 2: Smoke** (antes do resumo final; reaproveite o login `jwt` do smoke; `device_start`/`device_claim` não são usados aqui, então não gasta limite de taxa deles)

```js
// Aparelho web
const inst = 'smoke-' + Math.random().toString(16).slice(2) + '0123456789abcdef';
const w1 = await rpc('web_device_register', { p_instalacao: inst, p_modelo: 'Smoke Web', p_sistema: 'Web' }, jwt);
check('web_device_register cria o aparelho web e devolve o token', w1.status === 200 && w1.data.status === 'ok' && /^[0-9a-f]{64}$/.test(w1.data.device_token || ''), JSON.stringify(w1.data));
const v1 = await rpc('device_valid', { p_token: w1.data.device_token });
check('device_valid aceita o token do aparelho web', v1.data === true);
const w2 = await rpc('web_device_register', { p_instalacao: inst, p_modelo: 'Smoke Web', p_sistema: 'Web' }, jwt);
check('a mesma instalação reaproveita o aparelho e troca o token', w2.data.device_token && w2.data.device_token !== w1.data.device_token);
const vOld = await rpc('device_valid', { p_token: w1.data.device_token });
check('o token antigo deixa de valer', vOld.data === false);
const semLogin = await rpc('web_device_register', { p_instalacao: inst, p_modelo: 'x', p_sistema: 'y' });
check('web_device_register exige login', semLogin.status >= 400);
const instRuim = await rpc('web_device_register', { p_instalacao: 'curto', p_modelo: 'x', p_sistema: 'y' }, jwt);
check('instalação inválida é recusada', instRuim.status >= 400 && /inválida/i.test((instRuim.data && instRuim.data.message) || ''));
const cfgW = await rpc('device_config', { p_token: w2.data.device_token });
check('o aparelho web recebe a configuração da conta', ['ok', 'expired', 'blocked'].includes(cfgW.data.status), cfgW.data.status);
const falsoV = await rpc('device_valid', { p_token: 'falso' });
check('device_valid com token falso devolve false', falsoV.data === false);
await rpc('device_unlink', { p_token: w2.data.device_token });
```

- [ ] **Step 3: Painel** — `types.ts`: `tipo?: 'tv' | 'celular' | 'web'` e `max_web?: number`. `AccountPage.tsx` (contagem e rótulos nas linhas ~69-70 e ~102): contar `activeWebs` e mostrar "TVs x de y · Celulares x de y · Navegadores x de z"; rótulo `TV`/`Celular`/`Navegador` conforme `tipo`. `AdminPage.tsx` (~86-87 e ~253): mesmos contadores/rótulos e os botões `−`/`+` do limite de navegadores (`max_web`, `MAX_WEB_LIMIT = 10`, chaves `web-menos`/`web-mais`), como foi feito para celulares.
- [ ] **Step 4: Rodar** — `npm run ott:setup` (confirmar `mailer_autoconfirm = false`), `npm run ott:smoke` **uma vez** (9 `device_start` e 9 `device_claim` por rodada; respeitar a janela), `npx tsc --noEmit -p . && npm test && npm run build:panel`.
- [ ] **Step 5: Commit** — `git add supabase scripts panel && git commit -m "feat(backend): aparelho do tipo web (registro sem código) e device_valid"`

### Task W3: Proxy do site (`/api/proxy`)

**Files:**
- Create: `functions/api/proxy.js`, `functions/_lib/proxy.js`
- Test: `tests/proxy.test.ts`

- [ ] **Step 1: Teste da lógica pura (deve falhar)**

```ts
// Proxy: destinos permitidos (SSRF), reescrita de manifestos HLS e cabeçalhos
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget, rewriteM3u8, proxyUrl, passHeaders } from '../functions/_lib/proxy.js';

test('só http e https públicos', () => {
  assert.equal(checkTarget('https://exemplo.com/a.m3u8').ok, true);
  assert.equal(checkTarget('http://exemplo.com:8080/get.php?u=1').ok, true);
  for (const ruim of ['ftp://x.com/a', 'file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.5/a',
    'http://192.168.1.1/a', 'http://172.16.0.1/a', 'http://172.31.255.255/a', 'http://169.254.169.254/latest', 'http://0.0.0.0/a',
    'http://[::1]/a', 'http://[fe80::1]/a', 'http://servidor.local/a', 'http://algo.internal/a', 'lixo', '']) {
    assert.equal(checkTarget(ruim).ok, false, ruim);
  }
  assert.equal(checkTarget('http://172.32.0.1/a').ok, true); // fora da faixa privada
});

test('monta a URL do proxy', () => {
  assert.equal(proxyUrl('https://x.com/a b?c=1&d=2', 'tok', 'hls'), '/api/proxy?u=' + encodeURIComponent('https://x.com/a b?c=1&d=2') + '&t=tok&k=hls');
  assert.equal(proxyUrl('https://x.com/a', 'tok'), '/api/proxy?u=' + encodeURIComponent('https://x.com/a') + '&t=tok');
});

test('reescreve o manifesto HLS: linhas, relativos e atributos URI', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:6.0,',
    'seg1.ts',
    '#EXTINF:6.0,',
    'https://cdn.exemplo.com/seg2.ts?x=1',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000',
    '/sub/lista.m3u8',
    '',
  ].join('\n');
  const out = rewriteM3u8(m3u8, 'https://x.com/live/main.m3u8', 'tok');
  const linhas = out.split('\n');
  assert.ok(linhas[1].includes('URI="/api/proxy?u=' + encodeURIComponent('https://x.com/live/key.bin') + '&t=tok"'));
  assert.ok(linhas[1].includes('IV=0x1'));
  assert.ok(linhas[2].includes(encodeURIComponent('https://x.com/live/init.mp4')));
  assert.equal(linhas[4], '/api/proxy?u=' + encodeURIComponent('https://x.com/live/seg1.ts') + '&t=tok&k=hls');
  assert.equal(linhas[6], '/api/proxy?u=' + encodeURIComponent('https://cdn.exemplo.com/seg2.ts?x=1') + '&t=tok&k=hls');
  assert.equal(linhas[8], '/api/proxy?u=' + encodeURIComponent('https://x.com/sub/lista.m3u8') + '&t=tok&k=hls');
  assert.equal(linhas[0], '#EXTM3U');
});

test('cabeçalhos repassados: só os seguros', () => {
  const h = passHeaders(new Headers({ range: 'bytes=0-99', 'if-range': 'x', cookie: 'segredo', authorization: 'Bearer z', host: 'a' }));
  assert.equal(h.get('range'), 'bytes=0-99');
  assert.equal(h.get('cookie'), null);
  assert.equal(h.get('authorization'), null);
  assert.equal(h.get('user-agent'), 'VLC/3.0.20');
});
```
Run: `node --import tsx --test tests/proxy.test.ts` → FAIL.

- [ ] **Step 2: Implementar `functions/_lib/proxy.js`**

```js
// Proxy do site: validação de destino (SSRF), reescrita de HLS e cabeçalhos. Puro (testado no Node).
const PRIV_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function checkTarget(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return { ok: false, motivo: 'url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, motivo: 'protocolo' };
  const h = u.hostname.toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.indexOf('[') >= 0 || h.indexOf(':') >= 0) return { ok: false, motivo: 'host' };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) for (let i = 0; i < PRIV_V4.length; i++) if (PRIV_V4[i].test(h)) return { ok: false, motivo: 'privado' };
  return { ok: true, url: u.toString() };
}

export function proxyUrl(alvo, token, kind) {
  return '/api/proxy?u=' + encodeURIComponent(alvo) + '&t=' + token + (kind ? '&k=' + kind : '');
}

// Reescreve um manifesto HLS para que sub-manifestos e segmentos também passem pelo proxy.
export function rewriteM3u8(texto, baseUrl, token) {
  const resolve = (ref) => { try { return new URL(ref, baseUrl).toString(); } catch (e) { return null; } };
  return String(texto).split(/\r?\n/).map((linha) => {
    if (!linha) return linha;
    if (linha.charAt(0) === '#') {
      // atributos URI="..." (chaves, mapas, mídias): chaves e mapas vão crus; listas de mídia como HLS
      return linha.replace(/URI="([^"]+)"/g, (m, ref) => {
        const abs = resolve(ref);
        if (!abs) return m;
        const kind = /^#EXT-X-MEDIA:/.test(linha) ? 'hls' : undefined;
        return 'URI="' + proxyUrl(abs, token, kind) + '"';
      });
    }
    const abs = resolve(linha.trim());
    return abs ? proxyUrl(abs, token, 'hls') : linha;
  }).join('\n');
}

export function passHeaders(entrada) {
  const h = new Headers();
  const range = entrada.get('range');
  if (range) h.set('range', range);
  const ifRange = entrada.get('if-range');
  if (ifRange) h.set('if-range', ifRange);
  h.set('user-agent', 'VLC/3.0.20');
  h.set('accept', '*/*');
  return h;
}
```

`functions/api/proxy.js` (onRequest para GET e HEAD; OPTIONS 204): (1) `t` obrigatório, validar com `deviceValid(env, t)`: chama `POST ${env.SUPABASE_URL}/rest/v1/rpc/device_valid` com `apikey`/Bearer = `env.SUPABASE_ANON_KEY`, corpo `{p_token}`; cache em memória do isolate `Map` com TTL 300 s (positivo) e 30 s (negativo); 401 `{erro:'sessão inválida'}` se falso; (2) `checkTarget(u)` → 400; (3) `fetch` manual com `redirect:'manual'`, até 5 saltos, **revalidando cada destino** com `checkTarget`; (4) cabeçalhos de entrada por `passHeaders`; (5) se `k === 'hls'` e o corpo for manifesto (content-type com `mpegurl` ou URL final `.m3u8`): `text()` → `rewriteM3u8(texto, urlFinal, t)` → `Cache-Control: no-store`, `Content-Type: application/vnd.apple.mpegurl`; senão devolver `new Response(resp.body, {status, headers})` copiando `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, `Cache-Control`; (6) erro de rede → 502 `{erro:'o provedor não respondeu'}`; (7) cabeçalhos `Access-Control-Allow-Origin: https://<SITE_DOMAIN>`, `Vary: Origin`, `X-Content-Type-Options: nosniff`; (8) limite: recusar `Content-Length` > 8 GB não é necessário; recusar métodos que não sejam GET/HEAD.

- [ ] **Step 3: Rodar** — `node --import tsx --test tests/proxy.test.ts && npx tsc --noEmit -p . && npm test`; teste de integração local simples: `scripts/dev/proxy-local.mjs` sobe um servidor Node que importa o handler com `env` falso e um "provedor" local (em `127.0.0.1` → deve ser **bloqueado**; para o teste use `checkTarget` injetável ou um provedor com host de teste permitido via variável `PROXY_ALLOW_LOCAL=1` **somente no Node de teste**, nunca na função publicada) conferindo repasse de `Range` (206), reescrita HLS e 401 sem token.
- [ ] **Step 4: Commit** — `git add functions tests scripts && git commit -m "feat(site): proxy /api/proxy para o app web (CORS, http→https, HLS, Range, anti-SSRF)"`

---

# PARTE 2 — App (repositório `visual-craft-assistant`, branch `v14`)

### Task W4: Build web (manifest, service worker, ícones, bibliotecas próprias)

**Files:**
- Create: `scripts/build-web.mjs`, `scripts/make-web-icons.py`, `web/vendor.json`, `web/sw.template.js`, `web/manifest.template.json`, `web/icons/*.png`
- Modify: `package.json` (`"build:web": "node scripts/build-web.mjs"`); Create `.github/workflows/build-mobile-v14.yml`, bump de versão (iOS 1.4/14, Android 1.4/14, `APP_VERSION="v14"`)
- Test: `tests/web/build-web.test.js`

- [ ] **Step 1: Branch e versão** — `git checkout -b v14` (a partir da `v13`); aplicar o bump como nas versões anteriores (script Node preservando CRLF).
- [ ] **Step 2: Ícones** — `scripts/make-web-icons.py` (Pillow, já instalado) gera a partir de `icon.png` (1024): `web/icons/icon-180.png` (apple-touch, **sem transparência**, fundo `#0B0B11`), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (logo dentro de 70% da área central sobre `#0B0B11`), `favicon-32.png`; commitar os PNGs. Conferir visualmente (Read) e apagar capturas temporárias.
- [ ] **Step 3: Bibliotecas próprias** — `web/vendor.json` com as **versões fixas atuais** de `lucide`, `hls.js`, `mpegts.js` (descobrir a versão resolvida de `@latest` no jsDelivr e fixá-la) e da fonte Outfit/Plus Jakarta se o app usa Google Fonts; `scripts/build-web.mjs` baixa os arquivos exatos para `<saida>/app/vendor/` (guardando cópia em `.web-cache/`, ignorado pelo git, para builds offline) e valida o hash SHA-256 guardado em `vendor.json` na segunda vez.
- [ ] **Step 4: Teste (deve falhar)** — `tests/web/build-web.test.js` constrói em pasta temporária e confere:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildWeb } from "../../scripts/build-web.mjs";

const out = mkdtempSync(path.join(tmpdir(), "sint-web-"));
const res = await buildWeb({ outDir: out, offline: true }); // offline: usa .web-cache/ ou arquivos de teste
const html = readFileSync(path.join(out, "app", "index.html"), "utf8");

test("o app web sai em /app/ com manifest, service worker e ícones", () => {
  for (const f of ["index.html", "manifest.webmanifest", "sw.js", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"]) {
    assert.ok(existsSync(path.join(out, "app", f)), f);
  }
});

test("tags de PWA e iOS", () => {
  assert.match(html, /<link rel="manifest" href="\/app\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#08080D">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Sintoniza">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/app\/icons\/icon-180\.png">/);
  assert.match(html, /navigator\.serviceWorker\.register\("\/app\/sw\.js"/);
});

test("nenhuma biblioteca vem de CDN @latest e nenhum segredo é embutido", () => {
  assert.doesNotMatch(html, /unpkg\.com|cdn\.jsdelivr\.net|@latest/);
  assert.doesNotMatch(html, /__DEFAULT_CHANNELS_URL__|__DEFAULT_VOD_URL__/);
  assert.match(html, /\/app\/vendor\//);
});

test("o manifest abre em /app/ como app independente", () => {
  const m = JSON.parse(readFileSync(path.join(out, "app", "manifest.webmanifest"), "utf8"));
  assert.equal(m.start_url, "/app/");
  assert.equal(m.scope, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "pt-BR");
  assert.ok(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
});

test("o service worker não cacheia API, proxy, listas nem streams", () => {
  const sw = readFileSync(path.join(out, "app", "sw.js"), "utf8");
  assert.match(sw, /\/api\//);
  assert.match(sw, /BUILD_ID/);
  assert.doesNotMatch(sw, /supabase\.co/); // chamadas ao backend não passam pelo cache
});

test("o build reaproveita o arquivo do app sem tocar no original", () => {
  assert.ok(res.htmlBytes > 100000);
});
```
- [ ] **Step 5: Implementar `scripts/build-web.mjs`** exportando `buildWeb({ outDir, offline })`: lê `sintoniza-link.html` (CRLF preservado ou normalizado para LF no artefato web; tanto faz), aplica: (a) troca os 3 `<script src=…cdn…>` e o `<link>` de fontes pelos arquivos de `/app/vendor/`; (b) esvazia os tokens `__DEFAULT_*__`; (c) injeta no `<head>` (antes do primeiro `<script>` embutido) as tags do teste; (d) marca `<html data-web-app="1">`; (e) acrescenta, antes de `</body>`, o registro do service worker **só se `navigator.serviceWorker` existir e a página for servida por `/app/`**: `navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" })`; (f) grava `manifest.webmanifest` (a partir do template: `name "Sintoniza"`, `short_name "Sintoniza"`, `start_url "/app/"`, `scope "/"`, `display "standalone"`, `background_color "#08080D"`, `theme_color "#08080D"`, `lang "pt-BR"`, ícones 192/512 `any` + 512 `maskable` + 180); (g) grava `sw.js` do template com `BUILD_ID` = hash do `index.html` (cache do shell: `/app/`, `/app/index.html`, `/app/manifest.webmanifest`, ícones e `/app/vendor/*`; **estratégia network-first** para `index.html` e cache-first para `vendor/` e ícones; nunca cachear `/api/`, `/auth/`, `/rest/`, URLs de outra origem nem requisições com `Range`; ao ativar, apagar caches antigos e `clients.claim()`). Saída final em `<outDir>/app/…`.
- [ ] **Step 6: Rodar** — `node --test "tests/web/*.test.js" && npm test` (256+ verdes continuam) → PASS.
- [ ] **Step 7: Commit** — `git add scripts web tests package.json .github ios android sintoniza-link.html && git commit -m "feat(web): build web do app (manifest, service worker, ícones e bibliotecas próprias) e versão v14"`

### Task W5: O app roda como "web" (conta do site, aparelho web, proxy, computador e iPhone)

**Files:**
- Modify: `sintoniza-link.html` (ott-core + script principal + CSS), `tests/ott/loadOtt.js`
- Create: `tests/ott/web.test.js`, `tests/vod/web-helpers.test.js`, `scripts/dev/check-web-app.mjs`

Antes do desenho do layout de computador invoque a skill `frontend-design:frontend-design` (identidade atual: tema claro creme/dourado do app de celular e laranja/escuro da marca; Outfit).

- [ ] **Step 1: Funções puras testadas** (no `ott-core`, expostas em `loadOtt.js`)
  - `ottIsWebPath(pathname, native)`: true se `!native` e `pathname` começa com `/app`.
  - `ottWebInstallId(storage)`: lê/gera `sint_web_install` (uuid v4 de `crypto.getRandomValues`; fallback `Math.random` só em teste) e devolve.
  - `ottWebParseSession(raw)`: lê `sintoniza_painel_sessao` → `{access_token, refresh_token, expires_at, user}` ou `null`.
  - `ottWebNeedsRefresh(session, nowMs)`: true se faltam < 60 s.
  - `ottWebRefresh(cfg, session, fetchImpl)`: `POST /auth/v1/token?grant_type=refresh_token` (como o `getSession` do painel); grava a sessão renovada em `sintoniza_painel_sessao` (mesmo formato do painel); falha → `null`.
  - `ottWebRegister(cfg, accessToken, instalacao, info, fetchImpl)`: `POST /rest/v1/rpc/web_device_register` com `Authorization: Bearer <access_token>` (o `ottCallRpc` ganha o parâmetro opcional `bearer` no fim) → `device_token`; erros do servidor viram `Error` em português.
  - `ottWebDevice(ua, platform)`: modelo/sistema legíveis (Chrome/Edge/Firefox/Safari + Windows/macOS/Linux/Android/iOS) e se está em modo "app" (`display-mode: standalone` ou `navigator.standalone`).
  - `ottWebProxy(url, token, kind)`: `/api/proxy?u=…&t=…[&k=…]` (mesma lógica do servidor; testar igualdade com os casos do `proxy.test.ts`), e `ottWebShouldProxy(url, ownOrigins)`: true para `http(s)` de provedor; false para a própria origem, Supabase, `raw.githubusercontent.com`, `data:`/`blob:`.
  - Testes em `tests/ott/web.test.js` com os casos acima (sessão expirada → refresh; refresh falho → null; instalação estável; `web_device_register` com `Bearer` do usuário e não da anon key; id de instalação inválido nunca enviado).
- [ ] **Step 2: Detecção e entrada** (script principal)
  - `isWebApp()` = `ottIsWebPath(location.pathname, isNativeApp())`; `ottEnabled()` passa a ser verdadeiro também com `isWebApp()`; os dois scripts do `<head>` (classes `ott-open`/`profile-open`) usam a mesma regra (o build web já marca `data-web-app`).
  - **`webBoot()`** (substitui `ottBeginActivation` no modo web, dentro de `ottCheck` quando não há token): (1) lê a sessão do site (`ottWebParseSession(localStorage.sintoniza_painel_sessao)`); sem sessão → `location.replace("/?next=" + encodeURIComponent("/app/"))`; (2) renova se necessário; falhou → mesma ida ao login; (3) `ottWebRegister(...)` → grava `sint_ott_token` e segue o fluxo normal (`ottCheck` → `device_config` → `ottOnOk`); erros de limite/desativado/bloqueio mostram a tela de bloqueio existente com a mensagem e o link do painel; (4) **não mostrar a tela de código/QR no modo web**.
  - Se o app já tiver token: segue como hoje; se `device_config` responder `unknown_device` (aparelho removido no painel), apagar o token e repetir `webBoot()`.
  - **Sair:** no cartão "Conta Sintoniza" (Configurações) o botão "Desvincular este aparelho" vira, no modo web, **"Sair"**: `device_unlink` + apagar `sint_ott_*`/`sintoniza_painel_sessao` + `POST /auth/v1/logout` (como o painel) + `location.replace("/")`. Gravar `sint_web_signed_out=1` até o próximo login para impedir registrar de novo em loop.
  - Botão "Gerenciar minha conta" e links para o painel apontam para `/conta` (mesma origem, dentro do app instalado).
- [ ] **Step 3: Proxy no navegador** — no modo web (`isWebApp()`): um único ponto `webUrl(url, kind)` aplica `ottWebProxy` quando `ottWebShouldProxy`; usar nos pontos mapeados: lista M3U (`loadPlaylistFromUrl`), `xtreamApiUrl` e os 3 `fetch` de `player_api.php` (`get_series_info` incluso), EPG principal e suplementar, sondagens `HEAD` (`detectStreamType`, `probeVodUrl`), VOD direto (`tryDirectPlay`: `video.src` com `webUrl(url)` cru) e streams HLS (`playUrl = webUrl(url, "hls")`, hls.js; MPEG-TS com `webUrl(url)`; Safari nativo com `video.src = webUrl(url, "hls")`). O `proxyIfInsecure`/`LS.PROXY` antigos não são usados no modo web. Imagens ficam como estão (falha cai nas iniciais).
- [ ] **Step 4: iPhone/Android como atalho** — `toggleFullscreen`: em `isWebApp()` com iPhone/iPad ou modo standalone usa o pseudo-fullscreen (já existe) em vez de `requestFullscreen`; `safe-area` já existe; `apple-mobile-web-app-status-bar-style: black-translucent` exige que o topo use `env(safe-area-inset-top)` (conferir topbar/gate de perfis/gate de conta); o seletor de perfis reaparece quando o iOS encerra o app (usar `localStorage` com validade de 12 h em vez de `sessionStorage` só no modo web). Downloads continuam ocultos (`canDownload()` false). Sem pedir login em loop.
- [ ] **Step 5: Computador** — grade de canais com colunas responsivas (`grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr))` acima de 1100 px; abaixo mantém as regras atuais), `content-shell` mais largo em telas ≥ 1600 px (`min(100%, 110rem)`), player com altura proporcional (`aspect-ratio` 16/9 até 70vh em telas largas, sem quebrar o mobile), carrosséis com **setas** e rolagem horizontal pela roda do mouse; controle de **volume** e mudo no player só no desktop (`@media (hover: hover) and (pointer: fine)`; o app mobile força volume 1: manter lá); **atalhos de teclado** (quando o foco não está num campo): `Espaço`/`k` play/pause, `←`/`→` −/+10 s (VOD), `↑`/`↓` volume, `m` mudo, `f` tela cheia, `/` foca a busca, `Esc` sai da tela cheia; função pura `webKeyAction(evento)` testada. Sidebar fixa recolhível em 769–1100 px.
- [ ] **Step 6: `localStorage` robusto** — envolver em `try/catch` as escritas listadas no mapa (`sint_recents`, `sint_fav`, `sint_continue`, `sint_mylist`, `sint_downloads`, `sint_ott_*`, `sint_proxy`, `sint_fit`) por um helper `lsSet(key, value)`; cota estourada → apagar `sint_epg_cache` e tentar de novo uma vez; o EPG segue em memória.
- [ ] **Step 7: Testes de marcação e funções puras** (`tests/ott/web.test.js` + `tests/vod/web-helpers.test.js` para `webKeyAction`/`webUrl` se ficarem no script principal e entrarem em `PURE_HELPER_NAMES`).
- [ ] **Step 8: Verificar no Chrome** — `scripts/dev/check-web-app.mjs`: servir `build:web` em `http://127.0.0.1:<porta>/app/` com um servidor local que também responde `/api/proxy` (reaproveitar o handler da W3 do outro repo **não é possível**: simule com um servidor de teste que implementa o mesmo contrato) e um Supabase fingido (`fetch` fingido que recusa rede real, como nos `check-*` anteriores): (a) sem sessão → redireciona para `/?next=%2Fapp%2F`; (b) com sessão válida → chama `web_device_register` com o `Bearer` do usuário e **não** mostra o código/QR; (c) as requisições ao provedor saem por `/api/proxy` com `t=`; (d) viewport 1440×900: grade com mais colunas, setas nos carrosséis, volume e atalhos funcionam; (e) viewport 390×844 em modo standalone simulado (`display-mode`): tela cheia usa pseudo-fullscreen e o topo respeita a safe-area; (f) service worker registra e `index.html` é servido do cache em segunda visita offline (shell). Capturas lidas (Read) e apagadas; todos os `scripts/dev/check-*.mjs` seguem `✔ ok`; `npm test` verde.
- [ ] **Step 9: Commit** — `git add sintoniza-link.html tests scripts/dev && git commit -m "feat(web): app roda no navegador (conta do site, aparelho web, proxy, desktop e iPhone como atalho)"`

---

# PARTE 3 — Site (repositório `Novo-App-de-TV`), publicação e testes

### Task W6: A aba App no site e o retorno do login

**Files:** `panel/src/App.tsx`, `panel/src/pages/AuthPage.tsx`, `panel/src/pages/AccountPage.tsx`, `panel/src/components/ui.tsx` (se precisar), `panel/index.html`, `panel/public/_headers`

- [ ] **Step 1: `next` no login** — função pura `safeNext(search)` (aceita só caminhos que começam com `/app/` ou `/conta`, sem `//`, sem esquema, ≤ 200 caracteres) com teste em `tests/panel-next.test.ts`; em `AuthPage`, depois de entrar (sessão criada), se `safeNext` válido → `window.location.replace(next)`; o link do e-mail de confirmação (`redirect_to`) também carrega o `next` (como já faz com `?codigo=`).
- [ ] **Step 2: A aba** — no cabeçalho do painel (para quem tem sessão) acrescentar **"App"** (primeira aba) que abre `/app/` (navegação completa, não a rota interna); em `AccountPage`, um cartão "Assistir no navegador" com botão "Abrir o app" e a dica "No celular: abra este endereço e use *Compartilhar → Adicionar à Tela de Início* (iPhone) ou *Instalar app* (Android/computador)". Sem sessão, a página inicial do site (`/`) oferece "Entrar ou criar conta" e, no rodapé, "Abrir o app".
- [ ] **Step 3: Cabeçalhos** — `panel/public/_headers`: para `/app/*`: `Cache-Control: no-cache` em `index.html`/`sw.js`/`manifest.webmanifest`, `Service-Worker-Allowed: /app/` em `sw.js`, `Cache-Control: public, max-age=31536000, immutable` em `/app/vendor/*` e `/app/icons/*`, `Permissions-Policy: autoplay=(self), fullscreen=(self), picture-in-picture=(self)` **sem** `camera/microphone/geolocation`; manter `X-Frame-Options: DENY` e `nosniff`. Sem CSP restritiva no `/app/` (provedores e Supabase são destinos variáveis); apenas `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] **Step 4: Verificar** — `npx tsc --noEmit -p . && npm test && npm run build:panel`; capturas do cabeçalho com a aba nova e do cartão (Read, apagar).
- [ ] **Step 5: Commit** — `git add panel tests && git commit -m "feat(site): aba App e retorno ao app depois do login"`

### Task W7: Integrar no deploy, publicar e conferir

**Files:** `scripts/deploy-panel.mjs`, `package.json`, `.gitignore` (`dist-panel/` já ignorado)

- [ ] **Step 1: Integração** — no `deploy-panel.mjs`, depois do `vite build` do painel: localizar o repositório do app (`SINTONIZA_APP_DIR`, padrão `../visual-craft-assistant`), exigir a branch/arquivos (`scripts/build-web.mjs`), executar `node scripts/build-web.mjs --out <repo-site>/dist-panel` (o build escreve em `dist-panel/app/`), copiar `functions/` (já na raiz do repo do site, onde o wrangler as encontra) e gerar `dist-panel/_routes.json` `{ "version": 1, "include": ["/api/*"], "exclude": [] }` (as funções só rodam em `/api/*`; estáticos não gastam cota). Falhar com mensagem clara se o app não for encontrado. `package.json`: `"deploy:site": "node --env-file=.env.ott.local scripts/deploy-panel.mjs"` (mantém `deploy:panel` como alias).
- [ ] **Step 2: Preparar** — `npm run ott:setup` (aplica 0011 e 0012; **confirmar `mailer_autoconfirm = false`**) e `npm run ott:aviso` (cria chave Resend de envio, segredos e variáveis do Cloudflare, segredo do banco), **antes** do deploy.
- [ ] **Step 3: Publicar** — `npm run deploy:site`. Conferir com `curl` (sem imprimir segredos): `https://sintonizatv.com.br/app/` → 200 e contém `manifest.webmanifest`; `/app/manifest.webmanifest` → JSON com `start_url:"/app/"`; `/app/sw.js` → 200 com `Service-Worker-Allowed`; `/app/vendor/…` e ícones → 200 e cache longo; `/api/proxy` sem `t` → 401; `/api/proxy?u=http://127.0.0.1/x&t=abc` → 401 (token inválido, nunca chega ao destino); `/api/notify-signup` (POST sem segredo) → 401; `/` e `/conta` do painel continuam funcionando (SPA).
- [ ] **Step 4: Commit** — `git add scripts package.json && git commit -m "feat(site): deploy do site publica o app web, as funções e as rotas"`

### Task W8: Testes de ponta a ponta na produção

**Files:** Create `scripts/dev/e2e-site-app.mjs` no repo do app (estilo dos outros e2e; `.env.ott.local` do repo do site por caminho; nunca imprimir segredos). Usar o Chrome via `scripts/dev/cdp.mjs` (ou o Playwright MCP, se estiver disponível).

- [ ] **Step 1: Aviso de cadastro (real, 1 e-mail ao Gustavo)** — criar um usuário de teste pela API de Auth (`POST /auth/v1/signup` com e-mail `teste+aviso<timestamp>@…` num domínio de teste do próprio Gustavo **ou** pelo endpoint admin com `user_metadata.nome = "TESTE aviso de cadastro"`); aguardar até 15 s e consultar `net._http_response` (Management API) confirmando status 200 da função; **pedir confirmação ao Gustavo** de que o e-mail chegou (não dá para ler a caixa dele): registrar no relatório "enviado, status 200"; remover o usuário de teste ao final (`admin_delete_user`/Auth admin). O e-mail deve ter o assunto "Novo cadastro no Sintoniza: TESTE…".
- [ ] **Step 2: App web** — em Chrome (desktop 1440×900) logar na produção com o usuário de teste do `.env.ott.local` pela tela do site (`/`), clicar na aba **App** (ou abrir `/app/`), conferir: aparelho `web` criado (`devices` via REST com o JWT; **sem** tela de código), perfis carregam, lista de canais da conta carrega **através do proxy** (requisição `/api/proxy?...` com 200), um canal ao vivo inicia a reprodução (HLS por `/api/proxy…k=hls`; se o provedor da conta bloquear datacenter, registrar o status do provedor), `service worker` ativo e instalável (manifest válido; usar `Page.getAppManifest`/`Application` do CDP), segunda visita offline mostra o shell. Repetir em viewport 390×844 com `display-mode: standalone` simulado. Limpeza: `device_unlink` do aparelho web.
- [ ] **Step 3: Regressões** — repo do site: `npm test`, `npx tsc --noEmit -p .`, `npm run ott:smoke` (uma vez, respeitando a janela), `build:ott` + `check:tv` (a TV não deve ser afetada); repo do app: `npm test` e todos os `scripts/dev/check-*.mjs`; confirmar `mailer_autoconfirm = false`.
- [ ] **Step 4: Commit** — `git add scripts/dev/e2e-site-app.mjs && git commit -m "test(site): app web e aviso de cadastro de ponta a ponta na produção"`

### Task W9: Documentação e envio

- [ ] `docs/app-web.md` no repo do site: como o app web funciona, como publicar (`npm run deploy:site`), contratos (proxy e RPCs), **custos e limites** (100 mil requisições/dia no grátis, Workers Paid ≈ US$ 5/mês), como instalar no iPhone/Android/computador, como trocar `NOTIFY_TO` (`npm run ott:aviso`), o que o proxy faz e não faz (aviso: usa o token do aparelho; abuso é limitado a contas ativas). Enviar as branches ao GitHub (`v14` do app e `app-tv-ott-ativacao` do site). **Não** baixar IPA/APK.

---

## Auto-revisão

- **Cobertura do pedido:** aviso de cadastro com nome e e-mail (W1, W7, W8); custo de e-mail do domínio (respondido; nenhuma implementação); aba **App** no site (W6); cadastro/login pelo site e uso no computador (W2, W5, W6); atalho no celular funcionando pelo login web e substituindo o app instalado (W4, W5 Step 4, manifest com `scope "/"`, login dentro do atalho); proxy para o app funcionar de verdade no navegador (W3, W5 Step 3).
- **Nomes consistentes:** `web_device_register`, `device_valid`, `sint_web_install`, `/api/proxy` (`u`, `t`, `k`), `/api/notify-signup`, `app_secrets`, `NOTIFY_TO/NOTIFY_SECRET/RESEND_API_KEY/SUPABASE_URL/SUPABASE_ANON_KEY/SITE_DOMAIN`, `buildWeb`, `isWebApp`, `webBoot`, `webUrl`, `ottWeb*`, `safeNext`.
- **Riscos:** (1) provedores IPTV podem bloquear IPs de datacenter da Cloudflare (a verificar no W8); (2) o plano grátis do Cloudflare limita a 100 mil requisições por dia e o proxy de vídeo as consome rápido (mitigação: Workers Paid; tráfego de vídeo só passa pelo proxy quando necessário); (3) o PWA do iPhone tem armazenamento próprio: o login é refeito dentro do atalho (previsto); (4) o e-mail de confirmação pelo link abre no Safari, não no atalho: depois de confirmar, a pessoa entra de novo no app; (5) o aviso contém dados pessoais dos clientes (LGPD): enviar só ao Gustavo e mencionar no aviso de privacidade do site; (6) o iPhone não toca MKV/AVI nem MPEG-TS direto (igual ao app nativo).
