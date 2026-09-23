# Sintoniza v6 — Ajustes testados no iPhone (IPA) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** Corrigir os 10 pontos levantados pelo Gustavo testando a v5 (branch `fix/mobile-nav-redesign`) no iPhone 14, gerando a v6 do app mobile (IPA + APK) a partir de `sintoniza-link.html`.

**Arquitetura:** Tudo continua num único arquivo (`sintoniza-link.html`, sem bundler, scripts clássicos). Toda regra de decisão nova vira uma função **pura** no script principal (sem DOM/rede), exposta aos testes por `tests/vod/loadVodHelpers.js` (que avalia o script real num `node:vm`). O DOM só chama essas funções. APK e IPA usam o mesmo arquivo (`scripts/prepare-mobile.js` copia para `www/index.html`), então não há porte separado para Android.

**Tech Stack:** HTML/CSS/JS vanilla, hls.js, mpegts.js, lucide (CDN), Capacitor 8 (iOS/Android), testes com `node:test` (zero dependências novas).

**Branch:** `v6` (criada a partir de `origin/fix/mobile-nav-redesign`, commit `05d44b8`).

---

## Pontos levantados (e onde cada um é resolvido)

| # | Ponto (teste no iPhone) | Task |
|---|---|---|
| 1 | Tela cheia não preenche tudo; barra de status do iOS continua visível | Task 10 (+ Task 12, que depende de autorização) |
| 2 | Controles do player: "10" some nos botões de ±10s; tirar volume, barra ao vivo e ícone de batimento (em todos os players) | Task 1 |
| 3 | "Não foi possível reproduzir" em filmes/séries, que depois de um tempo funciona | Task 2 |
| 4 | "Acessados Recentemente" empilhado numa coluna; séries sem capa | Tasks 3 e 4 |
| 5 | Busca fixa no lugar errado: deve se encaixar na topbar, entre o menu e o sininho | Task 7 |
| 6/7 | Player grande em todas as 5 abas; filmes/séries tocam na própria aba | Task 6 |
| 8 | Segurar para remover; "Minha Lista" como primeira faixa (só aparece se tiver itens) | Tasks 8 e 9 |
| 9 | Início só com recém-assistidos; canais só em Canais; Favoritos só com favoritos | Task 5 |
| 10 | Duplo toque abre em pé; botão para deitar; controles (linha do tempo, ±10s, deitar) somem após 5s; bloqueio de tela com instrução para desbloquear | Task 10 |

### Decisões assumidas (sugestões aprovadas por "pode montar em cima do que foi falado")

1. A barra ao vivo e o ícone de telemetria saem de **todos** os players, canais incluídos.
2. Recém-assistidos em **grade** de 3 por linha no celular.
3. Título de episódio: `Nome da Série · T1E3`.
4. O banner "Atriz / Assistir" de Filmes/Séries **sai**; o player grande fica no lugar.
5. Mini-player só aparece quando algo está tocando **e** o player grande saiu da tela na rolagem. Tocar nele rola de volta ao topo.
6. "Segurar" funciona em qualquer cartão de filme/série (Minha Lista) e nos recém-assistidos/Continue Assistindo (também Remover). Canais recentes: só Remover.
7. "Minha Lista" aparece em Início (tudo), Filmes (só filmes) e Séries (só séries), sempre como primeira faixa. Também há um botão "Minha Lista" no modal do filme/série.
8. Canais continuam nos recém-assistidos do Início e podem ser removidos segurando.
9. Favoritos = só canais.
10. A tela cheia (duplo toque **e** botão de tela cheia) sempre abre em pé.

### Achados extras durante a análise (corrigidos junto, pois afetam os mesmos pontos)

- **Causa do ponto 3:** retentativas antigas de `tryDirectPlay()` nunca eram canceladas. O timeout de 15s do `playStream()` disparava uma recarga em paralelo, e as duas cadeias trocavam o `src` uma da outra (AbortError em cascata até esgotar as tentativas). Além disso, `stopStream()` não chamava `video.load()`, então a conexão do vídeo anterior podia continuar ocupando a vaga do servidor Xtream.
- Pausar e dar play num filme **recarregava o arquivo do zero**, porque `togglePlayPause()` chamava `playStream()`. E o watchdog "despausava" sozinho um filme pausado.
- O "Continue Assistindo" salvava o progresso mas **nunca retomava** do ponto salvo.
- O mini-player tinha texto branco sobre fundo branco e a miniatura empilhada (cortada) embaixo do título.

### Fora do escopo desta v6

- **TV (webOS/Tizen):** nenhum dos 10 pontos se aplica à TV. A TV não tem VOD nem toque, e a navegação por controle remoto é outra. Fica para um plano próprio depois que a v6 for validada.
- **Task 12 (plugins nativos):** o `CLAUDE.md` do Gustavo proíbe instalar plugins sem pedido explícito dele. O código da Task 10 já detecta os plugins e os usa se estiverem instalados; sem eles, usa o giro via CSS.

## Restrições globais

- `sintoniza-link.html` continua um arquivo único com scripts clássicos (sem `import`, sem bundler).
- Nenhuma dependência npm nova, exceto na Task 12, que é condicionada à autorização.
- Comentários de código novos em português.
- Um commit por task na branch `v6`. **Não fazer push sem o Gustavo pedir.**
- `www/index.html` é regenerado **uma vez**, na Task 11 (`node scripts/prepare-mobile.js`).
- Suíte de testes do app (exclui `tests/ci/`, que precisa de `node_modules` para rodar `npx cap`):
  `node --test "tests/vod/*.test.js" "tests/player/*.test.js" "tests/helpers/*.test.js" "tests/scripts/*.test.js"`.
  Base atual: **75 testes passando**.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `sintoniza-link.html` | App mobile inteiro (CSS + HTML + JS) | 1–10 |
| `tests/vod/loadVodHelpers.js` | Expõe as funções puras do script principal aos testes | 2 |
| `tests/player/player-markup.test.js` (novo) | Garante a estrutura dos controles do player e da tela cheia | 1, 10 |
| `tests/vod/direct-play-policy.test.js` (novo) | Política de retentativa e mensagens de erro do VOD | 2 |
| `tests/vod/episode-meta.test.js` (novo) | Título de episódio e recorte do item de VOD | 3 |
| `tests/vod/tab-layout.test.js` (novo) | O que cada aba mostra | 5 |
| `tests/player/player-mode.test.js` (novo) | Player grande/mini/oculto e encaixe da busca | 6, 7 |
| `tests/vod/my-list.test.js` (novo) | Minha Lista | 8 |
| `tests/vod/card-actions.test.js` (novo) | Opções do menu de "segurar" | 9 |
| `tests/player/fullscreen-layout.test.js` (novo) | Layout da tela cheia (em pé/deitado) | 10 |
| `www/index.html` | Cópia gerada para o Capacitor | 11 |

---

### Task 1: Controles do player (ponto 2)

**Files:**
- Modify: `sintoniza-link.html` (CSS: `.skip-badge`, `.live-*`, `.vol-slider`, `.player-debug-overlay`/`.debug-*`; HTML: `.player-controls`, `#player-debug-overlay`, "Volume padrão" nas Configurações; JS: `enableLiveBar`, `applyVolume`, listeners de volume/telemetria, `stopStream`)
- Create: `tests/player/player-markup.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/player/player-markup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, "..", "..", "sintoniza-link.html"), "utf8");

function buttonHtml(id) {
  const match = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`));
  assert.ok(match, `botão ${id} não encontrado`);
  return match[0];
}

test("player não tem mais volume, barra ao vivo nem telemetria", () => {
  for (const id of ["mute-btn", "vol-slider", "live-bar", "live-label", "progress-fill", "debug-toggle-btn", "player-debug-overlay", "pref-vol"]) {
    assert.ok(!html.includes(`id="${id}"`), `id="${id}" ainda existe no HTML`);
  }
});

