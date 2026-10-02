# Celular: cadastro, QR code e conta de 7 dias (como na TV) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o app de celular passa a exigir uma conta Sintoniza, igual à TV: ao abrir, mostra um **código + QR code** de ativação; o cliente cria a conta no painel (**teste gratuito de 7 dias**) e digita o código; o app recebe as listas liberadas pela conta e abre. Termina com o IPA/APK da `v10` baixados em `Downloads`.

**Architecture:** reaproveita o backend e o painel da TV (Supabase: `device_start`, `device_config`, `device_claim`, `device_unlink`). O celular é um **aparelho do tipo `celular`** (limite separado do das TVs, para não gastar a vaga da TV). O app **não leva chave nenhuma no código**: busca a configuração pública do backend em `https://sintonizatv.com.br/app-config.json`, publicada pelo painel. Toda a lógica vai em dois blocos de script embutidos no `sintoniza-link.html` (`ott-core`: funções puras e testáveis; `qrcodegen`: gerador de QR da TV compilado para JS) e uma camada de tela (`#ott-gate`) por cima do app.

**Tech Stack:** Supabase (SQL/RPC, via Management API), React + Vite (painel), HTML/JS puro (celular), `node:test`, Chrome via CDP, GitHub Actions (build).

**Repositórios e branches:**
- Backend e painel: `C:\Users\guait\Documents\Novo-App-de-TV`, branch `app-tv-ott-ativacao` (Tasks B1–B3).
- Celular: `C:\Users\guait\Documents\visual-craft-assistant`, branch `v10` (Tasks M1–M6 e Task Final).
- **Nunca na `main`.** Ordem obrigatória: **B1 → B2 → B3 → M1…** (o celular só funciona depois que o backend e o `app-config.json` estiverem no ar).

> ⚠️ **Edição do HTML do celular:** CRLF (`core.autocrlf=true`). Sem `sed -i` (converte para LF e quebra o teste do bloco `epg-helpers`). Use a ferramenta de edição ou script Node que preserve o fim de linha. Rode `npm test` depois de cada tarefa.

> 🔐 **Segredos:** nunca imprimir chaves, senhas ou tokens (`.env.ott.local` do projeto da TV guarda `SUPABASE_ACCESS_TOKEN`, `OTT_TEST_EMAIL`, `OTT_TEST_PASSWORD`, `CLOUDFLARE_*`). A chave pública (`anon`) é a mesma que já vai em todo cliente; ela só fica no site do painel, nunca no repositório.

---

## Decisões (tomadas pelo critério "recomendado", sem o Gustavo presente)

| Decisão | Escolha | Por quê |
|---|---|---|
| Quem é "conta de 7 dias" | O que o painel já faz: `profiles.trial_fim = now() + 7 dias` no cadastro | Zero mudança no cadastro; o app só mostra os dias restantes |
| Cadastro dentro do app? | **Não**: o app abre a página de ativação do painel (com o código) e mostra o QR para outro aparelho | O painel já tem cadastro, confirmação por e-mail e recuperação de senha prontos e testados |
| QR code | Mostrado no app (leitura por **outro** aparelho: computador ou outro celular) + botão que abre a página no próprio celular | No mesmo aparelho o QR não serve; o botão resolve |
| Limite de aparelhos | `devices.tipo` (`tv`/`celular`) e `profiles.max_celulares` (padrão 3), separado de `max_devices` (TVs, padrão 2) | Com o limite único de 2, uma TV + um celular esgotariam a conta |
| Chave do backend no app | `app-config.json` publicado pelo painel | Mantém a regra "chave fora do código" e dispensa segredos no GitHub Actions (não há `gh` instalado) |
| Onde a conta é obrigatória | Só no app nativo (Capacitor) ou com `?ott=1`; o site no navegador (GitHub Pages) continua com listas manuais; `?noott=1` desliga | Não quebra o uso web atual |
| Listas manuais no app com conta | Escondidas (as listas vêm da conta, "Modelo A") | Igual à TV OTT |

---

# PARTE 1 — Backend e painel (repositório `Novo-App-de-TV`, branch `app-tv-ott-ativacao`)

### Task B1: Migração 0006 — celular como aparelho da conta

**Files:**
- Create: `supabase/migrations/0006_ott_celular.sql`
- Modify: `scripts/ott-smoke.mjs` (verificações novas antes do resumo final, linha ~100)

- [ ] **Step 1: Escrever a migração**

```sql
-- 0006: celulares como aparelhos da conta, com limite separado do das TVs.
-- Aparelhos antigos (TVs) ficam com tipo 'tv'. TVs que chamam device_start com 2 parâmetros continuam
-- funcionando (p_tipo tem valor padrão 'tv').

alter table public.devices
  add column if not exists tipo text not null default 'tv' check (tipo in ('tv', 'celular'));

alter table public.profiles
  add column if not exists max_celulares integer not null default 3 check (max_celulares >= 0);

drop function if exists public.device_start(text, text);

create or replace function public.device_start(
  p_modelo  text default '',
  p_sistema text default '',
  p_tipo    text default 'tv'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token  text;
  v_device uuid;
  c        public.activation_codes;
begin
  perform public.check_rate('start:' || public.request_ip(), 20, interval '1 hour');
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.devices (token_hash, modelo, sistema, tipo)
  values (
    encode(digest(v_token, 'sha256'), 'hex'),
    left(coalesce(p_modelo, ''), 80),
    left(coalesce(p_sistema, ''), 40),
    case when p_tipo = 'celular' then 'celular' else 'tv' end
  )
  returning id into v_device;
  c := public.issue_activation_code(v_device);
  return json_build_object(
    'device_token', v_token,
    'code', c.code,
    'expires_at', c.expires_at,
    'poll_seconds', 5
  );
end;
$$;

create or replace function public.device_claim(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_raw  text;
  v_code text;
  v_tipo text;
  c      public.activation_codes;
  p      public.profiles;
  n      integer;
begin
  if v_uid is null then
    raise exception 'Faça login para ativar o aparelho.' using errcode = '28000';
  end if;
  perform public.check_rate('claim:' || v_uid::text, 10, interval '10 minutes');

  -- Aceita "abcd1234", "ABCD 1234" ou "ABCD-1234"
  v_raw  := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_code := left(v_raw, 4) || '-' || substr(v_raw, 5, 4);

  select * into c from public.activation_codes where code = v_code for update;
  if not found or c.claimed_at is not null or c.expires_at <= now() then
    raise exception 'Código inválido ou expirado. Confira o código que aparece no aparelho agora.' using errcode = 'P0001';
  end if;

  select * into p from public.profiles where id = v_uid;
  if public.access_state(p) = 'blocked' then
    raise exception 'Conta bloqueada. Fale com o suporte.' using errcode = 'P0001';
  end if;

  select tipo into v_tipo from public.devices where id = c.device_id;
  select count(*) into n from public.devices where user_id = v_uid and ativo and tipo = v_tipo;
  if v_tipo = 'celular' then
    if n >= p.max_celulares then
      raise exception 'Limite de % celular(es) atingido. Remova um celular no painel para ativar este.', p.max_celulares
        using errcode = 'P0001';
    end if;
  elsif n >= p.max_devices then
    raise exception 'Limite de % TV(s) atingido. Remova uma TV no painel para ativar esta.', p.max_devices
      using errcode = 'P0001';
  end if;

  update public.activation_codes set claimed_at = now() where code = c.code;
  update public.devices set user_id = v_uid where id = c.device_id;
  return json_build_object('ok', true, 'device_id', c.device_id);
end;
$$;
```

- [ ] **Step 2: Acrescentar as verificações ao `scripts/ott-smoke.mjs`**

Logo antes da linha `console.log(failed ? ...` (resumo final), inserir:

```js
// 8. Celular: aparelho próprio, com limite separado do das TVs
const cel = await rpc('device_start', { p_modelo: 'Celular Smoke', p_sistema: 'Android', p_tipo: 'celular' });
check('device_start aceita p_tipo=celular', cel.status === 200 && /^[A-Z]{4}-\d{4}$/.test(cel.data.code || ''), `código ${cel.data.code}`);
const celClaim = await rpc('device_claim', { p_code: cel.data.code }, jwt);
check('device_claim vincula o celular', celClaim.status === 200 && celClaim.data.ok === true, JSON.stringify(celClaim.data));
const celCfg = await rpc('device_config', { p_token: cel.data.device_token });
check('celular vinculado recebe a configuração da conta', ['ok', 'expired', 'blocked'].includes(celCfg.data.status), `status ${celCfg.data.status}`);
const devs = await fetch(`${URL_BASE}/rest/v1/devices?select=modelo,tipo&modelo=eq.Celular%20Smoke`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
}).then((r) => r.json());
check('o aparelho foi gravado como celular', Array.isArray(devs) && devs.length > 0 && devs[0].tipo === 'celular');
const celUnlink = await rpc('device_unlink', { p_token: cel.data.device_token });
check('device_unlink apaga o celular', celUnlink.status === 200 && celUnlink.data.ok === true);

// 9. TV antiga (2 parâmetros) continua funcionando e vira tipo 'tv'
const tvOld = await rpc('device_start', { p_modelo: 'TV Antiga Smoke', p_sistema: 'node' });
check('device_start com 2 parâmetros continua valendo', tvOld.status === 200 && /^[A-Z]{4}-\d{4}$/.test(tvOld.data.code || ''));
await rpc('device_unlink', { p_token: tvOld.data.device_token });
```

- [ ] **Step 3: Aplicar a migração no Supabase real**

Run: `npm run ott:setup`
Expected: roda `supabase/migrations/*.sql` em ordem (idempotente) e termina sem erro; **não imprime chaves**. Se o projeto "sintoniza-ott" já existe, ele só reaplica as migrações.

