# Filmes Livres (embeds oficiais) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma categoria "Filmes Livres", por conta, com filmes de fontes autorizadas que abrem em uma tela de embed própria do app (iframe sem restrições, sem lista de domínios), coexistindo com a categoria Legendados.

**Architecture:** A conta ganha o link de uma lista M3U (`profiles.url_embeds`) devolvido por `device_config` (igual ao `url_legendados`). O app lê a lista com um leitor de M3U compartilhado com os Legendados, decide por item entre embed (tela própria) e link direto (player nativo), e desenha uma fileira nova. O cabeçalho `Permissions-Policy` do site passa a permitir tela cheia e autoplay em iframes.

**Tech Stack:** HTML/JS único (`sintoniza-link.html`), testes `node:test` (app) e `node --import tsx --test` (Novo-App-de-TV), Supabase (SQL), Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-10-24-filmes-livres-embed-design.md`

---

## Convenções (valem para todas as tarefas)

- Comentários de código em **português**. Código simples antes de elegante.
- Commits: `git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit …`, mensagem em português no formato `feat(...)/test(...)/refactor(...)`, terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Sempre `git add` com lista fechada de arquivos (o working tree do app tem alterações antigas de outros assuntos: `cloudflare-proxy/`, `package.json`, `www/index.html`, `scratch/` etc. **não entram**). Nunca `git add -A`, nunca push.
- `www/index.html` é gerado pelo build; não editar.
- **App** (`C:\Users\guait\Documents\visual-craft-assistant`): branch `orquestrador/embeds` (já criado, com o spec). Suíte completa: `node --test "tests/**/*.test.js"` (linha de base: 567 passando).
- **Site** (`C:\Users\guait\Documents\Novo-App-de-TV`): branch novo `orquestrador/embeds-conta`, criado a partir de `orquestrador/seo-site` (que já contém a migração 0016 e é o que está em produção). Suíte completa: `npm test` (linha de base: 549 passando).
- Fluxo de execução do Gustavo: o Gemini (`omp`) constrói por tarefa, Claude revisa e roda os testes, Haiku commita.
- **Nada de banco, ligar conta ou deploy sem o "pode" explícito do Gustavo** (Tarefa 11).

## Estrutura de arquivos

**Novo-App-de-TV**
- Modificar `panel/public/_headers` — `Permissions-Policy` do `/app/*`.
- Criar `supabase/migrations/0017_ott_embeds.sql` — coluna `profiles.url_embeds` e `device_config` com `url_embeds`.
- Criar `scripts/lib/embeds-resumo.mjs` — resumo puro da lista (itens e domínios).
- Criar `scripts/ott-embeds-conta.mjs` — liga/desliga a categoria numa conta.
- Modificar `package.json` — script `ott:embeds`.
- Criar `tests/embeds-headers.test.ts` e `tests/embeds-conta.test.ts`.

**App**
- Modificar `sintoniza-link.html` — leitor compartilhado, funções de embeds, chaves de conta, roteamento, fileira, tela de embed.
- Criar `tests/vod/embeds.test.js`.
- Modificar `tests/vod/loadVodHelpers.js` — registrar as funções novas.
- Modificar `tests/vod/legendados.test.js` — duas expressões de "ligações" que citam código que passa a ser genérico (Tarefas 7 e 8).

---

# Parte A — Site (Novo-App-de-TV)

### Task 1: Cabeçalho que permite tela cheia e autoplay no `/app/*`

**Files:**
- Modify: `C:\Users\guait\Documents\Novo-App-de-TV\panel\public\_headers` (bloco `/app/*`, linhas 29-31)
- Create: `C:\Users\guait\Documents\Novo-App-de-TV\tests\embeds-headers.test.ts`

- [ ] **Step 1: Criar o branch**

```bash
cd /c/Users/guait/Documents/Novo-App-de-TV
git switch -c orquestrador/embeds-conta orquestrador/seo-site
git branch --show-current
```
Expected: `orquestrador/embeds-conta`

- [ ] **Step 2: Escrever o teste que falha**

`tests/embeds-headers.test.ts`:

```ts
// Testes: o app web (/app/*) precisa deixar iframes de outros domínios usar tela cheia e autoplay (categoria Filmes Livres)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const headers = readFileSync(path.join(raiz, 'panel', 'public', '_headers'), 'utf8').split('\r\n').join('\n');

// Bloco de cabeçalhos de uma rota exata (da linha da rota até a próxima linha sem recuo)
function bloco(rota: string): string {
  const m = headers.match(new RegExp(`^${rota.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n((?:  .+\\n?)*)`, 'm'));
  assert.ok(m, `rota ${rota} não encontrada no _headers`);
  return m[1];
}

test('/app/*: Permissions-Policy libera tela cheia, autoplay, picture-in-picture e DRM para qualquer origem', () => {
  const b = bloco('/app/*');
  const pp = (b.match(/Permissions-Policy: (.+)/) || [])[1] || '';
  for (const rec of ['autoplay', 'fullscreen', 'picture-in-picture', 'encrypted-media']) {
    assert.match(pp, new RegExp(`${rec}=\\*`), `${rec} deve valer para qualquer origem`);
  }
  assert.doesNotMatch(pp, /=\(self\)/, 'não pode restar recurso preso a (self)');
});

test('/app/*: continua fora do índice dos buscadores e a regra de segurança /* não mudou', () => {
  assert.match(bloco('/app/*'), /X-Robots-Tag: noindex, nofollow/);
  assert.match(bloco('/*'), /X-Frame-Options: DENY/);
  assert.match(bloco('/*'), /X-Content-Type-Options: nosniff/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /c/Users/guait/Documents/Novo-App-de-TV && node --import tsx --test tests/embeds-headers.test.ts`
Expected: FAIL no primeiro teste (`autoplay deve valer para qualquer origem`).

- [ ] **Step 4: Editar o `_headers`**

Trocar a linha

```
  Permissions-Policy: autoplay=(self), fullscreen=(self), picture-in-picture=(self)
```

por

```
  Permissions-Policy: autoplay=*, fullscreen=*, picture-in-picture=*, encrypted-media=*
```

e acrescentar, acima do bloco `/app/*`, o comentário:

```
# /app/* libera tela cheia e autoplay para iframes de qualquer origem: a categoria "Filmes Livres" abre embeds de fontes
# autorizadas e não há lista fixa de domínios. (X-Frame-Options: DENY da regra /* protege as NOSSAS páginas; não afeta o que o app embute.)
```

- [ ] **Step 5: Rodar os testes de cabeçalho e de SEO**

Run: `node --import tsx --test tests/embeds-headers.test.ts tests/seo-site.test.ts`
Expected: todos passam (os 12 de SEO continuam: o `X-Robots-Tag` de `/app/*` está preservado).

- [ ] **Step 6: Commit**

```bash
git add panel/public/_headers tests/embeds-headers.test.ts
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(site): /app/* libera tela cheia e autoplay em iframes de qualquer origem

Necessário para a categoria Filmes Livres (embeds sem lista fixa de domínios).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Migração 0017 (`profiles.url_embeds` + `device_config`)

**Files:**
- Create: `C:\Users\guait\Documents\Novo-App-de-TV\supabase\migrations\0017_ott_embeds.sql`

SQL não tem teste unitário aqui; a verificação é a conferência contra a 0016 (Step 2) e a aplicação supervisionada da Tarefa 11.

- [ ] **Step 1: Criar o arquivo**

```sql
-- Sintoniza OTT — lista de filmes "Filmes Livres" (embeds oficiais) por conta: só o admin define, só a conta marcada recebe
-- Rodar depois do 0016_ott_legendados.sql.
-- Mesma ideia da url_legendados: a coluna fica em profiles, a conta continua recebendo a lista padrão (ou a própria)
-- e ganha o link extra por cima. Quem pode gravar: só o admin (policy profiles_admin_write); o cliente nunca marca a própria conta.

alter table public.profiles add column if not exists url_embeds text;

-- device_config = versão do 0016 + 'url_embeds' (null para quem não foi marcado) em cada lista devolvida
create or replace function public.device_config(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d       public.devices;
  p       public.profiles;
  c       public.activation_codes;
  v_state text;
  v_lists json;
begin
  select * into d from public.devices
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then
    return json_build_object('status', 'unknown_device');
  end if;
  if not d.ativo then
    return json_build_object('status', 'device_blocked');
  end if;
  update public.devices set ultimo_acesso = now() where id = d.id;

  if d.user_id is null then
    select * into c from public.activation_codes
     where device_id = d.id and claimed_at is null and expires_at > now()
     order by expires_at desc limit 1;
    if not found then
      c := public.issue_activation_code(d.id);
    end if;
    return json_build_object('status', 'pending', 'code', c.code, 'expires_at', c.expires_at, 'poll_seconds', 5);
  end if;

  select * into p from public.profiles where id = d.user_id;
  v_state := public.access_state(p);
  if v_state <> 'ok' then
    return json_build_object('status', v_state, 'trial_fim', coalesce(p.acesso_fim, p.trial_fim));
  end if;

  select coalesce(json_agg(json_build_object(
           'id', l.id, 'nome', l.nome, 'url_m3u', l.url_m3u, 'url_vod', l.url_vod, 'url_epg', l.url_epg,
           'url_legendados', p.url_legendados, 'url_embeds', p.url_embeds
         ) order by l.created_at), '[]'::json)
    into v_lists
    from public.playlists l
   where l.user_id = p.id and l.ativo and (l.expiracao is null or l.expiracao > now());

  if json_array_length(v_lists) = 0 then
    select coalesce(json_agg(json_build_object(
             'id', l.id, 'nome', l.nome, 'url_m3u', l.url_m3u, 'url_vod', l.url_vod, 'url_epg', l.url_epg,
             'url_legendados', p.url_legendados, 'url_embeds', p.url_embeds
           ) order by l.created_at), '[]'::json)
      into v_lists
      from public.playlists l
     where l.user_id is null and l.ativo and (l.expiracao is null or l.expiracao > now());
  end if;

  return json_build_object(
    'status', 'ok',
    'user', json_build_object('nome', p.nome, 'status', p.status, 'trial_fim', p.trial_fim, 'acesso_fim', p.acesso_fim),
    'playlists', v_lists
  );
end;
$$;
revoke execute on function public.device_config(text) from public;
grant  execute on function public.device_config(text) to anon, authenticated;
```

- [ ] **Step 2: Conferir que só mudaram as linhas esperadas em relação à 0016**

Run: `cd /c/Users/guait/Documents/Novo-App-de-TV && diff <(sed -n '/^create or replace function/,$p' supabase/migrations/0016_ott_legendados.sql) <(sed -n '/^create or replace function/,$p' supabase/migrations/0017_ott_embeds.sql)`
Expected: exatamente duas diferenças, nas duas linhas `'url_legendados', p.url_legendados` (que passam a terminar com `, 'url_embeds', p.url_embeds`). Qualquer outra diferença é erro de cópia: corrigir.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0017_ott_embeds.sql
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(ott): coluna profiles.url_embeds e device_config devolve o link da lista de Filmes Livres

Migração 0017 (não aplicada em produção).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Resumo da lista e script `ott:embeds`

**Files:**
- Create: `C:\Users\guait\Documents\Novo-App-de-TV\scripts\lib\embeds-resumo.mjs`
- Create: `C:\Users\guait\Documents\Novo-App-de-TV\scripts\ott-embeds-conta.mjs`
- Modify: `C:\Users\guait\Documents\Novo-App-de-TV\package.json` (junto de `"ott:legendados"`)
- Test: `C:\Users\guait\Documents\Novo-App-de-TV\tests\embeds-conta.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// Testes: resumo informativo da lista de Filmes Livres (itens, embeds, links diretos e domínios) usado pelo ott:embeds
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirListaEmbeds } from '../scripts/lib/embeds-resumo.mjs';

const par = (id: string, url: string) => `#EXTINF:-1 tvg-id="${id}", Filme ${id}\n${url}`;

test('conta embeds, links diretos e domínios; não bloqueia domínio nenhum', () => {
  const lista = [
    '#EXTM3U',
    par('a', 'https://archive.org/embed/a'),
    par('b', 'https://archive.org/embed/b'),
    par('c', 'https://player.exemplo.test:8443/filme/c'),
    par('d', 'https://cdn.exemplo.test/d.mp4?x=1'),
  ].join('\n');
  const r = resumirListaEmbeds(lista);
  assert.equal(r.itens, 4);
  assert.equal(r.embeds, 3);
  assert.equal(r.diretos, 1);
  assert.equal(r.invalidos, 0);
  assert.deepEqual(r.dominios, { 'archive.org': 2, 'player.exemplo.test': 1, 'cdn.exemplo.test': 1 });
});

test('http, javascript:, data: e linhas com espaço contam como inválidos e não entram nos domínios', () => {
  const lista = [
    par('a', 'http://inseguro.test/a'),
    par('b', 'javascript:alert(1)'),
    par('c', 'data:text/html;base64,AAAA'),
    par('d', 'https://com espaco.test/d'),
    par('e', 'https://bom.test/e'),
  ].join('\n');
  const r = resumirListaEmbeds(lista);
  assert.equal(r.itens, 5);
  assert.equal(r.invalidos, 4);
  assert.equal(r.embeds, 1);
  assert.deepEqual(r.dominios, { 'bom.test': 1 });
});

test('entrada vazia ou estranha devolve zeros', () => {
  for (const entrada of ['', '   ', undefined, null, '#EXTM3U\n#EXTINF:-1 tvg-id="x", Sem URL']) {
    const r = resumirListaEmbeds(entrada as any);
    assert.equal(r.embeds + r.diretos, 0);
    assert.deepEqual(r.dominios, {});
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test tests/embeds-conta.test.ts`
Expected: FAIL (`Cannot find module '../scripts/lib/embeds-resumo.mjs'`).

- [ ] **Step 3: Criar `scripts/lib/embeds-resumo.mjs`**

```js
// Resumo de uma lista M3U de Filmes Livres: totais e domínios por contagem.
// É só informativo (para o Gustavo ver de onde vêm os links ao ligar a categoria): não bloqueia nenhum domínio.
// As regras de link espelham as do app (sintoniza-link.html: embedsClassifyUrl): só https, sem espaço nem aspas.
const EXT_DIRETA = /\.(m3u8|mp4|mkv|ts|m4v|webm|mov)$/i;

export function resumirListaEmbeds(texto) {
  const resumo = { itens: 0, embeds: 0, diretos: 0, invalidos: 0, dominios: {} };
  const linhas = String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let pendente = false; // true depois de um #EXTINF, até chegar a linha do link
  for (const bruta of linhas) {
    const linha = bruta.trim();
    if (!linha) continue;
    if (linha.startsWith('#EXTINF:')) { pendente = true; continue; }
    if (linha.startsWith('#') || !pendente) continue;
    pendente = false;
    resumo.itens++;
    if (!/^https:\/\/[^\s"'<>]+$/i.test(linha)) { resumo.invalidos++; continue; }
    let url;
    try { url = new URL(linha); } catch { resumo.invalidos++; continue; }
    if (EXT_DIRETA.test(url.pathname)) resumo.diretos++; else resumo.embeds++;
    resumo.dominios[url.hostname] = (resumo.dominios[url.hostname] || 0) + 1;
  }
  return resumo;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test tests/embeds-conta.test.ts`
Expected: 3 testes passando.

- [ ] **Step 5: Criar `scripts/ott-embeds-conta.mjs`**

```js
// Liga (ou desliga) a categoria "Filmes Livres" em UMA conta: grava o link da lista de embeds em profiles.url_embeds.
// Só o admin consegue gravar (RLS). As outras listas da conta (padrão ou própria) e a categoria Legendados não são tocadas.
//
// Uso:
//   npm run ott:embeds -- --email=conta@exemplo.com            (liga/atualiza)
//   npm run ott:embeds -- --email=conta@exemplo.com --remover  (desliga)
// Lê do .env.ott.local: OTT_ADMIN_EMAIL, OTT_ADMIN_PASSWORD (ou OTT_ADMIN_TEMP_PASSWORD) e
//   OTT_CONTA_EMBEDS  link M3U dos Filmes Livres (obrigatório para ligar)
// Pré-requisito: aplicar a migração supabase/migrations/0017_ott_embeds.sql.
// Nunca imprime o link da lista (pode ter credenciais): só o domínio e o resumo dos domínios dos filmes.
import { resumirListaEmbeds } from './lib/embeds-resumo.mjs';

const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const ADMIN = process.env.OTT_ADMIN_EMAIL;
const PASSWORD = process.env.OTT_ADMIN_PASSWORD || process.env.OTT_ADMIN_TEMP_PASSWORD;
const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').split('=').slice(1).join('=').trim();
const email = arg('email').toLowerCase();
const remover = process.argv.includes('--remover');
const link = (process.env.OTT_CONTA_EMBEDS || '').trim();
const falha = (msg) => { console.error(`[embeds] ${msg}`); process.exit(1); };

if (!URL_BASE || !ANON || !ADMIN || !PASSWORD) falha('Faltam VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, OTT_ADMIN_EMAIL ou a senha do admin no .env.ott.local.');
if (!email) falha('Informe a conta: --email=conta@exemplo.com');
if (!remover && !/^https?:\/\/\S+$/i.test(link)) falha('Defina OTT_CONTA_EMBEDS com um link http:// ou https:// no .env.ott.local.');

// Resumo informativo da lista (não bloqueia nada): quantos itens e de quais domínios
if (!remover) {
  const r = await fetch(link).catch(() => null);
  if (r && r.ok) {
    const resumo = resumirListaEmbeds(await r.text());
    const doms = Object.entries(resumo.dominios).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} (${n})`).join(', ');
    console.log(`[embeds] Lista: ${resumo.itens} itens (${resumo.embeds} embeds, ${resumo.diretos} links diretos, ${resumo.invalidos} inválidos). Domínios: ${doms || 'nenhum'}`);
  } else {
    console.log('[embeds] Não consegui baixar a lista para o resumo (a gravação segue).');
  }
}

// Login do admin (Supabase Auth)
const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN, password: PASSWORD }),
}).then((r) => r.json());
if (!login.access_token) falha('Login do admin recusado. Confira e-mail e senha no .env.ott.local.');
const headers = { apikey: ANON, Authorization: `Bearer ${login.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

// Grava em profiles pelo e-mail; return=representation mostra se alguma linha foi mesmo alterada
const valor = remover ? null : link;
const res = await fetch(`${URL_BASE}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}`, {
  method: 'PATCH', headers, body: JSON.stringify({ url_embeds: valor }),
});
if (!res.ok) {
  const txt = (await res.text()).slice(0, 300);
  falha(`Falha ao gravar (${res.status}): ${txt}${/url_embeds/.test(txt) ? ' — aplique antes a migração 0017_ott_embeds.sql' : ''}`);
}
const linhas = await res.json();
if (!Array.isArray(linhas) || !linhas.length) falha(`Conta ${email} não encontrada em profiles (ou sem permissão).`);
console.log(remover
  ? `[embeds] Desligado em ${email}: a conta deixa de ver a categoria.`
  : `[embeds] Ligado em ${email}: lista em ${new URL(link).host}. No app: Atualizar listas ou reabrir.`);
```

- [ ] **Step 6: Registrar o script no `package.json`**

Na linha logo abaixo de `"ott:legendados": "node --env-file=.env.ott.local scripts/ott-legendados-conta.mjs",` acrescentar:

```json
    "ott:embeds": "node --env-file=.env.ott.local scripts/ott-embeds-conta.mjs",
```

- [ ] **Step 7: Conferir sintaxe e rodar a suíte inteira**

Run: `cd /c/Users/guait/Documents/Novo-App-de-TV && node --check scripts/ott-embeds-conta.mjs && node --check scripts/lib/embeds-resumo.mjs && npm test 2>&1 | tail -8`
Expected: sem erro de sintaxe; `# pass 554` (549 + 2 de cabeçalho + 3 de resumo), `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/embeds-resumo.mjs scripts/ott-embeds-conta.mjs package.json tests/embeds-conta.test.ts
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(ott): script ott:embeds liga/desliga os Filmes Livres numa conta e resume os domínios da lista

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

# Parte B — App (visual-craft-assistant, branch `orquestrador/embeds`)

Todos os caminhos abaixo são relativos a `C:\Users\guait\Documents\visual-craft-assistant`. Confirmar antes de começar: `git branch --show-current` → `orquestrador/embeds`.

### Task 4: Núcleo compartilhado das listas extras (refatoração sem mudar comportamento)

**Files:**
- Modify: `sintoniza-link.html` (bloco `// ─── Lista extra de filmes Legendados (v8) ───`, hoje linhas 5664-5836: tudo entre esse comentário e `function parseM3U(text) {`, mantendo `legendadosDirectExt` intacta)
- Test: `tests/vod/legendados.test.js` (já existente, sem alteração: é a rede de segurança)

- [ ] **Step 1: Confirmar a linha de base**

Run: `node --test tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ pass 19` (ou o número atual) e `ℹ fail 0`. Anotar o número.

- [ ] **Step 2: Trocar `legendadosEnabled` por um verificador genérico**

Substituir a função `legendadosEnabled` inteira por:

```js
// true se a chave do armazenamento guarda um link http(s) (usado pelas listas extras: Legendados e Filmes Livres)
function extraListEnabled(storage, key) {
  if (!storage) return false;
  let val = null;
  try {
    val = typeof storage.getItem === "function" ? storage.getItem(key) : storage[key];
  } catch (e) {
    return false;
  }
  if (typeof val !== "string") return false;
  return /^https?:\/\//i.test(val.trim());
}

function legendadosEnabled(storage) {
  return extraListEnabled(storage, "sint_legendados_url");
}
```

- [ ] **Step 3: Trocar `legendadosParseM3u` por um leitor comum + invólucro**

Substituir a função `legendadosParseM3u` inteira por:

```js
// Leitor comum das listas extras: pares #EXTINF + link → itens já saneados.
// opts.idPrefix  prefixo do stream_id ("leg-", "liv-")
// opts.category  nome da categoria
// opts.classify  (link) => campos extras do item (direct_url, embed_url, flags…) ou null para descartar o item
// opts.max       teto de itens (0 ou ausente = sem teto)
function m3uExtraParse(text, opts) {
  if (typeof text !== "string") return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (!text.trim()) return [];
  const max = Number(opts.max) > 0 ? Number(opts.max) : 0;

  const lines = text.split(/\r?\n/);
  const items = [];
  const seenIds = new Set();
  let pendingExtinf = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const idMatch = line.match(/\btvg-id="([^"]*)"/i);
      const tvgId = idMatch ? idMatch[1].trim() : "";
      // id só com letras, números, _ - . (vai para atributos HTML e para chaves do cache): qualquer outro vira item descartado
      if (!tvgId || !/^[A-Za-z0-9_.-]{1,40}$/.test(tvgId)) {
        pendingExtinf = null;
        continue;
      }

      const nameMatch = line.match(/\btvg-name="([^"]*)"/i);
      let rawName = "";
      if (nameMatch && nameMatch[1].trim()) {
        rawName = nameMatch[1].trim();
      } else {
        let inQuotes = false;
        let commaIdx = -1;
        for (let c = 8; c < line.length; c++) {
          if (line[c] === '"') inQuotes = !inQuotes;
          else if (line[c] === ',' && !inQuotes) {
            commaIdx = c;
            break;
          }
        }
        if (commaIdx >= 0) {
          rawName = line.slice(commaIdx + 1).trim();
        } else {
          const lastComma = line.lastIndexOf(",");
          rawName = lastComma >= 0 ? line.slice(lastComma + 1).trim() : "";
        }
      }

      let year = "";
      const yearMatch = rawName.match(/\s*\((\d{4})\)$/);
      if (yearMatch) {
        year = yearMatch[1];
        rawName = rawName.slice(0, yearMatch.index).trim();
      }

      const name = sanitizeLabel(rawName);
      const logoMatch = line.match(/\btvg-logo="([^"]*)"/i);
      const stream_icon = logoMatch ? sanitizeImageUrl(logoMatch[1]) : "";
      const groupMatch = line.match(/\bgroup-title="([^"]*)"/i);
      const genre = groupMatch ? sanitizeLabel(groupMatch[1]) : "";

      pendingExtinf = { stream_id: opts.idPrefix + tvgId, name, stream_icon, genre, year };
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (pendingExtinf) {
      const extra = opts.classify(line);
      if (extra && !seenIds.has(pendingExtinf.stream_id)) {
        seenIds.add(pendingExtinf.stream_id);
        items.push({
          stream_id: pendingExtinf.stream_id,
          name: pendingExtinf.name,
          stream_icon: pendingExtinf.stream_icon,
          category_name: opts.category,
          genre: pendingExtinf.genre,
          year: pendingExtinf.year,
          ...extra,
        });
        if (max && items.length >= max) return items;
      }
      pendingExtinf = null;
    }
  }

  return items;
}

function legendadosParseM3u(text) {
  return m3uExtraParse(text, {
    idPrefix: "leg-",
    category: "Legendados",
    // Legendados só aceita link direto de vídeo (https + extensão de mídia)
    classify: (url) => {
      const ext = legendadosDirectExt(url);
      return ext ? { direct_url: url, container_extension: ext, is_legendado: true } : null;
    },
  });
}
```

- [ ] **Step 4: Extrair o download da lista e simplificar `legendadosFetch`**

Substituir `let _legendadosCache = null;` e a função `legendadosFetch` inteira por:

```js
// Baixa o texto de uma lista extra: busca direta (15 s) e, se falhar, a mesma estratégia de fallback do loadPlaylistFromUrl.
// Devolve o texto ou null se as duas tentativas falharem.
async function extraListFetchText(url) {
  const targetUrl = url.trim();
  let text = null;

  // Tentativa 1: busca direta com timeout de 15 s
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(targetUrl, { signal: ctrl.signal, cache: "no-cache" });
      if (res && res.ok) {
        text = await res.text();
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    /* falha na tentativa direta, tenta fallback abaixo */
  }

  // Tentativa 2: fallback pela mesma estratégia que loadPlaylistFromUrl já usa
  if (text == null) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = (typeof isWebApp === "function" && isWebApp())
          ? await webFetchRouted(targetUrl, { signal: ctrl.signal, cache: "no-cache" })
          : await fetch(typeof proxyIfInsecure === "function" ? proxyIfInsecure(targetUrl) : targetUrl, { signal: ctrl.signal, cache: "no-cache" });
        if (res && res.ok) {
          text = await res.text();
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      /* falha final */
    }
  }

  return text;
}

