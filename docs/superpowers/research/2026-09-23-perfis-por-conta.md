# Perfis de visualização dentro de uma conta (estilo Netflix) — pesquisa

- **Data da pesquisa:** 2026-09-23 (v8)
- **Status:** só pesquisa. Nenhum código foi criado, nenhum arquivo do app foi alterado.
- **Depende de:** [`2026-09-23-backend-usuarios-assinaturas.md`](./2026-09-23-backend-usuarios-assinaturas.md) (mesma pasta). Este documento **assume que o backend de login/assinatura daquele relatório existe** (Supabase Free, RLS, `auth.users`, `public.subscriptions`, `public.devices`) e propõe perfis **em cima** dele. Não contradiz nada de lá — só estende o esquema de banco.
- **Regra dos números:** todo link foi conferido em 2026-09-23. Quando a fonte é secundária ou não consegui confirmar, isso está escrito ao lado da informação.

---

## 0. Resumo executivo

- **O que é "perfil" aqui:** dentro de **uma única conta paga** (um `auth.users`, uma assinatura, um limite de aparelhos), várias pessoas da casa têm seu próprio avatar, nome, "Minha Lista", favoritos, continuar assistindo e (opcional) PIN — como Netflix, Disney+ e Prime Video. Isso é **diferente** do limite de aparelhos/telas do relatório anterior: perfil é uma gaveta de dados dentro da conta; aparelho é o dispositivo físico logado.
- **Renomeação proposta na tabela `profiles` do relatório anterior:** o nome `profiles` ficou ambíguo agora que existem dois conceitos. Proposta:
  - `public.profiles` (do relatório anterior) → renomear para **`public.accounts`**: guarda os dados do dono da conta (nome, aceite de termos, opt-in de marketing), 1:1 com `auth.users`. É quem loga e quem paga.
  - Novo conceito → **`public.viewer_profiles`**: os perfis de visualização (Netflix-style) dentro de uma conta. É a peça nova deste relatório.
  - Isso é uma sugestão de nomenclatura para quando for implementar; **não foi aplicada** em nenhum banco.
- **Modelo de dados:** uma tabela `viewer_profiles` (dono = `account_id`) e tabelas de dados por perfil (`favorites`, `my_list`, `watch_progress`, `recents`) com `profile_id`. RLS restringe tudo por `account_id = auth.uid()`; a seleção de **qual perfil está ativo agora** é decidida no app (não existe login separado por perfil) e validada por uma função que confere se o perfil pertence à conta logada.
- **Mapeamento do que já existe:** os quatro localStorage do app hoje (`sint_fav`, `sint_recents`, `sint_continue`, `sint_mylist`) mapeiam quase 1:1 para as quatro tabelas por perfil. A migração é: na primeira sincronização depois do login, tudo que está no localStorage vira o "Perfil 1" (perfil padrão, criado junto com a conta).
- **PIN de perfil:** nunca guardar em texto puro. Hash com `pgcrypto`/`crypt()` (bcrypt) no servidor, verificado por uma função `security definer` — nunca no cliente.
- **Perfil infantil:** com lista de canais/VOD vinda da própria lista IPTV do usuário (sem metadados curados de estúdio), o filtro realista é **por categoria** (ex.: esconder categorias "Adulto", "Terror" na visão kids), não por classificação indicativa de conteúdo — isso é uma limitação estrutural, não um detalhe de implementação a resolver depois.
- **Limite de telas continua por conta, não por perfil:** é o `public.devices` do relatório anterior. Perfis não mudam esse limite; um mesmo aparelho pode trocar de perfil sem contar como novo aparelho.
- **Esforço:** depois que auth existir (fases 0–1.5 do relatório anterior), perfis são um incremento de **8–12 dias** de um dev solo (detalhado na seção 6), porque a peça mais trabalhosa (RLS, JWT, sessão) já está pronta.

---

## 1. Como os grandes apps de streaming modelam perfis

