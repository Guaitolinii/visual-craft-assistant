# Sintoniza TV — Reconstrução do app de Smart TV (handoff para Antigravity)

> **Para quem vai executar isto (Antigravity/Gemini, ou qualquer outro agente):** este documento NÃO segue o formato de "task TDD em passos de 2-5 minutos" que os outros planos deste repositório usam (`docs/superpowers/plans/*.md`), porque a maior parte do problema real está em **comportamento de foco/teclado/layout dentro do runtime webOS/Tizen**, algo que `node:test` não consegue exercitar (não há DOM, não há controle remoto, não há teclado virtual do sistema). Este documento é um **diagnóstico técnico + especificação de arquitetura + lista de tarefas**, com referências exatas de arquivo/linha para você não precisar redescobrir o que já foi investigado. Onde a lógica for pura (sem DOM), a tarefa pede teste automatizado normal, seguindo os harnesses que já existem no repositório (ver seção "Convenções e testes já existentes").

**Branch:** tudo aqui é para a branch `v9`. Você pode sobrescrever/recriar `v9` à vontade. **Nunca** faça merge, rebase ou push direto para `main` — a `main` só muda quando o Gustavo testar no aparelho e aprovar explicitamente (o mesmo fluxo usado nas versões anteriores: v6, v7, v8).

**Escopo:** só o app de Smart TV, pasta `sintoniza-tv/` (`sintoniza-tv.html`, `tv-nav.js`, `tv-styles.css`, `appinfo.json`, `config.xml`, `icon.png`, `README.md`) e os testes que cobrem esses arquivos (`tests/player/tv-safety.test.js`, `tests/player/epg-helpers.test.js`, `tests/vod/loadTvVodHelpers.js`, `tests/vod/tv-vod-parity.test.js`). **Não mexer** em `sintoniza-link.html` (app do celular) nem nos apps iOS/Android — eles já foram validados nas versões v6-v8 e estão na `main`.

---

## 1. O problema relatado (testado ao vivo numa LG real)

O Gustavo instalou o `.ipk` (build da v9, commit `b754266`) numa Smart TV LG real e testou com o controle remoto físico. Resultado, nas palavras dele:

> "seguimos com problema... ele sempre abre nessa tela [onboarding com os 3 campos de URL], essa tela nunca carregou, em todos os testes eu nunca consegui sair dela... o controle nunca funcionou nessa tela, ele sempre fica travado, só o modo 'mouse' do controle que funciona e o botão carregar nunca funcionou tmb."

Ele pediu explicitamente:
1. Interface o mais parecida possível com o app do celular / o mais perto de Netflix.
2. Ir em Configurações, colocar os links **uma única vez**; da próxima vez que abrir, carrega sozinho com o que já foi salvo.
3. Remover essa tela de onboarding (o bloqueio inicial) e **focar pesado na integração com o controle remoto** — hoje ele trava sempre nessa tela, só o modo ponteiro ("mouse") do Magic Remote parece reagir, e nem o botão "Carregar" funciona.
4. (Adicional, olhando a foto do launcher da TV ao lado de Paramount+ etc.) **A logo/ícone do app fica muito menor que a dos outros apps** na prateleira de apps da TV — precisa preencher o quadrado como os concorrentes fazem.

O restante deste documento explica **por que isso acontece** (com prova em código, não achismo) e **o que construir** para resolver de vez.

---

## 2. Diagnóstico técnico (causa raiz, com arquivo:linha)

Todas as referências abaixo são do arquivo `sintoniza-tv/sintoniza-tv.html` na branch `v9` (commit `b754266`), salvo indicação contrária.

### 2.1 Existem DOIS motores de navegação por D-pad, e o bom está desligado