test("botões de ±10s desenham o número 10 dentro do próprio ícone", () => {
  for (const id of ["vod-skip-back-btn", "vod-skip-fwd-btn"]) {
    assert.match(buttonHtml(id), /<svg[\s\S]*<text[^>]*>10<\/text>[\s\S]*<\/svg>/);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/player-markup.test.js`
Expected: FAIL (`id="mute-btn" ainda existe no HTML` e o regex do SVG não casa).

- [ ] **Step 3: Implementar**

3a. HTML: substituir o bloco `<div class="player-controls">…</div>` inteiro por:

```html
    <div class="player-controls">
      <button class="ctrl-btn" id="vod-skip-back-btn" aria-label="Voltar 10 segundos" title="Voltar 10 segundos" style="display:none">
        <svg class="skip-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><text x="12" y="15.5">10</text></svg>
      </button>
      <button class="ctrl-btn" id="play-pause-btn" aria-label="Reproduzir/Pausar" disabled>
        <i data-lucide="play" style="width:20px;height:20px" id="play-pause-icon"></i>
      </button>
      <button class="ctrl-btn" id="vod-skip-fwd-btn" aria-label="Adiantar 10 segundos" title="Adiantar 10 segundos" style="display:none">
        <svg class="skip-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><text x="12" y="15.5">10</text></svg>
      </button>
      <button class="ctrl-btn" id="reload-stream-btn" aria-label="Recarregar canal" title="Recarregar transmissão atual" disabled>
        <i data-lucide="rotate-cw" style="width:20px;height:20px" id="reload-stream-icon"></i>
      </button>
      <div class="player-controls-spacer"></div>
      <select class="ctrl-select" aria-label="Enquadramento" id="fit-select">
        <option value="contain">Original</option>
        <option value="cover">Preencher</option>
        <option value="fill">Esticar</option>
      </select>
      <button class="ctrl-btn" aria-label="Tela cheia" id="fullscreen-btn">
        <i data-lucide="maximize" style="width:20px;height:20px"></i>
      </button>
    </div>
```

3b. HTML: apagar o bloco `<!-- Monitor Panel / Telemetria -->` + `<div class="player-debug-overlay" …>…</div>`, e o `<div class="pref-row">` de "Volume padrão" (com o `<select id="pref-vol">`).

3c. CSS: apagar `.player-debug-overlay`, `.debug-header`, `.debug-badge` (e `.warning`/`.danger`), `.debug-grid*`, `.ctrl-btn-skip`, `.skip-badge`, `.live-line`, `.live-bar`, `.progress-fill`, `@keyframes live-pulse`, `.live-label`, `.progress-label`, `.vol-slider` (e `::-webkit-slider-thumb`), `.vol-slider { width: 3.5rem; }` do media query, e trocar `*, .live-bar, .spinner {` por `*, .spinner {` no `prefers-reduced-motion`. Onde ficava `.ctrl-btn-skip`, adicionar:

```css
    /* Ícones de ±10s desenhados à mão: seta circular com o "10" dentro do
       próprio círculo (antes o número era um selo sobreposto que sumia no
       meio do ícone). */
    .skip-icon {
      width: 26px; height: 26px; fill: none; stroke: currentColor;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .skip-icon text {
      fill: currentColor; stroke: none; font-size: 8.5px; font-weight: 700;
      text-anchor: middle; font-family: 'Outfit', sans-serif;
    }
    /* Empurra enquadramento + tela cheia para a direita da barra. */
    .player-controls-spacer { flex: 1; }
```

3d. JS: apagar a função `enableLiveBar()` e as 4 chamadas `enableLiveBar();`. Em `stopStream()`, apagar as 3 linhas de `live-bar`/`progress-fill`/`live-label`. Apagar `applyVolume()` e pôr no lugar:

```js
// ─── Volume ───
// Sempre no máximo: quem regula o volume é o botão físico do aparelho.
function forceMaxVolume() {
  const video = document.getElementById("player-video");
  video.volume = 1;
  video.muted = false;
}
```

No boot, trocar `const savedVol = …; applyVolume(savedVol);` por `forceMaxVolume();`. Apagar os listeners de `debug-toggle-btn`, `mute-btn`, `vol-slider` e `pref-vol`, a linha `pref-vol` de `loadSettingsForm()` (e a `const vol`), `let isDebugOverlayVisible`, a chave `VOL` de `LS` e `muted` de `_state`. `updateDebugOverlay()` fica, porque já retorna cedo quando o overlay não existe.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/player-markup.test.js` e depois a suíte do app.
Expected: PASS. A suíte continua com 75 testes verdes mais os 2 novos (os testes de VOD avaliam o script inteiro no vm, o que pega erro de sintaxe).

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/player/player-markup.test.js
git commit -m "fix(player): drop volume, live bar and telemetry controls; draw the 10 inside the skip icons"
```

---

### Task 2: Reprodução de filmes/séries robusta (ponto 3)

**Files:**
- Modify: `sintoniza-link.html` (`computeDirectPlayRetryDelayMs`, `tryDirectPlay`, `stopStream`, `playStream`, `reloadCurrentChannel`, watchdog, `showPlayerError`, `showPlayerArt/Video`, `togglePlayPause`, `playVodSelection`, `selectChannel`, clique de "Continue Assistindo", markup do `#player-error`)
- Modify: `tests/vod/loadVodHelpers.js` (lista única de funções puras + cópia para o realm do teste)
- Create: `tests/vod/direct-play-policy.test.js`

- [ ] **Step 1: Preparar o harness de testes para as funções puras novas**

Em `tests/vod/loadVodHelpers.js`, logo depois dos imports:

```js
// Funções puras do script principal usadas pelos testes da v6. As que
// devolvem objetos/arrays são copiadas para este realm (JSON) antes de
// voltar para o teste - deepStrictEqual compara protótipos, e objetos
// criados dentro do vm têm Object/Array.prototype diferentes.
const PURE_HELPER_NAMES = [
  "shouldRetryDirectPlay", "describeDirectPlayError", "isContainerUnsupportedOnIOS", "shouldApplyResume",
  "formatEpisodeTitle", "trimVodItem",
  "getCatalogTabLayout", "getMobileTabForSection",
  "computePlayerMode", "isPlayerScrolledAway", "shouldDockSearch",
  "isInMyList", "toggleMyListEntry", "getMyListItems", "buildMyListEntry",
  "getCardActions", "computeFsLayout",
];

function toHostRealm(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
```

No `vm.runInContext(mainScript + …)`, acrescentar ao final da string concatenada:

```js
      "\nthis.selectNewestVodItems = typeof selectNewestVodItems !== 'undefined' ? selectNewestVodItems : undefined;" +
      PURE_HELPER_NAMES.map(n => `\nthis.${n} = typeof ${n} !== 'undefined' ? ${n} : undefined;`).join(""),
```

E antes do `return context;`:

```js
  for (const name of PURE_HELPER_NAMES) {
    const fn = context[name];
    if (typeof fn === "function") context[name] = (...args) => toHostRealm(fn(...args));
  }
```

- [ ] **Step 2: Escrever os testes que falham**

```js
// tests/vod/direct-play-policy.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("esperas entre tentativas crescem 1s por vez, com teto de 5s (~15s no total)", () => {
  const ctx = loadVodHelpers();
  const delays = [1, 2, 3, 4, 5, 6].map(a => ctx.computeDirectPlayRetryDelayMs(a));
  assert.deepEqual(delays, [1000, 2000, 3000, 4000, 5000, 5000]);
  assert.equal(delays.slice(0, 5).reduce((s, d) => s + d, 0), 15000);
});

test("não tenta de novo quando o iOS exige um toque do usuário", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.shouldRetryDirectPlay({ errorName: "NotAllowedError", attempt: 1, maxAttempts: 6, url: "http://x/movie/u/p/1.mp4", isIOS: true }), false);
});

test("não tenta de novo um MKV no iPhone, mas tenta no Android", () => {
  const ctx = loadVodHelpers();
  const url = "http://x/movie/u/p/1.mkv";
  assert.equal(ctx.shouldRetryDirectPlay({ errorName: "NotSupportedError", attempt: 1, maxAttempts: 6, url, isIOS: true }), false);
  assert.equal(ctx.shouldRetryDirectPlay({ errorName: "NotSupportedError", attempt: 1, maxAttempts: 6, url, isIOS: false }), true);
});

test("para de tentar ao chegar no limite de tentativas", () => {
  const ctx = loadVodHelpers();
  const base = { errorName: "NotSupportedError", maxAttempts: 6, url: "http://x/movie/u/p/1.mp4", isIOS: true };
  assert.equal(ctx.shouldRetryDirectPlay({ ...base, attempt: 5 }), true);
  assert.equal(ctx.shouldRetryDirectPlay({ ...base, attempt: 6 }), false);
});

test("mensagem de erro explica o limite de telas e mostra o código real", () => {
  const ctx = loadVodHelpers();
  const r = ctx.describeDirectPlayError({ errorName: "NotSupportedError", mediaErrorCode: 4, url: "http://x/movie/u/p/1.mp4", isIOS: true, attempts: 6 });
  assert.match(r.message, /limite de telas/);
  assert.doesNotMatch(r.message, /CORS/);
  assert.equal(r.code, "NotSupportedError · MEDIA_ERR 4 · 6 tentativas");
});

test("mensagem de erro de MKV no iPhone cita o formato", () => {
  const ctx = loadVodHelpers();
  const r = ctx.describeDirectPlayError({ errorName: "NotSupportedError", mediaErrorCode: 4, url: "http://x/movie/u/p/1.mkv?t=1", isIOS: true, attempts: 1 });
  assert.match(r.message, /MKV/);
});

test("retoma do ponto salvo só quando faz sentido", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.shouldApplyResume(120, 3600), true);
  assert.equal(ctx.shouldApplyResume(0, 3600), false);
  assert.equal(ctx.shouldApplyResume(3598, 3600), false); // a 2s do fim: começa do zero
  assert.equal(ctx.shouldApplyResume(120, NaN), false);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/vod/direct-play-policy.test.js`
Expected: FAIL (`ctx.shouldRetryDirectPlay is not a function`, e as esperas atuais `[800, 1800, …]`).

- [ ] **Step 4: Implementar as funções puras**

Substituir `computeDirectPlayRetryDelayMs` por:

```js
// ─── Filmes/episódios (arquivo direto) ───
// Servidores Xtream limitam as telas simultâneas por usuário e levam alguns
// segundos para liberar a vaga da reprodução anterior. Por isso são 6
// tentativas, com esperas que somam ~15s, sem mostrar erro enquanto isso.
const DIRECT_PLAY_MAX_ATTEMPTS = 6;
const DIRECT_PLAY_ATTEMPT_TIMEOUT_MS = 12000;

function computeDirectPlayRetryDelayMs(attempt) {
  return Math.min(5000, 1000 * attempt);
}

// Contêineres que o player nativo do iPhone (AVFoundation) nunca reproduz:
// tentar de novo não adianta.
function isContainerUnsupportedOnIOS(url) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  return /\.(mkv|avi|wmv|flv)$/.test(clean);
}

function shouldRetryDirectPlay({ errorName, attempt, maxAttempts, url, isIOS }) {
  if (errorName === "NotAllowedError") return false; // precisa de um toque do usuário
  if (isIOS && isContainerUnsupportedOnIOS(url)) return false;
  return attempt < maxAttempts;
}

// Traduz o motivo real da falha (erro do play() + código do MediaError da
// tag <video>) numa mensagem em português e num código curto, mostrado em
// letra pequena na tela de erro para o diagnóstico ficar 100% claro.
function describeDirectPlayError({ errorName, mediaErrorCode, url, isIOS, attempts }) {
  const parts = [];
  if (errorName) parts.push(errorName);
  if (mediaErrorCode) parts.push(`MEDIA_ERR ${mediaErrorCode}`);
  if (attempts) parts.push(`${attempts} tentativa${attempts > 1 ? "s" : ""}`);
  const code = parts.join(" · ");

  if (isIOS && isContainerUnsupportedOnIOS(url)) {
    const ext = String(url).split("?")[0].split(".").pop().toUpperCase();
    return { message: `O iPhone não reproduz arquivos ${ext}. Esse título precisa estar em outro formato no seu provedor.`, code };
  }
  if (errorName === "timeout") return { message: "O servidor demorou demais para começar a enviar o vídeo.", code };
  if (mediaErrorCode === 2) return { message: "A conexão com o servidor caiu enquanto o vídeo carregava.", code };
  if (mediaErrorCode === 3) return { message: "O arquivo do vídeo está corrompido ou usa um formato de áudio/vídeo não suportado.", code };
  if (mediaErrorCode === 4 || errorName === "NotSupportedError") {
    return { message: "O servidor recusou o vídeo. Isso costuma acontecer quando o limite de telas simultâneas do seu plano está ocupado.", code };
  }
  return { message: "Não foi possível abrir o vídeo agora.", code };
}

// Só retoma do ponto salvo se ele existir e não estiver colado no fim.
function shouldApplyResume(target, duration) {
  return target > 0 && isFinite(duration) && target < duration - 5;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/vod/direct-play-policy.test.js tests/vod/retry-direct-play.test.js`
Expected: PASS. O teste antigo também passa: 1000 ≤ 1500 e 2000 > 1000.

- [ ] **Step 6: Ligar a política ao player**

6a. Variáveis, junto de `let hlsInstance…`:

```js
// Cada reprodução nova (ou parada) incrementa este contador. Retentativas
// agendadas por uma reprodução antiga comparam o valor que capturaram com o
// atual e desistem sozinhas. Antes, uma retentativa atrasada podia trocar o
// src do vídeo que já estava tocando (causa do erro do ponto 3).
let playbackGeneration = 0;
// Pausa pedida pelo usuário num filme/episódio: o watchdog não "despausa".
let userPausedVod = false;
// Ponto (s) para retomar quando o próximo filme/episódio começar a tocar.
let pendingResumeAt = 0;
```

6b. Substituir `tryDirectPlay` inteira por:

```js
function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Solta o arquivo atual de verdade: sem o load(), o iOS podia manter o
// download anterior aberto, ocupando a vaga no servidor Xtream.
function releaseVideoElement(video) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function applyPendingResume(video) {
  const target = pendingResumeAt;
  pendingResumeAt = 0;
  if (!target) return;
  const seek = () => {
    if (shouldApplyResume(target, video.duration)) {
      try { video.currentTime = target; } catch (e) {}
    }
  };
  if (video.readyState >= 1) seek();
  else video.addEventListener("loadedmetadata", seek, { once: true });
}

function tryDirectPlay(url, video, attempt, generation) {
  attempt = attempt || 1;
  const gen = generation != null ? generation : playbackGeneration;
  if (gen !== playbackGeneration) return; // uma reprodução mais nova assumiu

  const loaderText = document.querySelector("#player-loader p");
  if (loaderText) {
    loaderText.textContent = attempt === 1
      ? "Conectando..."
      : `Servidor ocupado, tentando de novo (${attempt}/${DIRECT_PLAY_MAX_ATTEMPTS})...`;
  }

  if (attempt > 1) releaseVideoElement(video);
  video.src = url;

  let settled = false;
  const attemptTimer = setTimeout(() => fail({ name: "timeout" }), DIRECT_PLAY_ATTEMPT_TIMEOUT_MS);

  function fail(err) {
    if (settled) return;
    settled = true;
    clearTimeout(attemptTimer);
    if (gen !== playbackGeneration) return;
    const errorName = (err && err.name) || "Error";
    const mediaErrorCode = video.error ? video.error.code : null;
    const ios = isIOSDevice();
    if (errorName === "NotAllowedError") {
      // O sistema bloqueou o início automático: mostra o botão de play
      // (um toque do usuário libera) em vez de uma tela de erro.
      hidePlayerLoader();
      showPlayerArt();
      showToast("Toque em ▶ para começar.");
      return;
    }
    if (shouldRetryDirectPlay({ errorName, attempt, maxAttempts: DIRECT_PLAY_MAX_ATTEMPTS, url, isIOS: ios })) {
      setTimeout(() => tryDirectPlay(url, video, attempt + 1, gen), computeDirectPlayRetryDelayMs(attempt));
      return;
    }
    releaseVideoElement(video);
    const { message, code } = describeDirectPlayError({ errorName, mediaErrorCode, url, isIOS: ios, attempts: attempt });
    showPlayerError(message, code);
  }

  video.play().then(() => {
    if (settled) return;
    settled = true;
    clearTimeout(attemptTimer);
    if (gen !== playbackGeneration) return;
    hidePlayerLoader();
    showPlayerVideo();
    setState({ playing: true });
    const playBtn = document.getElementById("play-pause-btn");
    if (playBtn) playBtn.disabled = false;
    const reloadBtn = document.getElementById("reload-stream-btn");
    if (reloadBtn) reloadBtn.disabled = false;
    applyPendingResume(video);
    startWatchdog(url);
  }).catch(fail);
}
```

6c. `playStream()`: logo depois do `if (!url) …`:

```js
  const gen = ++playbackGeneration;
  userPausedVod = false;
```

Logo depois de `const streamInfo = await detectStreamType(url);`:

```js
  if (gen !== playbackGeneration) return; // outra reprodução começou durante a sondagem
```

Trocar `if (currentStreamType !== "mpegts") {` (timeout de 15s) por `if (currentStreamType !== "mpegts" && currentStreamType !== "direct") {`. O arquivo direto já tem timeout e retentativas próprios em `tryDirectPlay`.

6d. `stopStream()`: primeira linha `playbackGeneration++; userPausedVod = false;`, e depois de `video.removeAttribute("src");` acrescentar `video.load();`.

6e. `reloadCurrentChannel()`: no `GIVE_UP`, trocar a mensagem por `showPlayerError(ch.isVod ? \`"${ch.name}" está instável. Toque em "Tentar novamente" quando quiser tentar de novo.\` : \`Canal "${ch.name}" está instável. Toque em "Tentar novamente" quando quiser tentar de novo.\`);`. No `try`, mover `const video = document.getElementById("player-video");` para a primeira linha e acrescentar logo abaixo:

```js
    // Filme/episódio: guarda o ponto atual para retomar dali após a recarga
    if (ch.isVod && video && video.currentTime > 0) pendingResumeAt = video.currentTime;
```

6f. Watchdog: depois de `if (!_state.playing) return;` acrescentar `if (userPausedVod) return;`.

6g. Erro com código. Markup do `#player-error`: depois de `<p id="player-error-msg">…</p>` acrescentar `<p class="player-error-code" id="player-error-code" style="display:none"></p>`. CSS depois de `.player-error p { … }`:

```css
    .player-error .player-error-code {
      font-size: .68rem; color: oklch(0.6 0.02 75);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
```

E `showPlayerError`:

```js
function showPlayerError(msg, code) {
  hidePlayerLoader();
  showPlayerArt();
  document.getElementById("player-error-msg").textContent = msg || "Tente novamente.";
  const codeEl = document.getElementById("player-error-code");
  codeEl.textContent = code || "";
  codeEl.style.display = code ? "" : "none";
  document.getElementById("player-error").classList.add("active");
}
```

6h. Ícones de play/pause num só lugar (serve também ao mini-player e à tela cheia):

```js
function setPlayPauseIcons(isPlaying) {
  const icon = isPlaying ? "pause" : "play";
  ["play-pause-icon", "mini-play-icon", "fs-play-icon"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute("data-lucide", icon);
  });
  lucide.createIcons();
}
```

`showPlayerArt()`/`showPlayerVideo()` passam a chamar `setPlayPauseIcons(false)` / `setPlayPauseIcons(true)` no lugar das duas linhas `setAttribute` + `lucide.createIcons()`.

6i. `togglePlayPause()`: no topo da função:

```js
    const ch = _state.selected;
    // Filme/episódio carregado: pausa e retoma no mesmo ponto (antes o play
    // recarregava o arquivo e o vídeo voltava para o começo).
    if (ch && ch.isVod && _state.playing) {
      if (video.paused) {
        userPausedVod = false;
        video.play().catch(() => {});
        setPlayPauseIcons(true);
      } else {
        userPausedVod = true;
        video.pause();
        setPlayPauseIcons(false);
      }
      return;
    }
```

(o `const ch` do ramo antigo sai, porque agora está no topo).

6j. Retomar o "Continue Assistindo": em `playVodSelection`, depois de `closeVodModal();`, acrescentar `pendingResumeAt = meta.resumeAt > 0 ? meta.resumeAt : 0;`. Em `selectChannel`, antes de `stopStream();`, acrescentar `pendingResumeAt = 0;`. No clique de cartão com `data-vod-resume="1"`, passar `resumeAt: item.progress`.

- [ ] **Step 7: Rodar a suíte**

Run: suíte do app.
Expected: tudo PASS.

- [ ] **Step 8: Commit**

```bash
git add sintoniza-link.html tests/vod/loadVodHelpers.js tests/vod/direct-play-policy.test.js
git commit -m "fix(vod): cancel stale retries, release the previous stream, retry patiently and show the real error"
```

---

### Task 3: Capa e título de episódio nos recém-assistidos (ponto 4, parte 1)

**Files:**
- Modify: `sintoniza-link.html` (`openVodModal`, `playEpisode`, `playVodSelection`, `continueCardHtml`, listener de episódios, `timeupdate` do Continue Assistindo, CSS `.vod-card-placeholder`)
- Create: `tests/vod/episode-meta.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/vod/episode-meta.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("formatEpisodeTitle usa o nome da série + temporada/episódio", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.formatEpisodeTitle("Escola Minerva", "1", "3"), "Escola Minerva · T1E3");
  assert.equal(ctx.formatEpisodeTitle("", 2, 5), "T2E5");
  assert.equal(ctx.formatEpisodeTitle("Dark", undefined, ""), "Dark · T1");
});

test("trimVodItem guarda só os campos usados para reabrir o título", () => {
  const ctx = loadVodHelpers();
  const trimmed = ctx.trimVodItem({ series_id: 9, name: "Dark", cover: "http://c/d.jpg", plot: "…", cast: "muita gente", backdrop_path: ["a", "b"] });
  assert.deepEqual(trimmed, { series_id: 9, name: "Dark", cover: "http://c/d.jpg", plot: "…" });
  assert.equal(ctx.trimVodItem(null), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/episode-meta.test.js`
Expected: FAIL (`ctx.formatEpisodeTitle is not a function`).

- [ ] **Step 3: Implementar**

3a. Funções puras, logo antes de `saveContinueWatching`:

```js
// Título exibido para um episódio: "Nome da Série · T1E3". Antes aparecia
// só o título cru da API (muitas vezes apenas "S01E01").
function formatEpisodeTitle(seriesName, season, episodeNum) {
  const s = Number(season) || 1;
  const code = episodeNum ? `T${s}E${episodeNum}` : `T${s}`;
  const name = String(seriesName || "").trim();
  return name ? `${name} · ${code}` : code;
}

// Cópia enxuta do item da API (filme ou série), guardada no histórico e
// na Minha Lista para reabrir o título depois sem refazer a busca.
const VOD_ITEM_FIELDS = ["stream_id", "series_id", "name", "title", "stream_icon", "cover", "container_extension", "plot", "rating", "releaseDate", "year"];
function trimVodItem(item) {
  if (!item) return null;
  const out = {};
  VOD_ITEM_FIELDS.forEach(k => { if (item[k] != null && item[k] !== "") out[k] = item[k]; });
  return out;
}

// Capa do cartão. Sem imagem, mostra as iniciais do título sobre um fundo
// colorido em vez de um retângulo em branco.
function vodCardArtHtml(cover, title) {
  return cover
    ? `<img src="${cover}" alt="" loading="lazy" onerror="this.style.opacity='0.15'">`
    : `<div class="vod-card-placeholder logo-c3">${escapeHtmlText(makeInitials(title || "?"))}</div>`;
}
```

3b. `continueCardHtml`: calcular `const cover = item.cover || (item.vodItem && (item.vodItem.cover || item.vodItem.stream_icon)) || "";` e trocar o `<img …>` por `${vodCardArtHtml(cover, item.title)}`.

3c. CSS, depois de `.vod-card img { … }`:

```css
    .vod-card-placeholder {
      width: 100%; aspect-ratio: 2/3; border-radius: .5rem; margin-bottom: .5rem;
      display: grid; place-items: center; color: oklch(0.98 0 0);
      font-size: 1.4rem; font-weight: 700;
      box-shadow: 0 10px 20px oklch(0.1 0.01 65 / 25%);
    }
```

3d. `let _vodModalItem = null;` junto de `_vodCardsIndex`, e em `openVodModal` logo após `const isSeries…`: `_vodModalItem = { item, contType: isSeries ? "series" : "vod" };`. No filme, o `playVodSelection` do botão passa `vodItem: item`. Nos botões de episódio, trocar `data-series-cover="…"` por `data-ep-season="${ep.season || 1}" data-ep-num="${ep.episode_num || ""}"`.

3e. `playEpisode` passa a receber um objeto:

```js
function playEpisode({ episodeId, containerExtension, season, episodeNum, series, creds }) {
  const url = buildSeriesEpisodeUrl(creds, episodeId, containerExtension);
  const seriesName = (series && (series.name || series.title)) || "";
  playVodSelection(url, {
    id: episodeId,
    contType: "series",
    title: formatEpisodeTitle(seriesName, season, episodeNum),
    cover: (series && (series.cover || series.stream_icon)) || null,
    vodItem: series || null,
  });
}
```

O listener de `#vod-modal-episodes` passa `{ episodeId: btn.dataset.epId, containerExtension: btn.dataset.epExt, season: btn.dataset.epSeason, episodeNum: btn.dataset.epNum, series: _vodModalItem ? _vodModalItem.item : null, creds }`.

3f. `playVodSelection`: o `pseudo` ganha `vodItem: meta.vodItem ? trimVodItem(meta.vodItem) : null`. No `timeupdate` do Continue Assistindo, `saveContinueWatching({ …, vodItem: ch.vodItem || null })`. No clique de retomar, passar também `vodItem: item.vodItem || null`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vod/episode-meta.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/vod/episode-meta.test.js
git commit -m "fix(vod): series cover and 'Série · T1E3' title in recently watched"
```

---

### Task 4: Grade dos recém-assistidos (ponto 4, parte 2)

**Files:**
- Modify: `sintoniza-link.html` (`#home-recents-list`, `homeRecentCardHtml`, CSS)

A causa: `#home-recents-list` usa `minmax(14rem, 1fr)` inline. Numa tela de 390px, isso dá **1 coluna**, e o cartão (7,5rem fixos no celular) fica sozinho em cada linha.

- [ ] **Step 1: Implementar**

1a. HTML: `<div id="home-recents-list" class="home-recents-grid"></div>` (sem o `style` inline).

1b. CSS, depois de `.vod-carousel-grid .vod-card { … }`:

```css
    /* Recém-assistidos do Início: grade (3 por linha no celular) em vez de
       uma coluna só. */
    .home-recents-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 1rem;
    }
    .home-recents-grid .vod-card { min-width: 0; width: 100%; }
    /* Canal na grade: logo inteira (contain) sobre a cor do canal, no mesmo
       formato 2:3 dos pôsteres para as linhas ficarem alinhadas. */
    .vod-card-logo {
      width: 100%; aspect-ratio: 2/3; border-radius: .5rem; margin-bottom: .5rem;
      display: grid; place-items: center; overflow: hidden;
      color: oklch(0.98 0 0); font-size: 1.2rem; font-weight: 700;
      box-shadow: 0 10px 20px oklch(0.1 0.01 65 / 25%);
    }
    .vod-card .vod-card-logo img {
      width: 80%; height: auto; aspect-ratio: auto; object-fit: contain;
      margin: 0; box-shadow: none; background: none; border-radius: 0;
    }
```

E no `@media (max-width: 768px)`: `.home-recents-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }`.

1c. `homeRecentCardHtml`, ramo de canal:

```js
    return `
      <button class="vod-card" data-channel-id="${ch.id}" tabindex="0">
        <div class="vod-card-logo ${ch.color}">${ch.logo
          ? `<img src="${ch.logo}" alt="" loading="lazy" onerror="this.remove()">`
          : `<span>${ch.initials}</span>`}</div>
        <p>${ch.name || ""}</p>
      </button>`;
```

- [ ] **Step 2: Rodar a suíte**

Expected: tudo PASS.

- [ ] **Step 3: Commit**

```bash
git add sintoniza-link.html
git commit -m "fix(home): lay out recently watched as a 3-column grid"
```

---

### Task 5: O que cada aba mostra (ponto 9)

**Files:**
- Modify: `sintoniza-link.html` (sidebar, catalog-view, `visibleChannels`, `renderCategoryNav`, `renderNav`, `renderHomeRecents`, `render`, listeners das abas, `openVodSection`)
- Create: `tests/vod/tab-layout.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/vod/tab-layout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("Início mostra só as listas pessoais (sem busca e sem canais)", () => {
  const l = loadVodHelpers().getCatalogTabLayout("Início");
  assert.equal(l.showHomeLists, true);
  assert.equal(l.showSearch, false);
  assert.equal(l.showCatalog, false);
});

test("Favoritos mostra só os canais favoritos, com busca própria", () => {
  const l = loadVodHelpers().getCatalogTabLayout("Favoritos");
  assert.equal(l.showHomeLists, false);
  assert.equal(l.showCatalog, true);
  assert.equal(l.showPills, false);
  assert.equal(l.searchPlaceholder, "Buscar nos favoritos...");
});

test("Canais (e qualquer categoria) mostram a grade completa com as categorias", () => {
  const ctx = loadVodHelpers();
  for (const active of ["Todos os canais", "Esportes"]) {
    const l = ctx.getCatalogTabLayout(active);
    assert.equal(l.showHomeLists, false);
    assert.equal(l.showCatalog, true);
    assert.equal(l.showPills, true);
  }
});

test("categorias acendem a aba Canais", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.getMobileTabForSection("Início"), "Início");
  assert.equal(ctx.getMobileTabForSection("Favoritos"), "Favoritos");
  assert.equal(ctx.getMobileTabForSection("Esportes"), "Todos os canais");
  assert.equal(ctx.getMobileTabForSection("Todos os canais"), "Todos os canais");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/tab-layout.test.js`
Expected: FAIL (`getCatalogTabLayout is not a function`).

- [ ] **Step 3: Implementar**

3a. Funções puras, depois de `visibleChannels`:

```js
// O que cada aba do catálogo mostra (ponto 9 da v6): Início só as listas
// pessoais (Minha Lista + recém-assistidos), Favoritos só os canais
// favoritos, e Canais a grade completa com as categorias.
function getCatalogTabLayout(active) {
  if (active === "Início") {
    return { showHomeLists: true, showSearch: false, showCatalog: false, showPills: false, showOnNow: false, searchPlaceholder: "", eyebrow: "" };
  }
  if (active === "Favoritos") {
    return { showHomeLists: false, showSearch: true, showCatalog: true, showPills: false, showOnNow: false, searchPlaceholder: "Buscar nos favoritos...", eyebrow: "SEUS FAVORITOS" };
  }
  return { showHomeLists: false, showSearch: true, showCatalog: true, showPills: true, showOnNow: true, searchPlaceholder: "Buscar canais...", eyebrow: "EXPLORE" };
}

// "Todos os canais" e qualquer categoria pertencem à aba Canais.
function getMobileTabForSection(active) {
  if (active === "Início" || active === "Favoritos") return active;
  return "Todos os canais";
}
```

3b. `visibleChannels`: no ramo com busca, trocar `matchS = true; // busca sempre mostra tudo` por:

```js
      // Na aba Favoritos a busca fica restrita aos favoritos; nas outras
      // abas de canais ela procura em todos.
      matchS = active === "Favoritos" ? isFav(ch) : true;
```

3c. HTML do `#catalog-view`: `<section class="feature-layout" id="feature-layout">`, `<section class="catalog-section" id="catalog-section">`, `<p class="eyebrow" id="catalog-eyebrow">EXPLORE</p>`, e o container de busca com `id="catalog-search-slot"`. Envolver `#home-recents-section` num `<div id="home-lists">` com um `<div id="home-mylist"></div>` antes (usado na Task 8) e um estado vazio depois:

```html
      <div id="home-lists">
        <div id="home-mylist"></div>
        <!-- (section#home-recents-section atual, sem mudanças) -->
        <div class="empty-state" id="home-empty" style="display:none">
          <i data-lucide="clock-3" style="width:2rem;height:2rem"></i>
          <h3>Nada assistido ainda</h3>
          <p>Os canais, filmes e séries que você assistir aparecem aqui.</p>
        </div>
      </div>
```

3d. Sidebar: trocar o item "Canais" (que apontava para Início) por três itens:

```html
    <button class="nav-item active" data-section="Início">
      <i data-lucide="home" style="width:19px;height:19px"></i><span>Início</span>
    </button>
    <button class="nav-item" data-section="Favoritos">
      <i data-lucide="heart" style="width:19px;height:19px"></i><span>Favoritos</span>
    </button>
    <button class="nav-item" data-section="Todos os canais">
      <i data-lucide="monitor-play" style="width:19px;height:19px"></i><span>Canais</span>
    </button>
```

3e. JS:

```js
// Aplica o layout da aba ativa (ponto 9 da v6) na view de catálogo.
function renderTabLayout() {
  const layout = getCatalogTabLayout(_state.active);
  document.getElementById("catalog-search-slot").style.display = layout.showSearch ? "" : "none";
  document.getElementById("search-input").placeholder = layout.searchPlaceholder || "Buscar...";
  document.getElementById("catalog-section").style.display = layout.showCatalog ? "" : "none";
  document.getElementById("category-pills").style.display = layout.showPills ? "" : "none";
  document.getElementById("feature-layout").style.display = layout.showOnNow ? "" : "none";
  document.getElementById("catalog-eyebrow").textContent = layout.eyebrow;
  document.getElementById("home-lists").style.display = layout.showHomeLists ? "" : "none";
}

// Listas pessoais do Início. Mostra o estado vazio quando não há nada.
function renderHomeLists() {
  const hasRecents = renderHomeRecents();
  document.getElementById("home-empty").style.display = hasRecents ? "none" : "";
}
```

`renderHomeRecents()` passa a `return false` no ramo vazio e `return true` no final. Em `render()`, trocar `renderHomeRecents();` por `renderTabLayout(); renderHomeLists();`.

3f. `renderCategoryNav`: primeira pílula "Todos":

```js
  nav.innerHTML = [`<button class="nav-item" data-section="Todos os canais"><span>Todos</span></button>`]
    .concat(cats.map(cat => `
    <button class="nav-item" data-section="${cat}"><span>${cat}</span></button>`)).join("");
```

3g. `renderNav`: trocar os dois primeiros `forEach` (`.nav-item[data-section]` e `.mobile-tab[data-section]`) por:

```js
  const tab = getMobileTabForSection(active);
  document.querySelectorAll(".sidebar-nav .nav-item[data-section], .mobile-tab[data-section]").forEach(el => {
    el.classList.toggle("active", section === "catalog" && el.dataset.section === tab);
  });
  document.querySelectorAll("#category-pills .nav-item[data-section]").forEach(el => {
    el.classList.toggle("active", section === "catalog" && el.dataset.section === active);
  });
```

3h. Listeners do boot (trocar de aba sobe para o topo, onde está o player; as pílulas não sobem):

```js
  document.querySelectorAll(".sidebar-nav .nav-item[data-section]").forEach(el => {
    el.addEventListener("click", () => { setSection(el.dataset.section); closeSidebar(); window.scrollTo({ top: 0 }); });
  });
  document.querySelectorAll(".mobile-tab[data-section]").forEach(el => {
    el.addEventListener("click", () => { setSection(el.dataset.section); window.scrollTo({ top: 0 }); });
  });
```

Em `openVodSection`, depois do `setState(...)`: `window.scrollTo({ top: 0 });`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vod/tab-layout.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/vod/tab-layout.test.js
git commit -m "feat(tabs): Início shows only recents, Favoritos only favorites, channels only in Canais"
```

---

### Task 6: Player grande em todas as abas e mini-player corrigido (pontos 6 e 7)

**Files:**
- Modify: `sintoniza-link.html` (remover `#vod-hero` + `setVodHero` + estado de busca do herói; `#player-anchor`; `setPlayerMode`; docking na rolagem; CSS do mini-player; toque no mini-player)
- Create: `tests/player/player-mode.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/player/player-mode.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

test("player fica grande em todas as abas enquanto está visível", () => {
  const ctx = loadVodHelpers();
  for (const section of ["catalog", "vod"]) {
    assert.equal(ctx.computePlayerMode({ section, hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "full");
    assert.equal(ctx.computePlayerMode({ section, hasActiveMedia: false, playerScrolledAway: true, isFullscreen: false }), "full");
  }
});

test("vira mini-player só com algo tocando e o player fora da tela", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "vod", hasActiveMedia: true, playerScrolledAway: true, isFullscreen: false }), "mini");
});

test("em Configurações nunca fica grande", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "mini");
  assert.equal(ctx.computePlayerMode({ section: "settings", hasActiveMedia: false, playerScrolledAway: false, isFullscreen: false }), "hidden");
});

test("tela cheia sempre vence", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasActiveMedia: true, playerScrolledAway: true, isFullscreen: true }), "full");
});

test("player conta como fora da tela com menos de 48px visíveis abaixo da topbar", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.isPlayerScrolledAway(200, 100), false);
  assert.equal(ctx.isPlayerScrolledAway(140, 100), true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/player-mode.test.js`
Expected: FAIL (`computePlayerMode is not a function`).

- [ ] **Step 3: Implementar**

3a. Remover o banner de Filmes/Séries: a `<section class="vod-hero" …>` inteira; o CSS `.vod-hero*` (base e media query) e `#vod-hero-play` na regra combinada (fica só `#vod-modal-play { … }`); a função `setVodHero`; em `loadVodCatalog`, as linhas do `vod-hero`, `firstCatId`/`heroSet` e o `if (!heroSet …) setVodHero(…)`, além de `_vodSearchActive = false;`; as variáveis `_vodSearchActive`/`_vodHeroVisibleBeforeSearch` (e o comentário delas). No listener de `#vod-search-input`, remover `heroEl`, o bloco `if (!_vodSearchActive) {…}` e `heroEl.style.display = "none";`. O ramo de campo vazio fica só com `resultsEl.style.display = "none"; document.getElementById("vod-carousels").style.display = "block"; return;`.

3b. HTML: envolver `#player-screen` em `<div id="player-anchor"> … </div><!-- /player-anchor -->`. CSS: `#player-anchor { display: flow-root; }`, para a margem do player ficar dentro da âncora e a altura medida bater.

3c. Funções puras, antes de `setPlayerMode`:

```js
// Como o player aparece (pontos 6/7 da v6): grande no topo de todas as
// abas. Vira mini-player só quando algo está tocando e o player grande
// saiu da tela na rolagem. Em Configurações nunca fica grande.
function computePlayerMode({ section, hasActiveMedia, playerScrolledAway, isFullscreen }) {
  if (isFullscreen) return "full";
  if (section === "settings") return hasActiveMedia ? "mini" : "hidden";
  return hasActiveMedia && playerScrolledAway ? "mini" : "full";
}

// O player grande conta como "fora da tela" quando sobram menos de 48px
// dele visíveis abaixo da topbar fixa.
const PLAYER_VISIBLE_MIN_PX = 48;
function isPlayerScrolledAway(anchorBottom, topbarBottom) {
  return anchorBottom - topbarBottom < PLAYER_VISIBLE_MIN_PX;
}
```

3d. Substituir `setPlayerMode` inteira:

```js
let _playerScrolledAway = false;

// Enquanto o player está fora do fluxo (mini ou tela cheia), a âncora
// guarda a altura dele para a página não "pular" para cima.
function lockPlayerAnchor() {
  const anchor = document.getElementById("player-anchor");
  if (anchor && !anchor.style.height) anchor.style.height = `${anchor.offsetHeight}px`;
}
function unlockPlayerAnchor() {
  const anchor = document.getElementById("player-anchor");
  if (anchor) anchor.style.height = "";
}

function setPlayerMode() {
  const el = document.getElementById("player-screen");
  if (!el) return;
  const isFullscreen = el.classList.contains("pseudo-fullscreen");
  const wasOutOfFlow = isFullscreen || el.classList.contains("mini-player");
  const hasActiveMedia = !!(_state.selected && (_state.playing || _state.selected.isVod));
  const mode = computePlayerMode({ section: _state.section, hasActiveMedia, playerScrolledAway: _playerScrolledAway, isFullscreen });
  const keepSlot = _state.section !== "settings" && (mode === "mini" || isFullscreen);
  if (keepSlot && !wasOutOfFlow) lockPlayerAnchor(); // mede antes de sair do fluxo
  if (!keepSlot) unlockPlayerAnchor();
  el.classList.toggle("mini-player", mode === "mini");
  el.classList.toggle("player-hidden", mode === "hidden");
}

// Rolagem: decide o mini-player (e, na Task 7, o encaixe da busca). Roda no
// máximo uma vez por quadro.
let _dockingRaf = 0;
function scheduleDockingUpdate() {
  if (_dockingRaf) return;
  _dockingRaf = requestAnimationFrame(() => {
    _dockingRaf = 0;
    updateDocking();
  });
}

function updateDocking() {
  const topbar = document.querySelector(".topbar");
  const anchor = document.getElementById("player-anchor");
  if (!topbar || !anchor) return;
  const topbarBottom = topbar.getBoundingClientRect().bottom;
  _playerScrolledAway = isPlayerScrolledAway(anchor.getBoundingClientRect().bottom, topbarBottom);
  setPlayerMode();
}
```

Em `render()`, depois de `setPlayerMode();`, acrescentar `scheduleDockingUpdate();`. No boot:

```js
  window.addEventListener("scroll", scheduleDockingUpdate, { passive: true });
  window.addEventListener("resize", scheduleDockingUpdate);
```

3e. Toque no mini-player: trocar o listener que fazia `setState({ section: "catalog" })` por:

```js
  // Tocar no mini-player volta ao player grande: nas abas principais ele
  // fica no topo da própria página (basta rolar). Em Configurações, que não
  // tem player grande, volta para o catálogo.
  document.getElementById("player-screen").addEventListener("click", () => {
    const el = document.getElementById("player-screen");
    if (!el.classList.contains("mini-player")) return;
    if (_state.section === "settings") setState({ section: "catalog" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
```

3f. CSS: substituir todo o bloco do mini-player (de `/* Mini-player: …` até `#player-screen.player-hidden { display: none; }`) por:

```css
    /* Mini-player (pontos 6/7 da v6): barra compacta acima das abas, só
       quando algo toca e o player grande saiu da tela (ou em Configurações). */
    #player-screen.mini-player {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 500;
      height: 4.5rem; min-height: 0;
      display: flex; flex-direction: row; align-items: center;
      padding: 0 .75rem 0 1rem;
      background: var(--card); color: var(--foreground);
      border-top: 1px solid var(--border);
      box-shadow: 0 -4px 16px rgba(0,0,0,0.15);
      margin: 0; border-radius: 0;
    }
    /* A área de mídia vira uma linha: miniatura, título e play/pause. Antes
       elas empilhavam e a miniatura ficava cortada embaixo do título. */
    #player-screen.mini-player .player-media {
      position: relative; min-height: 0; flex: 1; min-width: 0;
      display: flex; align-items: center; gap: .75rem;
      background: transparent; overflow: visible;
    }
    #player-screen.mini-player .player-video-wrap {
      order: -1; position: relative;
      width: 4.5rem; height: 2.55rem; flex-shrink: 0;
      border-radius: .4rem; overflow: hidden; background: #000;
    }
    #player-screen.mini-player .player-controls,
    #player-screen.mini-player .vod-seek-row,
    #player-screen.mini-player .player-loader,
    #player-screen.mini-player .player-error,
    #player-screen.mini-player .play-center {
      /* !important: .vod-seek-row/.player-controls recebem display inline via JS */
      display: none !important;
    }
    #player-screen.mini-player .player-art {
      display: flex !important; opacity: 1 !important; pointer-events: auto !important;
      position: static; flex: 1; min-width: 0;
      padding: 0; background: none; align-items: center;
    }
    #player-screen.mini-player .signal-lines,
    #player-screen.mini-player .channel-monogram,
    #player-screen.mini-player .player-art-logo {
      display: none !important;
    }
    #player-screen.mini-player .player-copy {
      display: flex !important; flex-direction: column; justify-content: center;
      flex: 1; min-width: 0; overflow: hidden; color: var(--foreground);
    }
    /* Texto escuro sobre a barra clara (antes: branco sobre branco). */
    #player-screen.mini-player .player-copy h2 {
      font-size: .85rem; margin: 0; color: var(--foreground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #player-screen.mini-player .player-copy p,
    #player-screen.mini-player .live-badge {
      display: none !important;
    }
    .mini-play-btn { display: none; }
    #player-screen.mini-player .mini-play-btn {
      display: flex !important; align-items: center; justify-content: center;
      width: 2.75rem; height: 2.75rem; flex-shrink: 0;
      background: none; border: none; color: var(--foreground); cursor: pointer;
    }
    #player-screen.player-hidden { display: none; }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/player-mode.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/player/player-mode.test.js
git commit -m "feat(player): big player on every tab, mini-player only when scrolled away, fix mini-player layout"
```

---

### Task 7: Busca que se encaixa na topbar (ponto 5)

**Files:**
- Modify: `sintoniza-link.html` (os dois containers de busca, CSS `.sticky-search-container` → `.search-dock-slot`, `updateDocking`)
- Modify: `tests/player/player-mode.test.js`

- [ ] **Step 1: Escrever o teste que falha** (acrescentar em `tests/player/player-mode.test.js`)

```js
test("busca se encaixa na topbar quando o lugar dela passa por baixo da topbar", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.shouldDockSearch(90, 100), true);
  assert.equal(ctx.shouldDockSearch(120, 100), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/player-mode.test.js`
Expected: FAIL (`shouldDockSearch is not a function`).

- [ ] **Step 3: Implementar**

3a. HTML: nos dois lugares, `<div class="sticky-search-container">` vira `<div class="search-dock-slot">` (o do catálogo mantém `id="catalog-search-slot"`), e o `label` da busca de VOD perde a classe `vod-search-box`.

3b. CSS: substituir `.sticky-search-container { … }` e `.sticky-search-container .search-box { … }` por:

```css
    /* Lugar da busca no conteúdo. Ao rolar, a caixa sai daqui e se encaixa
       na topbar, entre o menu e o sininho (ponto 5 da v6). O lugar mantém a
       altura para a página não pular. */
    .search-dock-slot { height: 2.6rem; margin: 1.25rem 0; }
    .search-dock-slot .search-box { max-width: 28rem; }
    .search-box.docked {
      position: fixed; z-index: 31; max-width: none;
      top: calc(env(safe-area-inset-top) + 1.2rem);
      left: calc(var(--sidebar-w) + 2rem); right: 4.75rem;
    }
```

Remover `.vod-search-box { … }`. No `@media (max-width: 768px)`, trocar a linha `.sticky-search-container { top: … }` por:

```css
      .search-box.docked { top: calc(env(safe-area-inset-top) + .85rem); left: 3.75rem; right: 3.6rem; }
```

3c. JS: função pura, junto de `isPlayerScrolledAway`:

```js
// A caixa de busca se encaixa na topbar quando o lugar dela no conteúdo
// passa por baixo da topbar.
function shouldDockSearch(slotTop, topbarBottom) {
  return slotTop < topbarBottom;
}
```

E, no fim de `updateDocking()`:

```js
  document.querySelectorAll(".search-dock-slot").forEach(slot => {
    const box = slot.querySelector(".search-box");
    if (!box) return;
    const inActiveView = slot.offsetParent !== null; // view escondida → null
    box.classList.toggle("docked", inActiveView && shouldDockSearch(slot.getBoundingClientRect().top, topbarBottom));
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/player-mode.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/player/player-mode.test.js
git commit -m "feat(search): dock the search box into the topbar on scroll"
```

---

### Task 8: Minha Lista (ponto 8, parte 1)

**Files:**
- Modify: `sintoniza-link.html` (funções da Minha Lista, faixa no Início e em Filmes/Séries, botão no modal, delegação de clique)
- Create: `tests/vod/my-list.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/vod/my-list.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("toggleMyListEntry adiciona no começo e remove se já existir", () => {
  const ctx = loadVodHelpers();
  const a = { type: "vod", id: 1, title: "A" };
  const b = { type: "series", id: 7, title: "B" };
  let list = ctx.toggleMyListEntry([], a, 100);
  list = ctx.toggleMyListEntry(list, b, 200);
  assert.deepEqual(list.map(e => `${e.type}-${e.id}`), ["series-7", "vod-1"]);
  list = ctx.toggleMyListEntry(list, { type: "vod", id: "1" }, 300); // id em texto também casa
  assert.deepEqual(list.map(e => `${e.type}-${e.id}`), ["series-7"]);
});

test("isInMyList diferencia filme de série com o mesmo id", () => {
  const ctx = loadVodHelpers();
  const list = [{ type: "vod", id: 5, ts: 1 }];
  assert.equal(ctx.isInMyList(list, "vod", "5"), true);
  assert.equal(ctx.isInMyList(list, "series", 5), false);
});

test("getMyListItems filtra por tipo e ordena do mais recente", () => {
  const ctx = loadVodHelpers();
  const list = [{ type: "vod", id: 1, ts: 1 }, { type: "series", id: 2, ts: 3 }, { type: "vod", id: 3, ts: 2 }];
  assert.deepEqual(ctx.getMyListItems(list, "vod").map(e => e.id), [3, 1]);
  assert.deepEqual(ctx.getMyListItems(list, null).map(e => e.id), [2, 3, 1]);
});

test("buildMyListEntry monta a entrada a partir do item cru da API", () => {
  const ctx = loadVodHelpers();
  const serie = ctx.buildMyListEntry({ series_id: 9, name: "Dark", cover: "c.jpg", cast: "x" }, "series");
  assert.deepEqual(serie, { type: "series", id: 9, title: "Dark", cover: "c.jpg", item: { series_id: 9, name: "Dark", cover: "c.jpg" } });
  const filme = ctx.buildMyListEntry({ stream_id: 4, name: "Duna", stream_icon: "d.jpg", container_extension: "mp4" }, "vod");
  assert.equal(filme.id, 4);
  assert.equal(filme.cover, "d.jpg");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/my-list.test.js`
Expected: FAIL (`toggleMyListEntry is not a function`).

- [ ] **Step 3: Implementar**

3a. Depois de `removeContinueWatching`:

```js
// ─── Minha Lista (ponto 8 da v6) ───
// Filmes e séries marcados pelo usuário. Viram a primeira faixa do Início
// (tudo) e de Filmes/Séries (só o tipo da aba) e somem quando a lista está
// vazia. Entrada: { type: "vod"|"series", id, title, cover, item, ts }.
const MYLIST_KEY = "sint_mylist";

function loadMyList() {
  try { return JSON.parse(localStorage.getItem(MYLIST_KEY) || "[]"); } catch (e) { return []; }
}
function saveMyList(list) {
  localStorage.setItem(MYLIST_KEY, JSON.stringify(list));
}

function isInMyList(list, type, id) {
  return list.some(e => e.type === type && String(e.id) === String(id));
}

function toggleMyListEntry(list, entry, nowMs) {
  if (isInMyList(list, entry.type, entry.id)) {
    return list.filter(e => !(e.type === entry.type && String(e.id) === String(entry.id)));
  }
  return [{ ...entry, ts: nowMs }, ...list];
}

function getMyListItems(list, type) {
  return list.filter(e => !type || e.type === type).sort((a, b) => b.ts - a.ts);
}

function buildMyListEntry(rawItem, contType) {
  const item = trimVodItem(rawItem);
  return {
    type: contType,
    id: contType === "series" ? item.series_id : item.stream_id,
    title: item.name || item.title || "Sem título",
    cover: item.stream_icon || item.cover || "",
    item,
  };
}

function myListCardHtml(entry) {
  const key = `mylist-${entry.type}-${entry.id}`;
  _vodCardsIndex[key] = entry.item;
  return `
    <button class="vod-card" data-vod-key="${key}" data-vod-type="${entry.type === "series" ? "series" : "movies"}" data-lp="mylist" tabindex="0">
      ${vodCardArtHtml(entry.cover, entry.title)}
      <p>${escapeHtmlText(entry.title)}</p>
    </button>`;
}

// contType null = todos os tipos (Início).
function myListRowHtml(contType) {
  const items = getMyListItems(loadMyList(), contType);
  if (!items.length) return "";
  return `
    <div class="vod-row" data-cat-id="mylist">
      <h2>Minha Lista</h2>
      <div class="vod-carousel">${items.map(myListCardHtml).join("")}</div>
    </div>`;
}

// Recria só as faixas pessoais (Minha Lista / Continue Assistindo) da aba
// Filmes/Séries aberta, sem refazer as requisições do catálogo.
function refreshVodPersonalRows() {
  const carouselsEl = document.getElementById("vod-carousels");
  if (!carouselsEl || _state.section !== "vod") return;
  const contType = _state.vodType === "series" ? "series" : "vod";
  carouselsEl.querySelectorAll('.vod-row[data-cat-id="mylist"], .vod-row[data-cat-id="continue"]').forEach(row => row.remove());
  carouselsEl.insertAdjacentHTML("afterbegin", myListRowHtml(contType) + continueWatchingRowHtml(contType));
}

function refreshPersonalLists() {
  renderHomeLists();
  refreshVodPersonalRows();
}

function toggleMyListFor(rawItem, contType) {
  const entry = buildMyListEntry(rawItem, contType);
  const wasIn = isInMyList(loadMyList(), entry.type, entry.id);
  saveMyList(toggleMyListEntry(loadMyList(), entry, Date.now()));
  showToast(wasIn ? "Removido da Minha Lista" : "Adicionado à Minha Lista");
  refreshPersonalLists();
}
```

3b. `renderHomeLists()`:

```js
function renderHomeLists() {
  const myListHtml = myListRowHtml(null);
  document.getElementById("home-mylist").innerHTML = myListHtml;
  const hasRecents = renderHomeRecents();
  document.getElementById("home-empty").style.display = (myListHtml || hasRecents) ? "none" : "";
}
```

3c. `loadVodCatalog`: `const contRowHtml = continueWatchingRowHtml(contType);` vira `const contRowHtml = myListRowHtml(contType) + continueWatchingRowHtml(contType);`. Na inserção de "Novidades", `const continueRow = …` vira `const continueRow = carouselsEl.querySelector('.vod-row[data-cat-id="continue"]') || carouselsEl.querySelector('.vod-row[data-cat-id="mylist"]');`.

3d. Modal: em `#vod-modal-actions`, depois de `#vod-modal-play`:

```html
        <button class="btn-ghost" id="vod-modal-mylist">
          <i data-lucide="plus" style="width:18px;height:18px"></i> <span>Minha Lista</span>
        </button>
```

CSS: `#vod-modal-mylist { display: inline-flex; align-items: center; gap: .5rem; }`. JS:

```js
function updateModalMyListButton() {
  const btn = document.getElementById("vod-modal-mylist");
  if (!btn || !_vodModalItem) return;
  const entry = buildMyListEntry(_vodModalItem.item, _vodModalItem.contType);
  const inList = isInMyList(loadMyList(), entry.type, entry.id);
  btn.innerHTML = `<i data-lucide="${inList ? "check" : "plus"}" style="width:18px;height:18px"></i> <span>${inList ? "Na Minha Lista" : "Minha Lista"}</span>`;
  lucide.createIcons();
}
```

Em `openVodModal`, logo depois de definir `_vodModalItem`: `updateModalMyListButton();`. No boot:

```js
  document.getElementById("vod-modal-mylist").addEventListener("click", () => {
    if (!_vodModalItem) return;
    toggleMyListFor(_vodModalItem.item, _vodModalItem.contType);
    updateModalMyListButton();
  });
```

3e. `onVodCardAreaClick`: `openVodModal(item, _state.vodType, creds);` vira `openVodModal(item, card.dataset.vodType || _state.vodType, creds);`. No boot: `document.getElementById("home-mylist").addEventListener("click", onVodCardAreaClick);`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vod/my-list.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/vod/my-list.test.js
git commit -m "feat(vod): Minha Lista as the top row of Início, Filmes and Séries"
```

---

### Task 9: Segurar em cima do cartão (ponto 8, parte 2)

**Files:**
- Modify: `sintoniza-link.html` (atributos `data-lp` nos cartões, `getCardActions`, menu de ações, motor de toque longo)
- Create: `tests/vod/card-actions.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/vod/card-actions.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const ids = actions => actions.map(a => a.id);

test("canal recente: só remover", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "channel-recent", inMyList: false, canUseMyList: false })), ["recent-remove"]);
});

test("filme/série recente: Minha Lista + remover", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "continue", inMyList: false, canUseMyList: true })), ["mylist-add", "recent-remove"]);
  assert.deepEqual(ids(ctx.getCardActions({ kind: "continue", inMyList: true, canUseMyList: true })), ["mylist-remove", "recent-remove"]);
});

