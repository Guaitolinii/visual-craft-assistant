# Sintoniza TV — Corrigir o boot quebrado da v9 + adotar boas práticas do setor (handoff para Antigravity)

> **Para quem vai executar isto:** este documento não segue o formato rígido de "TDD em passos de 2-5 minutos" em TODAS as tarefas, porque parte real do problema só se manifesta no runtime de uma Smart TV física (não dá para reproduzir em `node:test`). Onde a lógica é pura (parsing de sintaxe, funções sem DOM), o formato TDD é seguido à risca — são testes de verdade, automatizados, que entram no `npm test`. Onde não dá (comportamento ao vivo na TV), o documento diz exatamente qual comando rodar e o que observar.

**Branch:** tudo aqui é para a branch `v9`. Pode sobrescrever/recriar `v9` à vontade. **Nunca** faça merge, rebase ou push para `main`.

**Escopo:** só `sintoniza-tv/` e os testes que cobrem esses arquivos. Não mexer em `sintoniza-link.html`/iOS/Android/`main`.

---

## 1. O que aconteceu (para não repetir o erro)

1. Em 24/09, o Gustavo testou o commit `a75d425` (a reconstrução que corrigiu a navegação e criou a Config scene + teclado on-screen, seguindo o documento anterior `2026-09-24-tv-app-reconstrucao.md`).
2. **Piorou**: o app abriu só com a logo "Sintoniza" no canto superior esquerdo, fundo preto, **nada mais na tela** — nenhuma fileira, nenhuma barra lateral, nenhuma reação a clique ou tecla. Reinstalar e abrir de novo ficou **ainda pior** (nem a logo apareceu).
3. Eu (Claude) tentei diagnosticar via `ares-inspect` (DevTools remoto) **enquanto o app já estava travado**, e continuei tentando depois que já dava para ver que algo estava errado. O Gustavo pediu para eu parar de mexer na TV — pedido correto, que seguirei também neste documento: **nenhuma tarefa abaixo assume que alguém vai ficar testando ao vivo sem necessidade**. Só a Tarefa 3 pede uma sessão no aparelho, e ela é feita com o cuidado certo (detalhado lá).

### 1.1 O que eu já verifiquei (com evidência, não achismo) e o que descartei

Antes de escrever qualquer correção, usei o parser JavaScript real do projeto (`acorn`, já presente em `node_modules`, usado por trás do ESLint) para comparar a sintaxe do arquivo **contra o teto real de cada geração do webOS**. A LG publica oficialmente qual Chromium cada versão do webOS usa:

| webOS | Chromium | Fonte |
|---|---|---|
| 4.x | 53.0.2785.34 | webOS TV Developer — Web API and Web Engine |
| 5.x | 68.0.3440.106 | idem |
| 6.x | 79.0.3945.79 | idem |
| 22 | 87.0.4280.88 | idem |
| 23 | 94.0.4606.128 | idem |
| 24 | 108.0.5359.211 | idem |

Fonte: [webOS TV Developer — Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) (confira a tabela vigente no momento da execução, a LG já atualizou esses números outras vezes).

**Teste ao vivo que eu já fiz (antes de ser pedido para parar):** conectei o DevTools remoto (`ares-inspect`) na TV do Gustavo e tentei avaliar uma expressão JS contendo `?.` (optional chaining, recurso do ES2020). O motor da TV recusou com `SyntaxError: Unexpected token .`. **Isso é uma prova direta, ao vivo, nesta TV específica: o motor dela não aceita `?.`** — ou seja, o Chromium dela é **anterior à versão 80** (quando o `?.` passou a ser aceito). Cruzando com a tabela oficial acima, e com o fato de que a build anterior (`b754266`, testada com sucesso pelo Gustavo — abriu a tela de onboarding estilizada, EPG funcionando) já usa bastante `async/await`, `Array.from`, desestruturação, `Promise.allSettled` etc. sem problema, a hipótese mais provável é que essa TV rode **webOS 6.x (Chromium ~79)**. Isso não precisa ser reconfirmado toda hora — é só contexto para quem for revisar novo código: **trate qualquer sintaxe do ES2020 em diante (`?.`, `??`, `??=`, `||=`, `&&=`, `.at()`, grupos nomeados/lookbehind em regex `(?<...)`, campos privados de classe `#x`) como proibida neste arquivo.**