let _legendadosCache = null;

async function legendadosFetch(url) {
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return [];
  if (_legendadosCache !== null) return _legendadosCache;

  const text = await extraListFetchText(url);
  if (!text) return [];

  const items = legendadosParseM3u(text);
  if (items && items.length > 0) {
    _legendadosCache = items;
  }
  return items;
}
```

- [ ] **Step 5: Rodar os testes de Legendados e a suíte inteira**

Run: `node --test tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)" && node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: o mesmo `pass` do Step 1 e `fail 0`; suíte inteira `pass 567`, `fail 0`. Se algum teste de Legendados falhar, a refatoração mudou comportamento: corrigir antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
refactor(web): leitor de M3U e download das listas extras viram núcleo compartilhado (Legendados sem mudança de comportamento)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Funções de Filmes Livres (leitura, tipo de reprodução, HTML do iframe)

**Files:**
- Modify: `sintoniza-link.html` (inserir logo antes de `function parseM3U(text) {`)
- Modify: `tests/vod/loadVodHelpers.js` (lista `PURE_HELPER_NAMES`)
- Create: `tests/vod/embeds.test.js`

- [ ] **Step 1: Escrever os testes que falham**

`tests/vod/embeds.test.js`:

```js
// Testes: categoria "Filmes Livres" (embeds oficiais): leitura da lista, tipo de reprodução, HTML do iframe,
// configuração da conta e ligações no sintoniza-link.html. Spec: docs/superpowers/specs/2026-10-24-filmes-livres-embed-design.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { loadOtt, fakeStorage, plain } from "../ott/loadOtt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");

// Um item da lista: #EXTINF (id, capa, gênero, nome) + linha do link
const par = (id, nome, url) => `#EXTINF:-1 tvg-id="${id}" tvg-logo="https://exemplo.test/${id}.jpg" group-title="Terror", ${nome}\n${url}`;