| | Netflix | Disney+ | Prime Video |
|---|---|---|---|
| **Limite de perfis por conta** | **5** perfis (contas "extra member" da divisão de residência têm só 1 perfil) ([Netflix Help Center](https://help.netflix.com/en/node/10421), *secundária confirmando o número*: [NBC News](https://www.nbcnews.com/technolog/netflix-now-allows-5-viewing-profiles-same-account-6c10835490)) | **7** perfis por conta (*secundária, não é página oficial de ajuda*: agregador via busca) | **6** perfis (1 principal + 5 adicionais) (*secundária*: reportagens sobre o rollout global de perfis, ver [TechCrunch](https://techcrunch.com/?p=2012523) e [TechRadar](https://www.techradar.com/news/amazon-prime-video-is-finally-starting-to-roll-out-netflix-style-profiles)) |
| **Tela após login** | Seletor de perfis (avatares em grade) antes de entrar no catálogo | Mesmo padrão | Mesmo padrão, adicionado bem depois dos concorrentes |
| **Perfil infantil** | Perfil "Kids" (até ~12 anos): só exibe títulos com classificação para crianças, esconde configurações de conta e bloqueia os joguinhos do Netflix; tem selo "kids" visível no avatar ([Netflix Help Center](https://help.netflix.com/en/node/114275)) | Conceito equivalente (perfil infantil com catálogo restrito) | Conceito equivalente |
| **PIN de perfil** | PIN numérico de **4 dígitos fixos** — não existe senha alfanumérica nem biometria como alternativa; mesmo formato em web, mobile, TV e console ([Netflix Help Center — PIN](https://help.netflix.com/en/node/114277), [guia 2026](https://canopy.us/blog/netflix-parental-control/)) | Não pesquisei o formato exato do PIN (fora do escopo desta chamada de busca) | Não pesquisei |
| **"Exigir PIN para criar novo perfil"** | Configuração que só existe no **perfil principal** da conta — impede alguém de criar um perfil sem restrição para escapar do perfil kids ([Netflix Help Center](https://help.netflix.com/en/node/122551)) | Não verifiquei | Não verifiquei |
| **Dados por perfil** | Histórico, "Minha Lista", continuar assistindo e recomendações são isolados por perfil — é o motivo de existir o recurso, desde o lançamento em 2013 ([TechCrunch, 2013](https://techcrunch.com/2013/08/01/netflix-user-profiles/)) | Mesmo padrão | Mesmo padrão |
| **Perfis × telas simultâneas** | **Não relacionados.** O número de perfis não muda quantas telas assistem ao mesmo tempo — isso é definido pelo plano de assinatura | Perfis não mudam o limite de telas simultâneas (4 no plano padrão, *secundária*: [The Manual](https://www.themanual.com/culture/how-many-people-can-watch-disney-plus-at-once/)) | Perfis não mudam o limite (3 streams simultâneos, mesma fonte do rollout) |

**O padrão comum, útil para o Sintoniza:**
1. Perfil é **cosmético + gaveta de dados**, não é uma segunda autenticação. Quem tem a sessão da conta pode trocar de perfil livremente (a menos que o perfil tenha PIN).
2. PIN de perfil é **opcional**, curto (numérico), serve para trancar um perfil específico (geralmente o kids ou o de um adulto que não quer os filhos mexendo), não para logar.
3. Limite de perfis é pequeno (5 a 7) e é regra de negócio simples, não técnica.
4. Perfil infantil = catálogo restrito. Nos três serviços isso depende de metadados de classificação indicativa que **o estúdio/distribuidor fornece**. Não achei nenhum dos três documentando como fazem esse filtro tecnicamente (é interno).

---

## 2. Modelo de dados no PostgreSQL/Supabase

### 2.1 Renomeação da tabela do relatório anterior

O relatório anterior definiu `public.profiles` como os dados do dono da conta (`display_name`, `terms_accepted_at`, `marketing_opt_in`), 1:1 com `auth.users`. Com perfis de visualização entrando em cena, o nome colide conceitualmente. Proposta de nomes claros para quando for implementar:

| Nome antigo (relatório anterior) | Nome proposto | O que guarda |
|---|---|---|
| `public.profiles` | **`public.accounts`** | 1 linha por `auth.users`. Quem paga, quem loga, quem aceitou os Termos. |
| *(não existia)* | **`public.viewer_profiles`** | N linhas por conta (até o limite do plano). Quem está assistindo agora: nome, avatar, se é infantil, hash do PIN. |

Isso é só troca de nome de tabela (`alter table public.profiles rename to accounts;`) e ajuste das duas policies e do trigger `handle_new_user` do relatório anterior — não muda a lógica de assinatura/pagamento.

### 2.2 Esquema proposto

```sql
-- =====================================================================
-- Sintoniza — perfis de visualização dentro de uma conta
-- Depende do esquema de 2026-09-23-backend-usuarios-assinaturas.md
-- (auth.users, public.accounts [ex-profiles], public.subscriptions,
-- public.devices já devem existir).
-- =====================================================================

-- ---------- viewer_profiles: perfis dentro da conta ----------
create table public.viewer_profiles (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  avatar       text,                    -- código do avatar (não é upload de imagem)
  is_kids      boolean not null default false,
  pin_hash     text,                    -- null = perfil sem PIN. Nunca a senha em texto puro.
  is_default   boolean not null default false, -- o "Perfil 1", criado junto com a conta
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Só 1 perfil padrão por conta (usado na migração dos dados locais, seção 3)
create unique index viewer_profiles_one_default_idx
  on public.viewer_profiles (account_id) where is_default;

-- Índice usado por toda consulta "meus perfis"
create index viewer_profiles_account_idx on public.viewer_profiles (account_id);

-- ---------- Limite de perfis por plano (trigger, não só client-side) ----------
-- Reaproveita a coluna max_devices como referência de "plans" já criada
-- no relatório anterior, mas com uma coluna própria (perfil ≠ aparelho).
alter table public.plans add column if not exists max_profiles smallint not null default 5;

create or replace function private.check_profile_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit smallint;
  v_count integer;
begin
  select p.max_profiles into v_limit
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.user_id = new.account_id;

  select count(*) into v_count
  from public.viewer_profiles
  where account_id = new.account_id;

  if v_limit is not null and v_count >= v_limit then
    raise exception 'Limite de % perfis atingido para esta conta', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger viewer_profiles_limit_check
  before insert on public.viewer_profiles
  for each row execute function private.check_profile_limit();

-- ---------- favorites: canais favoritos POR PERFIL ----------
create table public.favorites (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.viewer_profiles (id) on delete cascade,
  channel_key  text not null,           -- id ou nome do canal na lista M3U/Xtream do usuário
  created_at   timestamptz not null default now(),
  unique (profile_id, channel_key)
);
create index favorites_profile_idx on public.favorites (profile_id);

-- ---------- recents: canais/VOD assistidos recentemente POR PERFIL ----------
create table public.recents (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.viewer_profiles (id) on delete cascade,
  item_type    text not null check (item_type in ('channel', 'vod', 'series')),
  item_key     text not null,           -- id do canal/filme/série na lista do usuário
  title        text,
  cover        text,
  watched_at   timestamptz not null default now(),
  unique (profile_id, item_type, item_key)
);
create index recents_profile_idx on public.recents (profile_id, watched_at desc);

-- ---------- watch_progress: "continuar assistindo" POR PERFIL ----------
create table public.watch_progress (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.viewer_profiles (id) on delete cascade,
  item_type       text not null check (item_type in ('vod', 'series')),
  item_key        text not null,        -- stream_id (filme) ou series_id+episódio
  title           text,
  cover           text,
  progress_secs   numeric not null default 0,
  duration_secs   numeric,
  updated_at      timestamptz not null default now(),
  unique (profile_id, item_type, item_key)
);
create index watch_progress_profile_idx on public.watch_progress (profile_id, updated_at desc);

-- ---------- my_list: "Minha Lista" POR PERFIL ----------
create table public.my_list (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.viewer_profiles (id) on delete cascade,
  item_type    text not null check (item_type in ('vod', 'series')),
  item_key     text not null,
  title        text,
  cover        text,
  added_at     timestamptz not null default now(),
  unique (profile_id, item_type, item_key)
);
create index my_list_profile_idx on public.my_list (profile_id, added_at desc);

-- =====================================================================
-- RLS: tudo restrito à conta logada; dentro da conta, ao perfil escolhido
-- =====================================================================
alter table public.viewer_profiles enable row level security;
alter table public.favorites        enable row level security;
alter table public.recents          enable row level security;
alter table public.watch_progress   enable row level security;
alter table public.my_list          enable row level security;

-- viewer_profiles: a conta só vê/edita os próprios perfis
create policy viewer_profiles_all_own on public.viewer_profiles
  for all to authenticated
  using ((select auth.uid()) = account_id)
  with check ((select auth.uid()) = account_id);

-- Função auxiliar: "este profile_id pertence à conta logada?"
-- Evita repetir o join em cada policy e fica pronta para virar índice/cache.
create or replace function private.owns_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.viewer_profiles
    where id = p_profile_id and account_id = (select auth.uid())
  );
$$;

-- As 4 tabelas por perfil repetem o mesmo padrão de policy
create policy favorites_all_own on public.favorites
  for all to authenticated
  using (private.owns_profile(profile_id))
  with check (private.owns_profile(profile_id));

create policy recents_all_own on public.recents
  for all to authenticated
  using (private.owns_profile(profile_id))
  with check (private.owns_profile(profile_id));

create policy watch_progress_all_own on public.watch_progress
  for all to authenticated
  using (private.owns_profile(profile_id))
  with check (private.owns_profile(profile_id));

create policy my_list_all_own on public.my_list
  for all to authenticated
  using (private.owns_profile(profile_id))
  with check (private.owns_profile(profile_id));

-- ---------- Novo usuário: cria também o perfil padrão ----------
-- Estende o handle_new_user() do relatório anterior (ou roda como trigger
-- separada em auth.users — escolher uma das duas formas ao implementar,
-- não as duas, para não duplicar).
create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.viewer_profiles (account_id, name, is_default)
  values (new.id, 'Perfil 1', true);
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function private.handle_new_user_profile();
```

### 2.3 Por que RLS não "sabe" qual perfil está ativo

Diferente da conta (que tem um JWT emitido pelo Supabase Auth), **o perfil não tem login próprio** — é só uma seleção guardada no app (ex.: `localStorage` ou memória), igual Netflix/Disney+/Prime fazem. Isso significa duas coisas importantes:

1. **RLS não filtra automaticamente por perfil.** RLS só sabe `auth.uid()` (a conta). Por isso toda tabela por perfil usa `private.owns_profile(profile_id)`: a policy garante que o perfil pertence à conta logada, mas **é o app quem decide, a cada consulta, qual `profile_id` mandar** (ex.: `select * from favorites where profile_id = $1`). Um usuário malicioso não consegue ler o perfil de outra conta (RLS barra), mas dentro da própria conta ele pode, em teoria, ler dados de qualquer perfil seu passando outro `profile_id` — o que é aceitável, porque são todos perfis da mesma pessoa/família que já pagou a conta.
2. **PIN de perfil é uma trava de UX, não uma trava de RLS.** O PIN impede a **troca de perfil na interface** sem digitar o código; ele não vira outra política de banco. A verificação do PIN é uma RPC própria (seção 4), chamada antes do app "entrar" no perfil.

Essa arquitetura é a mesma usada pelos apps grandes: a conta autentica; o perfil é uma preferência de sessão dentro da conta, com uma trava de PIN opcional na camada de aplicação.

---

## 3. Mapeamento do localStorage atual para o banco

Hoje (conferido em `sintoniza-link.html`, espelhado em `www/sintoniza-link.html`, `sintoniza.html`, `www/index.html` e nas variantes de TV):

| Chave localStorage | Formato hoje no código | Tabela nova | Observação da migração |
|---|---|---|---|
| `sint_fav` | Array de strings (id ou nome do canal) — `_state.favorites` | `public.favorites` | `channel_key` = cada item do array. |
| `sint_recents` | Array de `{ id, type: "channel", ts }`, limitado a 20 itens (`.slice(0, 20)`) | `public.recents` | `item_type = 'channel'`, `item_key = id`, `watched_at = ts`. |
| `sint_continue` | **Objeto/mapa** (não array) chaveado por `id`: `{ id, type, title, cover, url, progress: video.currentTime, duration: video.duration, vodItem, ts }` (`saveContinueWatching`, linha ~4505 de `sintoniza-link.html`) | `public.watch_progress` | `item_type` = `vod` ou `series`, `progress_secs = progress`, `duration_secs = duration`, `updated_at = ts`. O campo `url` (stream direto) **não deve subir para o servidor** — é específico da lista IPTV do usuário e pode conter credenciais Xtream na query string; guardar só `item_key`/`vodItem` (já filtrado por `trimVodItem`, que remove tudo exceto `stream_id, series_id, name, title, stream_icon, cover, container_extension, plot, rating, releaseDate, year`). |
| `sint_mylist` | Array de `{ type: "vod"\|"series", id, title, cover, item, ts }` (`buildMyListEntry`, linha ~4547) | `public.my_list` | `item_type = type`, `item_key = id`, `added_at = ts`. Mesmo cuidado: subir `item` (já trimado por `trimVodItem`), nunca a URL de stream bruta. |

**Migração única (primeiro login após a conta existir):**
1. No primeiro login bem-sucedido, o app verifica se a conta já tem algum `viewer_profiles` (o trigger `handle_new_user_profile` já cria o "Perfil 1" automaticamente).
2. Se os quatro localStorage keys existirem e ainda não houver uma flag `sint_migrated_v1` gravada, o app faz um upload único: lê os quatro arrays/mapas, transforma no formato das quatro tabelas e faz `upsert` (usando as `unique` constraints da seção 2.2 para não duplicar em re-execuções) tudo associado ao `profile_id` do "Perfil 1".
3. Grava `localStorage.setItem("sint_migrated_v1", "1")` para não repetir.
4. **Os dados locais continuam existindo** depois da migração (não apagar) — eles viram o cache local do "Perfil 1" (estratégia da próxima seção).

### 3.1 Estratégia de sincronização: local-first com sync em segundo plano

Como o app hoje já funciona 100% offline com localStorage, a proposta é **não** trocar isso por "sempre ler do servidor" (ia adicionar latência onde hoje é instantâneo). Em vez disso:

1. **Leitura:** a UI continua lendo do localStorage/memória local primeiro (resposta instantânea, igual hoje).
2. **Escrita:** toda função que já grava local (`saveContinueWatching`, `setState({favorites...})`, `saveMyList`, o `setItem` de recents) passa a **também** enfileirar um upsert para a tabela correspondente, com `updated_at = now()` do lado do cliente. Isso pode ser debounced (ex.: o próprio app já debouncia `saveContinueWatching` a cada 5s pela variável `_lastContinueSaveTs` — dá pra reaproveitar esse intervalo para mandar ao servidor também).
3. **Fila offline:** se não houver rede, a escrita fica numa fila local (outra entrada de localStorage, tipo `sint_sync_queue`) e é reenviada quando a conexão voltar ou no próximo `app resume`.
4. **Download ao trocar de aparelho/perfil:** ao abrir o app num aparelho novo (ou trocar de perfil), busca o estado do servidor daquele `profile_id` e faz merge com o local pela regra abaixo.
5. **Regra de conflito: "last write wins por `updated_at`".** Cada linha (favorito, item de recents, progresso, item da lista) compara o `updated_at`/`ts` local com o do servidor; o mais recente vence. Isso é simples e adequado aqui porque:
   - são listas pequenas e pessoais (não há edição concorrente complexa tipo texto colaborativo);
   - o pior caso de conflito (ex.: dois aparelhos no mesmo perfil pausando o mesmo filme em pontos diferentes quase ao mesmo tempo) já é raro e o prejuízo é pequeno (retomar do ponto errado por alguns minutos).
   - Implementação prática: no upsert, usar `on conflict (profile_id, item_type, item_key) do update set ... where excluded.updated_at > watch_progress.updated_at` — o próprio SQL descarta a escrita mais antiga.

---

## 4. Segurança do PIN, filtro infantil e limite de telas

### 4.1 PIN de perfil

- **Nunca armazenar em texto puro nem em `localStorage` puro.** O PIN é curto (4 dígitos, seguindo o padrão do mercado — ver seção 1), então é o tipo de segredo mais fácil de forçar por tentativa e erro; por isso o hash e a verificação **têm que ser no servidor**, nunca no app.
- **Hash com `pgcrypto`** (extensão nativa do Postgres/Supabase), usando `crypt(pin, gen_salt('bf'))` (bcrypt) — mesma família de algoritmo que o Supabase Auth já usa para senha de conta (relatório anterior, seção 4.1).
- **RPC de verificação**, roda como `security definer`, para o app nunca ver o hash nem outro perfil:

```sql
create or replace function public.verify_profile_pin(p_profile_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  -- Só deixa verificar PIN de perfil da PRÓPRIA conta
  select pin_hash into v_hash
  from public.viewer_profiles
  where id = p_profile_id and account_id = (select auth.uid());

  if v_hash is null then
    return true; -- perfil sem PIN configurado: livre
  end if;

  return v_hash = crypt(p_pin, v_hash);
end;
$$;

-- Definir/trocar o PIN (mesma ideia, gera o hash)
create or replace function public.set_profile_pin(p_profile_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.viewer_profiles
     set pin_hash = case when p_pin is null then null else crypt(p_pin, gen_salt('bf')) end,
         updated_at = now()
   where id = p_profile_id and account_id = (select auth.uid());
end;
$$;
```

- **Rate limit da tentativa de PIN:** o Supabase Free não tem hook de "tentativas por conta" pronto (ver relatório anterior, item de segurança). Proposta simples: registrar tentativas falhas numa coluna (`pin_failed_attempts`, `pin_locked_until`) e bloquear temporariamente após ~5 tentativas erradas, checado dentro da própria função. **Não encontrei um padrão de mercado documentado para isso** (Netflix/Disney+/Prime não publicam a política de tentativas) — é uma decisão de projeto, não uma cópia de referência.

### 4.2 Filtro de conteúdo do perfil infantil — limite real, não só técnico

Isso merece destaque porque é uma diferença estrutural do Sintoniza frente a Netflix/Disney+/Prime: **eles têm um catálogo próprio, com metadados de classificação indicativa fornecidos pelo estúdio** (idade recomendada, tags de conteúdo). O Sintoniza **não tem catálogo próprio** — o conteúdo vem da lista M3U/Xtream que cada usuário já possui, sem nenhum metadado de classificação confiável.

**Consequência:** o único filtro realista de "perfil infantil" é **por categoria da própria lista** (o campo de categoria que já existe no XML/M3U/Xtream, ex.: `category_name` do Xtream), não por classificação de conteúdo individual:
- o app deixa o dono da conta marcar quais categorias aparecem no perfil kids (ex.: esconder "Adulto+", "Terror", manter "Desenhos", "Infantil" se a lista tiver essas categorias);
- isso é **tão bom quanto a qualidade da categorização da lista do próprio usuário** — se o provedor IPTV dele classifica mal (ou nem categoriza), o filtro é falho;
- **não há como o Sintoniza saber, por conta própria, se um filme específico é apropriado para criança** — não existe uma base de dados anexada ao stream. Qualquer alegação de "controle parental preciso" seria enganosa. Documentar essa limitação nos Termos/tela de ajuda é mais honesto do que prometer um filtro que o produto não consegue entregar.
- Modelagem: uma tabela simples `viewer_profile_category_filters (profile_id, category_name, allowed boolean)` ou, mais simples ainda, uma coluna `hidden_categories text[]` em `viewer_profiles` (lista de categorias escondidas daquele perfil) — mais barato de implementar que uma tabela separada, dado que o número de categorias por lista é pequeno.

### 4.3 Perfis não mudam o limite de telas/aparelhos

O relatório anterior definiu o limite de aparelhos (`public.devices`, `plans.max_devices`) **por conta**, contando instalações do app (aparelho físico), não perfis. Isso continua exatamente igual:
- **um aparelho pode trocar de perfil livremente** sem contar como novo registro em `devices` — trocar de perfil é uma ação local/RPC dentro da mesma sessão JWT, não um novo login;
- o limite de **perfis** (`plans.max_profiles`, seção 2.2) é uma regra de negócio separada e menor (5 perfis, seguindo o padrão do mercado), sem relação com quantos aparelhos estão logados;
- exemplo prático: uma conta com `max_devices = 2` e `max_profiles = 5` pode ter os pais e 3 filhos com perfil próprio, mas só 2 televisões/celulares logados ao mesmo tempo — exatamente como funciona nos concorrentes.

---

## 5. Fluxo de UX: mobile e TV

### 5.1 Mobile (Capacitor iOS/Android)

1. **Após login bem-sucedido** (ou reabertura do app com sessão válida): tela de **seleção de perfil** em grade de avatares — nome + avatar de cada `viewer_profiles` da conta, com selo "kids" nos perfis `is_kids = true` (padrão visual dos três apps pesquisados).
2. **Toque num perfil sem PIN:** entra direto no catálogo, salva `profile_id` ativo em memória/`localStorage` (ex.: `sint_active_profile`).
3. **Toque num perfil com PIN:** abre teclado numérico (4 dígitos), chama `verify_profile_pin`; 3 tentativas erradas mostram aviso, sem travar a conta inteira (só aquele perfil fica bloqueado por um tempo, conforme 4.1).
4. **Trocar de perfil durante o uso:** ícone/avatar do perfil ativo, sempre visível (ex.: no canto da tela de Configurações ou do menu principal), leva de volta à grade de seleção sem precisar deslogar da conta.
5. **Gerenciar perfis:** tela "Meus Perfis" (criar, editar nome/avatar, marcar como kids, definir/trocar PIN, excluir) — só o "Perfil 1" (`is_default`) não pode ser excluído, para sempre sobrar um perfil válido.
6. **Onboarding da migração:** na primeira sincronização (seção 3), nenhuma tela extra é necessária — o "Perfil 1" já nasce com os dados que a pessoa já tinha, então ela nem percebe que houve migração.

### 5.2 Smart TV (webOS/Tizen)

Diferenças específicas de controle remoto (navegação por D-pad, sem teclado físico, sem mouse):
1. **Grade de perfis em foco navegável:** avatares em linha horizontal ou grade, navegáveis com as setas do controle; "OK"/Enter seleciona. Mesmo padrão de foco já usado no restante do `sintoniza-tv.html` (o app já tem um sistema de navegação por foco para os cards de canal/VOD — reaproveitar o mesmo componente de foco em vez de criar um novo).
2. **PIN na TV:** teclado numérico virtual na tela (grade 0–9), navegável por D-pad — **nunca pedir para digitar com o controle remoto letra por letra** (ruim de usar); por isso PIN numérico curto (igual ao padrão do mercado) é a escolha certa aqui, não só uma preferência.
3. **Perfil ativo persiste entre sessões da TV:** diferente do celular (que a pessoa pode emprestar), a TV normalmente fica com o mesmo perfil selecionado entre uma sessão e outra (ex.: gravar o último `profile_id` usado naquele aparelho e pular a tela de seleção se não houver PIN, com um atalho visível para "trocar perfil" sem precisar deslogar).
4. **Sem teclado para nome/avatar:** criar/editar perfil na TV é mais raro — pode reaproveitar o fluxo de "aprovar TV pelo celular" do relatório anterior (o celular já é usado para aprovar o pareamento; o mesmo padrão de "faça isso no seu celular" serve para cadastrar um novo perfil, evitando digitar nome com o controle remoto).

---

## 6. Sugestão de fases (depois que o login existir)

Pressupõe que as Fases 0, 1 e 1.5 do relatório anterior (domínio, Supabase, Auth, páginas de conta) já estão prontas. Estimativas grosseiras, dev solo com apoio do Claude, testando em iPhone, Android e as duas TVs.

| Fase | Entrega | Esforço |
|---|---|---|
| **A. Esquema e RLS** | Renomear `profiles`→`accounts` (ou já nascer com esse nome, se a Fase 1 do relatório anterior ainda não foi implementada); criar `viewer_profiles` + 4 tabelas por perfil; trigger de perfil padrão; trigger de limite de perfis; RLS e a função `owns_profile`; `verify_profile_pin`/`set_profile_pin` com `pgcrypto`. | 1,5–2 dias |
| **B. Seletor de perfil (mobile)** | Tela de seleção após login, criação/edição/exclusão de perfil, avatar (lista fixa de ícones, sem upload de imagem para não precisar de storage), fluxo de PIN. | 2–3 dias |
| **C. Sincronização** | Adaptar `saveContinueWatching`, favoritos, recents e Minha Lista para escrever local **e** enfileirar upsert; fila offline; resolução de conflito por `updated_at`; migração única do "Perfil 1" (seção 3). | 3–4 dias |
| **D. TV (webOS/Tizen)** | Seletor de perfil navegável por D-pad, teclado numérico de PIN na tela, persistência do último perfil por aparelho. Reaproveita o componente de foco já existente no app de TV. | 1,5–2 dias |
| **E. Filtro infantil + polimento** | Marcação de categorias escondidas por perfil (`hidden_categories`), aviso claro nos Termos/ajuda sobre a limitação do filtro (seção 4.2), testes de ponta a ponta (criar conta → migrar dados → criar 2º perfil → trocar de perfil → checar isolamento de favoritos/continuar assistindo entre perfis). | 1,5–2 dias |

**Total estimado: 8–12 dias**, presumindo que o backend de conta/assinatura do relatório anterior já está funcionando (essa dependência é o motivo do intervalo ser bem menor que o do relatório de auth: RLS, JWT e sessão já resolvidos ali são reaproveitados aqui).

---

## 7. Fontes (conferidas em 2026-09-23)

**Perfis nos apps de streaming**
- Netflix — criar/editar/excluir perfis: https://help.netflix.com/en/node/10421
- Netflix — 5 perfis por conta (secundária, mas cita a política oficial): https://www.nbcnews.com/technolog/netflix-now-allows-5-viewing-profiles-same-account-6c10835490
- Netflix — perfil infantil: https://help.netflix.com/en/node/114275
- Netflix — PIN de perfil: https://help.netflix.com/en/node/114277
- Netflix — "exigir PIN para novo perfil": https://help.netflix.com/en/node/122551
- Netflix — guia de controle parental 2026 (secundária, formato do PIN de 4 dígitos): https://canopy.us/blog/netflix-parental-control/
- Netflix — lançamento original de perfis em 2013 (contexto histórico do recurso): https://techcrunch.com/2013/08/01/netflix-user-profiles/
- Prime Video — rollout global de perfis (secundária): https://techcrunch.com/?p=2012523 e https://www.techradar.com/news/amazon-prime-video-is-finally-starting-to-roll-out-netflix-style-profiles
- Disney+ — limite de telas simultâneas (secundária): https://www.themanual.com/culture/how-many-people-can-watch-disney-plus-at-once/
- Disney+ — número de perfis (7): não encontrei página oficial de ajuda da Disney+ com esse número; veio de agregador de busca, **não confirmado na fonte primária**.

**Supabase / RLS**
- RLS oficial: https://supabase.com/docs/guides/database/postgres/row-level-security
- Padrões de RLS multi-tenant (secundária): https://dev.to/issuecapture/row-level-security-in-supabase-multi-tenant-saas-from-day-one-4lon
- Guia de RLS 2026 (secundária): https://designrevision.com/blog/supabase-row-level-security

**Código do próprio app (conferido diretamente, não é fonte externa)**
- `sintoniza-link.html`: `_state.favorites`/`sint_fav` (linha ~1953), `sint_recents` (linha ~1957, ~1996-1998), `CONTINUE_KEY = "sint_continue"` e `saveContinueWatching` (linha ~4363, ~4505-4508, ~5685-5693), `MYLIST_KEY = "sint_mylist"` e `buildMyListEntry`/`trimVodItem` (linha ~4523-4556, ~4488-4495).
- Arquivos espelhados com o mesmo padrão: `sintoniza.html`, `www/index.html`, `www/sintoniza-link.html`, `sintoniza-tv/sintoniza-tv.html`, `www/sintoniza-tv/sintoniza-tv.html`.

### 7.1 O que não consegui verificar

1. **Número exato de perfis do Disney+ (7):** não achei a página oficial de ajuda confirmando; veio de agregador via busca.
2. **Formato do PIN de perfil no Disney+ e Prime Video:** não pesquisei (só verifiquei o padrão do Netflix, 4 dígitos numéricos).
3. **Política de "tentativas erradas de PIN" dos concorrentes:** não encontrei nenhuma documentação pública sobre quantas tentativas cada serviço permite antes de bloquear temporariamente.
4. **Se o Supabase tem algum recurso nativo para "perfil dentro de conta"** (ex.: multi-tenant helpers prontos): não existe esse conceito pronto na plataforma; o esquema da seção 2 é modelagem própria em cima de RLS padrão, não um recurso do Supabase.
5. **Compatibilidade do teclado numérico virtual com os controles remotos específicos de LG/Samsung mais antigos:** não testei; é uma suposição baseada no padrão geral de apps de TV.