**O que eu suspeitei e DESCARTEI com prova concreta (documentando para ninguém perder tempo investigando de novo):**
- Rodei o mesmo parser (`acorn`) com `ecmaVersion` reduzido, tentando achar sintaxe recente demais (spread de objeto `{...x}`, `catch {}` sem parâmetro) no bloco de script principal. Achei ocorrências reais dessas duas coisas — **mas ao rodar o MESMO teste contra o `b754266` (a build que funcionou de verdade na TV do Gustavo), as MESMAS ocorrências já estavam lá, nas mesmas linhas.** Ou seja: essa TV específica já tolera spread de objeto e `catch {}` sem parâmetro (fazem parte do Chromium 79). **Não é a causa da quebra nova.** Não perca tempo "corrigindo" isso como se fosse o bug — é ruído.
- Também conferi (via `grep` nas linhas exatas que o commit `a75d425` adicionou, não no arquivo inteiro) se havia `?.`, `??`, `.at(`, `Object.hasOwn`, `globalThis`, `structuredClone`, `replaceAll(`, grupos de regex `(?<...)`, `class`, atribuição lógica (`||=`/`&&=`/`??=`) — **nenhuma dessas construções aparece nas linhas novas.** Ou seja, **não é (aparentemente) um erro de sintaxe introduzido por este commit especificamente.**

**Conclusão honesta:** eu não tenho, agora, a mensagem de erro real do navegador — porque só conectei o DevTools remoto **depois** que o app já tinha travado (o Chrome DevTools Protocol só reporta exceções que acontecem **depois** que você conecta; não retroage). A Tarefa 3 existe exatamente para corrigir esse processo e capturar o erro de verdade da próxima vez, em vez de continuar adivinhando.

**A teoria mais provável, com base no que É possível verificar sem a TV** (raciocínio abaixo): alguma coisa dentro do `document.addEventListener('DOMContentLoaded', () => { ... })` do script principal lança uma exceção **antes** de chegar em `TVNav.init(...)`. Evidência a favor: quando testei ao vivo, `typeof window.TVNav === 'object'` (o arquivo `tv-nav.js`, carregado por um `<script src>` separado, executou normalmente), mas nada relacionado à Config/OSK reagia a clique nem tecla nenhuma — consistente com `TVNav.init()` (que é quem liga o `addEventListener('keydown', ...)`) nunca ter chegado a rodar. Como declarações de função (`function foo(){}`) são todas "hoisted" no carregamento do script inteiro, **isso só se explica por uma exceção de runtime no meio da execução síncrona do callback, não por um erro de sintaxe** (erro de sintaxe impediria até as funções declaradas depois de existirem — não é o caso aqui, pois eu não testei isso especificamente, então trate como teoria a confirmar, não fato).

---

## 2. Pesquisa: como o mercado resolve os dois problemas de fundo

Pesquisei de verdade (não é achismo) antes de escrever este plano.

### 2.1 Navegação por D-pad em apps de TV