// ── Leitura da lista ──
test("embedsParseM3u: link https de página vira item de embed", () => {
  const ctx = loadVodHelpers();
  const items = ctx.embedsParseM3u("#EXTM3U\n" + par("nosferatu", "Nosferatu (1922)", "https://fonte.test/embed/nosferatu"));
  assert.deepEqual(items, [{
    stream_id: "liv-nosferatu",
    name: "Nosferatu",
    stream_icon: "https://exemplo.test/nosferatu.jpg",
    category_name: "Filmes Livres",
    genre: "Terror",
    year: "1922",
    embed_url: "https://fonte.test/embed/nosferatu",
    is_livre: true,
  }]);
});

test("embedsParseM3u: link https com extensão de vídeo vira item de link direto (player nativo)", () => {
  const ctx = loadVodHelpers();
  const items = ctx.embedsParseM3u(par("a", "Filme A (2000)", "https://cdn.test/a.mp4?x=1") + "\n" + par("b", "Filme B (2001)", "https://cdn.test/b.m3u8"));
  assert.equal(items.length, 2);
  assert.equal(items[0].direct_url, "https://cdn.test/a.mp4?x=1");
  assert.equal(items[0].container_extension, "mp4");
  assert.equal(items[0].is_livre, true);
  assert.equal(items[0].embed_url, undefined);
  assert.equal(items[1].container_extension, "m3u8");
});

