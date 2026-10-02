# Celular v10: correções de interface e aba Favoritos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corrigir os problemas relatados no teste em Android (retângulo da tela de reprodução, realce quadrado nos botões de pular 10 s, duplo toque para tela cheia, player que não volta depois da janela flutuante, tela cheia que não gira) e fazer a aba Favoritos mostrar Canais, Filmes e Séries.

**Architecture:** o app inteiro é o arquivo `sintoniza-link.html` (6.738 linhas; CSS, HTML e JavaScript embutidos). Regras de decisão ficam em **funções puras** no script principal, testadas pelo carregador `tests/vod/loadVodHelpers.js` (que só enxerga as funções listadas em `PURE_HELPER_NAMES`). O resto é fiado ao DOM e conferido no Chrome sem janela pela ferramenta `scripts/dev/cdp.mjs` (Task 0).

**Tech Stack:** HTML/CSS/JS puro, Capacitor 7 (Android e iOS), `node:test`, Chrome via DevTools Protocol.

Branch: `v10` do repositório `visual-craft-assistant` (a partir da `v9`). **Nunca na `main`.** Suíte de base: 199 testes passando (`npm test`).

> ⚠️ **Edição do HTML:** o arquivo fica em CRLF (`core.autocrlf=true`). **Não use `sed -i`**: converte para LF e quebra o teste que compara o bloco `epg-helpers` byte a byte com `sintoniza-tv.html`. Use a ferramenta de edição ou um script Node que preserve o fim de linha. Depois de cada tarefa rode `npm test`. Ao digitar `\u0300` numa regex, confira com `grep -c` que não virou o caractere literal.

---

## Diagnóstico (relato do Gustavo × causa encontrada no código)

| # | Relato (Android) | Causa |
|---|---|---|
| 1 | O retângulo da tela de reprodução aparece ao abrir o app, sem nada tocando | `computePlayerMode` (linha ~4415) devolve `"full"` quando não há mídia ativa: o player grande fica sempre à mostra. `_state.selected` começa `null` e o "fechar" do mini-player volta a `null`, então **"nada selecionado" é o critério certo** (pausar um canal ao vivo mantém a seleção e o botão de retomar precisa continuar visível). |
| 2 | Os botões de pular 10 s "marcam como um ícone quadrado" ao tocar | Nenhum `-webkit-tap-highlight-color` no arquivo (o Android desenha o retângulo padrão), e o `.ctrl-btn` tem `border-radius: .4rem` com `:hover` que **gruda no toque** (fundo quadrado depois do toque). |
| 3 | Dois toques na tela de reprodução não abrem a tela cheia (sair funciona) | Entrar depende de dois `click` no `<video>` (linhas ~6184–6194), que no Android fica coberto por camadas; sair usa a camada `#fs-ui`, que funciona. Também há um `dblclick` redundante que, ao ser corrigido, tocaria duas vezes e se cancelaria. |
| 4 | Depois de minimizar (janela flutuante) e voltar, só fica a barra do mini-player | Dentro da janela flutuante o player fica `position: fixed` e a âncora colapsa: `updateDocking` mede "player fora da tela" e liga o mini-player. Ao sair do PiP **não chega nenhum evento de rolagem/redimensionamento depois de `pip-active` ser removido**, então o estado de mini fica preso (tocar na barra rola para o topo, que já estava no topo: nenhum evento). |
| 5 | Em tela cheia o Android não gira com a rotação automática ligada (o iPhone gira) | O manifesto não define `screenOrientation`, e o app só chama o plugin para **travar** (`lock`), nunca para liberar: depois de usar o botão de girar a orientação fica presa em retrato. No iOS o `Info.plist` já libera as três orientações. **Não foi possível testar em aparelho Android real**; a correção libera o sensor explicitamente e deve ser confirmada pelo Gustavo. |

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `scripts/dev/cdp.mjs` | Criar (Task 0) | Abre uma página no Chrome sem janela e permite medir, tocar e tirar captura |
| `sintoniza-link.html` | Modificar (Tasks 1–7) | App inteiro |
| `tests/vod/loadVodHelpers.js` | Modificar | Lista `PURE_HELPER_NAMES` das funções puras novas |
| `tests/player/player-mode.test.js` | Modificar (Task 1/4) | Regra do retângulo e da medida "rolou para longe" |
| `tests/player/touch-feedback.test.js` | Criar (Task 2) | CSS do toque e dos botões redondos |
| `tests/player/double-tap.test.js` | Criar (Task 3) | Duplo toque |
| `tests/player/fullscreen-orientation.test.js` | Criar (Task 5) | Orientação em tela cheia |
| `tests/vod/favorites-kind.test.js` | Criar (Task 6) | Favoritos de filmes e séries |
| `android/app/src/main/AndroidManifest.xml` | Modificar (Task 5) | `screenOrientation="fullUser"` |
| `.github/workflows/build-mobile-v10.yml` | Criar (Task 8) | Build do IPA/APK da `v10` |

---

### Task 0: Ferramenta de verificação no Chrome

**Files:**
- Create: `scripts/dev/cdp.mjs`

- [ ] **Step 1: Criar a ferramenta**