- A própria LG mantém e distribui **Enact**, um framework React oficial para webOS TV, com um módulo chamado **Spotlight** dedicado só a navegação espacial por controle (5 direções), incluindo gestão de foco inicial, restauração de foco, pop-ups, listas virtualizadas e troca entre controle/ponteiro. Está em produção em "dezenas de milhões de TVs por ano". Fonte: [Enact — LG webOS TV Developer](https://webostv.developer.lge.com), citado também em [From TV to Touch — GitNation](https://gitnation.com/contents/from-tv-to-touch-how-we-made-react-ui-work-across-every-input-mode).
- A **Norigin Media** (empresa de streaming) publicou uma biblioteca open-source, **Norigin Spatial Navigation**, especificamente para apps de TV (usada em produção em Tizen, webOS, Hisense, Vizio e STBs baseados em Chromium), indicada ao "Streaming Innovation Award 2025". Fonte: [Norigin Spatial Navigation — GitHub](https://github.com/NoriginMedia/Norigin-Spatial-Navigation), [anúncio](https://noriginmedia.com/norigin-spatial-navigation-open-source-library-for-smart-tvs-nominated-for-streaming-innovation-award-2025/).
- **Decisão para este projeto:** as duas opções acima são **primariamente para React** (Enact é um framework React completo; Norigin é "hooks-based", pensado para React, adaptável a outros com esforço). Adotar qualquer uma delas hoje significaria abandonar a arquitetura de "arquivo único, sem bundler" que o projeto mantém deliberadamente desde a v6 (para instalar via `ares-package`/`tizen package` sem pipeline de build). **Não é a recomendação para AGORA** — é uma opção estratégica de médio prazo, documentada aqui para quando/se o projeto decidir migrar para um toolchain com build (nesse caso, comece por essas duas, não reinvente de novo). Para agora: continuar com o motor de navegação vanilla que a v9 já reconstruiu (`tv-nav.js`), só com a correção de bug e as redes de segurança da Tarefa 1.
- O próprio W3C/WICG confirma que **navegação espacial (`spatial-navigation`) ainda não é implementada nativamente em nenhum navegador** — é por isso que toda TV (a nossa incluída) precisa reimplementar isso em JavaScript. Fonte: [WICG/spatial-navigation](https://github.com/WICG/spatial-navigation), [explainer](https://drafts.csswg.org/css-nav-1/explainer). Não existe atalho nativo que estejamos "perdendo".

### 2.2 Como Netflix e Prime Video resolvem "digitar credenciais longas numa TV"

Confirmado via pesquisa: **nenhum dos dois pede para digitar usuário/senha inteiros na TV.** Os dois usam o mesmo padrão (que é, na verdade, um padrão de indústria formalizado como **OAuth 2.0 Device Authorization Grant**, RFC 8628):
1. A TV mostra um **código curto** na tela (poucos dígitos/letras).
2. O usuário abre um site simples no celular ou computador (`netflix.com/activate`, `amazon.com/code`) já logado na própria conta, e digita esse código curto.
3. O site do servidor associa aquele código à conta e devolve as credenciais/token para a TV, que está checando periodicamente em segundo plano.

Fontes: [Ativação de dispositivo Netflix](https://realitypathing.com/activate-netflix-on-a-smart-tv-enter-the-code/), [Ativação Prime Video "MyTV"](https://www.spliiit.com/en/blog/primevideo-mytv-activation).

**Isso é o inverso do que eu propus no documento anterior** (eu tinha sugerido mostrar um QR code no celular para a TV "ler" — mas TV não tem câmera; o padrão real da indústria é o oposto: código exibido NA TV, digitado NO CELULAR). É a solução definitiva para o problema de digitar a URL gigante do Xtream (`http://provedor.com/get.php?username=...&password=...`) com um controle remoto. **Mas exige um servidor** (por menor que seja — nem que seja um Cloudflare Worker gratuito com KV) para guardar "código X = configuração Y enviada pelo celular" por alguns minutos, já que a TV e o celular não têm como se falar direto sem um intermediário. Isso está documentado como **Tarefa 5** (pesquisa/proposta, não bloqueante) — a pesquisa de backend do projeto (`docs/superpowers/research/2026-09-23-backend-usuarios-assinaturas.md`) já cobre a base de servidor que serviria para isso também.

### 2.3 Blank screen em apps de TV é um problema conhecido do setor

Encontrei relatos de desenvolvedores de apps para Samsung Tizen com o **mesmo sintoma**: tela em branco, sem nenhuma mensagem de erro visível, app parecendo "travado silenciosamente". A recomendação prática documentada por esses desenvolvedores, e que este plano adota na Tarefa 1: **envolver a inicialização em try/catch e registrar um handler global de erro (`window.onerror`) que mostra a mensagem NA TELA**, porque "é difícil acessar os logs de JavaScript no aparelho real" sem ferramentas extras. Fonte: [fórum de desenvolvedores Samsung — blank screen](https://forum.developer.samsung.com/t/blank-screen-in-2015-and-2016-tv-models/2323), [discussão de app SPA com tela vazia](https://github.com/yysun/apprun/issues/84).

---

## 3. Tarefas

### Tarefa 1: Teste automatizado de compatibilidade de sintaxe (parser real, não grep)

Isso transforma o que eu fiz manualmente acima num teste que roda pra sempre, em todo `npm test`, prevenindo que ISSO (ou qualquer coisa parecida) aconteça de novo sem ninguém perceber antes de instalar na TV.

**Arquivos:**
- Create: `tests/player/tv-syntax-compat.test.js`
- Modify: nenhum arquivo de produção nesta tarefa (só o teste)

- [ ] **Step 1: Escrever o teste**

```js
// tests/player/tv-syntax-compat.test.js
//
// Garante que o(s) bloco(s) <script> inline de sintoniza-tv.html continuam
// aceitos por um parser JS configurado para o TETO REAL de sintaxe desta TV
// (ver docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md,
// seção 1.1): um SyntaxError em QUALQUER lugar do bloco impede o bloco
// INTEIRO de rodar, mesmo que o trecho quebrado nunca seja chamado -
// foi exatamente isso que quebrou o boot em 24/09/2026.
//
// IMPORTANTE: isto pega erros de SINTAXE (parse-time). NÃO pega APIs de
// runtime que talvez não existam no motor real da TV (ex.: Promise.allSettled,
// Array.prototype.flat/flatMap, AbortSignal.timeout) - para isso não existe
// atalho automatizado; a Tarefa 3 trata disso caso a caso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TV_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html");

// Teto real observado ao vivo nesta TV (ver seção 1.1 do plano): aceita
// async/await, desestruturação, spread de objeto, catch sem parâmetro
// (tudo isso é ES2019) - mas REJEITA optional chaining `?.` (ES2020).
// Usamos ecmaVersion 2019 como o teto seguro.
const MAX_SAFE_ECMA_VERSION = 2019;

function extractInlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

test("todo bloco <script> inline de sintoniza-tv.html tem sintaxe aceita até ES2019 (teto real da TV)", () => {
  const html = readFileSync(TV_HTML_PATH, "utf8");
  const scripts = extractInlineScripts(html);
  assert.ok(scripts.length > 0, "nenhum bloco <script> inline encontrado - o teste não estaria testando nada");

  for (let i = 0; i < scripts.length; i++) {
    assert.doesNotThrow(
      () => acorn.parse(scripts[i], { ecmaVersion: MAX_SAFE_ECMA_VERSION, sourceType: "script", allowReturnOutsideFunction: true }),
      `bloco <script> #${i} tem sintaxe além de ES${MAX_SAFE_ECMA_VERSION} (?., ??, ??=, ||=, &&=, .at(), campos privados #x, grupos de regex nomeados/lookbehind, etc.) - isso quebra a TV inteira, não só o trecho`
    );
  }
});

test("nenhum bloco usa optional chaining (?.) ou nullish coalescing (??) mesmo em comentário-morto do editor", () => {
  const html = readFileSync(TV_HTML_PATH, "utf8");
  for (const src of extractInlineScripts(html)) {
    assert.doesNotMatch(src, /[)\]}\w]\?\./, "encontrado '?.' (optional chaining) - não suportado nesta TV");
    assert.doesNotMatch(src, /\?\?[^.]/, "encontrado '??' (nullish coalescing) - não suportado nesta TV");
  }
});
```

- [ ] **Step 2: Rodar e confirmar que passa hoje** (o arquivo atual, apesar de quebrar em runtime, não usa `?.`/`??` — isso já foi verificado manualmente nesta investigação):

Run: `node --test tests/player/tv-syntax-compat.test.js`
Expected: `2 pass, 0 fail` (se falhar, o motivo será real e precisa ser corrigido antes de seguir — não ignore).

- [ ] **Step 3: Commit**

```bash
git add tests/player/tv-syntax-compat.test.js
git commit -m "test(tv): guard against JS syntax beyond this TV's real ceiling (parser-based, not grep)"
```

---

### Tarefa 2: Rede de segurança — nunca mais uma tela preta sem explicação

Isso não corrige o bug em si (a Tarefa 3 faz isso, DEPOIS que soubermos a causa exata), mas garante que, **se algo quebrar de novo**, quem estiver testando vê a mensagem de erro na própria tela da TV, sem precisar de laptop/DevTools — exatamente a prática que devs de Tizen/webOS recomendam publicamente (ver seção 2.3).

**Arquivos:**
- Modify: `sintoniza-tv/sintoniza-tv.html` (novo bloco de HTML/CSS/JS, adicionado o mais cedo possível no `<head>`/início do `<body>`, ANTES de qualquer outro script que possa falhar)
- Test: `tests/player/tv-safety.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// acrescentar em tests/player/tv-safety.test.js
test("existe uma rede de segurança visível para erros não capturados (window.onerror mostra overlay na tela)", () => {
  assert.match(tv, /id="tv-fatal-error"/);
  assert.match(tv, /window\.addEventListener\(\s*['"]error['"]/);
  assert.match(tv, /window\.addEventListener\(\s*['"]unhandledrejection['"]/);
});

test("a rede de segurança é o PRIMEIRO <script> inline do documento (roda antes de qualquer outro código)", () => {
  const firstInlineScript = tv.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.match(firstInlineScript, /tv-fatal-error/);
});
```

- [ ] **Step 2:** `node --test tests/player/tv-safety.test.js` deve dar FAIL.

- [ ] **Step 3: Implementar.** Logo depois da tag `<meta charset="UTF-8" />` (o mais cedo possível, antes de `tv-nav.js` e de qualquer outro script — se ELE mesmo quebrar por sintaxe, nada pode ser feito por JS, mas cobre qualquer erro de RUNTIME em qualquer script depois dele):

```html
<!-- Rede de segurança: se qualquer script depois deste falhar (erro de
     runtime, promise rejeitada sem .catch), mostra a mensagem NA TELA em
     vez de deixar o app travado em silêncio (ver docs/superpowers/plans/
     2026-09-25-tv-app-boot-crash-e-boas-praticas.md, seção 2.3 e 1). Fica
     antes de qualquer outro <script> de propósito. -->
<style>
  #tv-fatal-error {
    display: none; position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 999999;
    background: #1a0000; color: #ffdddd; font-family: monospace;
    padding: 48px; overflow: auto; font-size: 22px; line-height: 1.5;
  }
  #tv-fatal-error.active { display: block; }
  #tv-fatal-error h1 { color: #ff6666; font-size: 32px; margin-bottom: 16px; }
  #tv-fatal-error pre { white-space: pre-wrap; word-break: break-word; font-size: 18px; opacity: .85; }
</style>
<div id="tv-fatal-error"><h1>Erro ao iniciar o Sintoniza</h1><pre id="tv-fatal-error-msg"></pre></div>
<script>
(function () {
  var shown = false;
  function show(label, detail) {
    // Mostra só o PRIMEIRO erro (os seguintes costumam ser efeito cascata
    // do primeiro) para não confundir quem está lendo a tela.
    if (shown) return;
    shown = true;
    var el = document.getElementById('tv-fatal-error');
    var msg = document.getElementById('tv-fatal-error-msg');
    if (el && msg) {
      msg.textContent = label + '\n\n' + detail;
      el.classList.add('active');
    }
  }
  window.addEventListener('error', function (e) {
    show('Erro de JavaScript', (e.filename || '?') + ':' + (e.lineno || '?') + ':' + (e.colno || '?') + '\n' + (e.message || e.error || 'sem mensagem'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    show('Promise rejeitada sem tratamento', (reason && reason.stack) || (reason && reason.message) || String(reason));
  });
})();
</script>
```

- [ ] **Step 4:** `node --test tests/player/tv-safety.test.js` deve dar PASS.
- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv/sintoniza-tv.html tests/player/tv-safety.test.js
git commit -m "feat(tv): on-screen error overlay for uncaught exceptions (never a silent blank screen again)"
```

---

### Tarefa 3: Capturar o erro real na TV, com o método certo desta vez, e corrigir

**Esta tarefa PRECISA da TV física.** Faça as Tarefas 1 e 2 primeiro (não custa nada e já ajuda mesmo sem a TV). Peça autorização explícita ao Gustavo antes de instalar/testar de novo no aparelho dele — ele pediu para parar antes, então continue parado até ele liberar de novo.

**O erro de metodologia da vez passada:** eu conectei o `ares-inspect` **depois** que o app já tinha carregado (e travado). O Chrome DevTools Protocol só relata exceções que acontecem **a partir do momento em que você conecta** — não retroage. Por isso "ERROS: nenhum" no meu teste anterior não provava nada; só provava que nada de novo quebrou DEPOIS que eu já estava olhando.

- [ ] **Step 1: Empacotar com as Tarefas 1 e 2 já aplicadas.**

```powershell
npx -y -p @webos-tools/cli ares-package sintoniza-tv -o "app tv"
```

- [ ] **Step 2: Conectar o DevTools remoto ANTES de reinstalar/relançar** (assim a conexão já está "ouvindo" quando o app carregar de novo):

```powershell
ares-inspect --device "Lg Tv" --app com.sintoniza.iptv
```
Isso imprime uma URL tipo `http://localhost:PORTA/devtools/inspector.html?ws=localhost:PORTA/devtools/page/ID`. Deixe esse processo rodando (ele mantém um túnel aberto).

- [ ] **Step 3: Com o túnel já aberto, ABRA essa URL num Chrome de verdade** (não precisa ser programático desta vez — é mais fácil ler o painel Console do DevTools com os próprios olhos). Só então:

```powershell
ares-install --device "Lg Tv" "app tv\com.sintoniza.iptv_<versao>_all.ipk"
ares-launch  --device "Lg Tv" com.sintoniza.iptv
```

- [ ] **Step 4: Observar.** Com a rede de segurança da Tarefa 2, se algo quebrar, **a própria tela da TV já vai mostrar a mensagem** — tire uma foto dela, é a forma mais rápida. Confira também a aba Console do DevTools (deve mostrar a mesma coisa, com pilha de chamadas completa).

- [ ] **Step 5: Se a Tarefa 2 sozinha já resolver o "silêncio" e mostrar a causa, corrija o bug real apontado pela mensagem** (não dá para escrever o código da correção agora, sem saber qual é — é exatamente o que esta tarefa existe para descobrir). Depois de corrigir:
  - Escreva um teste que teria pego esse bug especificamente (unitário se for lógica pura; ou mais uma asserção de estrutura em `tv-safety.test.js` se for algo estrutural).
  - Rode `npm test` inteiro, deve passar 100%.
  - Reinstale e confirme ao vivo que a Home aparece populada (fileiras, barra lateral) e que o app responde ao D-pad.

- [ ] **Step 6: Commit** com uma mensagem descrevendo a causa raiz real encontrada (não uma mensagem genérica) — por exemplo (ajuste ao que for encontrado de verdade): `fix(tv): <causa raiz real encontrada na Tarefa 3>`.

---

### Tarefa 4: Retomar o checklist do documento anterior, agora que o boot não quebra mais

O documento `docs/superpowers/plans/2026-09-24-tv-app-reconstrucao.md` continua válido — a reconstrução da navegação/Config/OSK que ele pediu **foi bem escrita** (conferi o código: motor único em `document.activeElement`, sem bloqueio de setas dentro de input, Config scene revisável pela sidebar, teclado on-screen funcional na estrutura, leitura de `?lista=`/`?epg=`/`?vod=`). O problema não foi o DESIGN daquela reconstrução, foi um bug que impediu tudo de rodar. Depois da Tarefa 3, refaça o checklist da seção 7 daquele documento, no aparelho físico:

- [ ] Existe um único motor de navegação D-pad (não dois).
- [ ] Nenhuma tela trava numa direção sem alternativa.
- [ ] O teclado on-screen abre e digita corretamente.
- [ ] "Configurações" é acessível a qualquer momento pela sidebar.
- [ ] Primeiro boot sem URL salva vai direto para a Home (com estado vazio, sem tela bloqueante).
- [ ] Depois de configurado, os próximos boots carregam sozinhos.
- [ ] O ícone do app no launcher da TV ainda precisa ser corrigido — **não foi feito nesta rodada** (confirmei: `icon.png` continua 512×512 usado para `icon` e `largeIcon` no `appinfo.json`, sem redesenho). Ver seção 3.8 do documento anterior — continua pendente.

---

### Tarefa 5: Pareamento por código (padrão Netflix/Prime) — registrar como próximo passo, não implementar agora

Não implementar nesta rodada (depende de um backend, ainda que pequeno, e o foco agora é destravar o app). Só documentar a decisão para não se perder:

- [ ] Acrescentar uma seção ao `docs/superpowers/research/2026-09-23-backend-usuarios-assinaturas.md` (ou um novo arquivo de pesquisa, se preferir manter o escopo separado) descrevendo o fluxo:
  1. TV gera um código curto (6-8 caracteres) e mostra na tela, junto com uma URL curta memorizável (ex.: `sintoniza.app/parear`).
  2. TV começa a perguntar ao backend, a cada poucos segundos, "esse código já foi preenchido?" (`GET /pair/:codigo`).
  3. Usuário abre a URL curta no celular, digita o código, e um formulário nele deixa colar as 3 URLs (M3U/EPG/VOD) que já tem salvas no app do celular (ou copiar de lá com um botão "Compartilhar com a TV" — reaproveitando `?lista=`/`?epg=` que `sintoniza-link.html` já sabe gerar).
  4. Backend guarda isso por poucos minutos (Cloudflare Worker + KV, TTL curto, sem precisar de conta/login algum para isso funcionar — é só um "correio" temporário entre os dois aparelhos, nada sensível fica salvo depois).
  5. TV recebe a resposta na próxima consulta e salva localmente, exatamente como se tivesse digitado.
- [ ] Referenciar essa seção neste plano quando for priorizada de verdade.

---

## Checklist final de aceite

- [ ] `tests/player/tv-syntax-compat.test.js` existe e passa.
- [ ] Overlay de erro visível existe, é o primeiro `<script>` do documento, e cobre `error` + `unhandledrejection`.
- [ ] A causa raiz real do boot quebrado foi capturada com o DevTools conectado **antes** do carregamento (não depois) e está registrada na mensagem do commit que a corrigiu.
- [ ] `npm test` passando (191 testes + os novos desta rodada).
- [ ] Testado ao vivo, com autorização do Gustavo: Home aparece populada, D-pad funciona, Configurações abre, teclado on-screen digita.
- [ ] Ícone do launcher (pendência da rodada anterior) resolvido ou explicitamente adiado com o motivo registrado aqui.
- [ ] Nada de `sintoniza-link.html`/iOS/Android/`main` foi tocado.

## Fontes consultadas

- [webOS TV Developer — Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) — versões de Chromium por versão do webOS.
- [Enact (LG webOS TV framework)](https://webostv.developer.lge.com) e [From TV to Touch — GitNation](https://gitnation.com/contents/from-tv-to-touch-how-we-made-react-ui-work-across-every-input-mode) — Spotlight/navegação espacial oficial da LG.
- [Norigin Spatial Navigation — GitHub](https://github.com/NoriginMedia/Norigin-Spatial-Navigation) e [anúncio Norigin Media](https://noriginmedia.com/norigin-spatial-navigation-open-source-library-for-smart-tvs-nominated-for-streaming-innovation-award-2025/).
- [WICG/spatial-navigation](https://github.com/WICG/spatial-navigation) e [explainer css-nav-1](https://drafts.csswg.org/css-nav-1/explainer) — navegação espacial ainda não nativa em nenhum navegador.
- [Ativação Netflix por código](https://realitypathing.com/activate-netflix-on-a-smart-tv-enter-the-code/) e [Ativação Prime Video "MyTV"](https://www.spliiit.com/en/blog/primevideo-mytv-activation) — padrão de pareamento por código curto (RFC 8628 Device Authorization Grant).
- [Fórum de desenvolvedores Samsung — blank screen](https://forum.developer.samsung.com/t/blank-screen-in-2015-and-2016-tv-models/2323) e [issue de SPA com tela vazia](https://github.com/yysun/apprun/issues/84) — recomendação de rede de segurança visível para erros em apps de TV.