- [ ] **Step 4: Rodar a verificação ponta a ponta**

Run: `npm run ott:smoke`
Expected: todas as linhas `OK` (as antigas e as novas) e `[ott] Tudo certo.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_ott_celular.sql scripts/ott-smoke.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(backend): celular como aparelho da conta (tipo e limite próprio)"
```

---

### Task B2: Painel mostra celulares e seus limites

**Files:**
- Modify: `panel/src/types.ts` (tipos `Profile` e `Device`)
- Modify: `panel/src/pages/AccountPage.tsx`
- Modify: `panel/src/pages/AdminPage.tsx`
- Modify: `panel/src/pages/ActivatePage.tsx` (textos "TV" → "aparelho")

- [ ] **Step 1: Tipos**

Em `panel/src/types.ts`, no tipo `Profile` acrescentar `max_celulares?: number;` e no tipo `Device` acrescentar `tipo?: 'tv' | 'celular';`.

- [ ] **Step 2: Página "Minha conta"** (`AccountPage.tsx`)

Trocar a consulta (acrescenta `tipo`):

```tsx
        `/rest/v1/devices?select=id,modelo,sistema,tipo,ativo,ultimo_acesso,created_at&user_id=eq.${profile.id}&order=created_at.asc`
```

Trocar `removeDevice` pelo texto genérico:

```tsx
    if (!window.confirm('Remover este aparelho? Ele volta para a tela do código.')) return;
```

Trocar `const activeCount = devices.filter((d) => d.ativo).length;` por:

```tsx
  const activeTvs = devices.filter((d) => d.ativo && d.tipo !== 'celular').length;
  const activeCels = devices.filter((d) => d.ativo && d.tipo === 'celular').length;
  const maxCels = profile.max_celulares ?? 3;
```

Trocar o cabeçalho do cartão "Minhas TVs" (o `<div className="flex items-center justify-between">` com `<h2>` e o contador) por:

```tsx
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Meus aparelhos</h2>
          <span className="text-sm text-slate-400">
            TVs {activeTvs} de {profile.max_devices} · Celulares {activeCels} de {maxCels}
          </span>
        </div>
```

Trocar o texto vazio por `Nenhum aparelho ativado ainda. Use "Ativar" com o código que aparece na tela da TV ou do celular.` e o nome de cada linha por:

```tsx
                  <p className="font-medium truncate">
                    {d.tipo === 'celular' ? 'Celular' : 'TV'} · {d.modelo || (d.tipo === 'celular' ? 'Celular' : 'TV')}{' '}
                    {!d.ativo && <span className="text-xs text-red-300">(desativado)</span>}
                  </p>
```

- [ ] **Step 3: Admin** (`AdminPage.tsx`)

Duplicar o bloco do contador/botões `−`/`+` de TVs (o que usa `p.max_devices`, `MAX_TVS_LIMIT` e `patchProfile(p, { max_devices: ... })`, linhas ~188–212) para os celulares: mesma estrutura, trocando `max_devices` → `max_celulares`, a constante `MAX_TVS_LIMIT` → nova `MAX_CELULARES_LIMIT = 10`, as chaves `k('menos')`/`k('mais')` → `k('cel-menos')`/`k('cel-mais')`, o contador para `{celulares.filter((d) => d.ativo).length} de {p.max_celulares ?? 3}` e o rótulo para "Celulares". Onde a lista de aparelhos do usuário filtra `tvs`, criar `const celulares = devices.filter((d) => d.tipo === 'celular')` e `tvs = devices.filter((d) => d.tipo !== 'celular')`, e mostrar na lista de cada um o prefixo `Celular`/`TV`. Na consulta de aparelhos do admin (linha ~27) acrescentar `tipo` ao `select`.

- [ ] **Step 3b: Página de ativação** (`ActivatePage.tsx`)

Trocar os textos que dizem "TV" para "aparelho" (título "Ativar aparelho", ajuda "Digite o código que aparece na tela do aparelho", mensagem de sucesso "Aparelho ativado!"). A página já aceita `?codigo=ABCD-1234` (é o que o QR da TV usa); o celular usa o mesmo link.

- [ ] **Step 4: Compilar e testar**

Run: `npx tsc --noEmit -p . && npm test && npm run build:panel`
Expected: sem erro de tipo; testes passam; build do painel gerado em `dist-panel/`.

- [ ] **Step 5: Commit**

```bash
git add panel/src
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(painel): aparelhos TV e celular com limites separados"
```

---

### Task B3: Painel publica `app-config.json` e vai ao ar

**Files:**
- Create: `scripts/lib/app-config.mjs`
- Test: `tests/app-config.test.ts`
- Modify: `scripts/deploy-panel.mjs`
- Modify: `panel/public/_headers`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```ts
// Configuração pública do backend que o app de celular busca em /app-config.json
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAppConfig } from '../scripts/lib/app-config.mjs';

test('monta url, chave pública e endereço do painel', () => {
  const cfg = buildAppConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_ANON_KEY: ' abc ', VITE_OTT_PANEL_URL: 'https://sintonizatv.com.br/' });
  assert.deepEqual(cfg, { url: 'https://x.supabase.co', anonKey: 'abc', panelUrl: 'https://sintonizatv.com.br' });
});

test('sem o endereço do painel usa o domínio padrão', () => {
  const cfg = buildAppConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'abc' });
  assert.equal(cfg?.panelUrl, 'https://sintonizatv.com.br');
});

test('sem url ou sem chave devolve null (o deploy deve falhar)', () => {
  assert.equal(buildAppConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.equal(buildAppConfig({ VITE_SUPABASE_ANON_KEY: 'abc' }), null);
  assert.equal(buildAppConfig({ VITE_SUPABASE_URL: 'http://inseguro.com', VITE_SUPABASE_ANON_KEY: 'abc' }), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test tests/app-config.test.ts`
Expected: FAIL (`Cannot find module '.../scripts/lib/app-config.mjs'`).

- [ ] **Step 3: Implementar**

`scripts/lib/app-config.mjs`:

```js
// Configuração pública do backend para o app de celular (publicada em /app-config.json pelo painel).
// A chave "anon" é a mesma que todo cliente já usa (o painel a leva no JavaScript); ela só vai para o
// site no deploy, nunca para o repositório.
export function buildAppConfig(env) {
  const url = String((env && env.VITE_SUPABASE_URL) || '').trim().replace(/\/+$/, '');
  const anonKey = String((env && env.VITE_SUPABASE_ANON_KEY) || '').trim();
  if (!/^https:\/\//.test(url) || !anonKey) return null;
  const panelUrl = String((env && env.VITE_OTT_PANEL_URL) || '').trim().replace(/\/+$/, '') || 'https://sintonizatv.com.br';
  return { url, anonKey, panelUrl };
}
```

Em `scripts/deploy-panel.mjs`, trocar o início e o miolo por:

```js
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { buildAppConfig } from './lib/app-config.mjs';

const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT || 'sintoniza-tv';
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('[deploy] Faltam CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID no .env.ott.local.');
  process.exit(1);
}
const appConfig = buildAppConfig(process.env);
if (!appConfig) {
  console.error('[deploy] Faltam VITE_SUPABASE_URL (https) e VITE_SUPABASE_ANON_KEY no .env.ott.local.');
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env: process.env });

run('npx vite build --config panel/vite.config.ts --mode ott');
// Configuração pública do backend, lida pelo app de celular
writeFileSync('dist-panel/app-config.json', JSON.stringify(appConfig));
// wrangler: ferramenta oficial da Cloudflare, via npx (sem instalação global)
run(`npx -y wrangler@latest pages deploy dist-panel --project-name ${PROJECT} --branch main --commit-dirty=true`);
console.log(`[deploy] Painel publicado: https://${PROJECT}.pages.dev`);
```

Em `panel/public/_headers`, acrescentar no fim (linha em branco antes):

```
/app-config.json
  Access-Control-Allow-Origin: *
  Cache-Control: no-cache
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test tests/app-config.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Publicar o painel e conferir o arquivo**

Run: `npm run deploy:panel`
Depois: `curl -s https://sintonizatv.com.br/app-config.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log('chaves:',Object.keys(c).join(','),'| url https:',/^https:/.test(c.url),'| anonKey presente:',c.anonKey.length>20)})"`
Expected: `chaves: url,anonKey,panelUrl | url https: true | anonKey presente: true` (**sem imprimir a chave**). Conferir também `curl -sI https://sintonizatv.com.br/app-config.json | grep -i "access-control"`.

- [ ] **Step 6: Commit e merge de volta**

```bash
git add scripts/lib/app-config.mjs tests/app-config.test.ts scripts/deploy-panel.mjs panel/public/_headers
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(painel): publica app-config.json para o app de celular"
```

---

# PARTE 2 — App de celular (repositório `visual-craft-assistant`, branch `v10`)

Todos os testes novos ficam em `tests/ott/`. Antes da M1, criar o carregador de teste:

**Files:**
- Create: `tests/ott/loadOtt.js`

```js
// Carrega os scripts embutidos "qrcodegen" e "ott-core" do sintoniza-link.html num contexto isolado.
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Objetos que saem do contexto vm têm outros protótipos; o teste compara como JSON.
export const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function loadOtt() {
  const ctx = vm.createContext({ URL, URLSearchParams, JSON, Date, Math, Promise, Error, setTimeout, clearTimeout, console });
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "qrcodegen"), ctx);
  vm.runInContext(
    extractInlineScriptById(LINK_HTML_PATH, "ott-core") +
      `\n;this.__ott = { OTT_KEYS, OTT_LIST_KEYS, OTT_PANEL_URL, OTT_OFFLINE_GRACE_MS, ottParseConfig, ottLoadConfig, ottDetectDevice,
        ottParseDeviceConfig, ottApplyPlaylist, ottWithinGrace, ottParseIsoMs, ottFormatDateBr, ottDaysLeft, ottFormatCountdown,
        ottCallRpc, ottDeviceStart, ottDeviceConfig, ottDeviceUnlink, ottActivationLink, ottQrSvgPath, ottDecide, ottAccountSummary };`,
    ctx
  );
  return ctx.__ott;
}

// Armazenamento falso (localStorage)
export function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

// fetch falso: responde com o corpo dado (objeto vira JSON)
export function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  f.calls = calls;
  return f;
}
```