test("histórico antigo sem dados da série não oferece Minha Lista", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "continue", inMyList: false, canUseMyList: false })), ["recent-remove"]);
});

test("cartão do catálogo alterna a Minha Lista", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ids(ctx.getCardActions({ kind: "vod", inMyList: false, canUseMyList: true })), ["mylist-add"]);
  assert.deepEqual(ids(ctx.getCardActions({ kind: "mylist", inMyList: true, canUseMyList: true })), ["mylist-remove"]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/card-actions.test.js`
Expected: FAIL (`getCardActions is not a function`).

- [ ] **Step 3: Implementar**

3a. Atributos: `vodCardHtml` ganha `data-lp="vod"`, `continueCardHtml` ganha `data-lp="continue"` e o cartão de canal de `homeRecentCardHtml` ganha `data-lp="channel-recent"` (o da Minha Lista já tem `data-lp="mylist"`).

3b. Função pura, depois de `toggleMyListFor`:

```js
// Opções do menu de "segurar em cima" (ponto 8 da v6), por tipo de cartão.
function getCardActions({ kind, inMyList, canUseMyList }) {
  const myListAction = inMyList
    ? { id: "mylist-remove", label: "Remover da Minha Lista", icon: "minus-circle", danger: false }
    : { id: "mylist-add", label: "Adicionar à Minha Lista", icon: "plus-circle", danger: false };
  const removeRecent = { id: "recent-remove", label: "Remover dos recentes", icon: "trash-2", danger: true };
  if (kind === "channel-recent") return [removeRecent];
  if (kind === "mylist") return [{ id: "mylist-remove", label: "Remover da Minha Lista", icon: "minus-circle", danger: true }];
  if (kind === "continue") return canUseMyList ? [myListAction, removeRecent] : [removeRecent];
  if (kind === "vod") return [myListAction];
  return [];
}
```

3c. Menu (DOM), logo depois:

```js
let _actionSheetContext = null;

// Descobre o que é o cartão pressionado e com quais dados agir.
function resolveCardContext(card) {
  const kind = card.dataset.lp;
  if (kind === "channel-recent") {
    const ch = getChannels().find(c => c.id === +card.dataset.channelId);
    return ch ? { kind, title: ch.name, channelId: ch.id } : null;
  }
  const item = _vodCardsIndex[card.dataset.vodKey];
  if (!item) return null;
  if (kind === "continue") {
    return { kind, title: item.title || "", recentId: item.id, rawItem: item.vodItem || null, contType: item.type === "series" ? "series" : "vod" };
  }
  const contType = kind === "mylist"
    ? (card.dataset.vodType === "series" ? "series" : "vod")
    : (_vodCatalogCache.vodType === "series" ? "series" : "vod");
  return { kind, title: item.name || item.title || "", rawItem: item, contType };
}

function openCardActions(card) {
  const ctx = resolveCardContext(card);
  if (!ctx) return;
  let inMyList = false;
  if (ctx.rawItem) {
    const entry = buildMyListEntry(ctx.rawItem, ctx.contType);
    inMyList = isInMyList(loadMyList(), entry.type, entry.id);
  }
  const actions = getCardActions({ kind: ctx.kind, inMyList, canUseMyList: !!ctx.rawItem });
  if (!actions.length) return;
  _actionSheetContext = ctx;
  document.getElementById("action-sheet-title").textContent = ctx.title;
  document.getElementById("action-sheet-actions").innerHTML = actions.map(a => `
    <button class="action-sheet-btn${a.danger ? " danger" : ""}" data-action="${a.id}">
      <i data-lucide="${a.icon}" style="width:18px;height:18px"></i><span>${a.label}</span>
    </button>`).join("");
  const sheet = document.getElementById("action-sheet");
  sheet.classList.remove("hidden");
  sheet.setAttribute("aria-hidden", "false");
  lucide.createIcons();
}

function closeCardActions() {
  const sheet = document.getElementById("action-sheet");
  sheet.classList.add("hidden");
  sheet.setAttribute("aria-hidden", "true");
  _actionSheetContext = null;
}

function runCardAction(actionId) {
  const ctx = _actionSheetContext;
  closeCardActions();
  if (!ctx) return;
  if (actionId === "mylist-add" || actionId === "mylist-remove") {
    if (ctx.rawItem) toggleMyListFor(ctx.rawItem, ctx.contType);
    return;
  }
  if (actionId === "recent-remove") {
    if (ctx.channelId != null) {
      const recents = _state.recents.filter(r => r.id !== ctx.channelId);
      localStorage.setItem("sint_recents", JSON.stringify(recents));
      setState({ recents });
    } else if (ctx.recentId) {
      removeContinueWatching(ctx.recentId);
      refreshPersonalLists();
    }
    showToast("Removido dos recentes");
  }
}
```

3d. Markup, antes do `<!-- VOD MODAL … -->`:

```html
<!-- MENU DE AÇÕES: aberto ao segurar em cima de um cartão (ponto 8 da v6) -->
<div id="action-sheet" class="action-sheet hidden" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="action-sheet-card">
    <p class="action-sheet-title" id="action-sheet-title"></p>
    <div class="action-sheet-actions" id="action-sheet-actions"></div>
    <button class="action-sheet-cancel" id="action-sheet-cancel">Cancelar</button>
  </div>
</div>
```

3e. CSS, depois do bloco do VOD MODAL:

```css
    /* ════════════ MENU DE AÇÕES (segurar em cima de um cartão) ════════════ */
    .action-sheet {
      position: fixed; inset: 0; z-index: 10001;
      display: flex; align-items: flex-end; justify-content: center;
      background: oklch(0.05 0.01 65 / 55%);
      padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
    }
    .action-sheet.hidden { display: none !important; }
    .action-sheet-card {
      width: 100%; max-width: 26rem; background: var(--card);
      border-radius: 1rem; padding: 1rem;
      display: flex; flex-direction: column; gap: .5rem;
      box-shadow: 0 20px 50px oklch(0.1 0.01 65 / 40%);
    }
    .action-sheet-title {
      font-weight: 600; font-size: .95rem; padding: .25rem .25rem .6rem;
      border-bottom: 1px solid var(--border);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .action-sheet-actions { display: flex; flex-direction: column; gap: .35rem; }
    .action-sheet-btn, .action-sheet-cancel {
      display: flex; align-items: center; gap: .6rem; width: 100%;
      padding: .85rem 1rem; border-radius: .6rem; border: none;
      background: var(--secondary); color: var(--foreground);
      font-size: .9rem; font-weight: 500; text-align: left;
    }
    .action-sheet-btn.danger { color: var(--error); }
    .action-sheet-cancel { justify-content: center; background: none; border: 1px solid var(--border); margin-top: .25rem; }
    /* Sem o menu nativo do iOS (salvar imagem/seleção de texto) ao segurar. */
    [data-lp] { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    [data-lp] img { -webkit-user-drag: none; pointer-events: none; }
```

3f. Motor de toque longo, no boot:

```js
  // ── SEGURAR EM CIMA DE UM CARTÃO (menu de ações, ponto 8 da v6) ──
  // Toque longo (~500ms sem arrastar) abre o menu. O clique que o navegador
  // dispara ao soltar o dedo é engolido; senão ele cairia no fundo do menu
  // (fechando-o) ou abriria o filme. No computador (e no toque longo do
  // Android, que vira "contextmenu"), o botão direito faz o mesmo.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
  let _lpTimer = null;
  let _lpStart = null;
  let _lpFired = false;
  let _lpSuppressClickUntil = 0;

  function cancelLongPress() {
    clearTimeout(_lpTimer);
    _lpTimer = null;
    _lpStart = null;
  }

  document.addEventListener("touchstart", e => {
    const card = e.target.closest("[data-lp]");
    if (!card || e.touches.length !== 1) return;
    _lpStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    _lpFired = false;
    clearTimeout(_lpTimer);
    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      _lpFired = true;
      if (navigator.vibrate) navigator.vibrate(12);
      openCardActions(card);
    }, LONG_PRESS_MS);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!_lpStart || !_lpTimer) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - _lpStart.x) > LONG_PRESS_MOVE_TOLERANCE_PX
      || Math.abs(t.clientY - _lpStart.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      cancelLongPress(); // arrastou: é rolagem, não toque longo
    }
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (_lpFired) {
      _lpSuppressClickUntil = Date.now() + 450;
      _lpFired = false;
    }
    cancelLongPress();
  }, { passive: true });
  document.addEventListener("touchcancel", cancelLongPress, { passive: true });

  document.addEventListener("click", e => {
    if (Date.now() < _lpSuppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      _lpSuppressClickUntil = 0;
    }
  }, true);

  document.addEventListener("contextmenu", e => {
    const card = e.target.closest("[data-lp]");
    if (!card) return;
    e.preventDefault();
    if (!document.getElementById("action-sheet").classList.contains("hidden")) return;
    openCardActions(card);
  });

  document.getElementById("action-sheet-actions").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (btn) runCardAction(btn.dataset.action);
  });
  document.getElementById("action-sheet-cancel").addEventListener("click", closeCardActions);
  document.getElementById("action-sheet").addEventListener("click", e => {
    if (e.target.id === "action-sheet") closeCardActions();
  });