```js
// Verificação em desenvolvimento: abre uma página no Chrome (sem janela), controla por DevTools (CDP),
// mede o DOM, simula toques e tira captura. Não faz parte do app nem do build.
// Uso:  import { withPage } from "./cdp.mjs";  await withPage(url, { native: true }, async (page) => { ... });
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {{width?:number,height?:number,native?:boolean,preScript?:string}} opts
 *   native: simula o app Capacitor (window.Capacitor.isNativePlatform() = true)
 *   preScript: JS que roda antes da página (ex.: fingir plugins nativos)
 */
export async function withPage(url, opts, fn) {
  const { width = 390, height = 844, native = false, preScript = "" } = opts || {};
  const port = 9333 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), "sint-cdp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, "--autoplay-policy=no-user-gesture-required",
    "--no-first-run", "--disable-gpu", "about:blank",
  ], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = list.find((t) => t.type === "page");
      } catch (e) { /* Chrome ainda abrindo */ }
    }
    if (!target) throw new Error("O Chrome não abriu (confira a variável CHROME).");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    const nativeStub = native ? "window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false, getPlatform: () => 'android' };" : "";
    if (nativeStub || preScript) await send("Page.addScriptToEvaluateOnNewDocument", { source: nativeStub + preScript });
    await send("Page.navigate", { url });
    await sleep(2500); // fontes, CDN e boot do app
    const page = {
      send,
      sleep,
      async eval(expression) {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || "erro na página");
        return r.result.result.value;
      },
      // Toque real (gera touchstart/touchend, pointerup e click)
      async tap(x, y) {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      },
      async screenshot(file) {
        const r = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(file, Buffer.from(r.result.data, "base64"));
      },
    };
    return await fn(page);
  } finally {
    chrome.kill();
  }
}
```

- [ ] **Step 2: Conferir que abre e mede**

Run: `node -e "import('./scripts/dev/cdp.mjs').then(async ({withPage}) => { const {pathToFileURL}=await import('node:url'); await withPage(pathToFileURL('sintoniza-link.html').href, {native:true}, async (p) => console.log(await p.eval('document.title'), await p.eval('typeof lucide'))); })"`
Expected: imprime o título da página e `object` (os ícones carregaram da internet).

- [ ] **Step 3: Commit**

```bash
git add scripts/dev/cdp.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "chore(dev): ferramenta de verificação no Chrome (CDP) para o app de celular"
```

---

### Task 1: Esconder o retângulo da tela de reprodução quando nada está selecionado

**Files:**
- Modify: `sintoniza-link.html` (`computePlayerMode` ~4415, `setPlayerMode` ~4459, `updateDocking` ~4482)
- Modify: `tests/vod/loadVodHelpers.js` (`PURE_HELPER_NAMES`)
- Test: `tests/player/player-mode.test.js`

- [ ] **Step 1: Ajustar os testes (devem falhar com o código atual)**

Em `tests/player/player-mode.test.js`, **substituir** os dois primeiros testes (`player fica grande em todas as abas enquanto está visível`, `vira mini-player só com algo tocando e o player fora da tela`), o de Configurações e o de tela cheia por estes (todas as chamadas passam a levar `hasSelection`):

```js
test("player fica grande em todas as abas enquanto há algo selecionado", () => {
  const ctx = loadVodHelpers();
  for (const section of ["catalog", "vod"]) {
    assert.equal(ctx.computePlayerMode({ section, hasSelection: true, hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "full");
    // canal ao vivo pausado: continua visível para dar para retomar
    assert.equal(ctx.computePlayerMode({ section, hasSelection: true, hasActiveMedia: false, playerScrolledAway: true, isFullscreen: false }), "full");
  }
});

test("sem nada selecionado o retângulo da tela de reprodução não aparece em aba nenhuma", () => {
  const ctx = loadVodHelpers();
  for (const section of ["catalog", "vod", "downloads", "settings"]) {
    for (const playerScrolledAway of [false, true]) {
      assert.equal(ctx.computePlayerMode({ section, hasSelection: false, hasActiveMedia: false, playerScrolledAway, isFullscreen: false }), "hidden");
    }
  }
});

test("vira mini-player só com algo tocando e o player fora da tela", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "vod", hasSelection: true, hasActiveMedia: true, playerScrolledAway: true, isFullscreen: false }), "mini");
});

test("em Configurações nunca fica grande", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasSelection: true, hasActiveMedia: true, playerScrolledAway: false, isFullscreen: false }), "mini");
  assert.equal(ctx.computePlayerMode({ section: "settings", hasSelection: true, hasActiveMedia: false, playerScrolledAway: false, isFullscreen: false }), "hidden");
});

test("tela cheia sempre vence", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computePlayerMode({ section: "settings", hasSelection: true, hasActiveMedia: true, playerScrolledAway: true, isFullscreen: true }), "full");
});

test("a medida 'player fora da tela' só vale com algo selecionado", () => {
  const ctx = loadVodHelpers();
  // sem seleção não há o que minimizar (a âncora está vazia e mediria sempre "fora")
  assert.equal(ctx.computeScrolledAway({ hasSelection: false, pipActive: false, anchorBottom: 0, topbarBottom: 100, previous: true }), false);
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: false, anchorBottom: 140, topbarBottom: 100, previous: false }), true);
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: false, anchorBottom: 300, topbarBottom: 100, previous: true }), false);
});

test("dentro da janela flutuante a medida não muda (o layout lá é outro)", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: true, anchorBottom: 0, topbarBottom: 100, previous: false }), false);
  assert.equal(ctx.computeScrolledAway({ hasSelection: true, pipActive: true, anchorBottom: 300, topbarBottom: 100, previous: true }), true);
});
```

Em `tests/vod/loadVodHelpers.js`, na lista `PURE_HELPER_NAMES`, acrescentar `"computeScrolledAway"` junto de `"computePlayerMode", "isPlayerScrolledAway", "shouldDockSearch",`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/player-mode.test.js`
Expected: FAIL (`sem nada selecionado...` devolve `"full"`; `computeScrolledAway is not a function`).

- [ ] **Step 3: Implementar**

Em `sintoniza-link.html`, trocar `computePlayerMode` por:

```js
function computePlayerMode({ section, hasSelection, hasActiveMedia, playerScrolledAway, isFullscreen }) {
  if (isFullscreen) return "full";
  // Nada selecionado: a área da tela de reprodução some (só volta ao escolher um canal/filme).
  // Pausar um canal ao vivo mantém a seleção, então o botão de retomar continua visível.
  if (!hasSelection) return "hidden";
  if (section === "settings") return hasActiveMedia ? "mini" : "hidden";
  return hasActiveMedia && playerScrolledAway ? "mini" : "full";
}