### Task M1: Módulo `ott-core` (lógica pura) + gerador de QR

**Files:**
- Modify: `sintoniza-link.html` (dois `<script>` novos **depois** do bloco `epg-helpers` e **antes** do script principal — o carregador de testes usa o **último** script embutido como principal)
- Test: `tests/ott/ott-core.test.js`, `tests/ott/qr.test.js`

- [ ] **Step 1: Gerar o `qrcodegen` como script clássico**

```bash
mkdir -p "$TEMP/qr" && cd /c/Users/guait/Documents/Novo-App-de-TV \
 && git show app-tv-ott-ativacao:src/vendor/qrcodegen.ts > "$TEMP/qr/qrcodegen.ts" \
 && npx tsc --ignoreConfig "$TEMP/qr/qrcodegen.ts" --outDir "$TEMP/qr/out" --target ES2017 --module commonjs --removeComments
```

Expected: cria `$TEMP/qr/out/qrcodegen.js` (~26 KB). No `sintoniza-link.html`, inserir **antes** do script `ott-core`:

```html
<!-- Gerador de QR code (qrcodegen, MIT; compilado do código da TV). Só desenha, nada sai do aparelho. -->
<script id="qrcodegen">
var exports = {};
/* …conteúdo de qrcodegen.js SEM a linha "use strict" do começo… */
var qrcodegen = exports.qrcodegen;
</script>
```

- [ ] **Step 2: Escrever os testes (devem falhar)**

`tests/ott/qr.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain } from "./loadOtt.js";

test("o link de ativação leva ao painel com o código preenchido", () => {
  const o = loadOtt();
  assert.equal(o.ottActivationLink("https://sintonizatv.com.br/", "ABCD-1234"), "https://sintonizatv.com.br?codigo=ABCD-1234");
  assert.equal(o.ottActivationLink("sintonizatv.com.br", "ABCD-1234"), "https://sintonizatv.com.br?codigo=ABCD-1234");
  assert.equal(o.ottActivationLink("", "ABCD-1234"), "");
  assert.equal(o.ottActivationLink("https://x.com", ""), "");
});

test("o QR sai como um único caminho SVG", () => {
  const o = loadOtt();
  const qr = plain(o.ottQrSvgPath("https://sintonizatv.com.br?codigo=ABCD-1234"));
  assert.ok(qr.size >= 21 && qr.size <= 57);
  assert.match(qr.path, /^M\d+ \d+h1v1h-1z/);
  assert.deepEqual(plain(o.ottQrSvgPath("")), { size: 0, path: "" });
});
```

`tests/ott/ott-core.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadOtt, plain, fakeStorage, fakeFetch, LINK_HTML_PATH } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };

test("configuração do backend: só https e com chave; endereço do painel tem padrão", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottParseConfig({ url: "https://x.supabase.co/", anonKey: " k ", panelUrl: "https://p.com/" })), { url: "https://x.supabase.co", anonKey: "k", panelUrl: "https://p.com" });
  assert.equal(plain(o.ottParseConfig({ url: "https://x.supabase.co", anonKey: "k" })).panelUrl, "https://sintonizatv.com.br");
  assert.equal(o.ottParseConfig({ url: "http://x.com", anonKey: "k" }), null);
  assert.equal(o.ottParseConfig({ url: "https://x.com" }), null);
  assert.equal(o.ottParseConfig(null), null);
});

test("busca a configuração no painel e guarda; sem internet usa a guardada", async () => {
  const o = loadOtt();
  const storage = fakeStorage();
  const online = fakeFetch(() => ({ body: { url: "https://x.supabase.co", anonKey: "k" } }));
  const a = plain(await o.ottLoadConfig(storage, online));
  assert.equal(a.url, "https://x.supabase.co");
  assert.ok(online.calls[0].url.endsWith("/app-config.json"));
  const offline = fakeFetch(() => { throw new Error("sem rede"); });
  assert.equal(plain(await o.ottLoadConfig(storage, offline)).anonKey, "k");
  assert.equal(await o.ottLoadConfig(fakeStorage(), offline), null);
});

test("detecta o aparelho: celular iPhone, Android ou navegador", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "ios")), { modelo: "iPhone", sistema: "iOS", tipo: "celular" });
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (iPad; CPU OS 17_0)", "")), { modelo: "iPad", sistema: "iOS", tipo: "celular" });
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)", "android")), { modelo: "Celular Android", sistema: "Android", tipo: "celular" });
  assert.deepEqual(plain(o.ottDetectDevice("Mozilla/5.0 (Windows NT 10.0)", "")), { modelo: "Navegador", sistema: "Web", tipo: "celular" });
});

test("interpreta device_config sem confiar no formato", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "pending", code: "ABCD-1234", expires_at: "2026-10-02T10:00:00Z", poll_seconds: 5 })), { status: "pending", code: "ABCD-1234", expiresAt: "2026-10-02T10:00:00Z", pollSeconds: 5 });
  const ok = plain(o.ottParseDeviceConfig({ status: "ok", user: { nome: "Ana", status: "trial", trial_fim: "2026-10-09T00:00:00Z" }, playlists: [{ id: "1", nome: "Principal", url_m3u: "http://a/m3u", url_vod: "http://a/vod" }, { id: "2", url_m3u: "" }] }));
  assert.equal(ok.status, "ok");
  assert.equal(ok.playlists.length, 1);
  assert.equal(ok.account.trial_fim, "2026-10-09T00:00:00Z");
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "expired", trial_fim: "2026-10-01T00:00:00Z" })), { status: "expired", trialFim: "2026-10-01T00:00:00Z" });
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "unknown_device" })), { status: "unknown_device" });
  assert.deepEqual(plain(o.ottParseDeviceConfig(null)), { status: "invalid" });
  assert.deepEqual(plain(o.ottParseDeviceConfig({ status: "pending" })), { status: "invalid" });
});

test("grava e limpa as listas nas chaves que o app já usa", () => {
  const o = loadOtt();
  const s = fakeStorage();
  assert.equal(o.ottApplyPlaylist(s, { url_m3u: "http://a/m3u", url_vod: "http://a/vod", url_epg: null }), true);
  assert.equal(s.getItem("sint_url"), "http://a/m3u");
  assert.equal(s.getItem("sint_mode"), "url");
  assert.equal(s.getItem("sint_vod_url"), "http://a/vod");
  assert.equal(s.getItem("sint_epg_url"), null);
  assert.equal(o.ottApplyPlaylist(s, { url_m3u: "http://a/m3u", url_vod: "http://a/vod", url_epg: null }), false); // nada mudou
  assert.equal(o.ottApplyPlaylist(s, null), true);
  assert.equal(s.getItem("sint_url"), null);
  assert.equal(s.getItem("sint_vod_url"), null);
});

test("as chaves de lista do ott-core são as mesmas do app (LS)", () => {
  const o = loadOtt();
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  const ls = html.match(/const LS = \{([^}]*)\}/)[1];
  const val = (name) => ls.match(new RegExp(`${name}:\\s*"([^"]+)"`))[1];
  const k = plain(o.OTT_LIST_KEYS);
  assert.equal(k.URL, val("URL"));
  assert.equal(k.MODE, val("MODE"));
  assert.equal(k.VOD, val("VOD_URL"));
  assert.equal(k.EPG, val("EPG_URL"));
  assert.equal(k.EPG_CACHE, val("EPG_CACHE"));
});

test("datas do Postgres com 6 casas de fração, dd/mm/aaaa e dias restantes", () => {
  const o = loadOtt();
  assert.equal(o.ottParseIsoMs("2026-10-09T15:12:45.123456+00:00"), Date.UTC(2026, 9, 9, 15, 12, 45, 123));
  assert.equal(o.ottParseIsoMs("lixo"), 0);
  assert.equal(o.ottFormatDateBr("2026-10-09T12:00:00Z"), "09/10/2026");
  assert.equal(o.ottFormatDateBr(""), "");
  const fim = "2026-10-09T12:00:00Z";
  assert.equal(o.ottDaysLeft(fim, Date.UTC(2026, 9, 2, 12, 0, 0)), 7);
  assert.equal(o.ottDaysLeft(fim, Date.UTC(2026, 9, 9, 6, 0, 0)), 1);
  assert.equal(o.ottDaysLeft(fim, Date.UTC(2026, 9, 12, 0, 0, 0)), 0);
  assert.equal(o.ottFormatCountdown(125000), "02:05");
});

test("tolerância sem internet: 48 h desde a última validação", () => {
  const o = loadOtt();
  const agora = 1_000_000_000_000;
  assert.equal(o.ottWithinGrace(agora - 47 * 3600e3, agora, o.OTT_OFFLINE_GRACE_MS), true);
  assert.equal(o.ottWithinGrace(agora - 49 * 3600e3, agora, o.OTT_OFFLINE_GRACE_MS), false);
  assert.equal(o.ottWithinGrace(0, agora, o.OTT_OFFLINE_GRACE_MS), false);
});

