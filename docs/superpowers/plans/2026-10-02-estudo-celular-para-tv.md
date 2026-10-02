# Estudo: procurar no celular e enviar para a TV

> **Status:** estudo e recomendação. **Nada disto foi implementado** (o pedido foi estudar). Se aprovado, vira um plano de implementação próprio (Fase 1 abaixo).

## 1. O que se quer

Achar o canal, filme ou série no celular (mais rápido que o controle remoto) e tocar em "Assistir na TV". A TV abre e reproduz sozinha, como o "transmitir" do YouTube.

## 2. Opções avaliadas

| Opção | Como funciona | Prós | Contras |
|---|---|---|---|
| **A. Pela conta (relé no servidor)** | O celular grava um comando ("tocar X") no Supabase, na conta do cliente. A TV, já ativada na mesma conta, consulta a cada poucos segundos e executa. | Funciona em qualquer rede (Wi-Fi, 4G, outra casa). Usa só o que já existe (conta, aparelhos, `device_token`). Funciona em LG webOS, Samsung Tizen, iOS e Android igualmente. Sem permissão extra no celular. | Depende de internet nos dois. Latência de 1 a 5 s (por causa da consulta periódica). Precisa de tabela e funções novas no backend. |
| **B. Pelo Wi-Fi, descoberta local (mDNS/SSDP, como o YouTube)** | O celular descobre a TV na rede local e fala direto com ela. | Latência mínima; funciona sem internet. | **Inviável para o nosso app de TV:** apps web (webOS/Tizen) não conseguem abrir um servidor nem anunciar serviço mDNS/SSDP; o iOS exige permissão de "Rede local" e o Capacitor não tem plugin pronto; o Chrome 53 da LG não tem APIs de rede para isso. O YouTube só consegue porque é app nativo com serviço de sistema. |
| **C. Pelo Wi-Fi, com TV mostrando um servidor local** | A TV escuta numa porta e o celular conecta por IP. | Rápido. | Mesmos limites de B (app web de TV não abre porta), além de pedir digitar IP. |
| **D. Pareamento por código/QR direto celular↔TV** | A TV mostra um código; o celular o digita para "parear" e depois conversa por relé. | Pareamento explícito. | É a opção A com um passo a mais; a conta já faz esse papel (TV e celular na mesma conta já estão pareados). |
| **E. Google Cast / AirPlay** | Protocolos nativos de transmissão. | Padrão de mercado. | Exige receptor/chip compatível; as TVs LG/Samsung de teste não rodam nosso app como receptor Cast; fora do alcance de um app web. |

## 3. Recomendação

**Opção A (pela conta), com uma "dica de Wi-Fi" opcional.** Ela é a única que funciona de forma igual nas quatro plataformas sem plugin nativo nem permissão extra, e reaproveita a ativação que acabou de ser feita (celular e TV já pertencem à mesma conta).

A ideia do Wi-Fi é boa para a **experiência** (mostrar primeiro as TVs da mesma casa), e dá para obtê-la sem descoberta local: o servidor compara o IP público de saída do celular e o da última consulta da TV; se forem o mesmo, a TV é marcada como "na sua rede". É só uma dica visual (ordenar a lista e destacar "Sala · na sua rede"), nunca uma regra de segurança.

**Por que não tentar o Wi-Fi puro:** nos aparelhos que temos, não há como a TV receber conexão direta de um app web. Insistir nisso custaria um app nativo de TV por plataforma.

## 4. Desenho (para a Fase 1)

### 4.1 Backend (Supabase), migração `0007_ott_cast.sql`

```sql
create table public.cast_commands (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  to_device   uuid not null references public.devices(id) on delete cascade, -- TV de destino
  from_device uuid references public.devices(id) on delete set null,         -- celular de origem
  kind        text not null check (kind in ('channel','vod','episode','stop','pause','play')),
  payload     jsonb not null default '{}'::jsonb,   -- ver 4.2 (sem credenciais!)
  status      text not null default 'pending' check (status in ('pending','delivered','played','failed','expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 minutes'
);
create index on public.cast_commands (to_device, status, created_at);
alter table public.cast_commands enable row level security;
-- ninguém acessa a tabela direto: tudo por funções com security definer
```

Funções (todas `security definer`, `set search_path = public`, com `check_rate` para limitar abuso):