// Medida "o player grande saiu da tela" usada para virar mini-player.
// - sem seleção não há o que minimizar (a âncora vazia mediria sempre "fora da tela");
// - dentro da janela flutuante (PiP) o player fica fixo na janelinha e o layout é outro:
//   mantém o valor anterior em vez de medir.
function computeScrolledAway({ hasSelection, pipActive, anchorBottom, topbarBottom, previous }) {
  if (!hasSelection) return false;
  if (pipActive) return previous;
  return isPlayerScrolledAway(anchorBottom, topbarBottom);
}
```

Em `setPlayerMode()`, trocar as linhas de `hasActiveMedia` e `mode` por:

```js
  const hasSelection = !!_state.selected;
  const hasActiveMedia = !!(_state.selected && (_state.playing || _state.selected.isVod));
  if (!hasSelection) _playerScrolledAway = false; // medida velha não pode "grudar" quando o player voltar
  const mode = computePlayerMode({ section: _state.section, hasSelection, hasActiveMedia, playerScrolledAway: _playerScrolledAway, isFullscreen });
```

Em `updateDocking()`, trocar a linha `_playerScrolledAway = isPlayerScrolledAway(anchor.getBoundingClientRect().bottom, topbarBottom);` por:

```js
  _playerScrolledAway = computeScrolledAway({
    hasSelection: !!_state.selected,
    pipActive: document.body.classList.contains("pip-active"),
    anchorBottom: anchor.getBoundingClientRect().bottom,
    topbarBottom,
    previous: _playerScrolledAway,
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/player-mode.test.js && npm test`
Expected: todos passam (199 + os novos; nenhum teste antigo quebra).

- [ ] **Step 5: Conferir no Chrome**

Criar `scripts/dev/check-player-idle.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  const idle = await page.eval(`(() => { const el = document.getElementById("player-screen"); const r = el.getBoundingClientRect(); return { oculto: el.classList.contains("player-hidden"), altura: r.height }; })()`);
  console.log("sem nada selecionado:", idle);
  if (!idle.oculto || idle.altura > 0) { console.error("✖ o retângulo ainda aparece"); process.exit(1); }
  // escolhe um canal: o player grande volta
  const apos = await page.eval(`(() => { const ch = getChannels()[0]; selectChannel(ch, false); const el = document.getElementById("player-screen"); return { oculto: el.classList.contains("player-hidden"), mini: el.classList.contains("mini-player"), altura: el.getBoundingClientRect().height }; })()`);
  console.log("com canal selecionado:", apos);
  if (apos.oculto || apos.mini || apos.altura < 100) { console.error("✖ o player não voltou ao escolher um canal"); process.exit(1); }
  console.log("✔ ok");
});
```

Run: `node scripts/dev/check-player-idle.mjs`
Expected: termina com `✔ ok`. Se `getChannels()[0]` não existir, usar o primeiro canal de demonstração (`DEMO_CHANNELS[0]`).

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/vod/loadVodHelpers.js tests/player/player-mode.test.js scripts/dev/check-player-idle.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "fix(player): esconde o retângulo da tela de reprodução quando nada está selecionado"
```

---

### Task 2: Toque nos botões (sem o retângulo do Android) e botões de pular redondos

**Files:**
- Modify: `sintoniza-link.html` (CSS: após a regra `html, body` na linha ~18; regra `.ctrl-btn:hover` na linha ~342)
- Test: `tests/player/touch-feedback.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
// O toque no Android não pode desenhar o retângulo padrão em volta dos botões redondos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("o toque não desenha o retângulo padrão do Android", () => {
  assert.match(html, /\*\s*\{\s*-webkit-tap-highlight-color:\s*transparent;\s*\}/);
});

test(":hover do .ctrl-btn só vale com mouse (não gruda depois do toque)", () => {
  assert.match(html, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.ctrl-btn:hover \{/);
  assert.doesNotMatch(html, /^\s*\.ctrl-btn:hover \{/m);
});

test("os botões de pular 10 s são redondos de verdade", () => {
  assert.match(html, /#vod-skip-back-btn, #vod-skip-fwd-btn \{[^}]*border-radius: 999px/);
});

test("botões dão retorno ao toque pelo próprio formato (:active)", () => {
  assert.match(html, /\.ctrl-btn:active \{/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/touch-feedback.test.js`
Expected: FAIL nos quatro.

- [ ] **Step 3: Implementar**

Logo depois da regra `html, body { touch-action: pan-x pan-y; }` (linhas ~18–20), acrescentar:

```css
    /* Toque no celular: sem o retângulo padrão do Android em volta do botão,
       e sem o clique atrasado/duplo-toque de zoom nos controles. */
    * { -webkit-tap-highlight-color: transparent; }
    button, [role="button"], .vod-card, .channel-card, .nav-item, .mobile-tab { touch-action: manipulation; }
    button { -webkit-user-select: none; user-select: none; }
```

Trocar a linha `.ctrl-btn:hover { background: oklch(0.18 0.015 65); color: oklch(0.98 0 0); }` por:

```css
    /* :hover só com mouse: no toque ele "gruda" e deixava um fundo quadrado depois de tocar */
    @media (hover: hover) and (pointer: fine) {
      .ctrl-btn:hover { background: oklch(0.18 0.015 65); color: oklch(0.98 0 0); }
    }
    .ctrl-btn:active { background: oklch(0.18 0.015 65); color: oklch(0.98 0 0); }
    /* Pular 10 s: redondos de verdade, para o toque e o realce seguirem o círculo do ícone */
    #vod-skip-back-btn, #vod-skip-fwd-btn { width: 2.6rem; height: 2.6rem; padding: 0; border-radius: 999px; }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/touch-feedback.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Conferir o formato no Chrome**

Criar `scripts/dev/check-skip-buttons.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  const r = await page.eval(`(() => {
    const b = document.getElementById("vod-skip-back-btn");
    b.style.display = ""; // aparece só com filme; força para medir
    const cs = getComputedStyle(b);
    const box = b.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height), raio: cs.borderTopLeftRadius, toque: getComputedStyle(document.body).webkitTapHighlightColor };
  })()`);
  console.log(r);
  if (r.w !== r.h || parseFloat(r.raio) < r.w / 2) { console.error("✖ o botão de pular não é redondo"); process.exit(1); }
  console.log("✔ ok");
});
```

Run: `node scripts/dev/check-skip-buttons.mjs`
Expected: `✔ ok` (largura = altura e raio ≥ metade do lado).

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/player/touch-feedback.test.js scripts/dev/check-skip-buttons.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "fix(player): sem retângulo de toque do Android; botões de pular 10 s redondos"
```

---

### Task 3: Duplo toque na tela de reprodução abre a tela cheia

**Files:**
- Modify: `sintoniza-link.html` (função pura junto de `toggleFullscreen` ~4041; trecho "Duplo clique no vídeo = fullscreen" ~6183–6194)
- Modify: `tests/vod/loadVodHelpers.js` (`PURE_HELPER_NAMES`: `"isDoubleTap"`)
- Test: `tests/player/double-tap.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("dois toques rápidos e próximos contam como duplo toque", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.isDoubleTap({ ts: 1000, x: 100, y: 100 }, { ts: 1250, x: 108, y: 104 }), true);
});

test("primeiro toque, toque devagar ou longe não contam", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.isDoubleTap(null, { ts: 1000, x: 0, y: 0 }), false);
  assert.equal(ctx.isDoubleTap({ ts: 1000, x: 100, y: 100 }, { ts: 1600, x: 100, y: 100 }), false); // devagar
  assert.equal(ctx.isDoubleTap({ ts: 1000, x: 100, y: 100 }, { ts: 1200, x: 300, y: 100 }), false); // longe
});

test("a tela de reprodução inteira escuta o duplo toque (não só o <video>) e sobrou um único caminho", () => {
  assert.match(html, /querySelector\("#player-screen \.player-media"\)[\s\S]{0,400}addEventListener\("pointerup"/);
  assert.doesNotMatch(html, /getElementById\("player-video"\)\.addEventListener\("dblclick"/);
  assert.doesNotMatch(html, /_lastVideoTapTs/);
});
```

Em `tests/vod/loadVodHelpers.js` acrescentar `"isDoubleTap"` a `PURE_HELPER_NAMES`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/double-tap.test.js`
Expected: FAIL (`isDoubleTap is not a function`).

- [ ] **Step 3: Implementar**

Logo antes de `function toggleFullscreen()` (~linha 4041) acrescentar:

```js
// Dois toques seguidos, rápidos e perto um do outro = "duplo toque".
// prev/now: { ts (ms), x, y } (x e y em pixels da tela)
function isDoubleTap(prev, now, windowMs = 350, maxDistPx = 40) {
  if (!prev) return false;
  return now.ts - prev.ts <= windowMs && Math.hypot(now.x - prev.x, now.y - prev.y) <= maxDistPx;
}
```

Em `DOMContentLoaded`, **substituir** o bloco:

```js
  // Duplo clique no vídeo = fullscreen
  let _lastVideoTapTs = 0;
  document.getElementById("player-video").addEventListener("click", () => { ...
  });
  document.getElementById("player-video").addEventListener("dblclick", toggleFullscreen);
```

por:

```js
  // Dois toques (ou duplo clique) em qualquer ponto da tela de reprodução abrem a tela cheia.
  // Escuta a área inteira e não só o <video>: no Android o toque cai nas camadas por cima do vídeo.
  // Na tela cheia quem trata o duplo toque (para sair) é o #fs-ui; no mini-player o toque expande o player.
  const playerMedia = document.querySelector("#player-screen .player-media");
  playerMedia.style.touchAction = "manipulation";
  let _lastPlayerTap = null;
  playerMedia.addEventListener("pointerup", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const screenEl = document.getElementById("player-screen");
    if (screenEl.classList.contains("pseudo-fullscreen") || screenEl.classList.contains("mini-player")) { _lastPlayerTap = null; return; }
    if (e.target.closest("button, input, a, .player-error")) { _lastPlayerTap = null; return; } // mexeu num controle
    const tap = { ts: Date.now(), x: e.clientX, y: e.clientY };
    if (isDoubleTap(_lastPlayerTap, tap)) {
      _lastPlayerTap = null;
      toggleFullscreen();
    } else {
      _lastPlayerTap = tap;
    }
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/double-tap.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Conferir com toques reais no Chrome**

Criar `scripts/dev/check-double-tap.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false)`); // mostra o player
  await page.sleep(600);
  const box = await page.eval(`(() => { const r = document.querySelector("#player-screen .player-media").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2 - 20) }; })()`);
  await page.tap(box.x, box.y);
  await page.sleep(120);
  await page.tap(box.x + 3, box.y + 2);
  await page.sleep(500);
  const cheia = await page.eval(`document.getElementById("player-screen").classList.contains("pseudo-fullscreen")`);
  console.log("tela cheia depois de dois toques:", cheia);
  if (!cheia) { console.error("✖ não abriu a tela cheia"); process.exit(1); }
  console.log("✔ ok");
});
```

Run: `node scripts/dev/check-double-tap.mjs`
Expected: `✔ ok`.

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/vod/loadVodHelpers.js tests/player/double-tap.test.js scripts/dev/check-double-tap.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "fix(player): duplo toque na tela de reprodução abre a tela cheia (área inteira, um único caminho)"
```