test("chamada RPC: cabeçalhos, corpo, erro do servidor e rede", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { ok: true } }));
  assert.deepEqual(plain(await o.ottCallRpc(cfg, "device_config", { p_token: "t" }, f)), { ok: true });
  assert.equal(f.calls[0].url, "https://x.supabase.co/rest/v1/rpc/device_config");
  assert.equal(f.calls[0].init.headers.apikey, "chave");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer chave");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_token: "t" });
  const erro = fakeFetch(() => ({ status: 400, body: { message: "Código inválido" } }));
  await assert.rejects(o.ottCallRpc(cfg, "x", {}, erro), /Código inválido/);
  const rede = fakeFetch(() => { throw new Error("falhou"); });
  await assert.rejects(o.ottCallRpc(cfg, "x", {}, rede), /Sem conexão/);
});

test("device_start do celular manda modelo, sistema e tipo 'celular'", async () => {
  const o = loadOtt();
  const f = fakeFetch(() => ({ body: { device_token: "tok", code: "ABCD-1234", expires_at: "2026-10-02T10:15:00Z", poll_seconds: 5 } }));
  const r = plain(await o.ottDeviceStart(cfg, { modelo: "iPhone", sistema: "iOS", tipo: "celular" }, f));
  assert.deepEqual(r, { token: "tok", code: "ABCD-1234", expiresAt: "2026-10-02T10:15:00Z", pollSeconds: 5 });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_modelo: "iPhone", p_sistema: "iOS", p_tipo: "celular" });
  const vazio = fakeFetch(() => ({ body: {} }));
  await assert.rejects(o.ottDeviceStart(cfg, { modelo: "x", sistema: "y", tipo: "celular" }, vazio), /inesperada/);
});

test("decisão da tela a partir da resposta do servidor", () => {
  const o = loadOtt();
  const agora = 1_000_000_000_000;
  const d = (args) => plain(o.ottDecide({ lastOkMs: 0, nowMs: agora, ...args }));
  assert.equal(d({ config: { status: "ok", account: { nome: "Ana" }, playlists: [] } }).screen, "ok");
  assert.deepEqual(d({ config: { status: "pending", code: "ABCD-1234", expiresAt: "x", pollSeconds: 5 } }), { screen: "activation", code: "ABCD-1234", expiresAt: "x", pollSeconds: 5 });
  assert.deepEqual(d({ config: { status: "expired", trialFim: "2026-10-01T00:00:00Z" } }), { screen: "blocked", kind: "expired", trialFim: "2026-10-01T00:00:00Z" });
  assert.equal(d({ config: { status: "blocked", trialFim: null } }).kind, "blocked");
  assert.equal(d({ config: { status: "unknown_device" } }).screen, "restart");
  assert.equal(d({ config: { status: "device_blocked" } }).screen, "device_blocked");
  assert.equal(d({ config: { status: "invalid" } }).screen, "offline");
  // sem internet: dentro de 48 h do último ok segue funcionando; depois mostra "sem conexão"
  assert.deepEqual(d({ error: "rede", lastOkMs: agora - 3600e3 }), { screen: "ok", offline: true });
  assert.equal(d({ error: "rede", lastOkMs: agora - 72 * 3600e3 }).screen, "offline");
  assert.equal(d({ error: "rede", lastOkMs: 0 }).screen, "offline");
});

test("resumo da conta: teste de 7 dias, assinatura e prazo", () => {
  const o = loadOtt();
  const agora = Date.UTC(2026, 9, 2, 12, 0, 0);
  assert.deepEqual(plain(o.ottAccountSummary({ nome: "Ana", status: "trial", trial_fim: "2026-10-09T12:00:00Z" }, agora)), { tone: "ok", text: "Teste gratuito: restam 7 dias (até 09/10/2026)" });
  assert.equal(plain(o.ottAccountSummary({ nome: "Ana", status: "trial", trial_fim: "2026-10-03T00:00:00Z" }, agora)).text, "Teste gratuito: resta 1 dia (até 03/10/2026)");
  assert.equal(plain(o.ottAccountSummary({ nome: "Ana", status: "active", acesso_fim: null }, agora)).text, "Assinatura ativa (sem prazo)");
  assert.equal(plain(o.ottAccountSummary({ nome: "Ana", status: "active", acesso_fim: "2026-12-01T12:00:00Z" }, agora)).text, "Assinatura ativa até 01/12/2026");
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/ott/`
Expected: FAIL (`No <script id="qrcodegen"/"ott-core"> found`).

- [ ] **Step 4: Implementar o `ott-core`**

No `sintoniza-link.html`, logo depois do `<script id="qrcodegen">`, e antes do script principal:

```html
<script id="ott-core">
// Conta Sintoniza no celular: ativação do aparelho por código (como a TV) e listas liberadas pela conta.
// Mesmo contrato da TV: Supabase RPC device_start / device_config / device_unlink.
// Funções puras e fetch injetável: testadas no Node (tests/ott/). A tela fica no script principal.
const OTT_PANEL_URL = "https://sintonizatv.com.br";
const OTT_CONFIG_URL = OTT_PANEL_URL + "/app-config.json";
const OTT_KEYS = { TOKEN: "sint_ott_token", LAST_OK: "sint_ott_last_ok", ACCOUNT: "sint_ott_account", CONFIG: "sint_ott_config" };
// Mesmos valores de LS no script principal (um teste confere)
const OTT_LIST_KEYS = { URL: "sint_url", MODE: "sint_mode", VOD: "sint_vod_url", EPG: "sint_epg_url", EPG_CACHE: "sint_epg_cache" };
const OTT_OFFLINE_GRACE_MS = 48 * 3600 * 1000;
const OTT_REVALIDATE_MS = 6 * 3600 * 1000;
const OTT_RPC_TIMEOUT_MS = 15000;
const OTT_MSG_NETWORK = "Sem conexão com o servidor Sintoniza. Verifique a internet do aparelho.";

function ottStr(v) {
  return typeof v === "string" ? v : "";
}

// Configuração pública do backend (vem do painel; a chave não fica no código do app)
function ottParseConfig(data) {
  if (!data || typeof data !== "object") return null;
  const url = ottStr(data.url).trim().replace(/\/+$/, "");
  const anonKey = ottStr(data.anonKey).trim();
  if (!/^https:\/\//.test(url) || !anonKey) return null;
  const panelUrl = ottStr(data.panelUrl).trim().replace(/\/+$/, "") || OTT_PANEL_URL;
  return { url, anonKey, panelUrl };
}

function ottFetchJson(url, doFetch, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(OTT_MSG_NETWORK)), timeoutMs);
    Promise.resolve()
      .then(() => doFetch(url, { cache: "no-store" }))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
      .then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// Busca a configuração no painel e guarda; sem internet usa a última guardada (null se nunca teve)
async function ottLoadConfig(storage, fetchImpl) {
  const doFetch = fetchImpl || ((u, i) => fetch(u, i));
  try {
    const cfg = ottParseConfig(await ottFetchJson(OTT_CONFIG_URL, doFetch, 8000));
    if (cfg) {
      storage.setItem(OTT_KEYS.CONFIG, JSON.stringify(cfg));
      return cfg;
    }
  } catch (e) { /* sem internet: cai para a configuração guardada */ }
  try {
    return ottParseConfig(JSON.parse(storage.getItem(OTT_KEYS.CONFIG) || "null"));
  } catch (e) {
    return null;
  }
}

// Modelo e sistema do aparelho (vão para a lista de aparelhos do painel). Sempre do tipo "celular".
function ottDetectDevice(ua, platform) {
  const p = String(platform || "").toLowerCase();
  if (/iphone|ipad|ipod/i.test(ua) || p === "ios") return { modelo: /ipad/i.test(ua) ? "iPad" : "iPhone", sistema: "iOS", tipo: "celular" };
  if (/android/i.test(ua) || p === "android") return { modelo: "Celular Android", sistema: "Android", tipo: "celular" };
  return { modelo: "Navegador", sistema: "Web", tipo: "celular" };
}

// Interpreta a resposta de device_config sem confiar no formato
function ottParseDeviceConfig(data) {
  if (!data || typeof data !== "object") return { status: "invalid" };
  switch (data.status) {
    case "pending":
      if (!ottStr(data.code)) return { status: "invalid" };
      return { status: "pending", code: data.code, expiresAt: ottStr(data.expires_at), pollSeconds: Number(data.poll_seconds) > 0 ? Number(data.poll_seconds) : 5 };
    case "ok": {
      const u = data.user || {};
      const lists = (Array.isArray(data.playlists) ? data.playlists : [])
        .filter((l) => l && ottStr(l.url_m3u))
        .map((l) => ({ id: ottStr(l.id), nome: ottStr(l.nome) || "Principal", url_m3u: l.url_m3u, url_vod: ottStr(l.url_vod) || null, url_epg: ottStr(l.url_epg) || null }));
      return {
        status: "ok",
        account: { nome: ottStr(u.nome), status: ottStr(u.status), trial_fim: ottStr(u.trial_fim) || null, acesso_fim: ottStr(u.acesso_fim) || null },
        playlists: lists,
      };
    }
    case "expired":
    case "blocked":
      return { status: data.status, trialFim: ottStr(data.trial_fim) || null };
    case "device_blocked":
    case "unknown_device":
      return { status: data.status };
    default:
      return { status: "invalid" };
  }
}

// Grava os links liberados nas chaves que o app já usa; null limpa. true = mudou algo.
function ottApplyPlaylist(storage, playlist) {
  const wanted = [
    [OTT_LIST_KEYS.URL, playlist ? playlist.url_m3u : null],
    [OTT_LIST_KEYS.MODE, playlist ? "url" : null],
    [OTT_LIST_KEYS.VOD, playlist ? playlist.url_vod : null],
    [OTT_LIST_KEYS.EPG, playlist ? playlist.url_epg : null],
  ];
  let changed = false;
  wanted.forEach(([key, value]) => {
    const current = storage.getItem(key);
    if (value) {
      if (current !== value) { storage.setItem(key, value); changed = true; }
    } else if (current !== null) {
      storage.removeItem(key);
      changed = true;
    }
  });
  if (changed) storage.removeItem(OTT_LIST_KEYS.EPG_CACHE); // guia antigo não vale para a lista nova
  return changed;
}

function ottWithinGrace(lastOkMs, nowMs, graceMs) {
  return lastOkMs > 0 && nowMs - lastOkMs <= graceMs;
}

// Datas ISO do Postgres ("2026-09-26T15:12:45.123456+00:00"): 0 = inválida
function ottParseIsoMs(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return 0;
  const ms = m[7] ? Number((m[7] + "00").slice(0, 3)) : 0;
  let utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms);
  const tz = m[8];
  if (tz && tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    utc -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60000;
  }
  return utc;
}

function ottFormatDateBr(iso) {
  const ms = ottParseIsoMs(iso);
  if (!ms) return "";
  const d = new Date(ms);
  const two = (n) => (n < 10 ? "0" : "") + n;
  return two(d.getDate()) + "/" + two(d.getMonth() + 1) + "/" + d.getFullYear();
}

// Dias que faltam até a data (arredonda para cima; 0 se já passou)
function ottDaysLeft(iso, nowMs) {
  const ms = ottParseIsoMs(iso);
  if (!ms) return 0;
  return Math.max(0, Math.ceil((ms - nowMs) / 86400000));
}

function ottFormatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

// POST numa função RPC do Supabase, com tempo-limite e mensagens em português
function ottCallRpc(cfg, name, body, fetchImpl) {
  const doFetch = fetchImpl || ((u, i) => fetch(u, i));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    timer = setTimeout(() => finish(() => reject(new Error(OTT_MSG_NETWORK))), OTT_RPC_TIMEOUT_MS);
    let request;
    try {
      request = doFetch(cfg.url + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      finish(() => reject(new Error(OTT_MSG_NETWORK)));
      return;
    }
    request.then(
      (res) => res.text().then(
        (text) => {
          let data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (res.ok) finish(() => resolve(data));
          else finish(() => reject(new Error(data && typeof data.message === "string" ? data.message : "Erro do servidor (" + res.status + ").")));
        },
        () => finish(() => reject(new Error(OTT_MSG_NETWORK)))
      ),
      () => finish(() => reject(new Error(OTT_MSG_NETWORK)))
    );
  });
}