- `sintoniza-tv/tv-nav.js` (225 linhas) é um motor de navegação espacial bem escrito — usa geometria de retângulos (`center`, `directedDistance`, `isInDirection`, tolerância de 12px) para achar o elemento focável mais próximo em cada direção. Ele expõe `window.TVNav` com `.init()`, `.focusEl()`, etc.
- **Esse arquivo nunca é carregado.** Não existe `<script src="tv-nav.js">` em nenhum lugar de `sintoniza-tv.html` (confirmado via `grep -n "<script "` — só aparecem os `<script>` do hls.js, mpegts.js e os blocos inline). `TVNav.init()` também nunca é chamado. É código morto, comitado mas nunca executado no app de verdade.
- O que **de fato roda** é uma segunda implementação, mais simples e com bugs, escrita direto dentro do `<script>` inline principal:
  - `getFocusableEls()` — linha 2284
  - `focusFirstFocusable()` — linha 2295
  - o listener principal de `keydown` — linhas 2420 a 2483
  - chamada de boot: `setTimeout(focusFirstFocusable, 100);` — linha 2485

Ter dois sistemas de navegação (um morto, um "reinventado" no meio do arquivo) é a receita perfeita para o tipo de bug que o Gustavo relatou: quem tenta consertar acaba mexendo no arquivo errado (foi o que aconteceu no commit anterior, `b754266`, que se chama "resolve UI layout and DOM lifecycle issues" mas não tocou nesse problema).

### 2.2 Causa raiz nº 1: o D-pad é bloqueado propositalmente dentro de um `<input>`, e o botão "Carregar" fica ao LADO do campo, não abaixo

Trecho real (linha 2448):
```js
if (active.tagName === 'INPUT' && ['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].indexOf(e.key) === -1) return;
```
Ou seja: com o foco dentro de um `<input>`, as teclas `ArrowLeft` e `ArrowRight` do controle são **descartadas silenciosamente**. Só `Enter`, `Escape`, `ArrowDown` e `ArrowUp` passam.

Só que o botão "Carregar" (`#tv-load-btn`, linha 354) fica **ao lado direito** do campo de URL (`#tv-m3u-url`, linha 347), dentro do mesmo `.tv-onboarding-input-group` (CSS em `tv-styles.css:573-576`, `display:flex` em linha, não em coluna). E o algoritmo de `ArrowDown`/`ArrowUp` (linhas 2450-2477) só considera candidato um elemento cujo topo esteja **estritamente abaixo** (`dy = r.top - currentRect.bottom; isValid = dy >= 0`) ou **estritamente acima** do atual — nunca ao lado.

**Resultado prático:** a partir do campo de URL, `ArrowRight` é ignorado (bloqueado pela regra acima) e `ArrowDown`/`ArrowUp` nunca encontram o botão "Carregar" porque ele não está nem acima nem abaixo, está ao lado. **O botão é fisicamente inalcançável pelo D-pad a partir do campo de texto.** Isso sozinho já explica "nunca consegui sair dela" e "o botão carregar nunca funcionou" via controle.

(O `tv-nav.js`, mesmo morto, tem exatamente o mesmo tipo de bloqueio nas linhas 130-132 — então só "religar" o arquivo morto sem corrigir isso não resolveria nada.)

### 2.3 Teoria bem fundamentada para "só o modo mouse funciona" (a confirmar com DevTools remoto no aparelho — ver seção 5)

`TVNav`/o motor inline focam o campo de texto **programaticamente** (`el.focus({preventScroll:true})`, sem nenhum toque real do usuário) logo na entrada da tela (`setTimeout(focusFirstFocusable, 100)`). Em várias versões do Chromium usado pelo webOS, o teclado virtual do sistema (VKB) só é exibido quando o foco em um `<input>` acontece **por gesto real do usuário** (toque/clique), não quando é forçado via JavaScript. Isso bateria exatamente com o relato: no modo ponteiro (o usuário clica de verdade com o cursor do Magic Remote), o VKB abre; via D-pad puro (foco programático), o VKB nunca abre, e as setas do controle acabam indo parar no NOSSO próprio `keydown` (porque nenhum teclado do sistema as consumiu antes), que aí esbarra no bug 2.2.