---

### Task 4: Player grande volta depois da janela flutuante (PiP)

**Files:**
- Modify: `sintoniza-link.html` (handler `sintonizapip` ~6125; `visibilitychange` ~2937; nova função perto de `setPlayerMode`)
- Test: `tests/player/player-mode.test.js` (os testes de `computeScrolledAway` já foram escritos na Task 1)

- [ ] **Step 1: Escrever o teste de marcação (deve falhar)**

Acrescentar a `tests/player/player-mode.test.js`:

```js
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("ao sair da janela flutuante o app recompõe o player grande", () => {
  assert.match(html, /function restorePlayerAfterPip\(\)/);
  assert.match(html, /if \(!active\) restorePlayerAfterPip\(\);/);
});

test("ao voltar para o app (visível de novo) o player é recomposto se não estiver na janela flutuante", () => {
  assert.match(html, /visibilityState === "visible" && !document\.body\.classList\.contains\("pip-active"\)\) restorePlayerAfterPip\(\)/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/player-mode.test.js`
Expected: FAIL nos dois novos.

- [ ] **Step 3: Implementar**

Logo depois de `setPlayerMode()` acrescentar:

```js
// Saiu da janela flutuante (ou o app voltou ao primeiro plano): a medida "o player grande saiu da
// tela" foi feita com o player fixo dentro da janelinha e não vale mais. Zera, solta a âncora e mede
// de novo depois que o layout assentar (nenhum evento de rolagem/redimensionamento chega depois).
function restorePlayerAfterPip() {
  _playerScrolledAway = false;
  unlockPlayerAnchor();
  setPlayerMode();
  [60, 300, 800].forEach(ms => setTimeout(scheduleDockingUpdate, ms));
}
```

No handler `window.addEventListener("sintonizapip", ...)`, depois de `document.body.classList.toggle("pip-active", active);` acrescentar:

```js
    if (!active) restorePlayerAfterPip();
```

No handler `document.addEventListener("visibilitychange", ...)` (~2937), antes do `}` final, acrescentar:

```js
  // Voltou ao app (ex.: depois de usar outros apps com a janela flutuante): recompõe o player grande.
  if (document.visibilityState === "visible" && !document.body.classList.contains("pip-active")) restorePlayerAfterPip();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/player-mode.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Reproduzir o defeito e a correção no Chrome**

Criar `scripts/dev/check-pip-return.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false); setState({ playing: true })`);
  await page.sleep(500);
  const antes = await page.eval(`document.getElementById("player-screen").classList.contains("mini-player")`);
  // entra na janela flutuante (o Android avisa por este evento) e o layout encolhe
  await page.eval(`(() => { const e = new Event("sintonizapip"); e.active = true; window.dispatchEvent(e); window.dispatchEvent(new Event("resize")); })()`);
  await page.sleep(400);
  // sai da janela flutuante
  await page.eval(`(() => { const e = new Event("sintonizapip"); e.active = false; e.closed = false; window.dispatchEvent(e); })()`);
  await page.sleep(1200);
  const depois = await page.eval(`(() => { const el = document.getElementById("player-screen"); return { mini: el.classList.contains("mini-player"), altura: Math.round(el.getBoundingClientRect().height) }; })()`);
  console.log({ miniAntes: antes, depois });
  if (depois.mini || depois.altura < 100) { console.error("✖ o player grande não voltou depois da janela flutuante"); process.exit(1); }
  console.log("✔ ok");
});
```

Run: `node scripts/dev/check-pip-return.mjs`
Expected: `✔ ok`. (Para ver o defeito original: `git stash` das mudanças de `sintoniza-link.html` e rodar de novo; deve imprimir `✖`.)

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/player/player-mode.test.js scripts/dev/check-pip-return.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "fix(player): o player grande volta ao sair da janela flutuante (PiP)"
```

---

### Task 5: Tela cheia gira com a rotação automática no Android

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml` (atributo na `<activity>`, linha ~12)
- Modify: `sintoniza-link.html` (`enterPseudoFullscreen` ~3916, `exitPseudoFullscreen` ~3931, `toggleFsRotation` ~3946, listener `resize` ~6246; função pura nova)
- Modify: `tests/vod/loadVodHelpers.js` (`"getFsOrientationCall"`)
- Test: `tests/player/fullscreen-orientation.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");

test("entrar e sair da tela cheia liberam o sensor; só o botão de girar trava uma orientação", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "enter", wantLandscape: false }), { method: "unlock", options: {} });
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "exit", wantLandscape: true }), { method: "unlock", options: {} });
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "rotate", wantLandscape: true }), { method: "lock", options: { orientation: "landscape" } });
  assert.deepEqual(ctx.getFsOrientationCall({ phase: "rotate", wantLandscape: false }), { method: "lock", options: { orientation: "portrait" } });
});

test("a saída da tela cheia não trava mais o app em retrato", () => {
  assert.doesNotMatch(html, /callNativePlugin\("ScreenOrientation", "lock", \{ orientation: "portrait" \}\)/);
});

test("o Android respeita o 'girar automaticamente' do aparelho nas quatro posições", () => {
  assert.match(manifest, /android:screenOrientation="fullUser"/);
});
```