```

E no handler de `Escape` (keydown), acrescentar `closeCardActions();`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vod/card-actions.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html tests/vod/card-actions.test.js
git commit -m "feat(cards): long-press menu to remove recents and manage Minha Lista"
```

---

### Task 10: Tela cheia nova — em pé, girar, controles que somem e bloqueio (pontos 1 e 10)

**Files:**
- Modify: `sintoniza-link.html` (CSS do `pseudo-fullscreen`/`fs-overlay`, markup `.fs-overlay-controls` → `.fs-ui` + `.fs-lock-shield`, JS de tela cheia, seek, `showPlayerError`, `updateVodSeekVisibility`, `renderPlayerInfo`)
- Create: `tests/player/fullscreen-layout.test.js`
- Modify: `tests/player/player-markup.test.js`

- [ ] **Step 1: Escrever os testes que falham**

```js
// tests/player/fullscreen-layout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

test("abre em pé, sem giro, com o botão de deitar", () => {
  const l = loadVodHelpers().computeFsLayout({ wantLandscape: false, viewportLandscape: false, nativeOrientation: false });
  assert.deepEqual(l, { cssRotate: false, showRotateBtn: true, rotateIcon: "rectangle-horizontal" });
});

test("sem plugin nativo, deitar gira o player via CSS", () => {
  const l = loadVodHelpers().computeFsLayout({ wantLandscape: true, viewportLandscape: false, nativeOrientation: false });
  assert.deepEqual(l, { cssRotate: true, showRotateBtn: true, rotateIcon: "rectangle-vertical" });
});

test("com plugin nativo, deitar nunca usa o giro via CSS", () => {
  const l = loadVodHelpers().computeFsLayout({ wantLandscape: true, viewportLandscape: false, nativeOrientation: true });
  assert.equal(l.cssRotate, false);
});

test("aparelho já na horizontal: sem giro via CSS; sem plugin, não dá para forçar a vertical", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.computeFsLayout({ wantLandscape: false, viewportLandscape: true, nativeOrientation: false }), { cssRotate: false, showRotateBtn: false, rotateIcon: "rectangle-vertical" });
  assert.equal(ctx.computeFsLayout({ wantLandscape: true, viewportLandscape: true, nativeOrientation: true }).showRotateBtn, true);
});
```

