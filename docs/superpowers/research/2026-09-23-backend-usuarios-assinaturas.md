# Backend de usuários, login e mensalidade do Sintoniza (pesquisa)

- **Data da pesquisa:** 2026-09-23 (v7, Task 6)
- **Status:** só pesquisa. Nenhum código foi criado e nenhuma conta foi aberta.
- **Regra dos números:** toda cota ou preço abaixo tem link e foi conferido em 2026-09-23. Quando a fonte é secundária (blog, agregador) ou não consegui confirmar, isso está escrito do lado do número. Cotas grátis mudam sem aviso. Por exemplo, a Oracle cortou pela metade a cota grátis de ARM em 15/06/2026, sem anunciar ([InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)). Confira de novo antes de implementar.

---

## 1. Resumo executivo

- **Stack recomendada:** **Supabase Free** (PostgreSQL + Auth + Edge Functions + pg_cron), na região São Paulo, com **Resend** como SMTP para os e-mails de login, **Cloudflare Turnstile** como CAPTCHA e **Mercado Pago** como gateway (Asaas fica como alternativa). **Segunda opção:** Cloudflare Workers + D1 + Turnstile.
- **O que é grátis de verdade:** até 50.000 usuários ativos por mês, banco de 500 MB e 500 mil chamadas de Edge Function por mês no Supabase. pg_cron sem limite por plano. Turnstile com desafios ilimitados. Resend com 3.000 e-mails por mês (100 por dia). Proteção DDoS da Cloudflare sem limite de volume.
- **O que NÃO é grátis:**
  - Todo pagamento paga taxa ao gateway. No Mercado Pago, Pix custa 0,99% e cartão com recebimento na hora custa 4,98%.
  - Um domínio próprio é necessário para o e-mail chegar na caixa de entrada (em torno de R$ 40/ano no .com.br, fonte secundária).
  - Comissão das lojas, se a venda passar pelo app da App Store ou do Google Play: de 15% a 26% na Apple Brasil com compra dentro do app, e 15% em assinaturas no Google Play.
  - Recursos do Supabase Pro (a partir de US$ 25/mês): backup diário, projeto que não pausa e "uma sessão por usuário".
- **Risco técnico nº 1:** o projeto Supabase Free **pausa após cerca de 1 semana sem atividade** e **não tem backup automático**. É preciso fazer backup próprio (GitHub Actions com `supabase db dump`) e manter algum uso diário.
- **Risco técnico nº 2:** o player roda 100% no aparelho. Quem descompilar o app consegue pular a checagem de assinatura. O servidor só consegue barrar de verdade o que **ele mesmo** entrega: login, pareamento da TV, limite de aparelhos e sincronização. Para o resto, a checagem só desestimula.
- **Risco técnico nº 3:** o Turnstile não aceita o endereço `capacitor://localhost` do app iOS, e o CAPTCHA do Supabase vale para o projeto inteiro. Por isso as telas de cadastro, login e "esqueci a senha" precisam morar numa **página hospedada no domínio próprio**. A TV entra por **código/QR aprovado no celular**.
- **Ponto legal:** cobrar pelo **player** (software) é defensável. Cobrar por **acesso a canais e filmes** sem licença é alvo ativo no Brasil: a Ancine mandou suspender 23.938 IPs e 4.161 sites entre abr/2025 e abr/2026. O backend deve ser neutro: não guardar listas, não oferecer catálogo e não repassar streams para quem paga.

---

## 2. Contexto técnico: tudo que vai no app é público

**Hoje:** o `sintoniza-link.html` (web e Capacitor iOS/Android) e o `sintoniza-tv/` (webOS/Tizen) rodam inteiros no aparelho. A lista M3U e as credenciais Xtream ficam no `localStorage`. Não existe servidor próprio. O único componente de servidor é o `cloudflare-proxy/`, um Worker opcional que repassa streams `http://`.

**Por que o app não guarda segredo:** um IPA ou APK é só um pacote compactado. Qualquer pessoa extrai o HTML/JS com ferramentas gratuitas, lê as strings e altera o código (por exemplo, trocar `if (!assinaturaAtiva)` por `if (false)`). No navegador e na TV é ainda mais fácil (F12 ou inspeção remota). Então:

| Tipo de chave | Pode ir no app? | Por quê |
|---|---|---|
| **Publishable/anon** do Supabase (`sb_publishable_...`, ou a antiga `anon`) | **Sim** | É feita para ser pública. Com ela, o banco só entrega o que as regras de **Row Level Security (RLS)** permitem ([Supabase: API keys](https://supabase.com/docs/guides/api/api-keys)). |
| **Secret/service_role** do Supabase (`sb_secret_...`) | **Nunca** | Ignora o RLS por completo (`BYPASSRLS`). Quem tiver essa chave lê e apaga tudo. Fica só nas Edge Functions, como variável de ambiente. |
| Access token do Mercado Pago/Asaas, segredo de webhook, secret do Turnstile, chave SMTP do Resend | **Nunca** | Com elas se criam cobranças, se estornam pagamentos, se forjam webhooks e se mandam e-mails em seu nome. |

**Conceito rápido de RLS:** são regras escritas no próprio PostgreSQL do tipo "cada linha só pode ser lida pelo dono (`user_id = auth.uid()`)". O banco confere o token (JWT) do usuário em **toda** consulta. Por isso o app pode falar direto com o banco usando a chave pública: a proteção fica no banco, e não no app.

**Consequência prática:** qualquer regra de acesso ("está pago?", "passou do limite de aparelhos?", "o pagamento foi aprovado?") precisa ser decidida **no servidor**, seja no RLS, numa Edge Function ou no pg_cron. O app só mostra o resultado.

As chaves legadas `anon` e `service_role` estão sendo descontinuadas até o fim de 2026 ([Supabase: API keys](https://supabase.com/docs/guides/api/api-keys)). Comece já com as novas `sb_publishable_`/`sb_secret_`.

---

## 3. Comparativo das opções gratuitas

### 3.1 Tabela

| | **Supabase Free** | **Firebase Spark** | **Cloudflare Free** (Workers + D1 + KV + Turnstile) | **Appwrite Cloud Free** | **PocketBase** auto-hospedado |
|---|---|---|---|---|---|
| **Banco** | PostgreSQL, 500 MB, CPU compartilhada ([pricing](https://supabase.com/pricing)) | Firestore (NoSQL): 1 GiB, 50 mil leituras, 20 mil gravações e 20 mil exclusões **por dia** ([pricing](https://firebase.google.com/pricing)) | D1 (SQLite): 5 GB, 5 milhões de linhas lidas e 100 mil gravadas **por dia** ([D1](https://developers.cloudflare.com/d1/platform/pricing/)). KV: 100 mil leituras e 1.000 gravações por dia ([KV](https://developers.cloudflare.com/kv/platform/pricing/)) | 1 banco por projeto ([docs](https://appwrite.io/docs/advanced/billing/free)). Armazenamento de 2 GB (*secundária*: [AgentDeals](https://agentdeals.dev/vendor/appwrite-cloud)) | SQLite no disco do servidor |
| **Auth pronta** | Sim, 50.000 usuários ativos/mês | Sim, 50.000 usuários ativos/mês | **Não**: você implementa (biblioteca ou código próprio) | Sim, 75.000 usuários ativos/mês (*secundária*) | Sim, embutida |
| **Código no servidor (webhook)** | Edge Functions: 500 mil/mês, 2 s de CPU e 150 s de duração ([limites](https://supabase.com/docs/guides/functions/limits)) | Cloud Functions **só no plano Blaze**, que pede cartão ([docs](https://firebase.google.com/docs/functions/get-started)) | Workers: 100 mil requisições/dia e **10 ms de CPU** por requisição ([limites](https://developers.cloudflare.com/workers/platform/limits/)) | 750 mil execuções/mês (*secundária*) | Hooks em JS/Go no próprio binário |
| **Agendador (cron)** | pg_cron, sem limite por plano, só de recursos ([resposta oficial](https://github.com/orgs/supabase/discussions/37405)). Recurso em Beta | Depende de Functions, então **só no Blaze** | Cron Triggers: 5 por conta, em UTC ([limites](https://developers.cloudflare.com/workers/platform/limits/)) | Não verifiquei | Não verifiquei na fonte oficial |
| **Pausa por inatividade** | **Sim.** Pausa após cerca de 1 semana com pouca atividade no banco. Poucos acessos por dia já evitam. Pode ser restaurado em até 1 ano ([docs](https://supabase.com/docs/guides/platform/free-project-pausing)) | Não encontrei política de pausa. Ao estourar a cota, o produto é desligado até o fim do mês ([docs](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)) | Não | **Sim, e pior.** Pausa após 7 dias sem **atividade de desenvolvimento no Console**; uso pela API não conta ([changelog 20/02/2026](https://appwrite.io/changelog/entry/2026-02-20-1)). **Excluído** após 90 dias pausado ([changelog 29/06/2026](https://appwrite.io/changelog/entry/2026-06-29)) | Depende do host (ver 3.3) |
| **E-mail de auth grátis** | Nativo: **2 por hora e só para membros da equipe** do projeto. SMTP próprio é obrigatório ([docs](https://supabase.com/docs/guides/auth/auth-smtp)) | Nativo: 1.000 verificações/dia, **150 resets de senha/dia**, 5 links de login/dia ([limites](https://firebase.google.com/docs/auth/limits)) | O Email Service **não envia para qualquer destinatário no plano Free** ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)). Precisa de Resend/Brevo | Não verifiquei | SMTP próprio |
| **CAPTCHA** | hCaptcha ou Turnstile, integrado ao Auth ([docs](https://supabase.com/docs/guides/auth/auth-captcha)) | Não avaliei (existe o App Check) | Turnstile nativo, grátis e ilimitado ([planos](https://developers.cloudflare.com/turnstile/plans/)) | Não verifiquei | Não nativo |
| **Backup no plano grátis** | **Não incluso.** Recomendam `supabase db dump` fora da plataforma ([docs](https://supabase.com/docs/guides/platform/backups)) | Não avaliei | Não avaliei | Não verifiquei | Por sua conta |
| **Vendor lock-in** | **Baixo a médio.** PostgreSQL padrão (exporta com `pg_dump`) e Auth open source | **Alto.** Firestore e as regras de segurança são proprietários | Médio. D1 é SQLite, mas o código é preso à API do Workers | Médio. É open source e dá para hospedar por conta própria | **Baixo** (open source), mas o servidor é problema seu |
| **Encaixe para dev solo** | **Alto.** SQL, Auth pronta e RLS; você já conhece PostgreSQL | Médio. Auth ótima, mas webhook e cron exigem Blaze com cartão | Médio a baixo. Auth "na mão" é a parte mais arriscada | Baixo, por causa da regra de pausa | Baixo. Patches, backup, TLS e monitoramento ficam com você |

### 3.2 Recomendação: Supabase Free

1. **Tem tudo que foi pedido no plano grátis e num lugar só:** e-mail + senha, confirmação por OTP, reset de senha, JWT com refresh, CAPTCHA, funções para webhook e cron para vencer assinaturas.
2. **É PostgreSQL**, que você já usa na PBA. As regras de acesso ficam em SQL (RLS), fáceis de ler e revisar. Sair daqui também é simples (`pg_dump`).
3. **A senha nunca passa pelo seu código:** o hash é bcrypt com salt, feito pelo Auth ([docs](https://supabase.com/docs/guides/auth/password-security)).
4. **DDoS e força bruta:** a plataforma já fica atrás da Cloudflare e usa fail2ban ([Supabase Security](https://supabase.com/security)).
5. **Tem região São Paulo** (`sa-east-1`) ([docs](https://supabase.com/docs/guides/platform/regions)), o que dá menor latência para usuário brasileiro.

**Cuidados que vêm junto:**
- A pausa por inatividade só incomoda enquanto não houver usuários diários.
- Sem backup no Free: agendar dump semanal no GitHub Actions (2.000 min/mês grátis em repositório privado, [GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- Estes recursos são **Pro**: "sessão única por usuário", timeout de sessão, proteção contra senha vazada e e-mail sem a marca Supabase ([pricing](https://supabase.com/pricing), [sessions](https://supabase.com/docs/guides/auth/sessions)).
- Limite de 2 projetos ativos.

**Segunda opção: Cloudflare (Workers + D1 + KV + Turnstile).** É o único plano grátis sem pausa que tem cron e CAPTCHA nativos. Perde por três motivos:
- **Não tem Auth pronta.** Hash de senha, expiração de token e rate limit ficariam com você, e é aí que mora o maior risco de segurança para quem não é especialista.
- **10 ms de CPU por requisição.** Um hash de senha forte gasta CPU de propósito, então fica apertado. Isso é inferência minha, não medi.
- **A cota é por conta.** As 100 mil requisições/dia **já são consumidas pelo `cloudflare-proxy`**: cada segmento `.ts` conta uma requisição (ver `cloudflare-proxy/README.md`). Uma noite de uso pesado do proxy derrubaria o login junto. Se escolher Cloudflare, use outra conta.

**Por que não as outras:**
- **Firebase Spark:** a Auth é boa, mas webhook de pagamento e cron exigem o plano Blaze, que pede cartão e não tem teto de gasto.
- **Appwrite Free:** pausa e **apaga** projetos sem atividade no Console, mesmo com o app em uso. Não serve para produção grátis.
- **PocketBase:** ótimo software (v0.40.4, ainda pré-1.0, [pocketbase.io](https://pocketbase.io/)), mas a hospedagem grátis é frágil (ver 3.3).

### 3.3 Onde hospedar PocketBase de graça (se um dia fizer sentido)

| Host | Situação em 2026-09-23 |
|---|---|
| **Oracle Cloud Always Free** | ARM A1 **caiu para 2 OCPU e 12 GB** (antes eram 4 e 24). Há também 2 VMs AMD micro de 1 GB e 200 GB de disco. A Oracle **recupera VMs ociosas** (CPU, rede e memória abaixo de 20% por 7 dias) ([Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)). Um backend pequeno fica ocioso quase sempre, então o risco de recuperação é real. |
| **Google Cloud e2-micro** | 1 VM grátis só em regiões dos EUA, 30 GB de disco e **1 GB/mês de saída** ([Google](https://docs.cloud.google.com/free/docs/free-cloud-features)). Latência alta para o Brasil. |
| **Fly.io** | Sem plano grátis para contas novas desde 07/10/2024 (*secundária*: [SaaSPricePulse](https://www.saaspricepulse.com/tools/flyio)). |
| **PocketHost** | A página de preços atual não mostra plano grátis: US$ 9,99/mês por instância ([pockethost.io](https://pockethost.io/pricing)). |
| **PocketBase Cloud** | Tem plano grátis (1 instância), mas **exige cadastrar cartão no Stripe** e **não é oficial** ([pocketbasecloud.com](https://pocketbasecloud.com/)). |

---

## 4. Funcionalidades pedidas, com Supabase

### 4.1 Cadastro e login com e-mail e senha
- `supabase.auth.signUp({ email, password })` e `signInWithPassword(...)`. No projeto hospedado, a confirmação de e-mail já vem ligada por padrão ([docs](https://supabase.com/docs/guides/auth/passwords)).
- Política de senha configurável no painel: tamanho mínimo (menos de 8 não é recomendado) e exigência de dígito, maiúscula e símbolo ([docs](https://supabase.com/docs/guides/auth/password-security)).
- Rate limit padrão ([docs](https://supabase.com/docs/guides/auth/rate-limits)): cadastro e login com 30 pedidos a cada 5 min; endpoint de token (login e refresh) com 150 a cada 5 min; 60 s entre reenvios de confirmação/OTP para o mesmo usuário. Tudo ajustável no painel.

### 4.2 Confirmar que o e-mail é válido (OTP é melhor que link no app)
- **Use código de 6 dígitos (OTP) em vez de link.** O modelo de e-mail aceita `{{ .Token }}`. O app pede o código e chama `verifyOtp({ email, token, type: 'signup' })` ([modelos de e-mail](https://supabase.com/docs/guides/auth/auth-email-templates)). Vantagens:
  - dispensa deep link no iOS, no Android e na TV;
  - evita um problema documentado: antivírus de e-mail "clicam" no link antes do usuário e o token expira na hora.
- **Limite de envio:** o SMTP nativo do Supabase manda **2 e-mails por hora, e só para endereços da equipe do projeto**. Serve só para teste ([docs](https://supabase.com/docs/guides/auth/auth-smtp)). Com SMTP próprio, o limite começa em 30 por hora e pode ser aumentado.
- **SMTP grátis:**

| Provedor | Cota grátis | Observação |
|---|---|---|
| **Resend** | **3.000 e-mails/mês, com teto de 100/dia**, SMTP incluso ([pricing](https://resend.com/pricing)) | **Recomendado.** Aparece na lista de provedores sugeridos pelo Supabase. Exige verificar um domínio (DNS SPF/DKIM). |
| **Brevo** | **300 e-mails/dia**, somando marketing e transacional (*secundária*: [Dreamlit](https://dreamlit.ai/blog/brevo-review), [Fastlancer](https://www.fastlancer.org/en/fastlancer-blog/brevo-review/)) | **Não consegui abrir a página oficial** (retornou 403 ou só o título). Confirmar no cadastro. |

- **Conta de cabeça:** 100 e-mails/dia no Resend dão para cerca de 50 cadastros por dia (confirmação + eventual reset). Isso sobra no começo. Se estourar, o próximo degrau é pago ou o Brevo (300/dia).
- **Domínio próprio é necessário** para o e-mail não cair no spam. Um `.com.br` custa em torno de R$ 40/ano (*secundária*: [HostGator](https://www.hostgator.com.br/blog/quanto-custa-um-dominio/); a página do Registro.br não carregou).

### 4.3 Esqueci a senha
1. `resetPasswordForEmail(email)`. O modelo de "Reset password" usa `{{ .Token }}` (código).
2. O app pede o código e chama `verifyOtp({ email, token, type: 'recovery' })`. Isso abre uma sessão temporária.
3. `updateUser({ password: novaSenha })` ([docs](https://supabase.com/docs/guides/auth/passwords)).
4. Na tela, a mensagem é sempre "se o e-mail existir, enviamos um código". Assim ninguém descobre quais e-mails estão cadastrados.

### 4.4 Sessão, JWT e refresh
- **Conceito:** o login devolve dois tokens. O **access token** (JWT) diz "sou o usuário X" e é enviado em toda chamada. O **refresh token** serve para pedir um novo access token quando o atual vence.
- **Access token:** vale **1 hora** por padrão, que é o valor recomendado.
- **Refresh token:** é de **uso único**, com tolerância de 10 s. Se alguém reusar um refresh token antigo fora dessa tolerância, **a sessão inteira é revogada**, o que protege contra roubo de token ([docs](https://supabase.com/docs/guides/auth/sessions)).
- O `supabase-js` renova o token sozinho. No app vanilla, a alternativa é chamar a API REST do Auth direto. Não verifiquei se o `supabase-js` roda nos navegadores de TVs antigas (ver seção 10.1).
- **Controles que exigem Pro:** sessão com prazo fixo, expiração por inatividade e "uma sessão por usuário". No Free, o limite de aparelhos é feito por nós (item 4.5).

### 4.5 Limite de aparelhos/telas por conta
- **Tabela `devices`** (seção 6): cada instalação gera um `device_uid` aleatório na primeira abertura. Não usar IMEI nem dado de hardware.
- **Edge Function `register-device`,** chamada no login e ao abrir o app:
  1. confere o JWT;
  2. conta os aparelhos ativos da conta (não revogados e vistos nos últimos 30 dias);
  3. se passou de `plans.max_devices`, responde **409** com a lista de aparelhos, para o usuário escolher qual remover;
  4. senão, grava ou atualiza o `last_seen_at` e o `session_id`. O `session_id` vem como claim dentro do JWT do Supabase.
- **Remover um aparelho:** a Edge Function marca `revoked_at`. O app revogado descobre isso na próxima abertura ou renovação de token (no máximo 1 h) e se desloga sozinho. Apagar a sessão no `auth.sessions` pela chave secreta derrubaria o refresh na hora. Funciona na prática, mas **não achei isso como API documentada**: validar em protótipo.
- **Limite honesto:** o backend limita **aparelhos logados no app**, não **streams simultâneos**. O vídeo vai direto do provedor IPTV para o aparelho e nunca passa pelo backend. O limite de conexões da conta Xtream é outra coisa, controlada pelo provedor do usuário (é o que a v7 investiga no ponto 3).
- **Opcional depois:** um "heartbeat" a cada 60 s durante a reprodução daria o número de telas assistindo ao mesmo tempo. Custa cerca de 1.440 chamadas por dia por tela, o que ainda cabe nas 500 mil/mês com pouca gente. Comece pelo limite de aparelhos, que é mais simples.

### 4.6 Login no app Capacitor (iOS/Android)
- O app já tem `CapacitorHttp` ligado (`capacitor.config.ts`), então `fetch` sai pelo HTTP nativo e **CORS não afeta o app**.
- **Onde guardar o refresh token:** o `localStorage` basta para começar. O risco é **XSS**. Nomes e logos de canais vêm de listas de terceiros: se algum trecho do app usa `innerHTML` com esses dados, um canal malicioso poderia roubar o token. Revisar para usar `textContent`. Depois, dá para avaliar guardar no Keychain/Keystore com um plugin (**não instalar nada agora**).
- **Problema do CAPTCHA no iOS:** o app iOS roda em `capacitor://localhost`, e o Turnstile só aceita nomes de domínio reais, sem esquema nem localhost ([Cloudflare](https://developers.cloudflare.com/turnstile/concepts/hostname-management/)). Há pedidos na comunidade para suportar `capacitor://` sem solução oficial (*secundária*: [fórum Cloudflare](https://community.cloudflare.com/t/turnstile-allow-uri-schemes-other-than-http-or-https/699634)). O CAPTCHA do Supabase vale para o projeto inteiro. Segundo o código citado num PR de terceiro, ele cobre `/signup`, `/recover`, `/resend`, `/otp`, `/magiclink`, `/sso` e o login por senha ([PR](https://github.com/luetzey/who2be/pull/578)). **Ou seja: ligar o CAPTCHA quebraria o login do app iOS.**
- **Saída proposta:** páginas de conta hospedadas no domínio próprio (cadastro, login e esqueci a senha, com Turnstile).
  1. O app abre essas páginas no navegador do sistema (plugin oficial `@capacitor/browser`).
  2. A página volta ao app por deep link (`sintoniza://auth/callback`) com um código **PKCE**.
  3. O app troca o código por sessão (`exchangeCodeForSession`).
  - **PKCE**, em uma linha: o app gera um segredo, manda só o hash dele, e na volta só quem tem o segredo original troca o código pela sessão. Um código interceptado não serve para nada.
  - O deep link precisa estar na lista "Redirect URLs" do Supabase.
- **Fase inicial sem CAPTCHA:** dá para lançar o login direto no app, apoiado nos rate limits, na confirmação de e-mail obrigatória e no fail2ban do Supabase, e migrar para a página hospedada antes de abrir ao público.

### 4.7 Login na TV (webOS/Tizen) por código ou QR no celular
Digitar e-mail e senha com o controle remoto é ruim, e o CAPTCHA não roda na TV. O padrão de mercado é o **"device flow"** (RFC 8628, o mesmo da Netflix e do YouTube). O servidor OAuth do Supabase **não oferece esse fluxo**: só aceita authorization code com PKCE e refresh, e está em beta ([docs](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)). Dá para montá-lo com 3 Edge Functions:

1. **TV → `tv-start`** (sem login): gera um `user_code` curto (ex.: `K7QF-2M9P`) e um `poll_secret` longo e grava **os hashes** de ambos em `tv_login_codes` com validade de 10 min. A TV mostra o código e um QR para `https://<seu-dominio>/tv?c=K7QF2M9P`. Esse endpoint precisa de rate limit por IP.
2. **Celular (logado) → `tv-approve`:** o usuário confirma "Aprovar a TV LG da sala?". A função:
   - confere JWT, assinatura ativa e limite de aparelhos;
   - chama `auth.admin.generateLink({ type: 'magiclink', email })`, que **não envia e-mail** e devolve um `hashed_token` ([docs](https://supabase.com/docs/reference/javascript/auth-admin-generatelink));
   - guarda esse token na linha do código.
3. **TV → `tv-poll`** a cada 5 s com o `poll_secret`. Quando o código estiver aprovado, recebe o `token_hash` **uma única vez** (a linha é apagada) e chama `verifyOtp({ token_hash, type: 'email' })`, que devolve a sessão ([docs](https://supabase.com/docs/reference/javascript/auth-verifyotp)).
4. **Segurança do fluxo:**
   - quem só vê o código na tela não consegue a sessão, porque falta o `poll_secret`;
   - o código expira em 10 min, tem limite de tentativas e é de uso único;
   - o celular mostra o nome do aparelho antes de aprovar.
   - Segundo a mesma fonte secundária do item 4.6, o endpoint de verificação não passa pelo CAPTCHA. **Validar em protótipo.**

---

## 5. Mensalidade com cancelamento automático

### 5.1 Estados da assinatura
```
cadastro → trialing (7 dias)
              │ pagou
              ▼
           active ──(venceu, sem pagamento)──► past_due (carência de 3 dias)
              ▲                                   │            │
              └──────────(pagou)──────────────────┘            │ carência acabou
                                                               ▼
           active + cancel_at_period_end ──(venceu)──► canceled (acesso bloqueado)
```
- **Quem tem acesso:** `trialing` ou `active` com `current_period_end` no futuro, ou `past_due` com `grace_until` no futuro.
- Quem está em `canceled` continua **logado**, para poder pagar, mas o app mostra a tela "assinatura vencida".
- **Cancelar = parar de renovar.** O usuário usa até o fim do período já pago. Não é preciso job para estornar nada.

### 5.2 Receber no Brasil: nenhum gateway é grátis por transação

| Gateway | Pix | Cartão de crédito | Recorrência | Fonte |
|---|---|---|---|---|
| **Mercado Pago** | **0,99%** | **4,98%** com recebimento na hora (prazos maiores têm taxa menor; os números variam entre as fontes, ver 10.1) | API de Assinaturas (`/preapproval`) com novas tentativas automáticas se o cartão recusar. A documentação lista Pix entre os meios, mas não confirmei se o **Pix Automático** está liberado via API | Oficial bloqueou (403). *Secundárias*: [SellSync (30/07/2026)](https://sellsync.ai/pt/blog/taxa-mercado-pago-2026-guia-completo/) e busca, que concordam em Pix 0,99% e cartão na hora 4,98%. [Assinaturas (oficial)](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview) |
| **Asaas** | **R$ 1,99** fixo (R$ 0,99 nos 3 primeiros meses) | **2,99% + R$ 0,49** à vista (1,99% na promoção) | Assinaturas (boleto, Pix ou cartão) e **Pix Automático com `paymentCreationMode: SUBSCRIPTION`** (maio/2026) | [Preços Asaas](https://www.asaas.com/precos-e-taxas), [Pix Automático](https://docs.asaas.com/docs/pix-automatico), [changelog](https://docs.asaas.com/changelog/pix-autom%C3%A1tico-cobran%C3%A7as-recorrentes-automatizadas) |
| **Stripe** (comparação) | 1,19%, **só por convite** | 3,99% + R$ 0,39 (+2% se o cartão for internacional) | Stripe Billing: **+0,7%** do volume | [Stripe BR](https://stripe.com/br/pricing) |

**Exemplo com uma mensalidade hipotética de R$ 14,90:**

| | Taxa por cobrança | % do valor |
|---|---|---|
| Mercado Pago, Pix | R$ 0,15 | 0,99% |
| Mercado Pago, cartão na hora | R$ 0,74 | 4,98% |
| Asaas, Pix (fora da promoção) | R$ 1,99 | **13,4%** |
| Asaas, cartão à vista | R$ 0,94 | 6,3% |
| Stripe, cartão + Billing | R$ 1,09 | 7,3% |

**Recomendação:** para ticket baixo, **Mercado Pago**. O Pix percentual sai muito mais barato que a tarifa fixa do Asaas.
- **Cartão:** Assinatura MP recorrente.
- **Pix:** cobrança avulsa todo mês. O usuário paga manualmente e o cron cuida do vencimento.
- **Quando usar o Asaas:** se o Pix recorrente sem ação do usuário (Pix Automático) virar prioridade, porque a API dele para isso está documentada.

Nenhum dos dois cobra mensalidade fixa para começar, mas **ambos cobram por transação**.

### 5.3 Webhook que ativa ou renova
**Conceito:** webhook é o gateway chamando uma URL sua ("o pagamento X foi aprovado"). Ele fica numa Edge Function `payments-webhook` com `verify_jwt = false` no `config.toml`, porque o gateway não tem JWT do Supabase ([docs](https://supabase.com/docs/guides/functions/function-configuration)). Essa URL é pública, então **a validação da assinatura é obrigatória**.

1. **Validar a origem:**
   - **Mercado Pago:** o cabeçalho `x-signature` vem como `ts=...,v1=...`. Calcule HMAC-SHA256 com o segredo do painel (Suas integrações → Webhooks) e compare com `v1` ([docs](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks)). O texto assinado combina `data.id`, `x-request-id` e `ts`. Confirme o formato exato na documentação ao implementar. Rejeite também `ts` muito antigo, para evitar replay.
   - **Asaas:** configure um `authToken` de 32 a 255 caracteres. Ele chega no cabeçalho `asaas-access-token`. Compare em tempo constante ([docs](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook)).
2. **Idempotência:** o gateway pode mandar o mesmo evento mais de uma vez (o Asaas avisa: "pelo menos uma vez"). Grave o `idempotency_key` em `webhook_events` com `ON CONFLICT DO NOTHING`. Se já existia, responda 200 e pare.
3. **Não confiar no corpo do webhook:** busque o pagamento na API do gateway (`GET /v1/payments/{id}` no MP), usando o access token guardado em secret, e use o status que vier de lá.
4. **Numa transação:**
   - fazer upsert em `payments` pela chave `(gateway, gateway_payment_id)`;
   - se o status for `approved` e ainda não tiver sido aplicado, estender o período (`current_period_end = greatest(current_period_end, now()) + período`), gravar `status = 'active'` e zerar `grace_until`;
   - gravar no `audit_log`.
5. **Estorno ou chargeback:** marcar o pagamento, voltar a assinatura para `past_due` ou `canceled` e registrar no log.
6. **Responder rápido:**
   - **Mercado Pago:** espera **200/201 em até 22 s**; se não receber, tenta de novo a cada 15 min.
   - **Asaas:** pode **pausar a fila após 15 falhas seguidas**.
   - Por isso, grave primeiro e processe o resto depois.

### 5.4 Job agendado que vence e bloqueia (pg_cron)
- Uma função SQL roda a cada 15 min (SQL completo na seção 6) e faz três coisas:
  1. quem pediu cancelamento e venceu vai para `canceled`;
  2. quem venceu sem pagar vai para `past_due`, com `grace_until = vencimento + grace_days`;
  3. quem esgotou a carência vai para `canceled` (bloqueio).
- Tudo vai para o `audit_log`, e o mesmo job apaga os códigos de TV expirados.
- O pg_cron roda em UTC. Limpe `cron.job_run_details` de tempos em tempos, porque ela cresce ([discussão oficial](https://github.com/orgs/supabase/discussions/37405)).
- **Avisos por e-mail** ("vence em 3 dias", "está em carência"): o Cron pode fazer uma requisição HTTP para uma Edge Function ([docs](https://supabase.com/docs/guides/cron)), que envia pelo Resend. Isso conta na cota de 100/dia.

### 5.5 O app checando a assinatura (login, abertura e offline)
- **No login e a cada abertura:** o app chama `rpc('get_my_access')` e recebe `status`, `current_period_end`, `grace_until`, `max_devices`, `has_access` e `server_time`. O app **não calcula** se tem acesso: usa o `has_access` que vem do servidor.
- **Offline:** o app guarda a última resposta e o horário da checagem. Proposta: liberar o uso offline enquanto valerem **as duas** condições:
  - o período pago (com carência) ainda não acabou;
  - a última checagem online tem menos de 7 dias.
- **Relógio adulterado:** use a diferença para o `server_time`, em vez de confiar só no relógio do aparelho.
- **Limite honesto (de novo):** como o player é todo local, um app modificado pula essa checagem. Um "comprovante" assinado pelo servidor (JWT com chave privada no secret e chave pública no app) impede editar o `localStorage`, mas não impede modificar o app. Aceite isso como **desestímulo**, não como tranca.

### 5.6 Regras das lojas: vender dentro do app tem comissão
- **Apple, Brasil (desde o acordo com o CADE, iOS 26.5):**
  - **Compra dentro do app pela Apple:** comissão de 21% + 5% de processamento. Para quem está no Small Business Program, 10% + 5%. Assinaturas pagam 10% a partir do 2º ano.
  - **Pagamento alternativo dentro do app:** 21%, ou 10% no Small Business.
  - **Link para pagar fora do app:** 15%, ou 10%, sobre vendas feitas até 7 dias depois do toque no link.
  - Em qualquer caso, a compra pela Apple **precisa aparecer como opção**, com o mesmo destaque ([Apple](https://developer.apple.com/support/payment-options-on-the-app-store-in-brazil)).
- **Google Play:** assinaturas pagam 15% fora de EUA/UE/Reino Unido ([Play](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)). O Brasil pode usar o "user choice billing", que reduz a taxa em 4 pontos quando o usuário paga pelo sistema alternativo ([Play](https://support.google.com/googleplay/android-developer/answer/13821247?hl=en)).
- **Fora das lojas** (APK direto ou IPA por outro canal) não há comissão, mas a distribuição e a confiança do usuário ficam mais difíceis. **Decidir o canal antes da Fase 2**, porque isso muda a tela de pagamento. Não fiz análise completa da regra 3.1.3 da Apple (apps multiplataforma).

---

## 6. Esquema de banco proposto (PostgreSQL / Supabase)

Proposta para revisão. **Não aplicar sem conferir.** Funções internas ficam no schema `private`, que não é exposto pela API, para ninguém chamá-las via `rpc` com a chave pública.

```sql
-- =====================================================================
-- Sintoniza — esquema mínimo de contas, assinatura e aparelhos
-- PostgreSQL 15+ no Supabase. Tudo que é "escrita sensível" é feito só
-- pelo servidor (Edge Functions com a chave secreta ou pg_cron).
-- =====================================================================

-- Schema privado: não é exposto pela API REST do Supabase
create schema if not exists private;

-- ---------- Tipo: estados possíveis da assinatura ----------
create type public.subscription_status as enum
  ('trialing', 'active', 'past_due', 'canceled');

-- ---------- plans: catálogo de planos (leitura pública) ----------
create table public.plans (
  id           text primary key,                          -- ex.: 'mensal'
  name         text        not null,                      -- nome exibido
  price_cents  integer     not null check (price_cents > 0), -- R$ 14,90 = 1490
  currency     text        not null default 'BRL',
  period_days  integer     not null default 30,           -- duração do ciclo
  max_devices  smallint    not null default 2,            -- limite de aparelhos
  grace_days   smallint    not null default 3,            -- carência pós-vencimento
  trial_days   smallint    not null default 7,            -- teste grátis
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- profiles: dados mínimos (1:1 com auth.users) ----------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text check (char_length(display_name) <= 60),
  terms_version     text,                     -- versão dos Termos aceita (LGPD)
  terms_accepted_at timestamptz,              -- quando aceitou
  marketing_opt_in  boolean not null default false, -- consentimento separado
  created_at        timestamptz not null default now()
);

-- ---------- subscriptions: 1 assinatura por conta ----------
create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users (id) on delete cascade,
  plan_id                 text not null references public.plans (id),
  status                  public.subscription_status not null default 'trialing',
  current_period_end      timestamptz not null,       -- liberado até aqui
  grace_until             timestamptz,                -- preenchido em past_due
  cancel_at_period_end    boolean not null default false, -- pediu p/ não renovar
  gateway                 text check (gateway in ('mercadopago', 'asaas', 'stripe')),
  gateway_customer_id     text,
  gateway_subscription_id text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (gateway, gateway_subscription_id)
);
-- Índice usado pelo job de vencimento
create index subscriptions_status_period_idx
  on public.subscriptions (status, current_period_end);

-- ---------- payments: cada cobrança do gateway ----------
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  -- "set null": ao excluir a conta, o registro financeiro fica anonimizado
  user_id            uuid references auth.users (id) on delete set null,
  subscription_id    uuid references public.subscriptions (id) on delete set null,
  gateway            text not null check (gateway in ('mercadopago', 'asaas', 'stripe')),
  gateway_payment_id text not null,          -- id do pagamento no gateway
  status             text not null,          -- approved, pending, rejected, refunded, charged_back
  method             text,                   -- pix, credit_card, boleto
  amount_cents       integer not null,
  paid_at            timestamptz,
  period_applied     boolean not null default false, -- já estendeu o período? (evita renovar 2x)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (gateway, gateway_payment_id)       -- 1ª trava de idempotência
);
create index payments_user_idx on public.payments (user_id, created_at desc);

-- ---------- webhook_events: 2ª trava de idempotência ----------
create table public.webhook_events (
  idempotency_key text primary key,          -- ex.: 'asaas:evt_123' / 'mercadopago:<x-request-id>'
  gateway         text not null,
  event_type      text not null,
  payload         jsonb not null,            -- só o necessário; NUNCA dados de cartão
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);

-- ---------- devices: aparelhos logados (limite de telas) ----------
create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_uid   text not null check (char_length(device_uid) between 16 and 64), -- aleatório, gerado pelo app
  platform     text not null check (platform in ('ios', 'android', 'web', 'webos', 'tizen')),
  label        text check (char_length(label) <= 60),   -- "TV da sala"
  session_id   uuid,                                     -- claim session_id do JWT
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, device_uid)
);
-- Índice parcial: contagem rápida só dos aparelhos ativos
create index devices_active_idx on public.devices (user_id) where revoked_at is null;

-- ---------- tv_login_codes: pareamento TV ↔ celular ----------
create table public.tv_login_codes (
  id               uuid primary key default gen_random_uuid(),
  user_code_hash   text not null unique,     -- sha256 do código exibido na TV
  poll_secret_hash text not null,            -- sha256 do segredo que só a TV conhece
  device_uid       text not null,
  platform         text not null check (platform in ('webos', 'tizen')),
  approved_by      uuid references auth.users (id) on delete cascade,
  token_hash       text,                     -- uso único; apagado ao entregar
  attempts         smallint not null default 0,
  expires_at       timestamptz not null,     -- now() + 10 min
  created_at       timestamptz not null default now()
);
create index tv_login_codes_expires_idx on public.tv_login_codes (expires_at);

-- ---------- audit_log: trilha de eventos importantes ----------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,                 -- sem FK: o log sobrevive à exclusão da conta
  actor      text not null,        -- 'user', 'cron', 'webhook:mercadopago', 'admin'
  action     text not null,        -- 'subscription.renewed', 'device.revoked', ...
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

-- =====================================================================
-- Row Level Security: LIGADO EM TODAS as tabelas do schema public
-- Tabela com RLS e sem policy = ninguém acessa com a chave pública.
-- =====================================================================
alter table public.plans          enable row level security;
alter table public.profiles       enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.payments       enable row level security;
alter table public.webhook_events enable row level security;
alter table public.devices        enable row level security;
alter table public.tv_login_codes enable row level security;
alter table public.audit_log      enable row level security;

-- plans: qualquer um lê os planos ativos (tela de preços)
create policy plans_read on public.plans
  for select to anon, authenticated
  using (is_active);

-- profiles: o dono lê e edita só o próprio perfil
create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);   -- "(select ...)" = cache por consulta (performance)

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- RLS filtra linhas, não colunas: limitar QUAIS colunas o usuário altera
revoke update on public.profiles from authenticated;
grant  update (display_name, marketing_opt_in) on public.profiles to authenticated;

-- subscriptions, payments, devices: o dono só LÊ as próprias linhas
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy payments_select_own on public.payments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy devices_select_own on public.devices
  for select to authenticated using ((select auth.uid()) = user_id);

-- Defesa em profundidade: tira qualquer permissão de escrita da chave pública
revoke insert, update, delete on public.plans, public.subscriptions,
  public.payments, public.devices from anon, authenticated;
-- webhook_events, tv_login_codes, audit_log: RLS ligado e sem policy.
-- Só a chave secreta (Edge Functions) e o pg_cron mexem nelas.

-- =====================================================================
-- Novo usuário: cria perfil + assinatura em teste (trigger no auth.users)
-- =====================================================================
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer          -- roda como dono da função (precisa gravar em tabelas protegidas)
set search_path = ''      -- evita sequestro de search_path
as $$
begin
  insert into public.profiles (id) values (new.id);

  insert into public.subscriptions (user_id, plan_id, status, current_period_end)
  select new.id, p.id, 'trialing', now() + make_interval(days => p.trial_days)
  from public.plans p
  where p.id = 'mensal';

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- =====================================================================
-- Consulta do app: "tenho acesso?" (a decisão é do servidor)
-- =====================================================================
create or replace function public.get_my_access()
returns table (
  status             public.subscription_status,
  current_period_end timestamptz,
  grace_until        timestamptz,
  max_devices        smallint,
  has_access         boolean,
  server_time        timestamptz
)
language sql
stable
security invoker          -- roda com as permissões do usuário: RLS continua valendo
set search_path = ''
as $$
  select s.status,
         s.current_period_end,
         s.grace_until,
         p.max_devices,
         (   (s.status in ('trialing', 'active') and s.current_period_end > now())
          or (s.status = 'past_due' and s.grace_until > now())
         ) as has_access,
         now() as server_time
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.user_id = (select auth.uid());
$$;

-- =====================================================================
-- Job de vencimento (pg_cron): cancela, entra em carência e bloqueia
-- =====================================================================
create or replace function private.expire_subscriptions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1) Pediu cancelamento e o período acabou: encerra (sem carência)
  with c as (
    update public.subscriptions s
       set status = 'canceled', updated_at = now()
     where s.status in ('trialing', 'active')
       and s.cancel_at_period_end
       and s.current_period_end <= now()
    returning s.user_id
  )
  insert into public.audit_log (user_id, actor, action)
  select user_id, 'cron', 'subscription.canceled_at_period_end' from c;

  -- 2) Venceu sem pagamento: entra em carência (past_due)
  with d as (
    update public.subscriptions s
       set status      = 'past_due',
           grace_until = s.current_period_end + make_interval(days => p.grace_days),
           updated_at  = now()
      from public.plans p
     where p.id = s.plan_id
       and s.status in ('trialing', 'active')
       and s.current_period_end <= now()
    returning s.user_id
  )
  insert into public.audit_log (user_id, actor, action)
  select user_id, 'cron', 'subscription.past_due' from d;

  -- 3) Carência acabou: bloqueia o acesso
  with b as (
    update public.subscriptions s
       set status = 'canceled', updated_at = now()
     where s.status = 'past_due'
       and s.grace_until <= now()
    returning s.user_id
  )
  insert into public.audit_log (user_id, actor, action)
  select user_id, 'cron', 'subscription.blocked' from b;

  -- 4) Limpeza: códigos de pareamento de TV expirados
  delete from public.tv_login_codes where expires_at < now();
end;
$$;

-- Ninguém chama essas funções pela API (só trigger e cron)
revoke all on function private.expire_subscriptions() from public, anon, authenticated;
revoke all on function private.handle_new_user()      from public, anon, authenticated;

-- Agenda: a cada 15 minutos (horário UTC)
select cron.schedule(
  'sintoniza-expirar-assinaturas',
  '*/15 * * * *',
  $$ select private.expire_subscriptions(); $$
);

-- Agenda: limpeza semanal do histórico do próprio pg_cron (domingo 03:00 UTC)
select cron.schedule(
  'sintoniza-limpar-historico-cron',
  '0 3 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $$
);
```

**Notas do esquema:**
- **Trial de 7 dias por e-mail novo convida abuso** (uma conta por e-mail descartável). Alternativas:
  - sem teste grátis;
  - teste só depois do primeiro pagamento;
  - trial só depois de o e-mail ser confirmado.
- **Idempotência:** ficou em duas camadas. `webhook_events.idempotency_key` impede processar o mesmo evento duas vezes, e `payments (gateway, gateway_payment_id)` + `period_applied` impedem renovar duas vezes pelo mesmo pagamento.
- **Listas M3U e credenciais Xtream NÃO entram no banco.** Isso é de propósito (seção 8): menos dado pessoal (LGPD) e backend neutro.
- **Recomendação da documentação de RLS** ([docs](https://supabase.com/docs/guides/database/postgres/row-level-security)): indexar as colunas usadas nas policies, usar `(select auth.uid())` e criar views com `security_invoker = true`, porque views ignoram o RLS por padrão.

---

## 7. Segurança: checklist prático

**Contas e senhas**
- [ ] O hash de senha é feito pelo Supabase Auth (bcrypt com salt). **Nunca** gravar senha em tabela própria.
- [ ] Senha mínima de 8+ caracteres e exigência de tipos de caractere no painel. A proteção contra senha vazada é Pro: fica para depois.
- [ ] Confirmação de e-mail obrigatória, por OTP.
- [ ] O "esqueci a senha" responde sempre igual, sem revelar se o e-mail existe.

**Abuso e força bruta**
- [ ] Rate limits do Auth revisados no painel (padrões na seção 4.1). O fail2ban da plataforma já bloqueia IPs com falhas repetidas de login ([Supabase Security](https://supabase.com/security)).
- [ ] Bloqueio após tentativas: o Supabase limita por IP e por janela de tempo, mas **o gancho "Password Verification Attempt" (bloqueio por conta) é só nos planos Team/Enterprise** ([hooks](https://supabase.com/docs/guides/auth/auth-hooks)). No Free, dependemos do rate limit e do CAPTCHA.
- [ ] Turnstile no cadastro, no login e no "esqueci a senha", via páginas hospedadas (seção 4.6). O token do Turnstile vale 300 s, é de uso único e **precisa ser validado no servidor** ([Cloudflare](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)). O Supabase faz isso quando o CAPTCHA está ligado.
- [ ] Edge Functions públicas (`tv-start`, webhook) com limite próprio por IP ou código, e respostas curtas.

**Banco**
- [ ] **RLS ligado em 100% das tabelas do `public`.** "Uma tabela num schema exposto sem RLS pode ser lida e alterada por qualquer papel com permissão" ([docs](https://supabase.com/docs/guides/database/postgres/row-level-security)). Rodar o Security Advisor do painel antes de cada deploy.
- [ ] Funções `security definer` em schema não exposto (`private`), com `set search_path = ''` e `revoke execute`.
- [ ] Views com `security_invoker = true`.

**Pagamentos**
- [ ] Webhook com assinatura validada (HMAC do MP ou token do Asaas), `ts` recente e idempotência.
- [ ] Status do pagamento sempre consultado na API do gateway.
- [ ] Usar o modo sandbox dos gateways para testes. Nunca misturar chave de teste com chave de produção.

**Segredos**
- [ ] `.env` no `.gitignore` (a documentação do Supabase avisa: um `.env` commitado expõe todos os segredos, [docs](https://supabase.com/docs/guides/functions/secrets)).
- [ ] Produção com `supabase secrets set NOME=valor`. Nomes não podem começar com `SUPABASE_`, porque esse prefixo é reservado.
- [ ] CI com **GitHub Actions secrets** (nunca nos arquivos do workflow).
- [ ] No app, só a chave `sb_publishable_...`. Buscar no repositório por `sb_secret_`, `service_role` e `APP_USR-` (token do MP) antes de cada build.

**Rede**
- [ ] HTTPS em tudo. Supabase e Cloudflare já entregam TLS.
- [ ] **CORS:** a API REST do Supabase hospedado responde `Access-Control-Allow-Origin: *` e **não dá para restringir** ([issue](https://github.com/supabase/supabase/issues/42033), [discussão](https://github.com/orgs/supabase/discussions/7038)). Nas Edge Functions, dá para restringir aos domínios da web e da TV. **CORS não é trava de segurança:** só vale para navegador, e `curl` ignora. A trava real é JWT + RLS.
- [ ] **DDoS:** o Supabase já fica atrás da Cloudflare. As páginas hospedadas também podem ficar atrás da Cloudflare Free, com proteção DDoS sem limite de volume ([Cloudflare](https://developers.cloudflare.com/ddos-protection/)) e **1 regra de rate limit** por IP (janela de 10 s) ([Cloudflare](https://developers.cloudflare.com/waf/rate-limiting-rules/)). Domínio próprio na frente do Supabase é add-on pago ([docs](https://supabase.com/docs/guides/platform/custom-domains)).

**O que NÃO confiar no cliente**
- [ ] O app pode ser descompilado. Tudo que decide acesso fica no servidor: preço, status, limite de aparelhos, aprovação de pagamento e aprovação de TV. O app nunca manda "estou pago" nem "meu limite é 5".
- [ ] Dados de listas de terceiros (nomes e logos de canais) são **não confiáveis**: renderizar com `textContent`, para não permitir XSS que roube o token.

**Backup e operação**
- [ ] Sem backup no Free: **dump semanal** com `supabase db dump` num workflow agendado do GitHub Actions, guardado em repositório **privado** ou criptografado. Testar a restauração uma vez.
- [ ] Alerta de pausa: o Supabase manda e-mail antes de pausar. Deixar o e-mail da conta monitorado.

**LGPD (Lei 13.709/2018, [texto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm))**
- [ ] **Dados mínimos:** e-mail, senha (hash), aparelhos e pagamentos. Sem CPF, a não ser que o gateway exija, e aí ele fica no gateway. Sem listas nem credenciais IPTV.
- [ ] **Consentimento:** aceite de Termos e Política de Privacidade no cadastro, com versão e data. Opt-in de marketing separado.
- [ ] **Exclusão de conta dentro do app e por um link na web.** As lojas exigem as duas coisas. A Apple exige excluir dentro do app ([Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)). O Google exige no app **e** por link na web, e excluir também os dados; desativar a conta não conta ([Google](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)). Implementar como uma Edge Function que apaga o usuário (cascata) e anonimiza `payments` e `audit_log`.
- [ ] **Incidente de segurança:** comunicar ANPD e titulares em **3 dias úteis** (Resolução CD/ANPD nº 15/2024, [ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca)).

---

## 8. Riscos e ponto de atenção legal

**Legal (objetivo):** cobrar mensalidade por **acesso a canais e filmes** exige ter o direito de distribuir esse conteúdo. IPTV sem licença é alvo ativo no Brasil:
- A Lei 14.815/2024 deu à Ancine poder administrativo para mandar suspender a oferta ilegal.
- A **Instrução Normativa nº 174 (10/04/2026)** permite bloquear sites, **aplicativos** e serviços digitais, e diz que o foco é quem oferece o conteúdo, não o usuário final ([Ancine](https://www.gov.br/ancine/pt-br/assuntos/noticias/ancine-publica-instrucao-normativa-e-amplia-combate-a-pirataria-audiovisual-na-internet)).
- Entre abr/2025 e abr/2026, foram mandados suspender 23.938 IPs e 4.161 sites ([Núcleo](https://nucleo.jor.br/curtas/2026/05/12/ancine-determinou-a-suspensao-de-24-mil-sites-e-ips-por-pirataria/)).
- A Anatel bloqueia servidores de TV box pirata desde 2023 e publicou um painel desses bloqueios em 11/05/2026 ([Minha Operadora](https://www.minhaoperadora.com.br/2026/05/anatel-lanca-painel-de-bloqueios-de-tv-boxes-piratas.html)).

**Recomendação:** manter o produto e o backend **neutros**. A assinatura paga o **software** (player, sincronização entre aparelhos, login na TV, limite de aparelhos). O conteúdo vem da lista que cada usuário já tem, sob responsabilidade dele, e isso deve estar escrito nos Termos. Na prática, isso quer dizer:
- não vender, indicar ou embutir listas;
- não ter catálogo de canais no servidor;
- **não oferecer o `cloudflare-proxy` como parte do serviço pago**, porque repassar streams de terceiros para clientes pagantes aproxima você de "distribuidor";
- ter um canal de denúncia e remoção.

Vale uma revisão rápida com advogado antes de começar a cobrar.

**Outros riscos:**

| Risco | Impacto | Mitigação |
|---|---|---|
| Pausa do Supabase Free sem uso | App fora do ar | Uso diário real. Monitorar o e-mail de aviso. Migrar para o Pro (US$ 25/mês) quando a receita cobrir. |
| Sem backup no Free | Perda de contas e pagamentos | Dump semanal no GitHub Actions (seção 7). |
| Cotas grátis mudam sem aviso (ex.: Oracle, Appwrite em 2026) | Custo ou bloqueio surpresa | Revisar as cotas a cada trimestre. Esquema em PostgreSQL padrão para migrar fácil. |
| App modificado pula a checagem | Uso sem pagar | Aceitar como risco residual. O valor que o servidor entrega (TV, limite, sincronização) só funciona pagando. |
| Loja rejeitar o app ou exigir compra pela loja | Cobrança travada ou comissão | Decidir o canal antes da Fase 2 (seção 5.6). |
| Cota de e-mail (100/dia no Resend) | Cadastro sem confirmação | Monitorar. Plano B: Brevo (300/dia) ou degrau pago. |

---

## 9. Próximos passos sugeridos (sem implementar agora)

Estimativas grosseiras, para um dev solo com ajuda do Claude, incluindo teste em iPhone, Android e TV.

| Fase | Entrega | Esforço |
|---|---|---|
| **0. Preparação** | Registrar domínio; criar o projeto Supabase (São Paulo); Resend com DNS verificado; SMTP ligado no Supabase; modelos de e-mail em PT com `{{ .Token }}`; Turnstile criado; `.env.example` + `.gitignore`; secrets no GitHub. Decidir o canal de venda (loja ou fora dela). | 0,5–1 dia |
| **1. Auth** | Cadastro, login, OTP de confirmação, esqueci a senha, sair, excluir conta (app + link web), tabela `profiles`, RLS, Termos/Política, backup semanal agendado. Login direto no app, sem CAPTCHA, para testes fechados. | 4–6 dias |
| **1.5. Páginas de conta + CAPTCHA** | Páginas hospedadas com Turnstile, deep link PKCE no app e CAPTCHA ligado no Supabase. Necessário antes de abrir ao público. | 2–3 dias |
| **2. Assinatura** | `plans`/`subscriptions`/`payments`/`webhook_events`, checkout no Mercado Pago (Pix avulso + cartão recorrente), webhook validado, `get_my_access`, pg_cron de vencimento, telas "assinatura vencida" e "pagar", e-mails de aviso, testes em sandbox (inclusive estorno e webhook duplicado). | 6–10 dias |
| **3. Aparelhos + TV** | Tabela `devices`, `register-device`, tela "meus aparelhos", pareamento da TV por código/QR (3 Edge Functions), teste nas TVs LG e Samsung. | 4–6 dias |
| **4. Endurecimento** | Revisão do Security Advisor, busca de segredos no repositório, CORS das Edge Functions, restauração de backup testada, revisão de XSS nos dados das listas, conversa com advogado. | 2–3 dias |

**Custo fixo estimado ao final:** R$ 0/mês em infraestrutura, mais o domínio (em torno de R$ 40/ano) e a taxa de cada pagamento, além da comissão da loja se a venda for dentro do app. O primeiro custo fixo que faz sentido assumir é o Supabase Pro (US$ 25/mês), quando houver receita, porque ele elimina a pausa e traz backup diário.

---

## 10. Fontes (todas conferidas em 2026-09-23)

**Supabase**
- Preços e cotas: https://supabase.com/pricing
- Rate limits do Auth: https://supabase.com/docs/guides/auth/rate-limits
- SMTP próprio: https://supabase.com/docs/guides/auth/auth-smtp
- Sessões e JWT: https://supabase.com/docs/guides/auth/sessions
- Chaves de API: https://supabase.com/docs/guides/api/api-keys
- CAPTCHA: https://supabase.com/docs/guides/auth/auth-captcha
- Auth Hooks e planos: https://supabase.com/docs/guides/auth/auth-hooks
- Cron: https://supabase.com/docs/guides/cron
- pg_cron no Free (resposta de colaborador): https://github.com/orgs/supabase/discussions/37405
- Status Beta do Cron: https://supabase.com/features/supabase-cron
- Pausa de projeto Free: https://supabase.com/docs/guides/platform/free-project-pausing
- Backups: https://supabase.com/docs/guides/platform/backups
- Segurança da plataforma (Cloudflare, fail2ban): https://supabase.com/security
- Segurança de senha: https://supabase.com/docs/guides/auth/password-security
- Login com senha e reset: https://supabase.com/docs/guides/auth/passwords
- Modelos de e-mail e OTP: https://supabase.com/docs/guides/auth/auth-email-templates
- Servidor OAuth (fluxos aceitos): https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- `generateLink`: https://supabase.com/docs/reference/javascript/auth-admin-generatelink
- `verifyOtp`: https://supabase.com/docs/reference/javascript/auth-verifyotp
- Limites de Edge Functions: https://supabase.com/docs/guides/functions/limits
- Secrets de Edge Functions: https://supabase.com/docs/guides/functions/secrets
- `verify_jwt`: https://supabase.com/docs/guides/functions/function-configuration
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Regiões: https://supabase.com/docs/guides/platform/regions
- Domínio próprio (pago): https://supabase.com/docs/guides/platform/custom-domains
- CORS fixo em `*`: https://github.com/supabase/supabase/issues/42033 e https://github.com/orgs/supabase/discussions/7038
- Rotas cobertas pelo CAPTCHA (PR de terceiro, secundária): https://github.com/luetzey/who2be/pull/578

**Firebase**
- Preços: https://firebase.google.com/pricing
- Planos Spark e Blaze: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Functions exige Blaze: https://firebase.google.com/docs/functions/get-started
- Limites de e-mail do Auth: https://firebase.google.com/docs/auth/limits
- Storage exige Blaze desde 03/02/2026: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024

**Cloudflare**
- Limites do Workers: https://developers.cloudflare.com/workers/platform/limits/
- Preços do D1: https://developers.cloudflare.com/d1/platform/pricing/
- Preços do KV: https://developers.cloudflare.com/kv/platform/pricing/
- Planos do Turnstile: https://developers.cloudflare.com/turnstile/plans/
- Hostnames do Turnstile: https://developers.cloudflare.com/turnstile/concepts/hostname-management/
- Turnstile em apps móveis: https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/
- Validação do Turnstile no servidor: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Pedido de suporte a `capacitor://` (comunidade, secundária): https://community.cloudflare.com/t/turnstile-allow-uri-schemes-other-than-http-or-https/699634
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Preços do Email Service: https://developers.cloudflare.com/email-service/platform/pricing/
- DDoS: https://developers.cloudflare.com/ddos-protection/
- Regras de rate limit: https://developers.cloudflare.com/waf/rate-limiting-rules/

**Appwrite**
- Plano Free: https://appwrite.io/docs/advanced/billing/free
- Pausa por inatividade: https://appwrite.io/changelog/entry/2026-02-20-1
- Exclusão após 90 dias pausado: https://appwrite.io/changelog/entry/2026-06-29
- Números do Free (secundária, verificada em 21/09/2026): https://agentdeals.dev/vendor/appwrite-cloud

**PocketBase e hospedagem**
- PocketBase: https://pocketbase.io/
- PocketHost: https://pockethost.io/pricing
- PocketBase Cloud: https://pocketbasecloud.com/
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Corte da cota ARM da Oracle: https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
- Google Cloud free tier: https://docs.cloud.google.com/free/docs/free-cloud-features
- Fly.io sem plano grátis (secundária): https://www.saaspricepulse.com/tools/flyio

**E-mail**
- Resend: https://resend.com/pricing
- Brevo (secundárias): https://dreamlit.ai/blog/brevo-review e https://www.fastlancer.org/en/fastlancer-blog/brevo-review/
- Página oficial do Brevo (não abriu): https://www.brevo.com/pricing/

**Pagamentos**
- Tarifas do Mercado Pago (secundária, 30/07/2026): https://sellsync.ai/pt/blog/taxa-mercado-pago-2026-guia-completo/
- Página oficial de tarifas do Mercado Pago (403): https://www.mercadopago.com.br/custos-e-tarifas
- Assinaturas do Mercado Pago: https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview
- Webhooks de assinatura do Mercado Pago: https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- Preços do Asaas: https://www.asaas.com/precos-e-taxas
- Assinaturas do Asaas: https://docs.asaas.com/docs/assinaturas
- Pix Automático do Asaas: https://docs.asaas.com/docs/pix-automatico
- Pix Automático vs Assinaturas: https://docs.asaas.com/docs/diferen%C3%A7a-entre-pix-autom%C3%A1tico-e-assinaturas-1
- Changelog do Pix Automático: https://docs.asaas.com/changelog/pix-autom%C3%A1tico-cobran%C3%A7as-recorrentes-automatizadas
- Webhooks do Asaas: https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- Stripe Brasil: https://stripe.com/br/pricing

**Lojas**
- Apple, pagamentos no Brasil: https://developer.apple.com/support/payment-options-on-the-app-store-in-brazil
- Apple, exclusão de conta: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Play, taxas de serviço: https://support.google.com/googleplay/android-developer/answer/112622?hl=en
- Google Play, user choice billing: https://support.google.com/googleplay/android-developer/answer/13821247?hl=en
- Google Play, exclusão de conta: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- Google Play, mudanças de junho/2026: https://android-developers.googleblog.com/2026/06/play-expanded-billing.html

**Legal e LGPD**
- Ancine, IN 174/2026: https://www.gov.br/ancine/pt-br/assuntos/noticias/ancine-publica-instrucao-normativa-e-amplia-combate-a-pirataria-audiovisual-na-internet
- Núcleo, 24 mil sites e IPs suspensos: https://nucleo.jor.br/curtas/2026/05/12/ancine-determinou-a-suspensao-de-24-mil-sites-e-ips-por-pirataria/
- Painel da Anatel: https://www.minhaoperadora.com.br/2026/05/anatel-lanca-painel-de-bloqueios-de-tv-boxes-piratas.html
- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD, comunicação de incidente: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca

**Outros**
- GitHub Actions (minutos grátis): https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Domínio .com.br (secundária): https://www.hostgator.com.br/blog/quanto-custa-um-dominio/

### 10.1 O que NÃO consegui confirmar

1. **Tarifas oficiais do Mercado Pago:** as páginas oficiais retornaram 403. Pix 0,99% e cartão na hora 4,98% vêm de fontes secundárias que concordam entre si. As taxas de cartão em 14 e 30 dias **divergem** entre as fontes (3,79% ou 3,98%; 3,03% ou 3,98%). Confirmar no painel do MP.
2. **Pix Automático no Mercado Pago via API:** a documentação lista Pix entre os meios de assinatura, mas não confirmei se a recorrência automática via Pix está liberada para qualquer conta.
3. **Cota oficial do Brevo:** a página oficial não carregou. Os 300/dia vêm de fontes secundárias.
4. **Números do Appwrite Free** (75 mil usuários ativos, 2 GB, 5 GB de banda, 750 mil execuções): a página de preços não mostrou os valores. Os números vêm de um agregador (verificado em 21/09/2026) e de um post antigo do próprio Appwrite. A **regra de pausa e exclusão** foi confirmada na fonte oficial.
5. **Turnstile no iOS/Capacitor:** a documentação oficial não aceita esquema nem localhost. Relatos da comunidade dizem que `capacitor://` não funciona. Não testei.
6. **Rotas cobertas pelo CAPTCHA do Supabase e isenção do `/verify`:** a informação vem de um PR de terceiro que cita o código do Supabase Auth, não da documentação oficial. Também falta confirmar o `type` certo no `verifyOtp` para um token gerado por `generateLink({ type: 'magiclink' })` (a documentação mostra `type: 'email'` com `token_hash`). Validar as duas coisas num protótipo antes de montar o login da TV.
7. **Revogar uma sessão específica apagando de `auth.sessions`:** funciona na prática segundo a comunidade, mas não achei API documentada para isso.
8. **`supabase-js` nos navegadores de TVs antigas (webOS/Tizen):** não verifiquei a compatibilidade. Plano B: chamar a API REST do Auth direto com `fetch`/XHR.
9. **Formato exato do texto assinado no HMAC do Mercado Pago** (ordem de `id`, `request-id` e `ts`): conferir na documentação ao implementar.
10. **Preço oficial do Registro.br:** a página não carregou. R$ 40/ano vem de fonte secundária.
11. **Firebase:** não encontrei política de pausa por inatividade. Não avaliei o App Check nem backups.
12. **Status do Google Play no Brasil para links de pagamento externos:** confirmei o "user choice billing" (−4 pontos), mas não o programa de ofertas externas para o Brasil.