Em `tests/vod/loadVodHelpers.js` acrescentar `"getFsOrientationCall"` a `PURE_HELPER_NAMES`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/player/fullscreen-orientation.test.js`
Expected: FAIL nos três.

- [ ] **Step 3: Implementar**

Em `AndroidManifest.xml`, na `<activity ... android:name=".MainActivity" ...>`, acrescentar o atributo (junto de `android:launchMode`):

```xml
            android:screenOrientation="fullUser"
```

Em `sintoniza-link.html`, antes de `function enterPseudoFullscreen()`:

```js
// Orientação do aparelho (plugin nativo) na tela cheia. Entrar e sair LIBERAM o sensor (respeita o
// "girar automaticamente" do aparelho); só o botão de girar trava uma orientação. Antes, sair da tela
// cheia travava em retrato e a rotação nunca mais voltava no Android.
function getFsOrientationCall({ phase, wantLandscape }) {
  if (phase === "rotate") return { method: "lock", options: { orientation: wantLandscape ? "landscape" : "portrait" } };
  return { method: "unlock", options: {} };
}

// Girou o aparelho sozinho (rotação automática): o botão de girar passa a refletir a posição real.
function syncFsOrientationFromViewport() {
  if (!isNativePluginAvailable("ScreenOrientation")) return;
  if (!document.getElementById("player-screen").classList.contains("pseudo-fullscreen")) return;
  _fs.wantLandscape = window.innerWidth > window.innerHeight;
}

function callFsOrientation(phase) {
  const call = getFsOrientationCall({ phase, wantLandscape: _fs.wantLandscape });
  callNativePlugin("ScreenOrientation", call.method, call.options);
}
```

Em `enterPseudoFullscreen()`, depois de `_fs.wantLandscape = false;` acrescentar `callFsOrientation("enter");`.

Em `exitPseudoFullscreen()`, **trocar** a linha `if (_fs.wantLandscape) callNativePlugin("ScreenOrientation", "lock", { orientation: "portrait" });` por `callFsOrientation("exit");` (e apagar o comentário acima dela, que descrevia o travamento em retrato).

Em `toggleFsRotation()`, **trocar** a linha do `callNativePlugin("ScreenOrientation", "lock", ...)` por `callFsOrientation("rotate");`.

Trocar o listener `window.addEventListener("resize", applyFsLayout);` (~6246) por:

```js
  window.addEventListener("resize", () => { syncFsOrientationFromViewport(); applyFsLayout(); });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/player/fullscreen-orientation.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Conferir a chamada ao plugin no Chrome (plugin falso)**

Criar `scripts/dev/check-orientation.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

// Finge o plugin nativo e registra as chamadas
const preScript = `
  window.__chamadas = [];
  window.Capacitor.isPluginAvailable = (n) => n === "ScreenOrientation" || n === "StatusBar";
  window.Capacitor.nativePromise = (plugin, method, options) => { window.__chamadas.push(plugin + "." + method + ":" + JSON.stringify(options)); return Promise.resolve({}); };
`;

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true, preScript }, async (page) => {
  await page.eval(`selectChannel(getChannels()[0], false); toggleFullscreen();`);   // entra
  await page.eval(`toggleFsRotation()`);                                              // gira
  await page.eval(`toggleFullscreen()`);                                              // sai
  const chamadas = await page.eval(`window.__chamadas`);
  console.log(chamadas);
  const esperado = ["ScreenOrientation.unlock", "ScreenOrientation.lock", "ScreenOrientation.unlock"];
  const ok = esperado.every((e, i) => chamadas.filter((c) => c.startsWith("ScreenOrientation")).map((c) => c.split(":")[0])[i] === e);
  if (!ok) { console.error("✖ sequência de orientação inesperada"); process.exit(1); }
  console.log("✔ ok");
});
```

Run: `node scripts/dev/check-orientation.mjs`
Expected: `✔ ok`.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml sintoniza-link.html tests/vod/loadVodHelpers.js tests/player/fullscreen-orientation.test.js scripts/dev/check-orientation.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "fix(android): tela cheia gira com a rotação automática (libera o sensor e fullUser no manifesto)"
```

---

### Task 6: Aba Favoritos mostra Canais, Filmes e Séries

Filmes e séries favoritos são os da **Minha Lista** (`sint_mylist`, entradas `{ type: "vod"|"series", id, title, cover, item, ts }`). O seletor fica à direita do título "Favoritos".

**Files:**
- Modify: `sintoniza-link.html` (HTML do `.section-controls` ~1397; CSS perto de `.view-toggle` ~608; `_state` ~2031; `renderCatalog` ~4258; `renderTabLayout` ~5456; `refreshPersonalLists` ~4960; `DOMContentLoaded`)
- Modify: `tests/vod/loadVodHelpers.js` (`"normalizeFavKind", "favKindLabel", "filterMyListEntries"`)
- Test: `tests/vod/favorites-kind.test.js`

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "./loadVodHelpers.js";

const html = readFileSync(new URL("../../sintoniza-link.html", import.meta.url), "utf8");

test("o tipo de favorito inválido volta para canais", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.normalizeFavKind("vod"), "vod");
  assert.equal(ctx.normalizeFavKind("series"), "series");
  assert.equal(ctx.normalizeFavKind("channels"), "channels");
  assert.equal(ctx.normalizeFavKind("lixo"), "channels");
  assert.equal(ctx.normalizeFavKind(null), "channels");
});

test("rótulos em português", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.favKindLabel("channels"), "Canais");
  assert.equal(ctx.favKindLabel("vod"), "Filmes");
  assert.equal(ctx.favKindLabel("series"), "Séries");
});

test("busca nos favoritos de filmes e séries ignora acento e caixa", () => {
  const ctx = loadVodHelpers();
  const lista = [{ title: "Ação Total" }, { title: "Drama C" }, { title: "Amor à Vida" }];
  assert.deepEqual(ctx.filterMyListEntries(lista, "acao").map((e) => e.title), ["Ação Total"]);
  assert.deepEqual(ctx.filterMyListEntries(lista, "").length, 3);
  assert.deepEqual(ctx.filterMyListEntries(lista, "xyz"), []);
});

test("o seletor Canais/Filmes/Séries fica ao lado do título dos Favoritos", () => {
  assert.match(html, /<div class="section-controls">\s*<div class="fav-kind-tabs" id="fav-kind-tabs"/);
  for (const kind of ["channels", "vod", "series"]) assert.match(html, new RegExp(`data-fav-kind="${kind}"`));
});

test("o clique nos cartões de filme/série também funciona dentro da aba Favoritos", () => {
  assert.match(html, /getElementById\("channel-container"\)\.addEventListener\("click", onVodCardAreaClick\)/);
});
```