Acrescentar em `tests/player/player-markup.test.js`:

```js
test("tela cheia tem linha do tempo, ±10s, girar, bloquear e sair", () => {
  for (const id of ["fs-ui", "fs-seek-bar", "fs-skip-back-btn", "fs-skip-fwd-btn", "fs-play-btn", "fs-rotate-btn", "fs-fit-btn", "fs-lock-btn", "fs-exit-btn", "fs-lock-shield", "fs-unlock-btn"]) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" não existe`);
  }
  assert.match(html, /Toque no cadeado para desbloquear/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/fullscreen-layout.test.js tests/player/player-markup.test.js`
Expected: FAIL (`computeFsLayout is not a function`; `id="fs-ui" não existe`).

- [ ] **Step 3: Markup**

Trocar o `<div class="fs-overlay-controls" …>…</div>` (e o comentário acima dele) por:

```html
      <!-- Controles da tela cheia (app nativo, pontos 1 e 10 da v6): somem
           após 5s sem toque; um toque na tela traz de volta. -->
      <div class="fs-ui" id="fs-ui">
        <div class="fs-top">
          <p class="fs-title" id="fs-title"></p>
          <button class="fs-btn" id="fs-lock-btn" aria-label="Bloquear a tela"><i data-lucide="lock" style="width:20px;height:20px"></i></button>
          <button class="fs-btn" id="fs-exit-btn" aria-label="Sair da tela cheia"><i data-lucide="minimize" style="width:20px;height:20px"></i></button>
        </div>
        <div class="fs-center">
          <button class="fs-btn fs-btn-lg fs-vod-only" id="fs-skip-back-btn" aria-label="Voltar 10 segundos">
            <svg class="skip-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><text x="12" y="15.5">10</text></svg>
          </button>
          <button class="fs-btn fs-btn-xl" id="fs-play-btn" aria-label="Reproduzir/Pausar"><i data-lucide="pause" id="fs-play-icon" style="width:30px;height:30px"></i></button>
          <button class="fs-btn fs-btn-lg fs-vod-only" id="fs-skip-fwd-btn" aria-label="Adiantar 10 segundos">
            <svg class="skip-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><text x="12" y="15.5">10</text></svg>
          </button>
        </div>
        <div class="fs-bottom">
          <div class="fs-seek fs-vod-only">
            <span class="fs-time" id="fs-seek-current">0:00</span>
            <input type="range" class="vod-seek-bar" id="fs-seek-bar" min="0" max="100" value="0" step="0.1" aria-label="Progresso do vídeo" />
            <span class="fs-time" id="fs-seek-duration">0:00</span>
          </div>
          <div class="fs-actions">
            <button class="fs-btn" id="fs-fit-btn" aria-label="Preencher a tela"><i data-lucide="expand" style="width:20px;height:20px"></i></button>
            <button class="fs-btn" id="fs-rotate-btn" aria-label="Girar para a horizontal"><i data-lucide="rectangle-horizontal" style="width:20px;height:20px"></i></button>
          </div>
        </div>
      </div>
      <!-- Tela bloqueada: engole todos os toques. Um toque mostra o cadeado e
           a instrução de como desbloquear por alguns segundos. -->
      <div class="fs-lock-shield" id="fs-lock-shield">
        <div class="fs-lock-hint" id="fs-lock-hint">
          <button class="fs-btn fs-btn-lg" id="fs-unlock-btn" aria-label="Desbloquear a tela"><i data-lucide="lock-open" style="width:24px;height:24px"></i></button>
          <p>Tela bloqueada. Toque no cadeado para desbloquear.</p>
        </div>
      </div>
```

- [ ] **Step 4: CSS**

Substituir tudo de `/* Tela cheia "de mentira" …` até o fim de `.fs-overlay-btn { … }` por:

```css
    /* ── Tela cheia do app nativo (pontos 1 e 10 da v6) ──
       Feita em CSS (sem a Fullscreen API, que no iOS mostra o aviso
       "capacitor://localhost is in full screen"). Cobre a tela inteira,
       inclusive a área da barra de status. Abre em pé; o botão de girar
       deita. Sem o plugin nativo de orientação, o player inteiro (vídeo +
       controles) é girado 90° via CSS. */
    #player-screen.pseudo-fullscreen {
      position: fixed; inset: 0; z-index: 9999; background: #000;
      margin: 0; border-radius: 0; box-shadow: none;
    }
    #player-screen.pseudo-fullscreen .player-controls,
    #player-screen.pseudo-fullscreen .vod-seek-row {
      display: none !important;
    }
    #player-screen.pseudo-fullscreen .player-media { min-height: 0; background: #000; }
    #player-screen.pseudo-fullscreen.rotated {
      inset: auto; top: 50%; left: 50%;
      width: 100vh; height: 100vw;
      transform: translate(-50%, -50%) rotate(90deg);
    }
    body.fs-open { overflow: hidden; }
    .fs-ui, .fs-lock-shield { display: none; }
    #player-screen.pseudo-fullscreen .fs-ui {
      position: absolute; inset: 0; z-index: 8;
      display: flex; flex-direction: column; justify-content: space-between;
      padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
               max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      background: linear-gradient(to bottom, oklch(0 0 0 / 55%), transparent 25%, transparent 70%, oklch(0 0 0 / 65%));
      opacity: 0; transition: opacity 220ms; touch-action: none;
    }
    /* Girado via CSS: o entalhe fica à esquerda e a barra de início à
       direita de quem assiste. */
    #player-screen.pseudo-fullscreen.rotated .fs-ui {
      padding: 1rem max(1rem, env(safe-area-inset-bottom)) 1rem max(1rem, env(safe-area-inset-top));
    }
    #player-screen.pseudo-fullscreen .fs-ui.visible { opacity: 1; }
    /* Escondidos, os botões não recebem toque; só a camada, que traz tudo de volta. */
    .fs-ui:not(.visible) .fs-btn, .fs-ui:not(.visible) input { pointer-events: none; }
    .fs-top, .fs-center, .fs-actions { display: flex; align-items: center; gap: .75rem; }
    .fs-title {
      flex: 1; min-width: 0; color: oklch(0.98 0 0); font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .fs-center { justify-content: center; gap: 2.5rem; }
    .fs-bottom { display: flex; align-items: center; gap: 1rem; }
    .fs-seek { flex: 1; min-width: 0; display: flex; align-items: center; gap: .6rem; }
    .fs-time {
      color: oklch(0.9 0.01 75); font-size: .8rem; min-width: 2.75rem;
      text-align: center; font-variant-numeric: tabular-nums;
    }
    .fs-actions { margin-left: auto; }
    .fs-btn {
      width: 2.75rem; height: 2.75rem; border-radius: 999px; border: none; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: oklch(0.1 0.01 65 / 55%); color: oklch(0.98 0 0);
      backdrop-filter: blur(8px);
    }
    .fs-btn-lg { width: 3.5rem; height: 3.5rem; }
    .fs-btn-lg .skip-icon { width: 30px; height: 30px; }
    .fs-btn-xl { width: 4.5rem; height: 4.5rem; background: var(--primary); color: var(--primary-fg); }
    #player-screen:not(.is-vod) .fs-vod-only { display: none !important; }
    #player-screen.pseudo-fullscreen.fs-locked .fs-ui { display: none; }
    #player-screen.pseudo-fullscreen.fs-locked .fs-lock-shield {
      position: absolute; inset: 0; z-index: 9; touch-action: none;
      display: flex; align-items: center; justify-content: center;
    }
    .fs-lock-hint {
      display: flex; flex-direction: column; align-items: center; gap: .75rem;
      max-width: 16rem; padding: 1rem 1.25rem; border-radius: 1rem;
      background: oklch(0.1 0.01 65 / 70%); color: oklch(0.98 0 0);
      font-size: .9rem; text-align: center;
      opacity: 0; transition: opacity 200ms; pointer-events: none;
    }
    .fs-lock-hint.visible { opacity: 1; pointer-events: auto; }