**Ação obrigatória:** confirmar isso com o DevTools remoto (`ares-inspect`, comando exato na seção 5) antes de decidir o quanto investir na correção "nativa" vs. construir teclado próprio (seção 3.3) — mas dado o histórico de inconsistência do VKB do webOS entre modelos/anos, **a recomendação deste documento já é: não depender do VKB nativo para nada crítico.**

### 2.4 Não existe tela de Configurações revisável — só um portão de primeira execução

- `#tv-onboarding` (linha 342) é um `<div>` de tela cheia (`z-index: 200` em `tv-styles.css:544-553`) que aparece **só quando `sint_url` nunca foi salvo**.
- `showApp()` (linhas 2009-2012) apenas esconde esse `<div>` para sempre (`classList.add('hidden')`) — não existe nenhum caminho de volta.
- O boot (linhas 2498-2511): se existe `sint_url` salva, chama `loadPlaylist(savedUrl)` direto — a tela de onboarding nunca mais aparece, em nenhuma circunstância.
- A barra lateral (`#tv-sidebar`, linhas 499-521) tem 5 itens: Início, Filmes e Séries, Favoritos, Recarregar lista, Telemetria. **Não existe item "Configurações".**
- Prova de que isso é um buraco real, não só teórico: o toast de erro na linha 1071 diz literalmente **"Configure a URL de Filmes/Séries no menu inicial"** — só que esse "menu inicial" (a tela de onboarding) se torna permanentemente inacessível assim que uma lista é carregada pela primeira vez. A mensagem de erro manda o usuário para um lugar que não existe mais.

Ou seja: hoje, se o usuário digitar a URL errada, ou quiser trocar de provedor, ou simplesmente quiser adicionar a URL de EPG/VOD depois, **não há absolutamente nenhuma forma de fazer isso pela interface** — só apagando os dados do app manualmente (Configurações do sistema da TV, fora do nosso app).

### 2.5 Comentário enganoso sobre "a mesma lista do celular"

Linhas 1280-1284 e o texto de apoio da tela de onboarding dizem, em essência, que como a chave `sint_url` do `localStorage` é "a mesma usada pelo app web", a lista já configurada no celular "é reconhecida automaticamente" pela TV. **Isso é falso na prática.** O app da TV instalado (webOS/Tizen) e o app do celular (navegador do Capacitor no iOS/Android, ou o navegador do PC) são processos/webviews completamente separados, em origens diferentes — `localStorage` nunca é compartilhado entre eles só porque o nome da chave é igual. Esse comentário/copy cria uma expectativa falsa no usuário ("eu já configurei isso no celular, por que a TV está pedindo de novo?"). Precisa ser corrigido ou, melhor, virar uma funcionalidade de verdade (ver 3.5).

### 2.6 CSS dividido em duas fontes de verdade

- `sintoniza-tv/tv-styles.css` (673 linhas) é carregado via `<link rel="stylesheet" href="tv-styles.css">` (linha 21) — parece ser a base "pré-reescrita", com onboarding, sidebar, controles do player etc.
- Só que dentro do próprio `<head>` existe um bloco `<style>` inline enorme (linhas ~22-335) cujo comentário diz textualmente: **"Task 4: Layout base — sobrescreve o grid 2-zonas do tv-styles.css"** (linha 42).

Ter duas fontes de estilo, uma "por cima" da outra, sem nenhuma documentação de qual regra vence onde, é terreno fértil para os bugs de layout que o commit anterior (`b754266`, "resolve UI layout and DOM lifecycle issues") tentou apagar um a um, reativamente. Isso precisa ser consolidado (ver 3.6).

### 2.7 Bug concreto de CSS: o botão principal fica sem cursor

`tv-styles.css`, dentro da regra `.tv-btn` (por volta da linha 596-610):
```css
.tv-btn {
  ...
  cursor: none;
  ...
}
```
Isso esconde o cursor do Magic Remote exatamente sobre o botão "Carregar" — o botão mais importante da tela. Compare com `.tv-input { cursor: text; }` (linha 591), que está correto. Quase certamente um erro de cópia; deveria ser `cursor: pointer` ou simplesmente removido (herda o padrão).