Em `tests/vod/loadVodHelpers.js` acrescentar `"normalizeFavKind", "favKindLabel", "filterMyListEntries"` a `PURE_HELPER_NAMES`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vod/favorites-kind.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar**

**3a. Funções puras** (junto das funções da Minha Lista, antes de `loadMyList`, ~linha 4897):

```js
// ─── Aba Favoritos: Canais, Filmes ou Séries ───
// Filmes e séries favoritos são os títulos da "Minha Lista".
const FAV_KIND_KEY = "sint_fav_kind";
const FAV_KINDS = ["channels", "vod", "series"];

function normalizeFavKind(value) {
  return FAV_KINDS.indexOf(value) !== -1 ? value : "channels";
}

function favKindLabel(kind) {
  return kind === "vod" ? "Filmes" : kind === "series" ? "Séries" : "Canais";
}

function foldSearchText(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function filterMyListEntries(entries, query) {
  const q = foldSearchText(query);
  if (!q) return entries;
  return entries.filter(e => foldSearchText(e.title).indexOf(q) !== -1);
}
```

**3b. Estado:** em `_state` (linha ~2031), depois de `vodType: "movies", ...`:

```js
  favKind:   normalizeFavKind(localStorage.getItem("sint_fav_kind")), // "channels" | "vod" | "series" - o que a aba Favoritos mostra
```

**3c. HTML:** em `#catalog-section`, dentro de `<div class="section-controls">`, **antes** de `<div class="view-toggle">`:

```html
            <div class="fav-kind-tabs" id="fav-kind-tabs" role="tablist" aria-label="O que mostrar nos favoritos" style="display:none">
              <button class="fav-kind-btn active" data-fav-kind="channels" role="tab" aria-selected="true">Canais</button>
              <button class="fav-kind-btn" data-fav-kind="vod" role="tab" aria-selected="false">Filmes</button>
              <button class="fav-kind-btn" data-fav-kind="series" role="tab" aria-selected="false">Séries</button>
            </div>
```

**3d. CSS** (depois de `.view-btn.active { ... }`, ~linha 620):

```css
    /* Aba Favoritos: escolher entre Canais, Filmes e Séries */
    .fav-kind-tabs { display: flex; border-radius: .5rem; background: var(--secondary); padding: .2rem; gap: .15rem; }
    .fav-kind-btn {
      border: none; background: none; color: var(--muted-fg);
      font-weight: 600; font-size: .85rem; padding: .5rem .85rem; border-radius: .35rem;
      transition: background 140ms, color 140ms;
    }
    .fav-kind-btn.active { background: var(--card); color: var(--foreground); box-shadow: 0 1px 3px oklch(0.1 0.01 65 / 10%); }
```

**3e. Desenho dos favoritos de filmes/séries.** Em `renderCatalog()`, logo depois do bloco `if (!getCatalogTabLayout(active).showCatalog) { ... return; }`:

```js
  // Favoritos de filmes ou séries: os títulos da Minha Lista daquele tipo
  if (active === "Favoritos" && _state.favKind !== "channels") {
    renderFavoritesVod(container);
    return;
  }
```

e a função (junto de `renderCatalog`):