test("embedsParseM3u: sem lista de domínios — qualquer https (outros hosts, portas, subdomínios) entra", () => {
  const ctx = loadVodHelpers();
  const items = ctx.embedsParseM3u([
    par("a", "A (2000)", "https://um.test/embed/1"),
    par("b", "B (2000)", "https://outro-site.example:8443/player?id=2"),
    par("c", "C (2000)", "https://sub.dominio.novo.test/filme/3#t=5"),
  ].join("\n"));
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.embed_url), [
    "https://um.test/embed/1",
    "https://outro-site.example:8443/player?id=2",
    "https://sub.dominio.novo.test/filme/3#t=5",
  ]);
});

test("embedsParseM3u: descarta http://, javascript:, data:, link com espaço ou aspas e link sem host", () => {
  const ctx = loadVodHelpers();
  const ruins = [
    "http://inseguro.test/embed/1",
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
    "https://com espaco.test/x",
    'https://aspas.test/x"onload="alert(1)',
    "https://",
    "//sem-esquema.test/x",
  ];
  const lista = ruins.map((u, i) => par("r" + i, "Ruim " + i + " (2000)", u)).join("\n");
  assert.deepEqual(ctx.embedsParseM3u(lista), []);
});

test("embedsParseM3u: tvg-id inválido ou ausente e duplicados são descartados, mantendo o primeiro", () => {
  const ctx = loadVodHelpers();
  const lista = [
    par("ok", "Primeiro (2000)", "https://fonte.test/embed/1"),
    par("ok", "Repetido (2001)", "https://fonte.test/embed/2"),
    par("id com espaço", "Id ruim (2002)", "https://fonte.test/embed/3"),
    `#EXTINF:-1 tvg-logo="https://exemplo.test/x.jpg", Sem id (2003)\nhttps://fonte.test/embed/4`,
  ].join("\n");
  const items = ctx.embedsParseM3u(lista);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Primeiro");
});

test("embedsParseM3u: entradas não-string ou vazias devolvem []", () => {
  const ctx = loadVodHelpers();
  for (const v of ["", "   ", null, undefined, 12345, {}]) assert.deepEqual(ctx.embedsParseM3u(v), []);
});

test("embedsParseM3u: teto de 5000 itens", () => {
  const ctx = loadVodHelpers();
  const partes = [];
  for (let i = 1; i <= 5001; i++) partes.push(`#EXTINF:-1 tvg-id="${i}", Filme ${i} (2000)\nhttps://fonte.test/embed/${i}`);
  const items = ctx.embedsParseM3u(partes.join("\n"));
  assert.equal(items.length, 5000);
  assert.equal(items[4999].stream_id, "liv-5000");
});

test("embedsParseM3u: sanitiza nome com HTML e logo malicioso", () => {
  const ctx = loadVodHelpers();
  const m3u = `#EXTINF:-1 tvg-id="x" tvg-logo="javascript:alert(1)" group-title="G", <img src=x onerror=alert(1)> Filme (2000)\nhttps://fonte.test/embed/x`;
  const [item] = ctx.embedsParseM3u(m3u);
  assert.ok(item);
  assert.doesNotMatch(item.name, /[<>]/);
  assert.doesNotMatch(item.stream_icon, /javascript:/i);
});

// ── Chave da conta ──
test("embedsEnabled: true somente se sint_embeds_url começar com http:// ou https://", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.embedsEnabled(fakeStorage({})), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "" })), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "javascript:alert(1)" })), false);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "https://exemplo.test/livres.m3u" })), true);
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_embeds_url: "http://exemplo.test/livres.m3u" })), true);
  assert.equal(ctx.embedsEnabled(null), false);
  // a chave dos Legendados não liga os Filmes Livres (e vice-versa)
  assert.equal(ctx.embedsEnabled(fakeStorage({ sint_legendados_url: "https://exemplo.test/leg.m3u" })), false);
  assert.equal(ctx.legendadosEnabled(fakeStorage({ sint_embeds_url: "https://exemplo.test/livres.m3u" })), false);
});

// ── Tipo de reprodução ──
test("vodItemPlayKind: embed, direct ou xtream; vodItemIsExtra: legendado ou livre", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.vodItemPlayKind({ embed_url: "https://fonte.test/embed/1", is_livre: true }), "embed");
  assert.equal(ctx.vodItemPlayKind({ direct_url: "https://cdn.test/a.mp4", is_livre: true }), "direct");
  assert.equal(ctx.vodItemPlayKind({ direct_url: "https://cdn.test/a.mp4", is_legendado: true }), "direct");
  assert.equal(ctx.vodItemPlayKind({ stream_id: 10, container_extension: "mkv" }), "xtream");
  assert.equal(ctx.vodItemPlayKind(null), "xtream");
  assert.equal(ctx.vodItemPlayKind(undefined), "xtream");
  assert.equal(ctx.vodItemIsExtra({ is_legendado: true }), true);
  assert.equal(ctx.vodItemIsExtra({ is_livre: true }), true);
  assert.equal(ctx.vodItemIsExtra({ stream_id: 10 }), false);
  assert.equal(ctx.vodItemIsExtra(null), false);
});

// ── HTML do iframe ──
test("embedFrameHtml: iframe com allow e allowfullscreen, URL escapada, SEM sandbox e SEM referrerpolicy (decisão do produto)", () => {
  const ctx = loadVodHelpers();
  const html = ctx.embedFrameHtml("https://fonte.test/embed/1?a=1&b=2");
  assert.match(html, /^<iframe /);
  assert.match(html, /src="https:\/\/fonte\.test\/embed\/1\?a=1&amp;b=2"/);
  assert.match(html, /allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"/);
  assert.match(html, /\ballowfullscreen\b/);
  assert.doesNotMatch(html, /sandbox/i);
  assert.doesNotMatch(html, /referrerpolicy/i);
  assert.match(html, /id="embed-frame"/);
});

test("embedFrameHtml: só https sem espaço nem aspas; qualquer outra coisa devolve string vazia", () => {
  const ctx = loadVodHelpers();
  for (const u of ["http://fonte.test/x", "javascript:alert(1)", "data:text/html,<b>", 'https://a.test/x"y', "https://a b.test/x", "", null, undefined, 42]) {
    assert.equal(ctx.embedFrameHtml(u), "", String(u));
  }
});
```

- [ ] **Step 2: Registrar as funções no carregador de testes**

Em `tests/vod/loadVodHelpers.js`, na lista `PURE_HELPER_NAMES`, trocar a última linha

```js
  "legendadosDirectExt", "legendadosEnabled", "legendadosParseM3u",
```

por

```js
  "legendadosDirectExt", "legendadosEnabled", "legendadosParseM3u",
  "embedsEnabled", "embedsClassifyUrl", "embedsParseM3u", "vodItemPlayKind", "vodItemIsExtra", "embedFrameHtml",
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/vod/embeds.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail` com todos os testes (funções ainda não definidas: `ctx.embedsParseM3u is not a function`).

- [ ] **Step 4: Implementar em `sintoniza-link.html`**

Inserir logo **antes** de `function parseM3U(text) {`:

```js
// ─── Filmes Livres: filmes de fontes autorizadas por embed oficial (spec 2026-10-24) ───
// Sem lista fixa de domínios: quem cura o que entra é o dono da lista. Só https (http seria bloqueado como conteúdo misto).
const EMBEDS_CATEGORY_NAME = "Filmes Livres";
const EMBEDS_MAX_ITEMS = 5000;

function embedsEnabled(storage) {
  return extraListEnabled(storage, "sint_embeds_url");
}

// Decide o tipo do link: https com extensão de vídeo = player nativo; qualquer outro https = embed (tela própria).
function embedsClassifyUrl(url) {
  const u = typeof url === "string" ? url.trim() : "";
  if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return null;
  try { new URL(u); } catch (e) { return null; }
  const ext = legendadosDirectExt(u);
  return ext
    ? { direct_url: u, container_extension: ext, is_livre: true }
    : { embed_url: u, is_livre: true };
}

function embedsParseM3u(text) {
  return m3uExtraParse(text, {
    idPrefix: "liv-",
    category: EMBEDS_CATEGORY_NAME,
    classify: embedsClassifyUrl,
    max: EMBEDS_MAX_ITEMS,
  });
}

// Cache de sessão POR LINK: trocar de conta (outro link) nunca mostra a lista da conta anterior
const _embedsCache = new Map();

async function embedsFetch(url) {
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return [];
  const key = url.trim();
  if (_embedsCache.has(key)) return _embedsCache.get(key);

  const text = await extraListFetchText(key);
  if (!text) return [];

  const items = embedsParseM3u(text);
  if (items && items.length > 0) {
    _embedsCache.set(key, items);
  }
  return items;
}

// Como tocar um item: "embed" (tela própria com iframe), "direct" (player nativo, link direto) ou "xtream" (catálogo do provedor)
function vodItemPlayKind(item) {
  if (item && typeof item.embed_url === "string" && item.embed_url) return "embed";
  if (item && typeof item.direct_url === "string" && item.direct_url) return "direct";
  return "xtream";
}

// Item de lista extra (Legendados ou Filmes Livres): não usa as credenciais Xtream
function vodItemIsExtra(item) {
  return !!item && (item.is_legendado === true || item.is_livre === true);
}

// Iframe do embed. Sem sandbox e sem referrerpolicy por decisão do produto: só entram sites autorizados, e alguns
// conferem o referenciador ou abrem popups do próprio player. Devolve "" se o link não for https seguro.
function embedFrameHtml(url) {
  const u = typeof url === "string" ? url.trim() : "";
  if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return "";
  return `<iframe id="embed-frame" src="${escapeHtmlText(u)}" title="Player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowfullscreen></iframe>`;
}

```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/vod/embeds.test.js 2>&1 | grep -E "^(ℹ (pass|fail)|✖)"`
Expected: `ℹ pass 12`, `ℹ fail 0`. Se `embedsParseM3u: sanitiza…` falhar por causa do formato de `sanitizeLabel`/`sanitizeImageUrl`, ler as duas funções e ajustar só as asserções do teste (o comportamento dessas funções é o que já vale para Legendados).

- [ ] **Step 6: Suíte inteira**

Run: `node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 579` (567 + 12), `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add sintoniza-link.html tests/vod/embeds.test.js tests/vod/loadVodHelpers.js
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(web): leitura da lista de Filmes Livres, tipo de reprodução por item e HTML do iframe de embed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Link da conta (`url_embeds`) no app

**Files:**
- Modify: `sintoniza-link.html` (`OTT_LIST_KEYS` ~linha 3749; `ottParseDeviceConfig` ~3815; `ottApplyPlaylist` ~3843; `OTT_WEB_ACCOUNT_KEY_RES` ~4885; `ottWebWipeAccountData` ~4900)
- Test: `tests/vod/embeds.test.js` (acrescentar ao final)

- [ ] **Step 1: Escrever os testes que falham (acrescentar ao final de `tests/vod/embeds.test.js`)**

```js

// ── Contrato da conta: url_embeds ──
test("OTT_LIST_KEYS.EMBEDS guarda o link em sint_embeds_url, ao lado de LEGENDADOS", () => {
  const o = loadOtt();
  assert.equal(plain(o.OTT_LIST_KEYS).EMBEDS, "sint_embeds_url");
  assert.equal(plain(o.OTT_LIST_KEYS).LEGENDADOS, "sint_legendados_url");
});

test("ottParseDeviceConfig: propaga url_embeds só se começar com http(s); url_legendados segue independente", () => {
  const o = loadOtt();
  const base = { id: "1", nome: "P", url_m3u: "http://exemplo.test/m3u" };
  const cfg = plain(o.ottParseDeviceConfig({
    status: "ok",
    playlists: [
      { ...base, url_embeds: "https://exemplo.test/livres.m3u", url_legendados: "https://exemplo.test/leg.m3u" },
      { ...base, url_embeds: "http://exemplo.test/livres.m3u" },
      { ...base, url_embeds: "javascript:alert(1)" },
      { ...base, url_embeds: "ftp://exemplo.test/livres.m3u" },
      { ...base, url_embeds: null },
      { ...base },
    ],
  }));
  assert.equal(cfg.playlists[0].url_embeds, "https://exemplo.test/livres.m3u");
  assert.equal(cfg.playlists[0].url_legendados, "https://exemplo.test/leg.m3u");
  assert.equal(cfg.playlists[1].url_embeds, "http://exemplo.test/livres.m3u");
  for (const i of [2, 3, 4, 5]) assert.equal(cfg.playlists[i].url_embeds, null, `lista ${i}`);
});

test("ottApplyPlaylist: grava e remove sint_embeds_url sem apagar o cache do guia (EPG)", () => {
  const o = loadOtt();
  const s = fakeStorage();
  const pl = { url_m3u: "http://exemplo.test/m3u", url_vod: "http://exemplo.test/vod", url_epg: "http://exemplo.test/epg", url_embeds: "https://exemplo.test/livres.m3u" };

  assert.equal(o.ottApplyPlaylist(s, pl), true);
  assert.equal(s.getItem("sint_embeds_url"), "https://exemplo.test/livres.m3u");

  s.setItem("sint_epg_cache", "cache-epg-valido");
  assert.equal(o.ottApplyPlaylist(s, pl), false, "chamada idêntica não muda nada");

  // trocar só o link dos Filmes Livres muda, mas o cache do guia fica
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_embeds: "https://exemplo.test/livres2.m3u" }), true);
  assert.equal(s.getItem("sint_embeds_url"), "https://exemplo.test/livres2.m3u");
  assert.equal(s.getItem("sint_epg_cache"), "cache-epg-valido");

  // sem url_embeds a chave some, também sem mexer no guia
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_embeds: null }), true);
  assert.equal(s.getItem("sint_embeds_url"), null);
  assert.equal(s.getItem("sint_epg_cache"), "cache-epg-valido");

  // trocar a lista de canais continua apagando o guia
  assert.equal(o.ottApplyPlaylist(s, { ...pl, url_m3u: "http://exemplo.test/m3u_novo", url_embeds: null }), true);
  assert.equal(s.getItem("sint_epg_cache"), null);

  // limpeza completa
  o.ottApplyPlaylist(s, pl);
  o.ottApplyPlaylist(s, null);
  assert.equal(s.getItem("sint_embeds_url"), null);
});