### 2.8 O app já tem uma Home estilo Netflix — só que ninguém nunca chegou a vê-la

As Tasks 4 a 7 da v9 (commits `e541240`, `ed77bf3`, `c689f87`, `418dd43`) já implementaram: fileiras estilo Netflix (`#tv-rows`), dados reais de VOD via API Xtream, ficha de série com sinopse e episódios (`#tv-detail-scene`), player com "morph" (o card expande até virar tela cheia) e HUD que soma sozinho. **O problema é que o usuário nunca passa da tela de onboarding para ver nada disso.** Ou seja: parte do pedido "deixe parecido com o celular / parecido com Netflix" **já está parcialmente pronta** — o trabalho aqui não é reescrever do zero, é (a) desbloquear o acesso, (b) auditar e completar a paridade com o celular tela por tela (seção 3.7).

### 2.9 Ícone do app pequeno demais no launcher da TV

O Gustavo mandou um print do launcher de apps da LG (Sintoniza ao lado de Paramount+ etc.): a logo dos outros apps preenche o quadrado praticamente de ponta a ponta; a nossa tem uma "TV" pequena com ícone de wi-fi, texto "SINTONIZA" minúsculo e uma tarjinha "TV" ainda menor, tudo cercado de bastante espaço vazio dentro do quadrado.