```js
function renderFavoritesVod(container) {
  const kind = _state.favKind === "series" ? "series" : "vod";
  const items = filterMyListEntries(getMyListItems(loadMyList(), kind), _state.query);
  if (!items.length) {
    const buscando = !!_state.query;
    const plural = kind === "series" ? "séries" : "filmes";
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="heart" style="width:2rem;height:2rem"></i>
        <h3>${buscando ? "Nada encontrado" : `Nenhum${kind === "series" ? "a série" : " filme"} favorit${kind === "series" ? "a" : "o"} ainda`}</h3>
        <p>${buscando ? "Tente outro termo." : `Adicione ${plural} à Minha Lista (no detalhe do título) para vê-los aqui.`}</p>
      </div>`;
    lucide.createIcons();
    return;
  }
  container.innerHTML = `<div class="vod-carousel-grid">${items.map(myListCardHtml).join("")}</div>`;
}
```

**3f. Layout da aba.** Em `renderTabLayout()` (depois da linha `document.getElementById("home-lists").style...`):

```js
  // Seletor Canais/Filmes/Séries só nos Favoritos; grade/lista só vale para canais
  const onFavorites = _state.active === "Favoritos";
  document.getElementById("fav-kind-tabs").style.display = onFavorites ? "" : "none";
  document.querySelectorAll("#fav-kind-tabs [data-fav-kind]").forEach(btn => {
    const on = btn.dataset.favKind === _state.favKind;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  document.querySelector(".view-toggle").style.display = onFavorites && _state.favKind !== "channels" ? "none" : "";
  if (onFavorites) document.getElementById("search-input").placeholder = `Buscar em favoritos (${favKindLabel(_state.favKind).toLowerCase()})...`;
```

**3g. Quando a Minha Lista muda com a aba aberta.** Em `refreshPersonalLists()` acrescentar no fim:

```js
  if (_state.section === "catalog" && _state.active === "Favoritos") renderCatalog();
```

**3h. Eventos** (em `DOMContentLoaded`, logo **depois** da função `onVodCardAreaClick` e dos listeners `#vod-carousels` / `#vod-search-results`):

```js
  // Favoritos de filmes/séries aparecem dentro de #channel-container: mesmo tratador de clique dos cartões
  document.getElementById("channel-container").addEventListener("click", onVodCardAreaClick);

  document.getElementById("fav-kind-tabs").addEventListener("click", e => {
    const btn = e.target.closest("[data-fav-kind]");
    if (!btn) return;
    const kind = normalizeFavKind(btn.dataset.favKind);
    localStorage.setItem(FAV_KIND_KEY, kind);
    setState({ favKind: kind });
  });
```

(Se `onVodCardAreaClick` não estiver visível no ponto escolhido porque está dentro de outro bloco, colocar os dois `addEventListener` no mesmo bloco onde ela é declarada.)

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vod/favorites-kind.test.js && npm test`
Expected: PASS (todos).

- [ ] **Step 5: Conferir no Chrome**

Criar `scripts/dev/check-favorites.mjs`:

```js
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

await withPage(pathToFileURL("sintoniza-link.html").href, { native: true }, async (page) => {
  // uma série e um filme na Minha Lista
  await page.eval(`localStorage.setItem("sint_mylist", JSON.stringify([
    { type: "vod", id: 1, title: "Filme Um", cover: "", item: { stream_id: 1, name: "Filme Um" }, ts: 2 },
    { type: "series", id: 9, title: "Série Nove", cover: "", item: { series_id: 9, name: "Série Nove" }, ts: 1 }
  ])); setState({ section: "catalog", active: "Favoritos", favKind: "vod" });`);
  await page.sleep(500);
  const vod = await page.eval(`({ abas: getComputedStyle(document.getElementById("fav-kind-tabs")).display, titulos: [...document.querySelectorAll("#channel-container .vod-card p")].map(p => p.textContent) })`);
  await page.eval(`setState({ favKind: "series" })`);
  await page.sleep(300);
  const series = await page.eval(`[...document.querySelectorAll("#channel-container .vod-card p")].map(p => p.textContent)`);
  console.log({ vod, series });
  await page.screenshot("favoritos-celular.png");
  if (vod.abas === "none" || vod.titulos.join() !== "Filme Um" || series.join() !== "Série Nove") { console.error("✖ favoritos incorretos"); process.exit(1); }
  console.log("✔ ok (captura em favoritos-celular.png)");
});
```

Run: `node scripts/dev/check-favorites.mjs`
Expected: `✔ ok`. Abrir `favoritos-celular.png` e confirmar o seletor à direita do título; **apagar a captura** depois (não commitar).

- [ ] **Step 6: Commit**

```bash
git add sintoniza-link.html tests/vod/loadVodHelpers.js tests/vod/favorites-kind.test.js scripts/dev/check-favorites.mjs
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "feat(favoritos): aba Favoritos mostra Canais, Filmes e Séries (Minha Lista)"
```

---

### Task 7: Versão do app e do build da v10

**Files:**
- Modify: `sintoniza-link.html` (`const APP_VERSION = "v7";` ~3375 → `"v10"`)
- Create: `.github/workflows/build-mobile-v10.yml` (cópia de `build-mobile-v9.yml`)

- [ ] **Step 1: Atualizar a versão e criar o workflow**

Trocar `const APP_VERSION = "v7";` por `const APP_VERSION = "v10";`.

Copiar `.github/workflows/build-mobile-v9.yml` para `build-mobile-v10.yml` com um script Node que preserve o fim de linha, trocando `name: Build Android APK e iOS IPA (v9)` por `... (v10)` e `branches: [v9]` por `branches: [v10]` e `".github/workflows/build-mobile-v9.yml"` por `".github/workflows/build-mobile-v10.yml"`:

```bash
node -e "const fs=require('fs');let s=fs.readFileSync('.github/workflows/build-mobile-v9.yml','utf8');s=s.split('(v9)').join('(v10)').split('[v9]').join('[v10]').split('build-mobile-v9.yml').join('build-mobile-v10.yml');fs.writeFileSync('.github/workflows/build-mobile-v10.yml',s)"
```

- [ ] **Step 2: Conferir**

Run: `grep -n "v9\|v10" .github/workflows/build-mobile-v10.yml; npm test`
Expected: só aparecem `v10`; a suíte passa (se um teste citar `v7`/`APP_VERSION`, atualizar o teste para `v10`).

- [ ] **Step 3: Commit**

```bash
git add sintoniza-link.html .github/workflows/build-mobile-v10.yml
git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "chore(v10): versão do app e workflow de build da v10"
```

---

## Auto-revisão

- **Cobertura do pedido:** retângulo (T1); realce quadrado nos botões de pular (T2); duplo toque (T3); player que não volta depois do PiP (T4); rotação em tela cheia (T5); Favoritos com Canais/Filmes/Séries (T6). Cadastro/QR/7 dias e envio para a TV estão nos outros planos.
- **Tipos e nomes:** `computePlayerMode({hasSelection,...})` e `computeScrolledAway(...)` são definidos na Task 1 e usados nas Tasks 1 e 4; `isDoubleTap` (T3), `getFsOrientationCall` (T5) e `normalizeFavKind/favKindLabel/filterMyListEntries` (T6) entram em `PURE_HELPER_NAMES`.
- **Risco aberto:** a rotação no Android (Task 5) não pôde ser testada em aparelho real; o resto foi conferido no Chrome com toques e eventos simulados.