```

- [ ] **Step 5: JS**

5a. Substituir `let fsControlsHideTimer…` + `showFsControls` + `enterPseudoFullscreen` + `exitPseudoFullscreen` por:

```js
// ─── Tela cheia do app nativo (pontos 1 e 10 da v6) ───
// Abre em pé; o botão de girar deita o vídeo. Com o plugin oficial
// @capacitor/screen-orientation instalado, quem gira é o próprio sistema (e
// o iOS esconde a barra de status sozinho na horizontal). Sem ele, o player
// inteiro gira via CSS. Com @capacitor/status-bar instalado, a barra de
// status também some na tela cheia em pé. Os controles somem após 5s sem
// toque, e o cadeado bloqueia os toques até ser desbloqueado.
const FS_CONTROLS_HIDE_MS = 5000;
const FS_LOCK_HINT_MS = 3000;
const FS_DOUBLE_TAP_MS = 350;
const _fs = { wantLandscape: false, locked: false, hideTimer: null, hintTimer: null, lastTapTs: 0 };

function isNativePluginAvailable(pluginName) {
  const cap = window.Capacitor;
  if (!cap || !isNativeApp()) return false;
  if (typeof cap.isPluginAvailable === "function") return cap.isPluginAvailable(pluginName);
  return Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some(h => h.name === pluginName);
}