Causa: `sintoniza-tv/appinfo.json` usa o **mesmo arquivo `icon.png` (512×512px) tanto para `icon` quanto para `largeIcon`**:
```json
"icon": "icon.png",
"largeIcon": "icon.png",
```
A especificação da LG pede tamanhos específicos e diferentes para cada um (tipicamente `icon` 80×80 e `largeIcon` 130×130 — confirmar o guia oficial vigente em https://webostv.developer.lge.com/develop/app-developer-guide/technical-requirement no momento da execução, pois a LG já mudou esses números entre gerações de SDK). Usar um único arquivo genérico, redimensionado automaticamente pelo sistema, faz a arte perder proporção/nitidez — mas o problema visual principal, olhando o print, é de **composição**: há espaço vazio de sobra ao redor de um glifo pequeno, diferente da prática comum (Netflix, Paramount+, Disney+ etc.) de logo em "full bleed", ocupando quase toda a área útil do quadrado.

---

## 3. O que construir (arquitetura da reconstrução)

### 3.1 Consolidar em UM motor de navegação D-pad

- Apagar a implementação inline duplicada (2.1: `getFocusableEls`, `focusFirstFocusable`, o listener de `keydown` de 2420-2483, o `setTimeout` de boot da linha 2485).
- Usar como base o algoritmo geométrico de `tv-nav.js` (é o melhor dos dois: distância ponderada por direção + tolerância de alinhamento), mas com dois ajustes obrigatórios:
  1. **Nunca guardar foco num "estado sombra"** (`_currentFocus` como variável privada). Sempre ler `document.activeElement` como fonte única de verdade — exatamente como a implementação inline (a que roda hoje) já faz, e é o padrão certo para não dessincronizar quando algo move o foco por fora do nosso controle (clique real, teclado do sistema, etc.).
  2. **Nunca bloquear direções inteiras só porque o foco está num `<input>`.** As únicas exceções válidas são: (a) o teclado virtual nativo do sistema está de fato aberto e consumindo o evento antes que ele chegue à página (nesse caso não há nada a fazer no nosso JS), ou (b) o próprio teclado on-screen customizado (3.3) estiver deliberadamente interceptando teclas para digitação — nunca "porque é um INPUT" como regra geral.
- Carregar via `<script src="tv-nav.js"></script>` **antes** do script principal e chamar `TVNav.init({ onBack, onKey })` uma única vez no boot.
- Cobrir isso com um teste de estrutura em `tests/player/tv-safety.test.js` (padrão já usado no arquivo: `assert.match(tv, /regex/)`), garantindo:
  - existe `<script src="tv-nav.js">`;
  - `TVNav.init(` é chamado;
  - não sobra nenhuma segunda implementação de `getFocusableEls`/`focusFirstFocusable` no arquivo principal.

### 3.2 Nenhuma tela deve "prender" o controle

Regra de ouro para toda a reconstrução: **qualquer elemento navegável por D-pad precisa ter, para toda direção fisicamente possível no layout, um destino alcançável ou nenhuma reação (nunca travar silenciosamente com uma condição escondida)**. Ao desenhar cada tela nova, pense primeiro no grafo de navegação (o que fica acima/abaixo/ao lado de quê) e só depois no CSS.

### 3.3 Teclado on-screen próprio (não depender do VKB nativo do sistema)

Construir um componente de teclado virtual, com layout QWERTY simplificado + números + símbolos úteis para URL (`: / . ? = & - _`), onde **cada tecla é um elemento navegável normal** (mesmo motor da seção 3.1), disposto em grade (linhas/colunas), com "Apagar", "Espaço", "Limpar" e "Concluir" como teclas especiais.

Por quê isto é a solução certa e não um capricho: é exatamente o padrão que Netflix, YouTube, Prime Video e Disney+ usam nos próprios apps de TV (nenhum deles depende do teclado nativo do sistema para login/busca) — porque o comportamento do VKB varia muito entre fabricante/geração de firmware, e um teclado próprio funciona identicamente em qualquer modelo, com ou sem Magic Remote, só com o D-pad de 4 direções + OK + Voltar.

Comportamento: ao pressionar OK sobre qualquer um dos campos de URL, abre o teclado on-screen (em vez de focar um `<input>` de verdade e esperar o sistema abrir algo). O texto digitado aparece refletido visualmente acima do teclado (pode ser um `<input readonly>` ou um simples `<span>`, tanto faz, contanto que fique claramente legível a 3 metros de distância — fonte grande, alto contraste).

### 3.4 Configurações como tela revisável, não como portão

- Remover o conceito de "onboarding obrigatório que bloqueia tudo". Os mesmos 3 campos (URL da lista M3U, EPG opcional, catálogo VOD opcional) passam a viver dentro de uma **scene normal de Configurações**, acessível a qualquer momento por um item **"Configurações"** na sidebar (ao lado de Início, Filmes e Séries, Favoritos, Recarregar lista, Telemetria) — o mesmo padrão que o app do celular já usa (`sintoniza-link.html`: item `nav-settings-btn` na sidebar → `#settings-view`, sempre alcançável, nunca bloqueia o resto do app).
- No primeiro boot, sem nenhuma URL salva: **ir direto para a Home** (não mostrar tela cheia bloqueante nenhuma), com um estado vazio amigável nas fileiras + uma chamada clara para abrir Configurações (ex.: um card/banner "Nenhuma lista configurada — abra Configurações para começar"). Isso espelha o comportamento do celular, que cai em `DEMO_CHANNELS` com o status "Demo — adicione sua lista" em vez de bloquear a tela inteira.
- Campos pré-preenchidos com o valor salvo, exatamente como já funciona hoje (linhas 2490-2496 já fazem isso — só precisa mudar ONDE essa tela mora, não a lógica de preenchimento em si).
- Corrigir o texto do toast da linha 1071 para apontar para "Configurações" (o nome real da nova tela).
- Remover ou corrigir o comentário/texto sobre "mesma chave do app web" (ver 2.5) — seja apagando a afirmação falsa, seja implementando de verdade o pareamento por link (3.5), que é a forma honesta de entregar essa promessa.

### 3.5 Pareamento por link/QR (recomendado, evita digitar URLs longas do Xtream no controle)

As URLs de EPG e VOD de um provedor Xtream costumam ser enormes (`http://provedor.com/get.php?username=...&password=...&type=m3u_plus`) — digitar isso com qualquer teclado on-screen, por melhor que seja, é uma péssima experiência. `sintoniza-link.html` (app do celular, na `main`) **já tem** um mecanismo pronto e testado para isso: um botão "Copiar link para outros aparelhos" que gera uma URL com `?lista=<url-codificada>&epg=<url-codificada>` (ver `sintoniza-link.html` linhas ~5693-5716 e ~6367-6377 na `main`), e o próprio app lê esses parâmetros no boot para se autoconfigurar.

Recomendação:
1. Portar essa mesma leitura de querystring (`?lista=`, `?epg=`, e adicionar `?vod=`, que o celular ainda não tem) para o boot de `sintoniza-tv.html`.
2. No app do celular, ao gerar o link de compartilhamento, oferecer uma opção "para a TV" que monta a URL pública do app de TV (aquela hospedada no GitHub Pages/raw.githack — ver `sintoniza-tv/README.md`) com esses parâmetros, e mostra isso como **QR code** (uma biblioteca cliente pequena, sem backend, é suficiente).
3. Na TV, o usuário abre esse link **pelo navegador nativo da própria TV** (não pelo app instalado) só uma vez, valida visualmente que carregou, e a partir daí pode inclusive instalar/usar o app nativo normalmente, já com tudo salvo (mesma origem `localStorage`, contanto que sirvam do mesmo domínio) — ou, no mínimo, evita digitar a URL enorme, porque o link em si é bem mais curto ou pode ser aberto direto por QR.

Isso é uma melhoria significativa de UX, mas **não substitui** o teclado on-screen da seção 3.3 — sempre vai existir o caso de alguém sem celular por perto, ou querendo digitar/corrigir manualmente.

### 3.6 CSS: uma fonte de verdade só

Escolher **uma** das duas abordagens e eliminar a outra:
- **Opção A (recomendada):** mover todas as regras do `<style>` inline da `<head>` para dentro de `tv-styles.css`, organizado por seção/zona de layout, com comentários claros de qual zona cada bloco pertence. Remove a ambiguidade de "quem sobrescreve quem" e deixa o arquivo `.html` mais enxuto.
- **Opção B:** manter tudo inline e apagar o `<link rel="stylesheet" href="tv-styles.css">`, absorvendo o conteúdo dele para dentro do `<style>` da `<head>`.

De qualquer forma: nunca duas fontes "brigando" silenciosamente pela mesma regra.

Correções pontuais a fazer durante essa consolidação:
- `.tv-btn { cursor: none; }` → `cursor: pointer` (ou remover a propriedade).
- Evitar a propriedade shorthand `inset` (usada em `#tv-onboarding { inset: 0; }` e possivelmente em outros lugares novos das Tasks 4-7) sem necessidade — `inset` só tem suporte a partir de Chromium 87 (~2020); várias Smart TVs 2018-2020 rodam Chromium mais antigo. Preferir `top:0; right:0; bottom:0; left:0;` explícito, que funciona em qualquer versão.

### 3.7 Auditoria de paridade com o app do celular

Comparar tela a tela contra `sintoniza-link.html` (app do celular, `main`) e listar o que falta/diverge:
- Início (recém-assistidos unificados + Minha Lista)
- Favoritos (só canais)
- Canais (categorias/pílulas)
- Séries / Filmes (fileiras por categoria, "Novidades", selo de streaming se fizer sentido numa TV)
- Ficha de VOD (sinopse, ano, nota, elenco se houver, botão Assistir, Minha Lista)
- Continue Assistindo
- EPG "a seguir" (popover) — já existe suporte em EPG helpers, conferir se está exposto na UI da TV
- Busca

Adaptar sempre para o formato "10-foot" (fontes e áreas de foco maiores, navegação por D-pad em vez de toque), mas mantendo a mesma paleta, tipografia e hierarquia visual do celular, para o produto parecer a mesma marca em qualquer tela.

### 3.8 Ícone do app (launcher)

- Redesenhar a arte para "preencher o quadrado" como os concorrentes (Netflix, Paramount+, Disney+): pouca ou nenhuma margem vazia ao redor do glifo/logotipo, cores fortes e contrastantes mesmo em miniatura.
- Exportar nos tamanhos exigidos pela LG (conferir a versão vigente do guia oficial no momento da execução — historicamente `icon` 80×80 e `largeIcon` 130×130) em vez de reaproveitar um único PNG de 512×512 genérico para os dois campos de `appinfo.json`.
- Conferir também o ícone do lado Samsung Tizen (`config.xml`/pasta de ícones do Tizen), pelo mesmo motivo, já que o app também é empacotado para lá.
- Testar visualmente no launcher real da TV (não só olhando o PNG no computador) antes de considerar concluído — é o único jeito de confirmar que ficou do tamanho/proporção certos ao lado dos outros apps.

---

## 4. Convenções e testes já existentes (para não quebrar o que já funciona)

- `sintoniza-tv/sintoniza-tv.html` é servido como **um arquivo único, sem bundler** — mantenha esse padrão (scripts clássicos, sem `import`/`export` de módulo ES no HTML principal).
- **CRLF:** a cópia de trabalho deste repositório usa `core.autocrlf=true`; os arquivos de `sintoniza-tv/` estão em CRLF. Nunca use ferramentas que normalizam para LF (`sed -i` no Git Bash, por exemplo) — edite preservando a terminação de linha original do arquivo.
- **O bloco `<script id="epg-helpers">` precisa continuar byte a byte idêntico** ao mesmo bloco em `sintoniza-link.html` — existe um teste (`tests/player/epg-helpers.test.js`, teste "epg-helpers block is byte-identical...") que garante isso. Não toque nesse bloco ao mexer no resto do arquivo.
- Já existem harnesses de teste específicos para o app de TV, siga o mesmo padrão para qualquer lógica pura nova (parsing de querystring, geração da matriz do teclado on-screen, o algoritmo de distância do motor de foco, etc.):
  - `tests/vod/loadTvVodHelpers.js` — carrega funções do `sintoniza-tv.html` num sandbox Node (`vm`), no mesmo espírito de `tests/vod/loadVodHelpers.js` usado para o app do celular.
  - `tests/vod/tv-vod-parity.test.js` — garante que os helpers de VOD portados para a TV se comportam igual aos do celular.
  - `tests/player/tv-safety.test.js` — testes de estrutura/segurança sobre o HTML bruto (regex), incluindo a sanitização de nomes/categorias/logos vindos da lista M3U (`sanitizeLabel`/`sanitizeImageUrl`, já implementados — não precisa mexer nisso).
- Suite completa: `npm test` (178 testes passando na v9 atual, antes desta reconstrução). Deve continuar tudo verde depois das mudanças, mais os testes novos que esta reconstrução exigir.
- `npm test` regenera `www/index.html` (efeito colateral de um teste do `prepare-mobile.js`) — não é relevante para o app de TV, mas não commite esse arquivo por engano se ele aparecer modificado.

---

## 5. Como verificar de verdade (não é opcional para os itens de navegação/teclado)

Este ambiente de desenvolvimento **já tem** o CLI do webOS instalado globalmente (`ares`, `ares-install`, `ares-launch`, etc.) e uma TV LG real cadastrada com o nome **"Lg Tv"** (`ares-setup-device --list` mostra o IP salvo). Use isso — não adivinhe comportamento de controle remoto sem testar no aparelho:

```powershell
# empacotar (rodar dentro da pasta sintoniza-tv/ ou apontando pra ela)
npx -y -p @webos-tools/cli ares-package sintoniza-tv -o "app tv"

# instalar e abrir na TV já cadastrada
ares-install --device "Lg Tv" "app tv\com.sintoniza.iptv_<versao>.ipk"
ares-launch  --device "Lg Tv" com.sintoniza.iptv

# abrir o DevTools remoto (Chrome) contra o app rodando na TV de verdade
ares-inspect --device "Lg Tv" --app com.sintoniza.iptv --open
```

Com o DevTools remoto aberto, confirme, **usando só o D-pad físico do controle** (sem tocar no modo ponteiro do Magic Remote):
1. O app abre direto na Home (sem nenhuma tela de bloqueio), mesmo sem nenhuma URL configurada ainda.
2. Dá para navegar até "Configurações" pela sidebar usando só as setas.
3. Dentro de Configurações, dá para abrir o teclado on-screen em cada campo, digitar, confirmar, e navegar até o botão de salvar/carregar — tudo só com D-pad + OK, sem nunca "travar" numa direção sem reação.
4. Depois de salvar, o app carrega a lista e mostra a Home populada.
5. Fechando o app de verdade (não só minimizando) e abrindo de novo: carrega direto na Home com a mesma lista, sem pedir nada de novo.
6. Voltando em Configurações depois: os campos aparecem preenchidos com o que foi salvo, e dá para editar e salvar de novo.
7. O ícone do app no launcher da TV está do mesmo tamanho/proporção visual que os demais apps instalados (comparar lado a lado, não só olhar isoladamente).

Só marque qualquer tarefa das seções 3.1 a 3.4 e 3.8 como concluída depois de confirmar isso no aparelho físico — commits que dizem "corrigido" sem essa verificação foram exatamente o que gerou a situação atual (a "correção" anterior, commit `b754266`, não resolveu o problema real relatado).

---

## 6. Regras de branch e commit

- Trabalhe só na branch `v9`. Pode reescrever/recriar commits nela à vontade (o Gustavo autorizou sobrescrever).
- **Nunca** dê merge, rebase ou push para `main`. A promoção de `v9` para `main` só acontece depois que o Gustavo testar no aparelho físico e aprovar explicitamente — mesmo fluxo já usado para v6, v7 e v8 deste projeto.
- Ao final de cada bloco de trabalho testado e aprovado no aparelho (seção 5), suba a versão em `sintoniza-tv/appinfo.json` (campo `version`) e `sintoniza-tv/config.xml` (atributo `version` do `<widget>`) — seguindo o padrão já usado (`1.8.0` → próxima, ex. `1.9.0`).
- Assine os commits com uma identidade e mensagem claras sobre o que mudou e por quê (siga o estilo já usado no histórico deste repositório: mensagem curta no imperativo + corpo explicando a causa raiz quando for uma correção de bug). Não é necessário replicar trailers de assinatura de outra ferramenta de IA que não seja a que está gerando o commit.

---

## 7. Checklist final de aceite

- [ ] Existe um único motor de navegação D-pad (não dois); `tv-nav.js` está de fato carregado e inicializado, OU foi deliberadamente removido em favor de uma única implementação nova — nunca as duas coexistindo.
- [ ] Nenhuma tela tem uma condição escondida que trava a navegação numa direção sem alternativa.
- [ ] Existe um teclado on-screen próprio, navegável por D-pad, para digitar as 3 URLs sem depender do teclado virtual do sistema.
- [ ] "Configurações" é um item normal da sidebar, sempre acessível, com os campos pré-preenchidos com o valor salvo.
- [ ] O primeiro boot sem URL salva vai direto para a Home (com estado vazio amigável), nunca para uma tela cheia bloqueante.
- [ ] Uma vez configurado, os próximos boots carregam sozinhos, sem pedir nada de novo (isso já funciona hoje via `localStorage`; só não pode regredir).
- [ ] O texto sobre "mesma lista do celular" foi corrigido ou virou realidade via pareamento por link/QR.
- [ ] CSS consolidado numa fonte só; `.tv-btn` tem cursor visível; sem uso de `inset` shorthand nos elementos de tela cheia.
- [ ] Auditoria de paridade com o celular feita e documentada (o que foi portado, o que ficou pra depois).
- [ ] Ícone do app redesenhado e testado no launcher real da TV, preenchendo o quadrado como os apps concorrentes.
- [ ] `npm test` passando (178 testes da v9 + os novos desta reconstrução).
- [ ] Os 7 passos da seção 5 confirmados **no aparelho físico**, só com D-pad.
- [ ] Nada de `sintoniza-link.html`/iOS/Android/`main` foi tocado.