// Aparelho novo: cria o dispositivo e recebe o token (uma única vez) e o código
async function ottDeviceStart(cfg, info, fetchImpl) {
  const data = await ottCallRpc(cfg, "device_start", { p_modelo: info.modelo, p_sistema: info.sistema, p_tipo: info.tipo }, fetchImpl);
  if (!data || !ottStr(data.device_token) || !ottStr(data.code)) throw new Error("Resposta inesperada do servidor ao gerar o código.");
  return { token: data.device_token, code: data.code, expiresAt: ottStr(data.expires_at), pollSeconds: Number(data.poll_seconds) > 0 ? Number(data.poll_seconds) : 5 };
}

async function ottDeviceConfig(cfg, token, fetchImpl) {
  return ottParseDeviceConfig(await ottCallRpc(cfg, "device_config", { p_token: token }, fetchImpl));
}

// "Desvincular este aparelho": apaga o dispositivo no servidor (libera a vaga no limite)
async function ottDeviceUnlink(cfg, token, fetchImpl) {
  await ottCallRpc(cfg, "device_unlink", { p_token: token }, fetchImpl);
}

// https://<painel>?codigo=ABCD-1234 ('' se faltar o painel ou o código)
function ottActivationLink(panelUrl, code) {
  const base = String(panelUrl || "").trim().replace(/\/+$/, "");
  if (!base || !code) return "";
  const withScheme = /^https?:\/\//i.test(base) ? base : "https://" + base;
  return withScheme + "?codigo=" + encodeURIComponent(code);
}

// Matriz do QR como um único <path> SVG (um quadrado 1x1 por módulo escuro)
function ottQrSvgPath(text) {
  if (!text) return { size: 0, path: "" };
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  let path = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) path += "M" + x + " " + y + "h1v1h-1z";
    }
  }
  return { size: qr.size, path };
}

// O que a tela deve fazer com a resposta do servidor (ou com o erro de rede)
function ottDecide({ config, error, lastOkMs, nowMs }) {
  if (error) {
    return ottWithinGrace(lastOkMs, nowMs, OTT_OFFLINE_GRACE_MS) ? { screen: "ok", offline: true } : { screen: "offline", message: error };
  }
  switch (config.status) {
    case "ok": return { screen: "ok", account: config.account, playlists: config.playlists };
    case "pending": return { screen: "activation", code: config.code, expiresAt: config.expiresAt, pollSeconds: config.pollSeconds };
    case "expired":
    case "blocked": return { screen: "blocked", kind: config.status, trialFim: config.trialFim };
    case "device_blocked": return { screen: "device_blocked" };
    case "unknown_device": return { screen: "restart" };
    default: return { screen: "offline", message: "Resposta inesperada do servidor." };
  }
}

// Texto da conta nas Configurações (teste de 7 dias, assinatura e prazo)
function ottAccountSummary(account, nowMs) {
  const a = account || {};
  if (a.status === "active") {
    return { tone: "ok", text: a.acesso_fim ? "Assinatura ativa até " + ottFormatDateBr(a.acesso_fim) : "Assinatura ativa (sem prazo)" };
  }
  if (a.status === "trial" && a.trial_fim) {
    const dias = ottDaysLeft(a.trial_fim, nowMs);
    return { tone: "ok", text: "Teste gratuito: " + (dias === 1 ? "resta 1 dia" : "restam " + dias + " dias") + " (até " + ottFormatDateBr(a.trial_fim) + ")" };
  }
  return { tone: "bad", text: "Acesso encerrado" };
}
</script>
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/ott/ && npm test`
Expected: PASS (todos; o teste de paridade confere `OTT_LIST_KEYS` com `LS`).

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/ott
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(conta): módulo ott-core (ativação por código, listas da conta) e QR code"
```

---

### Task M2: Tela de ativação (código, QR, botão que abre a página) e bloqueio

**Files:**
- Modify: `sintoniza-link.html` (script de 1 linha no `<head>`; CSS; HTML `#ott-gate` logo depois de `<body>`; controlador no script principal)
- Test: `tests/ott/gate-markup.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("a tela de ativação tem código, QR, botão de abrir a página, contagem e novo código", () => {
  for (const id of ["ott-gate", "ott-code", "ott-qr", "ott-open-panel", "ott-copy-code", "ott-timer", "ott-new-code", "ott-blocked-title", "ott-blocked-detail", "ott-retry", "ott-offline-msg"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  for (const screen of ["loading", "activation", "blocked", "offline", "device_blocked"]) {
    assert.match(html, new RegExp(`data-ott-screen="${screen}"`), `falta a tela ${screen}`);
  }
});

test("o botão abre a página de ativação fora do app (target=_blank, sem plugin novo)", () => {
  assert.match(html, /<a[^>]*id="ott-open-panel"[^>]*target="_blank"[^>]*rel="noopener"/);
});

test("a tela cobre o app logo ao abrir (sem piscar o app antes da conta)", () => {
  assert.match(html, /<script>\(function \(\)\{try\{var q=location\.search[^<]*ott-open[^<]*<\/script>/);
  assert.match(html, /html\.ott-open #ott-gate \{ display: flex; \}/);
});

test("o texto de encerramento é o mesmo da TV", () => {
  assert.match(html, /Seu período de acesso terminou/);
  assert.match(html, /Encerrado em/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ott/gate-markup.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar — `<head>` (evita o app piscar antes da conta)**

Logo no começo do `<head>` (antes dos `<link>` e `<script src>` externos):

```html
  <script>(function(){try{var q=location.search;if(q.indexOf("noott")!==-1)return;var C=window.Capacitor;if((C&&C.isNativePlatform&&C.isNativePlatform())||location.protocol==="capacitor:"||q.indexOf("ott")!==-1)document.documentElement.classList.add("ott-open");}catch(e){}})();</script>