// Chama um método de plugin nativo do Capacitor, se ele estiver instalado.
// Devolve a Promise da chamada, ou null quando o plugin não existe; nesse
// caso quem chamou segue pelo caminho alternativo.
function callNativePlugin(pluginName, method, options) {
  if (!isNativePluginAvailable(pluginName)) return null;
  const cap = window.Capacitor;
  try {
    if (typeof cap.nativePromise === "function") return cap.nativePromise(pluginName, method, options || {});
    const plugin = cap.Plugins && cap.Plugins[pluginName];
    if (plugin && typeof plugin[method] === "function") return plugin[method](options || {});
  } catch (e) {
    console.warn(`[native] ${pluginName}.${method} falhou:`, e);
  }
  return null;
}

// Como montar a tela cheia a cada mudança (girar, ou o aparelho girar
// sozinho com a rotação automática ligada).
function computeFsLayout({ wantLandscape, viewportLandscape, nativeOrientation }) {
  if (viewportLandscape) {
    return { cssRotate: false, showRotateBtn: nativeOrientation, rotateIcon: "rectangle-vertical" };
  }
  if (wantLandscape && !nativeOrientation) {
    return { cssRotate: true, showRotateBtn: true, rotateIcon: "rectangle-vertical" };
  }
  return { cssRotate: false, showRotateBtn: true, rotateIcon: wantLandscape ? "rectangle-vertical" : "rectangle-horizontal" };
}