| Função | Quem chama | O que faz |
|---|---|---|
| `cast_targets(p_token)` | celular | Lista as TVs ativas da mesma conta (`id`, `modelo`, `ultimo_acesso`, `na_mesma_rede`). |
| `cast_send(p_token, p_to, p_kind, p_payload)` | celular | Confere que o celular e a TV são da mesma conta e que a TV está ativa; grava o comando. Limite: 30 por minuto por aparelho. |
| `cast_poll(p_token)` | TV | Devolve o próximo comando `pending` não expirado e o marca `delivered` (atômico, `for update skip locked`). |
| `cast_ack(p_token, p_id, p_status)` | TV | Marca `played` ou `failed` (motivo curto). |

`na_mesma_rede`: comparar o IP do request (cabeçalho `x-forwarded-for`, que `request_ip()` já lê) com o IP guardado na última chamada de `device_config` da TV (coluna nova `devices.ultimo_ip`, só para este fim, truncada para os 3 primeiros octetos em IPv4 para privacidade).

### 4.2 Conteúdo do comando (sem credenciais)

```json
// canal
{ "kind": "channel", "payload": { "name": "Globo SP", "group": "Abertos", "tvgId": "globo.sp" } }
// filme
{ "kind": "vod", "payload": { "title": "Filme X", "year": 2023, "tmdbId": 12345 } }
// episódio
{ "kind": "episode", "payload": { "series": "Série Y", "season": 2, "episode": 5, "tmdbId": 6789 } }
```

**A TV resolve o endereço do stream sozinha**, na lista dela (que já tem por `device_config`). Assim o link com usuário e senha **nunca trafega** pelo relé. Se a TV não achar o item, responde `failed` com motivo ("não encontrado na lista desta TV") e o celular mostra o aviso.

### 4.3 TV (app OTT)

- Um laço de consulta (`cast_poll`) a cada 3 s com a TV em primeiro plano e a cada 15 s em segundo plano ou na tela inicial; para quando não há conta ativa.
- Ao receber: acorda a tela de reprodução, procura o item pelo `payload`, toca, envia `cast_ack`.
- Mostra um aviso curto: "Enviado do celular de Gustavo".
- Controle remoto remoto (pausar/continuar/parar): mesmos comandos `pause`/`play`/`stop`; entram na Fase 2.

### 4.4 Celular

- Botão **"Assistir na TV"** nos cartões de canal, filme e episódio e no player (ícone de TV).
- Se a conta tem uma TV: envia direto (com aviso "Enviado para a Sala"). Se tem várias: abre uma lista com as TVs, a "na sua rede" primeiro. Se não tem nenhuma: explica como ativar a TV.
- Estado do envio: "Enviando…" → "Tocando na TV" / "A TV não achou este item".

## 5. Segurança e privacidade

- Só aparelhos da **mesma conta** se enxergam; a verificação é do servidor (o celular manda só o próprio token).
- Comando expira em 2 min; limite de envio por minuto; payload com no máximo 2 KB.
- Nenhum link de stream, usuário ou senha no comando.
- O IP guardado é só para a dica de rede (3 primeiros octetos), apagado quando o aparelho é removido.
- Tabela com RLS ligada e sem política: acesso apenas pelas funções.

## 6. Fases

| Fase | Entrega | Esforço |
|---|---|---|
| **1 (MVP)** | Migração 0007 + `cast_*`; TV consulta e toca canal/filme/episódio; celular com "Assistir na TV" e escolha da TV | ~2 dias |
| **2** | Pausar/continuar/parar e volume pelo celular; avisos na TV; "dica de Wi-Fi" | ~1 dia |
| **3 (opcional)** | Troca de baixa latência com Supabase Realtime (WebSocket) em vez de consulta de 3 s | ~1 dia |

## 7. Riscos e perguntas em aberto

1. **Latência de 1 a 5 s** pela consulta: aceitável para "enviar para a TV"; o Realtime (Fase 3) reduz.
2. **Lista diferente em cada aparelho:** a TV só toca o que existe na lista dela; como as duas leem a mesma conta, é raro falhar.
3. **TV em espera/desligada** não consulta: o celular avisa "TV sem resposta" se `ultimo_acesso` for antigo (> 2 min).
4. **Samsung (.wgt sem assinatura)** e LG precisam de teste real; o relé é igual nas duas.
5. **Pergunta ao Gustavo:** vale mostrar nome amigável da TV ("Sala")? Hoje o painel mostra só o modelo; precisaria de um campo `apelido` em `devices`.

## 8. Decisão pedida

Aprovar a **Fase 1** (conta como relé). Se aprovada, escrever o plano de implementação (migração, TV, celular, painel) com testes de ponta a ponta contra o backend real, como foi feito na ativação.