```

- [ ] **Step 4: Implementar — CSS** (dentro do `<style>`, no fim)

```css
    /* ════════════ CONTA SINTONIZA (ativação) ════════════ */
    #ott-gate {
      display: none; position: fixed; inset: 0; z-index: 2147483000;
      align-items: center; justify-content: center; padding: 1.25rem;
      background: #08080D; color: #F3F4F6; font-family: "Outfit", system-ui, sans-serif;
      overflow-y: auto;
    }
    html.ott-open #ott-gate { display: flex; }
    html.ott-open body > *:not(#ott-gate):not(script) { visibility: hidden; }
    .ott-card { width: 100%; max-width: 26rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: .9rem; }
    .ott-card [hidden] { display: none !important; }
    .ott-card section { width: 100%; display: flex; flex-direction: column; align-items: center; gap: .9rem; }
    .ott-logo { width: 4.5rem; height: 4.5rem; }
    .ott-card h1 { font-size: 1.6rem; font-weight: 700; }
    .ott-sub { color: #9CA3AF; font-size: .95rem; line-height: 1.45; }
    .ott-code {
      font-size: 2.4rem; font-weight: 700; letter-spacing: .12em; color: #F97316;
      background: #12121C; border: 1px solid #252538; border-radius: .75rem; padding: .6rem 1.1rem;
      font-variant-numeric: tabular-nums;
    }
    .ott-timer { color: #9CA3AF; font-size: .85rem; min-height: 1.2em; }
    .ott-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 100%;
      min-height: 3rem; border-radius: .75rem; border: 1px solid #252538; background: #1C1C2B;
      color: #F3F4F6; font-weight: 600; font-size: 1rem; text-decoration: none; padding: .5rem 1rem;
    }
    .ott-btn-primary { background: #F97316; border-color: #F97316; color: #fff; }
    .ott-link { background: none; border: none; color: #9CA3AF; text-decoration: underline; font-size: .9rem; padding: .5rem; }
    .ott-qr { display: flex; flex-direction: column; align-items: center; gap: .5rem; }
    .ott-qr svg { width: 11rem; height: 11rem; background: #fff; padding: .6rem; border-radius: .6rem; }
    .ott-qr p { color: #9CA3AF; font-size: .8rem; max-width: 16rem; }
    .ott-err { color: #FCA5A5; font-size: .9rem; }
```

- [ ] **Step 5: Implementar — HTML** (logo depois de `<body>`, antes de `<div id="player-anchor">` e do resto)

```html
<!-- ══ CONTA SINTONIZA: cobre o app até o aparelho estar ativado (ver ottBoot) ══ -->
<div id="ott-gate" role="dialog" aria-modal="true" aria-label="Ativar o Sintoniza">
  <div class="ott-card">
    <span class="ott-logo" aria-hidden="true"><!-- colar aqui o conteúdo de sintoniza-logo-vetor/saida/imagens/marca.svg (a marca em vetor) --></span>

    <section data-ott-screen="loading">
      <h1>Sintoniza</h1>
      <p class="ott-sub">Conectando...</p>
    </section>

    <section data-ott-screen="activation" hidden>
      <h1>Ative o Sintoniza</h1>
      <p class="ott-sub">Teste grátis por 7 dias. Abra a página, crie sua conta e confirme o código abaixo.</p>
      <div class="ott-code" id="ott-code">----</div>
      <p class="ott-timer" id="ott-timer"></p>
      <a class="ott-btn ott-btn-primary" id="ott-open-panel" target="_blank" rel="noopener" href="#">Abrir página de ativação</a>
      <button class="ott-btn" id="ott-copy-code" type="button">Copiar código</button>
      <div class="ott-qr">
        <svg id="ott-qr" viewBox="0 0 1 1" role="img" aria-label="QR code da ativação"></svg>
        <p>Ou leia o QR code com outro aparelho (computador ou outro celular).</p>
      </div>
      <button class="ott-link" id="ott-new-code" type="button" hidden>Gerar novo código</button>
    </section>

    <section data-ott-screen="blocked" hidden>
      <h1 id="ott-blocked-title">Seu período de acesso terminou</h1>
      <p class="ott-sub" id="ott-blocked-detail"></p>
      <a class="ott-btn ott-btn-primary" id="ott-blocked-panel" target="_blank" rel="noopener" href="#">Abrir meu painel</a>
      <button class="ott-btn" id="ott-blocked-recheck" type="button">Já renovei: verificar de novo</button>
      <button class="ott-link" id="ott-blocked-unlink" type="button">Usar outra conta neste aparelho</button>
    </section>

    <section data-ott-screen="offline" hidden>
      <h1>Sem conexão</h1>
      <p class="ott-sub ott-err" id="ott-offline-msg"></p>
      <button class="ott-btn ott-btn-primary" id="ott-retry" type="button">Tentar de novo</button>
    </section>

    <section data-ott-screen="device_blocked" hidden>
      <h1>Aparelho desativado</h1>
      <p class="ott-sub">Este aparelho foi desativado no painel. Gere um novo código para ativá-lo de novo.</p>
      <button class="ott-btn ott-btn-primary" id="ott-restart" type="button">Gerar novo código</button>
    </section>
  </div>
</div>
```

> Colar o conteúdo de `C:\Users\guait\Documents\sintoniza-logo-vetor\saida\imagens\marca.svg` no lugar do comentário (é o `<svg>` da marca em vetor; remover o atributo `width`/`height` do `<svg>` para ele seguir o tamanho de `.ott-logo`).

- [ ] **Step 6: Implementar — controlador** (no script principal, junto do bloco de BOOT; sem alterar o resto)

```js
// ══════════════════════════════════════════════════════
// CONTA SINTONIZA (ativação do aparelho)
// ══════════════════════════════════════════════════════
const _ott = { cfg: null, poll: null, tick: null, revalidate: null, wired: false };

// Só no app nativo (ou ?ott=1); ?noott=1 desliga. O site no navegador segue com listas manuais.
function ottEnabled() {
  const q = new URLSearchParams(location.search);
  if (q.has("noott")) return false;
  return isNativeApp() || q.has("ott");
}

function ottStopTimers() {
  clearInterval(_ott.poll);
  clearInterval(_ott.tick);
  _ott.poll = _ott.tick = null;
}

function ottShowGate(screen) {
  document.documentElement.classList.add("ott-open");
  document.querySelectorAll("#ott-gate [data-ott-screen]").forEach(el => { el.hidden = el.dataset.ottScreen !== screen; });
}

function ottHideGate() {
  ottStopTimers();
  document.documentElement.classList.remove("ott-open");
}

function ottShowOffline(message) {
  ottStopTimers();
  document.getElementById("ott-offline-msg").textContent = message || OTT_MSG_NETWORK;
  ottShowGate("offline");
}

function ottStoredLastOk() { return Number(localStorage.getItem(OTT_KEYS.LAST_OK)) || 0; }

// Aparelho novo: pede o código ao servidor
async function ottBeginActivation() {
  ottStopTimers();
  ottShowGate("loading");
  try {
    const platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "";
    const s = await ottDeviceStart(_ott.cfg, ottDetectDevice(navigator.userAgent, platform));
    localStorage.setItem(OTT_KEYS.TOKEN, s.token);
    ottShowActivation({ code: s.code, expiresAt: s.expiresAt, pollSeconds: s.pollSeconds });
  } catch (e) {
    ottShowOffline(e.message);
  }
}

// Mostra o código, o QR e a contagem; consulta o servidor a cada pollSeconds
function ottShowActivation({ code, expiresAt, pollSeconds }) {
  ottStopTimers();
  const link = ottActivationLink(_ott.cfg.panelUrl, code);
  document.getElementById("ott-code").textContent = code;
  document.getElementById("ott-open-panel").href = link || "#";
  const qr = ottQrSvgPath(link);
  const svg = document.getElementById("ott-qr");
  svg.setAttribute("viewBox", `0 0 ${qr.size} ${qr.size}`);
  svg.innerHTML = `<path d="${qr.path}" fill="#000" shape-rendering="crispEdges"/>`;
  document.getElementById("ott-new-code").hidden = true;
  ottShowGate("activation");

  const endMs = ottParseIsoMs(expiresAt);
  const timerEl = document.getElementById("ott-timer");
  const renderTick = () => {
    const left = endMs ? endMs - Date.now() : 0;
    if (endMs && left <= 0) {
      ottStopTimers();
      timerEl.textContent = "O código expirou.";
      document.getElementById("ott-new-code").hidden = false;
      return;
    }
    timerEl.textContent = endMs ? `Código válido por ${ottFormatCountdown(left)}` : "";
  };
  renderTick();
  _ott.tick = setInterval(renderTick, 1000);
  _ott.poll = setInterval(ottPollOnce, Math.max(3, pollSeconds || 5) * 1000);
}

async function ottPollOnce() {
  const token = localStorage.getItem(OTT_KEYS.TOKEN);
  if (!token) return;
  try {
    const config = await ottDeviceConfig(_ott.cfg, token);
    if (config.status === "pending") return; // ainda esperando o cliente confirmar
    ottApplyDecision(ottDecide({ config, lastOkMs: ottStoredLastOk(), nowMs: Date.now() }));
  } catch (e) { /* rede oscilou: tenta de novo no próximo ciclo */ }
}

function ottShowBlocked(d) {
  ottStopTimers();
  const expired = d.kind === "expired";
  document.getElementById("ott-blocked-title").textContent = expired ? "Seu período de acesso terminou" : "Conta bloqueada";
  const fim = ottFormatDateBr(d.trialFim);
  document.getElementById("ott-blocked-detail").textContent = expired
    ? (fim ? `Encerrado em ${fim}. ` : "") + "Renove no painel para continuar assistindo."
    : "Fale com o suporte para liberar o acesso.";
  document.getElementById("ott-blocked-panel").href = _ott.cfg.panelUrl;
  ottShowGate("blocked");
}

// Acesso liberado: guarda a conta, aplica as listas (recarrega o app se mudaram) e abre o app
function ottOnOk(d) {
  localStorage.setItem(OTT_KEYS.LAST_OK, String(Date.now()));
  if (d.account) localStorage.setItem(OTT_KEYS.ACCOUNT, JSON.stringify(d.account));
  if (!d.offline) {
    const changed = ottApplyPlaylist(localStorage, (d.playlists && d.playlists[0]) || null);
    if (changed) { location.reload(); return; }
  }
  ottHideGate();
  document.body.classList.add("ott-mode");
  ottRenderAccountCard();
  ottScheduleRevalidate();
}

function ottApplyDecision(d) {
  if (d.screen === "ok") ottOnOk(d);
  else if (d.screen === "activation") ottShowActivation(d);
  else if (d.screen === "blocked") ottShowBlocked(d);
  else if (d.screen === "device_blocked") { ottStopTimers(); ottShowGate("device_blocked"); }
  else if (d.screen === "restart") { localStorage.removeItem(OTT_KEYS.TOKEN); ottBeginActivation(); }
  else ottShowOffline(d.message);
}

// Pergunta ao servidor a situação do aparelho (ao abrir, ao voltar ao app e a cada 6 h)
async function ottCheck() {
  const token = localStorage.getItem(OTT_KEYS.TOKEN);
  if (!token) { ottBeginActivation(); return; }
  let decision;
  try {
    decision = ottDecide({ config: await ottDeviceConfig(_ott.cfg, token), lastOkMs: ottStoredLastOk(), nowMs: Date.now() });
  } catch (e) {
    decision = ottDecide({ error: e.message, lastOkMs: ottStoredLastOk(), nowMs: Date.now() });
  }
  ottApplyDecision(decision);
}

function ottScheduleRevalidate() {
  clearInterval(_ott.revalidate);
  _ott.revalidate = setInterval(() => { if (document.visibilityState === "visible") ottCheck(); }, OTT_REVALIDATE_MS);
}

// "Desvincular este aparelho": libera a vaga no servidor e volta para a tela do código
async function ottUnlink() {
  if (!window.confirm("Desvincular este aparelho da sua conta? Ele volta para a tela do código.")) return;
  const token = localStorage.getItem(OTT_KEYS.TOKEN);
  try { if (token) await ottDeviceUnlink(_ott.cfg, token); } catch (e) { /* apaga localmente mesmo assim */ }
  [OTT_KEYS.TOKEN, OTT_KEYS.LAST_OK, OTT_KEYS.ACCOUNT].forEach(k => localStorage.removeItem(k));
  ottApplyPlaylist(localStorage, null);
  location.reload();
}

function ottWire() {
  if (_ott.wired) return;
  _ott.wired = true;
  document.getElementById("ott-new-code").addEventListener("click", ottBeginActivation);
  document.getElementById("ott-restart").addEventListener("click", () => { localStorage.removeItem(OTT_KEYS.TOKEN); ottBeginActivation(); });
  document.getElementById("ott-retry").addEventListener("click", () => { ottShowGate("loading"); ottBoot(); });
  document.getElementById("ott-blocked-recheck").addEventListener("click", () => { ottShowGate("loading"); ottCheck(); });
  document.getElementById("ott-blocked-unlink").addEventListener("click", ottUnlink);
  document.getElementById("ott-copy-code").addEventListener("click", async () => {
    const ok = await copyTextToClipboard(document.getElementById("ott-code").textContent);
    showToast(ok ? "Código copiado." : "Não foi possível copiar o código.");
  });
  // Voltou ao app depois de um tempo: revalida
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && _ott.cfg && Date.now() - ottStoredLastOk() > OTT_REVALIDATE_MS) ottCheck();
  });
}

async function ottBoot() {
  if (!ottEnabled()) { document.documentElement.classList.remove("ott-open"); return; }
  ottShowGate("loading");
  _ott.cfg = await ottLoadConfig(localStorage);
  if (!_ott.cfg) { ottShowOffline("Não foi possível conectar ao servidor Sintoniza. Verifique a internet do aparelho."); ottWire(); return; }
  ottWire();
  await ottCheck();
}
```

e, no `DOMContentLoaded`, ao final do boot (depois de tudo que já existe):

```js
  ottBoot();
```

`ottRenderAccountCard()` é criada na Task M3. Até lá, definir uma versão vazia `function ottRenderAccountCard() {}` para o app não quebrar (a M3 a substitui).

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test tests/ott/ && npm test`
Expected: PASS.

- [ ] **Step 8: Conferir a tela no Chrome (sem backend: só o visual e o link)**

Criar `scripts/dev/check-ott-screen.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

// Finge o backend: config e RPC respondem localmente
const preScript = `
  const _f = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    url = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/app-config.json")) return json({ url: "https://falso.supabase.co", anonKey: "chave-falsa" });
    if (url.includes("/rpc/device_start")) return json({ device_token: "tok", code: "ABCD-1234", expires_at: new Date(Date.now() + 15 * 60000).toISOString(), poll_seconds: 5 });
    if (url.includes("/rpc/device_config")) return json({ status: "pending", code: "ABCD-1234", expires_at: new Date(Date.now() + 15 * 60000).toISOString(), poll_seconds: 5 });
    return _f(url, init);
  };
`;

await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true, preScript }, async (page) => {
  await page.sleep(1500);
  const r = await page.eval(`({
    aberta: document.documentElement.classList.contains("ott-open"),
    codigo: document.getElementById("ott-code").textContent,
    link: document.getElementById("ott-open-panel").href,
    qr: document.querySelectorAll("#ott-qr path").length,
    contagem: document.getElementById("ott-timer").textContent,
  })`);
  console.log(r);
  await page.screenshot("ativacao-celular.png");
  if (!r.aberta || r.codigo !== "ABCD-1234" || !/codigo=ABCD-1234/.test(r.link) || r.qr !== 1 || !/Código válido por/.test(r.contagem)) {
    console.error("✖ tela de ativação incorreta");
    process.exit(1);
  }
  console.log("✔ ok (captura em ativacao-celular.png)");
});
```

Run: `node scripts/dev/check-ott-screen.mjs`
Expected: `✔ ok`. Abrir `ativacao-celular.png`, conferir visualmente (código laranja grande, QR branco, botões) e **apagar a captura**.

- [ ] **Step 9: Commit**

```bash
git add sintoniza-link.html tests/ott/gate-markup.test.js scripts/dev/check-ott-screen.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(conta): tela de ativação do celular (código, QR, abrir página) e bloqueio por prazo"
```

---

### Task M3: Conta nas Configurações e listas manuais escondidas

**Files:**
- Modify: `sintoniza-link.html` (cartão novo em `#settings-view`; atributo nos 3 cartões de listas; CSS; função `ottRenderAccountCard`)
- Test: `tests/ott/settings-account.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("as Configurações têm o cartão da conta, só visível com conta ativa", () => {
  for (const id of ["ott-account-card", "ott-account-name", "ott-account-summary", "ott-account-panel", "ott-unlink-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  assert.match(html, /body:not\(\.ott-mode\) \.ott-only \{ display: none; \}/);
});

test("com conta ativa, as listas manuais (M3U, Xtream e guia) ficam escondidas", () => {
  assert.match(html, /body\.ott-mode \[data-manual-list\] \{ display: none !important; \}/);
  const marcados = html.match(/<div class="settings-card"[^>]*data-manual-list/g) || [];
  assert.equal(marcados.length, 3);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ott/settings-account.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar**

**Marcar os três cartões de listas.** Em `#settings-view`, nos três `<div class="settings-card">` que contêm, respectivamente, o endereço/arquivo da lista M3U (`#tab-url`/`#save-btn`), as credenciais Xtream de filmes/séries e o guia de programação (`#epg-url`), trocar `<div class="settings-card">` por `<div class="settings-card" data-manual-list>` (conferir pelo conteúdo de cada um; não marcar os outros cartões).

**Cartão da conta.** Logo depois de `</header>` do `.settings-header` (antes do primeiro `.settings-card`):

```html
      <div class="settings-card ott-only" id="ott-account-card">
        <h2 style="font-size:1.1rem;font-weight:600">Conta Sintoniza</h2>
        <p id="ott-account-name" style="margin-top:.4rem;font-weight:600"></p>
        <p id="ott-account-summary" style="margin-top:.25rem;color:var(--muted-fg)"></p>
        <div class="settings-actions">
          <a class="btn-primary" id="ott-account-panel" target="_blank" rel="noopener" href="#" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center">Gerenciar minha conta</a>
          <button class="btn-ghost" id="ott-unlink-btn" type="button">Desvincular este aparelho</button>
        </div>
      </div>
```

**CSS** (junto do bloco "CONTA SINTONIZA"):

```css
    body:not(.ott-mode) .ott-only { display: none; }
    body.ott-mode [data-manual-list] { display: none !important; }
```

**Função** (substitui o `function ottRenderAccountCard() {}` provisório da M2):

```js
// Cartão "Conta Sintoniza" nas Configurações: nome, teste de 7 dias/assinatura e atalhos
function ottRenderAccountCard() {
  let account = null;
  try { account = JSON.parse(localStorage.getItem(OTT_KEYS.ACCOUNT) || "null"); } catch (e) { account = null; }
  const nome = (account && account.nome) || "Minha conta";
  const resumo = ottAccountSummary(account, Date.now());
  document.getElementById("ott-account-name").textContent = nome;
  const sumEl = document.getElementById("ott-account-summary");
  sumEl.textContent = resumo.text;
  sumEl.style.color = resumo.tone === "ok" ? "var(--muted-fg)" : "#b91c1c";
  document.getElementById("ott-account-panel").href = (_ott.cfg && _ott.cfg.panelUrl) || OTT_PANEL_URL;
}
```

e, em `ottWire()`, acrescentar: `document.getElementById("ott-unlink-btn").addEventListener("click", ottUnlink);`.

Também, com `body.ott-mode`, trocar o título e o texto do `.settings-header` em `ottOnOk` (depois de `document.body.classList.add("ott-mode")`):

```js
  const head = document.querySelector("#settings-view .settings-header");
  if (head) {
    head.querySelector("h1").textContent = "Sua conta";
    head.querySelector("p:last-child").textContent = "Suas listas de canais, filmes e séries vêm da sua conta Sintoniza e se atualizam sozinhas.";
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/ott/ && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/ott/settings-account.test.js
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(conta): cartão da conta (teste de 7 dias) nas Configurações; listas manuais escondidas"
```

---

### Task M4: Ponta a ponta contra o backend real (celular ativando de verdade)

**Files:**
- Create: `scripts/dev/e2e-ott-gate.mjs`

- [ ] **Step 1: Escrever o teste ponta a ponta**

```js
// Ativação de verdade: o app mostra o código, o "painel" (aqui, o usuário de teste) confirma o código
// pelo backend real e o app libera e carrega as listas. Nunca imprime chaves nem senhas.
// Uso: node scripts/dev/e2e-ott-gate.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withPage } from "./cdp.mjs";

const envFile = process.argv[2];
if (!envFile) { console.error("Passe o caminho do .env.ott.local do projeto da TV."); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: ANON, OTT_TEST_EMAIL: EMAIL, OTT_TEST_PASSWORD: PASSWORD } = env;
if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) { console.error("Faltam variáveis no .env.ott.local."); process.exit(1); }

const rpc = async (name, body, jwt) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async () => (await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).access_token;

await withPage(pathToFileURL("sintoniza-link.html").href + "?ott=1", { native: true }, async (page) => {
  await page.eval(`localStorage.clear(); location.reload()`);
  await page.sleep(4000);
  const codigo = await page.eval(`document.getElementById("ott-code").textContent`);
  console.log("código na tela:", codigo);
  if (!/^[A-Z]{4}-\d{4}$/.test(codigo)) { console.error("✖ o app não mostrou um código válido"); process.exit(1); }

  const jwt = await login();
  const claim = await rpc("device_claim", { p_code: codigo }, jwt);
  console.log("confirmação do código:", claim.status, claim.data && claim.data.ok);
  if (claim.status !== 200) { console.error("✖ o backend recusou o código:", JSON.stringify(claim.data)); process.exit(1); }

  // o app consulta a cada 5 s; espera liberar (pode recarregar sozinho ao gravar as listas)
  let liberado = false;
  for (let i = 0; i < 40 && !liberado; i++) {
    await page.sleep(1500);
    try { liberado = await page.eval(`!document.documentElement.classList.contains("ott-open") && document.body.classList.contains("ott-mode")`); } catch (e) { /* página recarregando */ }
  }
  const estado = await page.eval(`({ lista: !!localStorage.getItem("sint_url"), conta: JSON.parse(localStorage.getItem("sint_ott_account") || "null") })`);
  console.log("app liberado:", liberado, "| lista gravada:", estado.lista, "| conta:", estado.conta && estado.conta.status);

  // limpeza: remove o aparelho de teste
  const token = await page.eval(`localStorage.getItem("sint_ott_token")`);
  if (token) await rpc("device_unlink", { p_token: token });

  if (!liberado || !estado.conta) { console.error("✖ o app não liberou depois da confirmação"); process.exit(1); }
  console.log("✔ ok: ativação de ponta a ponta");
});
```

- [ ] **Step 2: Rodar contra o backend real (migração e `app-config.json` já no ar: Tasks B1–B3)**

Run: `node scripts/dev/e2e-ott-gate.mjs "C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local"`
Expected: imprime o código, `confirmação do código: 200 true`, `app liberado: true`, e `✔ ok`. Se falhar por limite de aparelhos do usuário de teste, remover aparelhos antigos dele (`device_unlink` ou pelo painel) e repetir.

- [ ] **Step 3: Conferir também a conta bloqueada**

Com o usuário de teste, simular o prazo vencido não é seguro em produção; em vez disso, a tela de bloqueio é coberta pelos testes de `ottDecide`/`ottShowBlocked` e conferida visualmente: no Chrome, `ottShowBlocked({ kind: "expired", trialFim: "2026-10-01T00:00:00Z" })` e `ottShowGate("blocked")` devem mostrar "Seu período de acesso terminou" e "Encerrado em 01/10/2026".

Run: `node -e "import('./scripts/dev/cdp.mjs').then(async ({withPage}) => { const {pathToFileURL}=await import('node:url'); await withPage(pathToFileURL('sintoniza-link.html').href+'?noott=1', {native:true}, async (p) => { await p.eval('_ott.cfg={panelUrl:\"https://sintonizatv.com.br\"}; ottShowBlocked({kind:\"expired\",trialFim:\"2026-10-01T12:00:00Z\"})'); console.log(await p.eval('document.getElementById(\"ott-blocked-title\").textContent + \" | \" + document.getElementById(\"ott-blocked-detail\").textContent')); }); })"`
Expected: `Seu período de acesso terminou | Encerrado em 01/10/2026. Renove no painel para continuar assistindo.`

- [ ] **Step 4: Commit**

```bash
git add scripts/dev/e2e-ott-gate.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "test(conta): ativação do celular de ponta a ponta contra o backend real"
```

---

### Task M5: Regressão do app e do prepare-mobile

- [ ] **Step 1: Rodar tudo**

Run: `npm test`
Expected: toda a suíte passa (199 de base + os novos dos três planos). O teste do `prepare-mobile` regenera `www/index.html`; conferir que ele contém `id="ott-core"` e `id="qrcodegen"`:

Run: `grep -c 'id="ott-core"\|id="qrcodegen"' www/index.html`
Expected: `2`.

- [ ] **Step 2: O site no navegador continua sem conta**

Run: `node -e "import('./scripts/dev/cdp.mjs').then(async ({withPage}) => { const {pathToFileURL}=await import('node:url'); await withPage(pathToFileURL('sintoniza-link.html').href, {native:false}, async (p) => console.log('gate aberto no navegador comum:', await p.eval('document.documentElement.classList.contains(\"ott-open\")'))); })"`
Expected: `gate aberto no navegador comum: false`.

- [ ] **Step 3: Commit (se algo foi ajustado)**

---

### Task Final: build do IPA e do APK e download em `Downloads`

**Pré-condições:** Plano A (`2026-10-02-celular-ajustes-v10.md`), Partes 1 e 2 deste plano e o estudo concluídos; `npm test` verde na `v10`.

- [ ] **Step 1: Enviar a branch (dispara o workflow `build-mobile-v10.yml`)**

Run: `git push origin v10`
Expected: sem erro; no GitHub, o workflow "Build Android APK e iOS IPA (v10)" começa.

- [ ] **Step 2: Esperar o build terminar (sem imprimir o token)**

```bash
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | sed -n 's/^password=//p')
REPO=Guaitolinii/visual-craft-assistant
for i in $(seq 1 60); do
  RUN=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/actions/runs?branch=v10&per_page=1")
  STATUS=$(echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).workflow_runs[0]||{};console.log((r.id||'')+' '+(r.status||'')+' '+(r.conclusion||''))})")
  echo "$i: $STATUS"
  case "$STATUS" in *" completed success") break;; *" completed "*) echo "BUILD FALHOU"; break;; esac
  sleep 30
done
```
Expected: termina com `<id> completed success`. Se falhar, abrir os logs do run (`/actions/runs/<id>/jobs`) e corrigir a causa antes de repetir.

- [ ] **Step 3: Baixar os artefatos para `Downloads`**

```bash
RUN_ID=<id impresso acima>
mkdir -p /c/Users/guait/Downloads/Sintoniza-celular
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts" > "$TEMP/artefatos.json"
for nome in sintoniza-android-debug sintoniza-ios-unsigned; do
  URL=$(node -e "const a=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).artifacts.find(x=>x.name===process.argv[2]);console.log(a?a.archive_download_url:'')" "$TEMP/artefatos.json" "$nome")
  curl -sL -H "Authorization: Bearer $TOKEN" -o "/c/Users/guait/Downloads/Sintoniza-celular/$nome.zip" "$URL"
done
```

Depois, no PowerShell, extrair e renomear:

```powershell
$d = 'C:\Users\guait\Downloads\Sintoniza-celular'
Expand-Archive "$d\sintoniza-android-debug.zip" "$d\apk" -Force
Expand-Archive "$d\sintoniza-ios-unsigned.zip" "$d\ipa" -Force
Move-Item "$d\apk\app-debug.apk" "$d\sintoniza-android-debug-v10.apk" -Force
Move-Item "$d\ipa\sintoniza-ios-unsigned.ipa" "$d\sintoniza-ios-unsigned-v10.ipa" -Force
Remove-Item "$d\apk","$d\ipa","$d\sintoniza-android-debug.zip","$d\sintoniza-ios-unsigned.zip" -Recurse -Force
Get-ChildItem $d | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
```
Expected: dois arquivos, `sintoniza-android-debug-v10.apk` e `sintoniza-ios-unsigned-v10.ipa`, com alguns MB cada.

- [ ] **Step 4: Atualizar a memória e o plano**

Atualizar a nota `sintoniza-versioning-workflow` (v10 = branch `v10`, o que mudou, IPA/APK em `Downloads\Sintoniza-celular\`) e marcar este plano como executado.

---

## Auto-revisão

- **Cobertura do pedido:** cadastro (painel, com o botão que abre a página no próprio celular), QR code (mostrado na tela de ativação), conta de 7 dias (existente no backend; mostrada em Configurações), IPA/APK em Downloads (Task Final). O limite de aparelhos foi tratado para um celular não gastar a vaga da TV.
- **Sem chaves no código:** a configuração vem de `app-config.json` (publicada pelo painel); o `.env.ott.local` nunca é lido pelo app, só pelos scripts de desenvolvimento, que não imprimem segredos.
- **Ordem:** B1 (migração aplicada) → B2 → B3 (painel no ar com `app-config.json`) → M1 → M2 → M3 → M4 (ponta a ponta real) → M5 → Task Final.
- **Nomes consistentes:** `ottDecide`, `ottAccountSummary`, `ottShowActivation/Blocked/Gate/Offline`, `ottRenderAccountCard`, `OTT_KEYS`, `OTT_LIST_KEYS` aparecem com o mesmo nome em M1, M2, M3 e nos testes.
- **Riscos abertos:** (1) `window.open`/`target="_blank"` abre o navegador do sistema no Capacitor sem plugin novo; confirmar no aparelho. (2) O IPA sai **sem assinatura** (como os anteriores): precisa do seu fluxo habitual de instalação.