function applyFsLayout() {
  const el = document.getElementById("player-screen");
  if (!el.classList.contains("pseudo-fullscreen")) return;
  const layout = computeFsLayout({
    wantLandscape: _fs.wantLandscape,
    viewportLandscape: window.innerWidth > window.innerHeight,
    nativeOrientation: isNativePluginAvailable("ScreenOrientation"),
  });
  el.classList.toggle("rotated", layout.cssRotate);
  const rotateBtn = document.getElementById("fs-rotate-btn");
  rotateBtn.style.display = layout.showRotateBtn ? "" : "none";
  rotateBtn.innerHTML = `<i data-lucide="${layout.rotateIcon}" style="width:20px;height:20px"></i>`;
  rotateBtn.setAttribute("aria-label", layout.rotateIcon === "rectangle-vertical" ? "Voltar para a vertical" : "Girar para a horizontal");
  lucide.createIcons();
}

function showFsControls() {
  const ui = document.getElementById("fs-ui");
  ui.classList.add("visible");
  clearTimeout(_fs.hideTimer);
  const video = document.getElementById("player-video");
  // Filme pausado: os controles ficam na tela, como nos apps de streaming.
  if (video.paused && _state.selected && _state.selected.isVod) return;
  _fs.hideTimer = setTimeout(() => ui.classList.remove("visible"), FS_CONTROLS_HIDE_MS);
}

function hideFsControls() {
  clearTimeout(_fs.hideTimer);
  document.getElementById("fs-ui").classList.remove("visible");
}

function setFsLocked(locked) {
  _fs.locked = locked;
  document.getElementById("player-screen").classList.toggle("fs-locked", locked);
  clearTimeout(_fs.hintTimer);
  document.getElementById("fs-lock-hint").classList.remove("visible");
  if (locked) hideFsControls();
}

// Mostra o cadeado + a instrução de desbloqueio por alguns segundos.
function flashFsLockHint() {
  const hint = document.getElementById("fs-lock-hint");
  hint.classList.add("visible");
  clearTimeout(_fs.hintTimer);
  _fs.hintTimer = setTimeout(() => hint.classList.remove("visible"), FS_LOCK_HINT_MS);
}

function syncFsFitButton() {
  const fit = document.getElementById("player-video").style.objectFit || "contain";
  const filling = fit !== "contain";
  const btn = document.getElementById("fs-fit-btn");
  btn.innerHTML = `<i data-lucide="${filling ? "shrink" : "expand"}" style="width:20px;height:20px"></i>`;
  btn.setAttribute("aria-label", filling ? "Mostrar o vídeo inteiro" : "Preencher a tela");
  lucide.createIcons();
}

// Alterna entre vídeo inteiro (com faixas pretas) e tela preenchida.
function toggleFsFit() {
  const video = document.getElementById("player-video");
  const next = (video.style.objectFit || "contain") === "contain" ? "cover" : "contain";
  video.style.objectFit = next;
  localStorage.setItem(LS.FIT, next);
  document.getElementById("fit-select").value = next;
  syncFsFitButton();
}

function enterPseudoFullscreen() {
  const el = document.getElementById("player-screen");
  if (_state.section !== "settings" && !el.classList.contains("mini-player")) lockPlayerAnchor();
  _fs.wantLandscape = false;
  setFsLocked(false);
  el.classList.add("pseudo-fullscreen");
  document.body.classList.add("fs-open");
  document.getElementById("fs-title").textContent = _state.selected ? _state.selected.name : "";
  callNativePlugin("StatusBar", "hide");
  applyFsLayout();
  setPlayerMode();
  syncFsFitButton();
  showFsControls();
}

function exitPseudoFullscreen() {
  const el = document.getElementById("player-screen");
  setFsLocked(false);
  hideFsControls();
  el.classList.remove("pseudo-fullscreen", "rotated");
  document.body.classList.remove("fs-open");
  // Com o plugin, devolve o app para a vertical (a interface do app não
  // foi desenhada para a horizontal no celular).
  if (_fs.wantLandscape) callNativePlugin("ScreenOrientation", "lock", { orientation: "portrait" });
  _fs.wantLandscape = false;
  callNativePlugin("StatusBar", "show");
  setPlayerMode();
  scheduleDockingUpdate();
}

function toggleFsRotation() {
  _fs.wantLandscape = !_fs.wantLandscape;
  callNativePlugin("ScreenOrientation", "lock", { orientation: _fs.wantLandscape ? "landscape" : "portrait" });
  applyFsLayout();
}
```

5b. Seek em um lugar só (barra normal + barra da tela cheia). Depois de `formatSeekTime`:

```js
function syncSeekUi(video) {
  if (!isFinite(video.duration) || video.duration <= 0) return;
  const pct = (video.currentTime / video.duration) * 100;
  const cur = formatSeekTime(video.currentTime);
  const dur = formatSeekTime(video.duration);
  [["vod-seek-bar", "vod-seek-current", "vod-seek-duration"], ["fs-seek-bar", "fs-seek-current", "fs-seek-duration"]].forEach(([barId, curId, durId]) => {
    document.getElementById(barId).value = pct;
    document.getElementById(curId).textContent = cur;
    document.getElementById(durId).textContent = dur;
  });
}

function seekToPercent(pct) {
  const video = document.getElementById("player-video");
  if (!isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = (pct / 100) * video.duration;
}

function skipBy(seconds) {
  const video = document.getElementById("player-video");
  if (!isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds));
}
```

No boot: o `timeupdate` da seek bar passa a só chamar `syncSeekUi(document.getElementById("player-video"));`. O `input` de `vod-seek-bar` chama `seekToPercent(Number(e.target.value))`. Os botões `vod-skip-back-btn`/`vod-skip-fwd-btn` chamam `skipBy(-10)`/`skipBy(10)`.

5c. `updateVodSeekVisibility()`: acrescentar `document.getElementById("player-screen").classList.toggle("is-vod", isVod);`. Em `renderPlayerInfo()`, depois de `player-name`: `document.getElementById("fs-title").textContent = ch.name;`.

5d. `showPlayerError`: na primeira linha,

```js
  // Erro na tela cheia: sai dela (e destrava), para o "Tentar novamente"
  // ficar alcançável.
  if (document.getElementById("player-screen").classList.contains("pseudo-fullscreen")) {
    exitPseudoFullscreen();
    updateFullscreenBtnIcon();
  }
```

5e. Boot: remover o listener antigo de `#player-screen` que chamava `showFsControls()` e o listener antigo de `fs-exit-btn`. Acrescentar:

```js
  // ── TELA CHEIA (pontos 1 e 10 da v6) ──
  // Toque na camada: mostra/esconde os controles. Dois toques: sai.
  document.getElementById("fs-ui").addEventListener("click", e => {
    if (e.target.closest("button, input")) { showFsControls(); return; } // mexeu num controle: mantém visível
    const now = Date.now();
    if (now - _fs.lastTapTs < FS_DOUBLE_TAP_MS) {
      _fs.lastTapTs = 0;
      toggleFullscreen();
      return;
    }
    _fs.lastTapTs = now;
    if (document.getElementById("fs-ui").classList.contains("visible")) hideFsControls();
    else showFsControls();
  });
  document.getElementById("fs-exit-btn").addEventListener("click", e => { e.stopPropagation(); toggleFullscreen(); });
  document.getElementById("fs-lock-btn").addEventListener("click", e => { e.stopPropagation(); setFsLocked(true); flashFsLockHint(); });
  document.getElementById("fs-rotate-btn").addEventListener("click", toggleFsRotation);
  document.getElementById("fs-fit-btn").addEventListener("click", toggleFsFit);
  document.getElementById("fs-play-btn").addEventListener("click", togglePlayPause);
  document.getElementById("fs-skip-back-btn").addEventListener("click", () => skipBy(-10));
  document.getElementById("fs-skip-fwd-btn").addEventListener("click", () => skipBy(10));
  document.getElementById("fs-seek-bar").addEventListener("input", e => { seekToPercent(Number(e.target.value)); showFsControls(); });
  // Tela bloqueada: só o cadeado desbloqueia; qualquer outro toque mostra a instrução.
  document.getElementById("fs-lock-shield").addEventListener("click", e => {
    e.stopPropagation();
    if (e.target.closest("#fs-unlock-btn")) { setFsLocked(false); showFsControls(); return; }
    flashFsLockHint();
  });
  // Girou o aparelho (ou o plugin girou): reaplica o layout da tela cheia.
  window.addEventListener("resize", applyFsLayout);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test tests/player/fullscreen-layout.test.js tests/player/player-markup.test.js` e a suíte do app.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sintoniza-link.html tests/player/fullscreen-layout.test.js tests/player/player-markup.test.js
git commit -m "feat(fullscreen): portrait first, rotate button, auto-hiding controls with timeline, and screen lock"
```

---

### Task 11: Regenerar o `www/` e verificação final

**Files:**
- Modify: `www/index.html` (gerado)

- [ ] **Step 1:** `node scripts/prepare-mobile.js`. Expected: `[prepare-mobile] sintoniza-link.html -> www/index.html`.
- [ ] **Step 2:** Suíte do app. Expected: todos PASS (75 originais + os novos).
- [ ] **Step 3:** Checar que nada órfão sobrou: `grep -n "enableLiveBar\|applyVolume\|vod-hero\|fs-overlay\|showFsControls()\|_vodHeroVisibleBeforeSearch\|sticky-search-container" sintoniza-link.html`. Expected: nenhuma linha (exceto `showFsControls` definido/usado pelo código novo).
- [ ] **Step 4:** Commit.

```bash
git add www/index.html
git commit -m "chore: regenerate www/index.html for v6"
```

- [ ] **Step 5 (depende do Gustavo):** push da branch `v6` e disparo do workflow "Build Android APK e iOS IPA" (Actions → Run workflow → branch `v6`) para gerar o IPA e o APK de teste.

---

### Task 12 (CONDICIONADA — só com autorização explícita do Gustavo): plugins nativos de orientação e barra de status

Sem esta task, a tela cheia deitada é girada via CSS e a barra de status do iOS continua visível (parte do ponto 1). Com ela, o giro é o do próprio sistema, a barra de status some e o código da Task 10 passa a usar os plugins sozinho, sem nenhuma outra mudança.

- [ ] **Step 1:** `npm install @capacitor/screen-orientation@^8 @capacitor/status-bar@^8` (plugins oficiais do Capacitor; mudam `package.json` e `package-lock.json`).
- [ ] **Step 2:** `npx cap sync`. Atualiza `ios/App/CapApp-SPM/Package.swift` e `android/capacitor.settings.gradle`/`android/app/capacitor.build.gradle`; o CI também roda o sync antes de compilar.
- [ ] **Step 3:** Commit `feat(mobile): add official screen-orientation and status-bar plugins`.
- [ ] **Step 4:** Gerar o IPA e testar no iPhone: botão de girar → o sistema gira de verdade e a barra de status some; sair → volta para a vertical.

---

## Roteiro de teste no iPhone (depois do IPA da v6)

1. **Controles:** filme/série mostram só ±10s (com "10" legível), play/pause, recarregar, enquadramento e tela cheia. Canais mostram o mesmo, sem os de ±10s.
2. **Erro de reprodução:** trocar de filme várias vezes seguidas. O loader mostra "Servidor ocupado, tentando de novo (n/6)" em vez de erro. Se falhar de vez, a tela mostra o motivo e o código em letra pequena.
3. **Pausar filme** e dar play: continua do mesmo ponto. "Continue Assistindo" retoma de onde parou.
4. **Início:** só Minha Lista (se tiver) + recém-assistidos em grade de 3, com capa da série e título "Série · T1E3".
5. **Busca:** ao rolar Canais/Filmes/Séries, a caixa sobe e se encaixa entre o menu e o sininho.
6. **Player nas 5 abas:** filme e episódio tocam na própria aba. Ao rolar com algo tocando, aparece o mini-player legível; tocar nele volta ao topo.
7. **Segurar** num cartão: menu com Minha Lista / Remover dos recentes. O botão "Minha Lista" no modal alterna o estado.
8. **Tela cheia:** duplo toque abre em pé. O botão de girar deita. Os controles somem em 5s e voltam com um toque. O cadeado bloqueia, e um toque mostra "Toque no cadeado para desbloquear". Dois toques na tela saem da tela cheia.