test("troca de conta e ottWebWipeAccountData limpam sint_embeds_url", () => {
  const o = loadOtt();
  const s = fakeStorage({ sint_web_owner: "user-1", sint_embeds_url: "https://exemplo.test/livres.m3u", sint_url: "http://exemplo.test/m3u" });
  o.ottWebWipeAccountData(s);
  assert.equal(s.getItem("sint_embeds_url"), null, "wipe de conta");

  s.setItem("sint_web_owner", "user-1");
  s.setItem("sint_embeds_url", "https://exemplo.test/livres.m3u");
  assert.equal(o.ottWebOwnerSwitch(s, "user-2"), true);
  assert.equal(s.getItem("sint_embeds_url"), null, "troca de dono");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/embeds.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 4` (os testes novos).

- [ ] **Step 3: Editar `OTT_LIST_KEYS`**

Trocar

```js
const OTT_LIST_KEYS = { URL: "sint_url", MODE: "sint_mode", VOD: "sint_vod_url", EPG: "sint_epg_url", EPG_CACHE: "sint_epg_cache", LEGENDADOS: "sint_legendados_url" };
```

por

```js
const OTT_LIST_KEYS = { URL: "sint_url", MODE: "sint_mode", VOD: "sint_vod_url", EPG: "sint_epg_url", EPG_CACHE: "sint_epg_cache", LEGENDADOS: "sint_legendados_url", EMBEDS: "sint_embeds_url" };
```

- [ ] **Step 4: Editar `ottParseDeviceConfig`**

Trocar o trecho

```js
          const leg = ottStr(l.url_legendados);
          return {
            id: ottStr(l.id),
            nome: ottStr(l.nome) || "Principal",
            url_m3u: l.url_m3u,
            url_vod: ottStr(l.url_vod) || null,
            url_epg: ottStr(l.url_epg) || null,
            url_legendados: (leg && /^https?:\/\//i.test(leg)) ? leg : null,
          };
```

por

```js
          const leg = ottStr(l.url_legendados);
          const emb = ottStr(l.url_embeds);
          return {
            id: ottStr(l.id),
            nome: ottStr(l.nome) || "Principal",
            url_m3u: l.url_m3u,
            url_vod: ottStr(l.url_vod) || null,
            url_epg: ottStr(l.url_epg) || null,
            url_legendados: (leg && /^https?:\/\//i.test(leg)) ? leg : null,
            url_embeds: (emb && /^https?:\/\//i.test(emb)) ? emb : null,
          };
```

- [ ] **Step 5: Editar `ottApplyPlaylist`**

Substituir a função inteira por:

```js
// Grava os links liberados nas chaves que o app já usa; null limpa. true = mudou algo.
function ottApplyPlaylist(storage, playlist) {
  const wanted = [
    [OTT_LIST_KEYS.URL, playlist ? playlist.url_m3u : null],
    [OTT_LIST_KEYS.MODE, playlist ? "url" : null],
    [OTT_LIST_KEYS.VOD, playlist ? playlist.url_vod : null],
    [OTT_LIST_KEYS.EPG, playlist ? playlist.url_epg : null],
    [OTT_LIST_KEYS.LEGENDADOS, playlist ? playlist.url_legendados : null],
    [OTT_LIST_KEYS.EMBEDS, playlist ? playlist.url_embeds : null],
  ];
  let changed = false;
  let epgInvalidated = false;
  wanted.forEach(([key, value]) => {
    // Listas extras (Legendados e Filmes Livres) não têm relação com o guia: mexer nelas não invalida o cache do EPG
    const extra = key === OTT_LIST_KEYS.LEGENDADOS || key === OTT_LIST_KEYS.EMBEDS;
    const current = storage.getItem(key);
    if (value) {
      if (current !== value) {
        storage.setItem(key, value);
        changed = true;
        if (!extra) epgInvalidated = true;
      }
    } else if (current !== null) {
      storage.removeItem(key);
      changed = true;
      if (!extra) epgInvalidated = true;
    }
  });
  if (epgInvalidated) storage.removeItem(OTT_LIST_KEYS.EPG_CACHE); // guia antigo não vale para a lista nova
  return changed;
}
```

- [ ] **Step 6: Editar a limpeza de conta**

Em `OTT_WEB_ACCOUNT_KEY_RES`, depois de `/^sint_legendados_url$/,` acrescentar a linha `  /^sint_embeds_url$/,`.

Em `ottWebWipeAccountData`, trocar o fim da lista `fixas`

```js
OTT_WEB_KEYS.CHOSEN, "sint_legendados_url"];
```

por

```js
OTT_WEB_KEYS.CHOSEN, "sint_legendados_url", "sint_embeds_url"];
```

- [ ] **Step 7: Rodar os testes (Filmes Livres + Legendados + suíte)**

Run: `node --test tests/vod/embeds.test.js tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)" && node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`; suíte inteira `pass 583`.

- [ ] **Step 8: Commit**

```bash
git add sintoniza-link.html tests/vod/embeds.test.js
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(web): o app recebe o link dos Filmes Livres da conta (url_embeds) e o apaga na troca de conta

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Campos do item e roteamento (modal, cartão, Minha Lista)

**Files:**
- Modify: `sintoniza-link.html` (`VOD_ITEM_FIELDS` ~9691; `openVodModal` ~10663; `onVodCardAreaClick` ~12543)
- Modify: `tests/vod/legendados.test.js` (uma expressão em "ligações", abaixo)
- Test: `tests/vod/embeds.test.js` (acrescentar ao final)

`openEmbedScreen` só é criada na Tarefa 9; aqui o modal passa a chamá-la (a função é declarada no mesmo script, sem problema de ordem em tempo de execução).

- [ ] **Step 1: Escrever os testes que falham (acrescentar ao final de `tests/vod/embeds.test.js`)**

```js

// ── Campos guardados na Minha Lista e roteamento ──
test("trimVodItem e buildMyListEntry guardam embed_url e is_livre", () => {
  const ctx = loadVodHelpers();
  const item = {
    stream_id: "liv-nosferatu", name: "Nosferatu", stream_icon: "https://exemplo.test/n.jpg", category_name: "Filmes Livres",
    genre: "Terror", year: "1922", embed_url: "https://fonte.test/embed/nosferatu", is_livre: true,
  };
  const trimmed = ctx.trimVodItem(item);
  assert.equal(trimmed.embed_url, "https://fonte.test/embed/nosferatu");
  assert.equal(trimmed.is_livre, true);
  const entry = ctx.buildMyListEntry(item, "vod");
  assert.equal(entry.id, "liv-nosferatu");
  assert.equal(entry.item.embed_url, "https://fonte.test/embed/nosferatu");
  // o item guardado ainda é reconhecido como embed
  assert.equal(ctx.vodItemPlayKind(entry.item), "embed");
  assert.equal(ctx.vodItemIsExtra(entry.item), true);
});

test("ligações: o modal e o cartão roteiam por vodItemPlayKind/vodItemIsExtra", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  // modal: embed abre a tela de embed, direct toca por playVodSelection(item.direct_url…)
  assert.match(html, /vodItemPlayKind\(item\)[\s\S]*?openEmbedScreen\(item\)[\s\S]*?playVodSelection\(\s*item\.direct_url/);
  // cartão: item extra não exige credenciais Xtream
  assert.match(html, /!creds && !vodItemIsExtra\(item\)/);
  // os campos novos entram no item enxuto
  assert.match(html, /VOD_ITEM_FIELDS = \[[^\]]*"embed_url"[^\]]*"is_livre"[^\]]*\]/);
});
```

- [ ] **Step 2: Atualizar a expressão do teste de Legendados que citava `item.is_legendado`**

Em `tests/vod/legendados.test.js`, no teste `ligações no sintoniza-link.html: categoria Legendados, modal e busca`, trocar a linha

```js
  assert.match(html, /item\.is_legendado[\s\S]*?playVodSelection\(\s*item\.direct_url/);
```

por

```js
  assert.match(html, /vodItemPlayKind\(item\)[\s\S]*?playVodSelection\(\s*item\.direct_url/);
```

e o comentário acima dela para: `// openVodModal esconde Baixar e TV para itens extras e chama playVodSelection com direct_url (via vodItemPlayKind)`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/vod/embeds.test.js tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 3` (os dois novos de embeds e o de ligações de Legendados já atualizado).

- [ ] **Step 4: Editar `VOD_ITEM_FIELDS`**

Trocar

```js
"releaseDate", "year", "direct_url", "is_legendado"];
```

por

```js
"releaseDate", "year", "direct_url", "is_legendado", "embed_url", "is_livre"];
```

- [ ] **Step 5: Editar `openVodModal`**

Trocar o trecho

```js
    if (item.is_legendado) {
      playBtn.onclick = () => playVodSelection(
        item.direct_url,
        { id: item.stream_id, contType: "vod", title, cover: item.stream_icon, vodItem: item, castInfo: null }
      );
      tvBtn.style.display = "none";
```

por

```js
    const kind = vodItemPlayKind(item);
    if (kind !== "xtream") {
      // Item de lista extra: "embed" abre a tela própria do player da fonte; "direct" toca no player nativo.
      // Nenhum dos dois usa as credenciais Xtream, e não há Baixar nem Assistir na TV.
      playBtn.onclick = kind === "embed"
        ? () => openEmbedScreen(item)
        : () => playVodSelection(
            item.direct_url,
            { id: item.stream_id, contType: "vod", title, cover: item.stream_icon, vodItem: item, castInfo: null }
          );
      tvBtn.style.display = "none";
```

(o restante do bloco, `tvBtn.onclick = null; dlBtn.style.display = "none"; dlBtn.onclick = null; } else { … }`, não muda).

- [ ] **Step 6: Editar o clique de cartão**

Trocar

```js
    if (!creds && !item.is_legendado) { showToast("Configure suas credenciais Xtream em Configurações."); return; }
```

por

```js
    if (!creds && !vodItemIsExtra(item)) { showToast("Configure suas credenciais Xtream em Configurações."); return; }
```

- [ ] **Step 7: Rodar os testes**

Run: `node --test tests/vod/embeds.test.js tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)" && node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`; suíte inteira `pass 585`.

- [ ] **Step 8: Commit**

```bash
git add sintoniza-link.html tests/vod/embeds.test.js tests/vod/legendados.test.js
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(web): itens de lista extra roteiam por tipo (embed, link direto ou Xtream) no modal e no cartão

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Fileira "Filmes Livres" e carga em paralelo

**Files:**
- Modify: `sintoniza-link.html` (`legendadosRowHtml` ~10367; `renderVodRows` ~10396, 10407, 10431; `loadVodCatalog` ~10469)
- Modify: `tests/vod/legendados.test.js` (uma expressão em "ligações")
- Test: `tests/vod/embeds.test.js` (acrescentar ao final)

- [ ] **Step 1: Escrever os testes que falham (acrescentar ao final de `tests/vod/embeds.test.js`)**

```js

// ── Fileira e carga ──
test("ligações: fileira genérica, Filmes Livres depois dos Legendados e carga em paralelo", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  // fileira genérica com wrappers
  assert.match(html, /function extraRowHtml\(catId, titulo, items, contType\)/);
  assert.match(html, /function legendadosRowHtml\(items, contType\) \{\s*return extraRowHtml\("legendados", "Legendados"/);
  assert.match(html, /function livresRowHtml\(items, contType\) \{\s*return extraRowHtml\("livres", EMBEDS_CATEGORY_NAME/);
  // renderVodRows: Legendados primeiro, Filmes Livres logo abaixo, nos dois modos de exibição
  assert.match(html, /const extrasHtml = legHtml \+ livHtml;/);
  assert.match(html, /rowsEl\.innerHTML = extrasHtml \+ groups\.map/);
  assert.match(html, /rowsEl\.innerHTML = extrasHtml \+ _vodCatalogCache\.categories\.map/);
  assert.doesNotMatch(html, /rowsEl\.innerHTML = legHtml \+/);
  // loadVodCatalog: carga em paralelo só na aba Filmes, categoria "livres" no cache
  assert.match(html, /vodType === "vod" && embedsEnabled\(localStorage\)/);
  assert.match(html, /embedsFetch\(localStorage\.getItem\("sint_embeds_url"\)\)/);
  assert.match(html, /itemsByCategory\["livres"\] = items/);
  assert.match(html, /categoryStatus\["livres"\] = "ok"/);
});
```

- [ ] **Step 2: Atualizar a expressão de Legendados que citava o id literal do carrossel**

Em `tests/vod/legendados.test.js`, no mesmo teste de "ligações", trocar

```js
  assert.match(html, /vod-carousel-legendados/);
```

por

```js
  assert.match(html, /extraRowHtml\("legendados"/);
  assert.match(html, /id="vod-carousel-\$\{catId\}"/);
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/vod/embeds.test.js tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 2` (o teste novo de fileira e o de ligações de Legendados já atualizado).

- [ ] **Step 4: Generalizar a fileira**

Substituir a função `legendadosRowHtml` inteira por:

```js
// Fileira de uma lista extra (Legendados, Filmes Livres): mesmo desenho das fileiras do catálogo, com "Ver todos"
function extraRowHtml(catId, titulo, items, contType) {
  if (!items || !items.length) return "";
  const catItems = attachProviders(items.slice(0, VOD_ROW_INITIAL_COUNT), _vodProviderMap);
  return `
    <div class="vod-row" data-cat-id="${catId}">
      <div class="vod-row-header">
        <h2>${escapeHtmlText(titulo)}</h2>
        <button class="vod-see-all" data-cat-id="${catId}">Ver todos</button>
      </div>
      <div class="vod-carousel" id="vod-carousel-${catId}">${catItems.map(item => vodCardHtml(item, contType)).join("")}</div>
    </div>`;
}

function legendadosRowHtml(items, contType) {
  return extraRowHtml("legendados", "Legendados", items, contType);
}

function livresRowHtml(items, contType) {
  return extraRowHtml("livres", EMBEDS_CATEGORY_NAME, items, contType);
}
```

- [ ] **Step 5: `renderVodRows` desenha as duas fileiras extras**

Trocar

```js
  const legItems = _vodCatalogCache.itemsByCategory["legendados"];
  const legHtml = (contType === "vod" && legItems && legItems.length) ? legendadosRowHtml(legItems, contType) : "";
```

por

```js
  // Fileiras extras no topo de Filmes: Legendados primeiro, Filmes Livres logo abaixo
  const legItems = _vodCatalogCache.itemsByCategory["legendados"];
  const legHtml = (contType === "vod" && legItems && legItems.length) ? legendadosRowHtml(legItems, contType) : "";
  const livItems = _vodCatalogCache.itemsByCategory["livres"];
  const livHtml = (contType === "vod" && livItems && livItems.length) ? livresRowHtml(livItems, contType) : "";
  const extrasHtml = legHtml + livHtml;
```

e trocar as duas ocorrências de `rowsEl.innerHTML = legHtml + ` por `rowsEl.innerHTML = extrasHtml + ` (modo "agrupar": `rowsEl.innerHTML = extrasHtml + groups.map(g => {`; modo padrão: `rowsEl.innerHTML = extrasHtml + _vodCatalogCache.categories.map(cat => {`).

- [ ] **Step 6: `loadVodCatalog` carrega a lista de embeds**

Logo **depois** do bloco `if (vodType === "vod" && legendadosEnabled(localStorage)) { … }` (e antes do comentário `// Mapa de streaming: uma vez por sessão`), inserir:

```js
  // Filmes Livres (embeds oficiais): em paralelo, sem bloquear o catálogo; independente dos Legendados
  if (vodType === "vod" && embedsEnabled(localStorage)) {
    embedsFetch(localStorage.getItem("sint_embeds_url")).then(items => {
      if (_vodCatalogCache.vodType !== "vod") return;
      if (!items || !items.length) return;
      _vodCatalogCache.itemsByCategory["livres"] = items;
      _vodCatalogCache.categoryStatus["livres"] = "ok";
      if (_vodCatalogCache.settled) {
        _vodCatalogCache.flat = dedupeVodItemsByTitle(Object.values(_vodCatalogCache.itemsByCategory).flat());
      }
      renderVodRows(Object.values(_vodCatalogCache.itemsByCategory).flat(), "vod");
    }).catch(() => {});
  }
```

- [ ] **Step 7: Rodar os testes**

Run: `node --test tests/vod/embeds.test.js tests/vod/legendados.test.js 2>&1 | grep -E "^ℹ (pass|fail)" && node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`; suíte inteira `pass 586`.

- [ ] **Step 8: Commit**

```bash
git add sintoniza-link.html tests/vod/embeds.test.js tests/vod/legendados.test.js
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(web): fileira "Filmes Livres" abaixo dos Legendados, carregada em paralelo ao catálogo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Tela de embed (HTML, CSS, abrir/fechar, voltar do navegador e do Android)

**Files:**
- Modify: `sintoniza-link.html` (CSS antes de `/* ════════════ VOD MODAL ════════════ */` ~linha 955; HTML antes de `<!-- VOD MODAL:` ~2273; JS depois de `closeVodModal()` ~10741; ligações junto de `vod-modal-close` ~12521 e no `keydown` de Escape ~12271)
- Test: `tests/vod/embeds.test.js` (acrescentar ao final)

- [ ] **Step 1: Escrever o teste que falha (acrescentar ao final de `tests/vod/embeds.test.js`)**

```js

// ── Tela de embed ──
test("ligações: tela de embed com voltar, Abrir no navegador, popstate e Escape; iframe nunca com sandbox", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  // marcação
  assert.match(html, /<div id="embed-screen" class="hidden" role="dialog" aria-modal="true" aria-hidden="true"/);
  assert.match(html, /id="embed-back"/);
  assert.match(html, /id="embed-external"[^>]*target="_blank"[^>]*rel="noopener"/);
  assert.match(html, /id="embed-hint"/);
  assert.match(html, /id="embed-frame-host"/);
  // abrir: pausa o player nativo, fecha o modal, cria a entrada de histórico e monta o iframe
  assert.match(html, /function openEmbedScreen\(item\)[\s\S]*?embedFrameHtml\([\s\S]*?pausePlayerForCast\(\)[\s\S]*?closeVodModal\(\)[\s\S]*?history\.pushState/);
  // fechar: remove o iframe (para o áudio); popstate (voltar do navegador e do Android) e Escape fecham a tela
  assert.match(html, /function closeEmbedScreen\(fromPopState\)[\s\S]*?\.innerHTML = ""/);
  assert.match(html, /addEventListener\("popstate", \(\) => closeEmbedScreen\(true\)\)/);
  assert.match(html, /if \(_embedOpen\) closeEmbedScreen\(\)/);
  // decisão do produto: nenhum iframe do app usa sandbox
  assert.doesNotMatch(html, /<iframe[^>]*sandbox/i);
  assert.doesNotMatch(html, /\.sandbox\s*=/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/embeds.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 1`.

- [ ] **Step 3: CSS**

Inserir logo **antes** da linha `/* ════════════ VOD MODAL ════════════ */`:

```css
    /* ════════════ TELA DE EMBED (Filmes Livres) ════════════ */
    /* Acima do modal de filme (9999) e abaixo do menu da TV (10001) e do aviso (10002). */
    #embed-screen {
      position: fixed; inset: 0; z-index: 10000; background: #000;
      display: flex; flex-direction: column;
      padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
    }
    #embed-screen.hidden { display: none !important; }
    .embed-bar {
      display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; flex-shrink: 0;
      background: var(--background); border-bottom: 1px solid var(--border);
    }
    .embed-bar h2 { flex: 1; min-width: 0; margin: 0; font-size: 1rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .embed-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: .4rem; min-width: 2.5rem; min-height: 2.5rem; padding: 0 .75rem;
      border-radius: .6rem; border: 1px solid var(--border); background: transparent; color: var(--foreground);
      font-size: .85rem; text-decoration: none; cursor: pointer;
    }
    .embed-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .embed-hint { margin: 0; padding: .5rem .75rem; font-size: .85rem; flex-shrink: 0; background: oklch(0.2 0.02 65); color: var(--foreground); }
    .embed-hint.hidden { display: none; }
    #embed-frame-host { flex: 1; min-height: 0; }
    #embed-frame-host iframe { display: block; width: 100%; height: 100%; border: 0; background: #000; }

```

- [ ] **Step 4: HTML**

Inserir logo **antes** da linha `<!-- VOD MODAL: detalhes de um filme/série + lista de episódios -->`:

```html
<!-- EMBED: tela do player incorporado (categoria Filmes Livres). O iframe não usa sandbox por decisão do produto: só entram fontes autorizadas -->
<div id="embed-screen" class="hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="embed-title">
  <div class="embed-bar">
    <button type="button" id="embed-back" class="embed-btn" aria-label="Voltar"><i data-lucide="arrow-left" style="width:20px;height:20px"></i></button>
    <h2 id="embed-title">Filme</h2>
    <a id="embed-external" class="embed-btn" href="#" target="_blank" rel="noopener">Abrir no navegador</a>
  </div>
  <p id="embed-hint" class="embed-hint hidden">O player não carregou? Alguns sites não permitem abrir aqui. Use “Abrir no navegador”.</p>
  <div id="embed-frame-host"></div>
</div>

```

- [ ] **Step 5: JS de abrir e fechar**

Inserir logo **depois** da função `closeVodModal()` (termina com `modal.setAttribute("aria-hidden", "true");\n}`):

```js

// ─── Tela de embed (Filmes Livres) ───
let _embedOpen = false;
let _embedHintTimer = 0;

// Abre o player da fonte em tela cheia. O histórico ganha uma entrada para o botão voltar do navegador e o botão
// físico do Android fecharem a tela em vez de sair do app (ver o listener de popstate).
function openEmbedScreen(item) {
  const frameHtml = embedFrameHtml(item && item.embed_url);
  if (!frameHtml) { showToast("Link do player inválido."); return; }
  pausePlayerForCast(); // se o player nativo estiver tocando, pausa para não tocar nos dois
  closeVodModal();
  document.getElementById("embed-title").textContent = item.name || item.title || "Filme";
  document.getElementById("embed-external").href = item.embed_url;
  document.getElementById("embed-frame-host").innerHTML = frameHtml;
  const hint = document.getElementById("embed-hint");
  hint.classList.add("hidden");
  clearTimeout(_embedHintTimer);
  // Se o quadro não terminar de carregar em 8 s, lembra do "Abrir no navegador" (o app não detecta bloqueio de iframe)
  const frame = document.getElementById("embed-frame");
  if (frame) frame.addEventListener("load", () => clearTimeout(_embedHintTimer));
  _embedHintTimer = setTimeout(() => hint.classList.remove("hidden"), 8000);
  const screen = document.getElementById("embed-screen");
  screen.classList.remove("hidden");
  screen.setAttribute("aria-hidden", "false");
  if (!_embedOpen) {
    try { history.pushState({ embed: 1 }, ""); } catch (e) { /* sem histórico: o botão Voltar da tela continua fechando */ }
  }
  _embedOpen = true;
  document.getElementById("embed-back").focus();
}

// fromPopState = true quando o fechamento veio do botão voltar do navegador/Android (a entrada de histórico já foi consumida)
function closeEmbedScreen(fromPopState) {
  if (!_embedOpen) return;
  _embedOpen = false;
  clearTimeout(_embedHintTimer);
  document.getElementById("embed-frame-host").innerHTML = ""; // remove o iframe: o vídeo e o áudio param
  const screen = document.getElementById("embed-screen");
  screen.classList.add("hidden");
  screen.setAttribute("aria-hidden", "true");
  if (!fromPopState) {
    try { history.back(); } catch (e) { /* ignora */ } // consome a entrada criada na abertura (o popstate seguinte não faz nada)
  }
}
```

- [ ] **Step 6: Ligações de eventos**

Logo depois da linha

```js
  document.getElementById("vod-modal-close").addEventListener("click", closeVodModal);
```

acrescentar:

```js
  document.getElementById("embed-back").addEventListener("click", () => closeEmbedScreen());
  window.addEventListener("popstate", () => closeEmbedScreen(true)); // voltar do navegador e botão físico do Android
```

E no listener de `keydown` com `Escape` (o que chama `hideEpgPopover()` e `closeCardActions()`), acrescentar uma linha depois de `closeCardActions();`:

```js
      if (_embedOpen) closeEmbedScreen();
```

- [ ] **Step 7: Rodar os testes**

Run: `node --test tests/vod/embeds.test.js 2>&1 | grep -E "^ℹ (pass|fail)" && node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`; suíte inteira `pass 587`.

- [ ] **Step 8: Commit**

```bash
git add sintoniza-link.html tests/vod/embeds.test.js
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -F - <<'EOF'
feat(web): tela de embed em tela cheia (iframe sem restrições), com voltar, Abrir no navegador e aviso de carga

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Verificação completa e teste manual no navegador

**Files:** nenhum arquivo do repositório muda. Arquivos temporários só no diretório de rascunho da sessão (variável `$SP` abaixo).

- [ ] **Step 1: Suítes completas dos dois repositórios**

Run:
```bash
cd /c/Users/guait/Documents/visual-craft-assistant && node --test "tests/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd /c/Users/guait/Documents/Novo-App-de-TV && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: app `pass 587 fail 0`; site `pass 554 fail 0`.

- [ ] **Step 2: Gerar o app web e subir um servidor local**

```bash
SP="<diretório de rascunho da sessão>"; mkdir -p "$SP/web-embeds" && cd /c/Users/guait/Documents/visual-craft-assistant
node scripts/build-web.mjs --out "$SP/web-embeds" 2>&1 | tail -2
cat > "$SP/web-embeds/livres.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1 tvg-id="teste-embed" group-title="Teste", Página de teste (2020)
https://example.com/
#EXTINF:-1 tvg-id="teste-ruim" group-title="Teste", Link http descartado (2020)
http://example.com/
EOF
python -m http.server 8099 --directory "$SP/web-embeds" &
```
Expected: `[build-web] app web gerado em …`; servidor em `http://localhost:8099`.

- [ ] **Step 3: Conferir no navegador (Playwright)**

Abrir `http://localhost:8099/app/index.html?noott=1` (o `noott=1` evita o login da conta) e, pelo console da página, preparar o armazenamento:

```js
localStorage.setItem("sint_vod_url", "http://localhost:9/get.php?username=x&password=y"); // a seção Filmes exige credenciais; o catálogo falha, as fileiras extras não dependem dele
localStorage.setItem("sint_embeds_url", "http://localhost:8099/livres.m3u");
location.reload();
```

Abrir Filmes e conferir, nesta ordem:
1. Aparece a fileira "Filmes Livres" com **1** cartão ("Página de teste"); o item `http://` não aparece.
2. Clicar no cartão abre o modal; "Assistir" abre a tela de embed com o título, o botão voltar e "Abrir no navegador"; o iframe mostra `example.com`.
3. O botão voltar fecha a tela e o iframe some do DOM (`document.getElementById("embed-frame")` → `null`).
4. Reabrir e usar o voltar do navegador (`history.back()`): a tela fecha e o app continua em Filmes.
5. Reabrir e apertar `Escape` fora do iframe: a tela fecha.
6. Reabrir e esperar 8 s: o aviso "O player não carregou?" aparece (example.com carrega rápido, então para ver o aviso, bloquear a rede da página ou usar um link que não responda; se não for possível, confirmar apenas que o aviso some quando o quadro carrega).
7. Colocar também `localStorage.setItem("sint_legendados_url", "<link de teste com um .mp4>")` e conferir que as **duas** fileiras coexistem, com Legendados acima de Filmes Livres.

- [ ] **Step 4: Encerrar o servidor local**

Run: `kill %1 2>/dev/null; echo ok`
Expected: `ok`. Anotar no relatório o resultado de cada item do Step 3.

---

### Task 11: Publicação (SÓ com o "pode" explícito do Gustavo)

Esta tarefa mexe em produção. O assistente que executa o plano **para aqui e pede confirmação**. O classificador de permissões do Claude Code também barra o deploy sem uma regra de permissão para ele; não contornar.

**Files:** nenhum arquivo do repositório muda.

- [ ] **Step 1: Pedir a confirmação**

Mostrar ao Gustavo: os commits dos dois branches, os resultados da Tarefa 10 e o que será feito (migração 0017, ligar a conta `<e-mail>` com a lista `<domínio do Gist>`, publicar o site e o app). Só seguir com um "pode" explícito.

- [ ] **Step 2: Aplicar a migração 0017**

Opção A (sem token no chat): colar `supabase/migrations/0017_ott_embeds.sql` no SQL Editor do Supabase e rodar.
Opção B (script, com `SUPABASE_ACCESS_TOKEN` válido no `.env.ott.local`, nunca impresso):

```bash
cd /c/Users/guait/Documents/Novo-App-de-TV
node --env-file=.env.ott.local --input-type=module -e '
import fs from "node:fs";
const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = (await r.text()).replaceAll(process.env.SUPABASE_ACCESS_TOKEN, "***");
  if (!r.ok) { console.error("ERRO", r.status, t.slice(0, 400)); process.exit(1); }
  return JSON.parse(t);
};
await q(fs.readFileSync("supabase/migrations/0017_ott_embeds.sql", "utf8"));
const col = await q("select column_name from information_schema.columns where table_schema=\u0027public\u0027 and table_name=\u0027profiles\u0027 and column_name=\u0027url_embeds\u0027");
const f = await q("select pg_get_functiondef(\u0027public.device_config(text)\u0027::regprocedure) as d");
console.log("coluna url_embeds:", col.length > 0, "| função menciona url_embeds:", f[0].d.includes("url_embeds"), "| ainda menciona url_legendados:", f[0].d.includes("url_legendados"));
'
```
Expected: `coluna url_embeds: true | função menciona url_embeds: true | ainda menciona url_legendados: true`.

- [ ] **Step 3: Ligar a conta**

```bash
cd /c/Users/guait/Documents/Novo-App-de-TV
OTT_CONTA_EMBEDS='<link do Gist de Filmes Livres>' node --env-file=.env.ott.local scripts/ott-embeds-conta.mjs --email=<e-mail da conta>
```
Expected: uma linha `[embeds] Lista: N itens (… embeds, … links diretos, … inválidos). Domínios: …` e `[embeds] Ligado em <e-mail>: lista em <host>.` Mostrar o resumo de domínios ao Gustavo.

- [ ] **Step 4: Publicar o site e o app**

O app é publicado a partir de um worktree limpo do commit revisado (para não levar as alterações antigas do working tree):

```bash
cd /c/Users/guait/Documents/visual-craft-assistant
COMMIT=$(git rev-parse HEAD)
WT="<diretório de rascunho da sessão>/app-embeds-wt"
git worktree add --detach "$WT" "$COMMIT"
cd /c/Users/guait/Documents/Novo-App-de-TV
git branch --show-current   # deve ser orquestrador/embeds-conta
SINTONIZA_APP_DIR="$WT" npm run deploy:site 2>&1 | tail -15
```
Expected: `Deployment complete!` e `[deploy] Site publicado: https://sintoniza-tv.pages.dev (app em /app/)`.

- [ ] **Step 5: Verificar em produção**

```bash
for u in https://sintonizatv.com.br/ https://sintonizatv.com.br/app/ https://sintonizatv.com.br/llms.txt "https://sintonizatv.com.br/?codigo=ABCD-1234"; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' "$u")"; done
curl -sI https://sintonizatv.com.br/app/ | grep -i -E "permissions-policy|x-robots-tag"
echo "embeds no /app/: $(curl -s https://sintonizatv.com.br/app/ | grep -c 'embedsParseM3u')"
```
Expected: quatro `200`; `Permissions-Policy` com `fullscreen=*` e `x-robots-tag: noindex, nofollow`; contagem de `embedsParseM3u` maior que 0.
Depois, pelo Playwright: entrar na conta ligada, Ctrl+F5, abrir Filmes e repetir os itens 1–5 e 7 do Step 3 da Tarefa 10 com a lista real.

- [ ] **Step 6: Limpeza e registro**

```bash
cd /c/Users/guait/Documents/visual-craft-assistant && git worktree remove --force "$WT"
```
Atualizar a memória do projeto (`legendados-producao.md` ou uma nova `filmes-livres-embeds.md`) com: data, commits dos dois branches, conta ligada, domínios da lista, e que não houve merge nem push. Lembrar o Gustavo de revogar o token do Supabase, se foi usado.

---

## Notas e limites conhecidos

- **Filmes exige credenciais Xtream:** `openVodSection` bloqueia a aba Filmes sem credenciais (`sint_vod_url`). A categoria só aparece em contas em que Filmes abre (como hoje com os Legendados). Mudar isso está fora do escopo.
- **Sem "continuar assistindo", Baixar, Chromecast e "Assistir na TV"** nos embeds (o app não vê o vídeo dentro do iframe). Itens com link direto na mesma lista ganham o comportamento dos Legendados (player nativo, sem Baixar e sem TV).
- **TV LG** fica de fora desta versão.
- **Riscos aceitos** (spec §3): iframe sem `sandbox` e sem lista de domínios; a curadoria da lista é do Gustavo.

## Auto-revisão do plano contra o spec

- §1 objetivo e §4 fonte de dados → Tarefas 4 e 5 (leitor, classificação embed/direto, teto de 5000, só https, duplicados).
- §5 conta e banco → Tarefas 2 e 3 (migração 0017, script `ott:embeds` com resumo de domínios, `--remover`).
- §6.1 configuração → Tarefa 6. §6.2 leitura → Tarefas 4 e 5 (núcleo compartilhado, cache por link). §6.3 fileira → Tarefa 8. §6.4 roteamento → Tarefa 7. §6.5 tela de embed → Tarefa 9. §6.6 funções puras → Tarefa 5.
- §7 cabeçalho → Tarefa 1. §8 plataformas → Tarefa 9 (`popstate` cobre navegador e botão físico do Android) e Notas (TV fora).
- §9 testes → distribuídos nas Tarefas 1, 3, 5–9; manual na Tarefa 10. §10 execução → Convenções e Tarefa 11.
- Consistência de nomes: `m3uExtraParse`, `extraListEnabled`, `extraListFetchText` (Tarefa 4); `embedsEnabled`, `embedsClassifyUrl`, `embedsParseM3u`, `embedsFetch`, `vodItemPlayKind`, `vodItemIsExtra`, `embedFrameHtml`, `EMBEDS_CATEGORY_NAME` (Tarefa 5); `extraRowHtml`, `legendadosRowHtml`, `livresRowHtml` (Tarefa 8); `openEmbedScreen`, `closeEmbedScreen`, `_embedOpen`, `_embedHintTimer` (Tarefa 9). Chaves: `sint_embeds_url`, `OTT_LIST_KEYS.EMBEDS`, categoria de cache `livres`, `stream_id` com prefixo `liv-`, campos `embed_url` e `is_livre`.
