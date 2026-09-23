# Sintoniza v7: Ajustes do teste da v6 + investigação de backend. Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** Corrigir os 5 problemas que o Gustavo achou testando a v6, que é a `main` atual, no iPhone e num Android, e produzir um relatório de pesquisa (sem código) sobre um backend gratuito de usuários e mensalidades.

**Arquitetura:** Igual à v6. Tudo continua em `sintoniza-link.html`, arquivo único com scripts clássicos. Cada regra nova vira uma função pura no script principal, testada via `tests/vod/loadVodHelpers.js` (lista `PURE_HELPER_NAMES`). O DOM só chama essas funções. APK e IPA usam o mesmo arquivo. A investigação de backend gera só um documento Markdown.

**Tech Stack:** HTML/CSS/JS vanilla, Capacitor 8 (CapacitorHttp ligado), `node:test`.

**Branch:** `v7`, criada a partir da `main` (`990332e`, a v6 oficial).

---

## Pontos levantados e onde cada um é resolvido

| # | Ponto | Task |
|---|---|---|
| 1 | Ao ir em Configurações e voltar, o player grande some e fica só o mini-player | Task 1 |
| 2 | O mini-player fica por cima do menu das 3 listras | Task 2 |
| 3 | Filmes/séries dão `NotSupportedError · MEDIA_ERR 4` num Android com a mesma lista e a mesma v6; é preciso ter certeza da causa | Task 5 |
| 4 | Avisos técnicos ("Blindagem ativa: Buffer expandido…" e parecidos) não podem aparecer | Task 4 |
| 5 | Ao abrir o app, o player mostra o "Canal Rural" de fundo; deve ficar só o fundo preto e dourado até algo ser escolhido | Task 3 |
| 6 | Investigar (só investigar) backend gratuito: login/senha, e-mail válido, troca de senha, mensalidade com cancelamento automático, segredos em env, segurança contra ataque e invasão | Task 6 |

### Causas já identificadas lendo o código

- **Ponto 1:** em Configurações o player vira mini (fica fora do fluxo) e `setPlayerMode()` destrava a âncora, que cai para altura 0. Na volta, `_playerScrolledAway` ainda carrega a medida feita com a âncora vazia, porque `isPlayerScrolledAway(bottom≈topbar, topbar)` dá `true`. O player continua mini e a âncora nunca volta a ter altura. É um ciclo que nunca se desfaz.
- **Ponto 2:** `#player-screen.mini-player` tem `z-index: 500`, e o `.sidebar` tem `z-index: 40`.
- **Ponto 3:** `MEDIA_ERR 4` sozinho não distingue "servidor recusou" de "o aparelho não decodifica o formato". Mesma lista significa mesma conta Xtream, o que torna possível o limite de telas. Também é possível um áudio AC3/E-AC3 ou vídeo HEVC que o iPhone toca e o motor do Chrome no Android não. A v7 mostra o diagnóstico real e deixa um botão para copiá-lo. O botão "Abrir no VLC" fica para depois do diagnóstico confirmar que é formato (YAGNI).
- **Ponto 4:** `escalateBufferStage()` (linha ~2416), o watchdog N3 (~2758), `reloadCurrentChannel` (~2837) e o timeout de 15s do `playStream` (~2924).
- **Ponto 5:** `loadPlaylistFromUrl`/`loadPlaylistFromFile` fazem `selected: channels[0]`, e o boot/"Limpar" fazem `selected: DEMO_CHANNELS[0]`.

## Restrições globais (valem para toda task)

- Não usar `sed -i` em `sintoniza-link.html`. A cópia de trabalho é CRLF (`core.autocrlf=true`) e o `sed` do Git Bash converte para LF, o que quebra o teste que compara o bloco `epg-helpers` com a TV. Use a ferramenta Edit.
- Suíte de testes: `npm test` (o `node_modules` já existe; 114 testes passando na base).
- Commit com a identidade do histórico, sem mexer na config global:
  `git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit -m "..."`, com a linha final `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Comentários novos em português. Não fazer push (a Task 7 cuida disso).
- `npm test` regenera `www/index.html` (teste do prepare-mobile); só a Task 7 o commita.

---

### Task 1: Player grande volta ao sair de Configurações (ponto 1)

**Files:**
- Modify: `sintoniza-link.html` (perto de `let _playerScrolledAway`, `setPlayerMode()`, listeners de `nav-settings-btn`/`settings-back`)
- Modify: `tests/vod/loadVodHelpers.js` (acrescentar nomes em `PURE_HELPER_NAMES`)
- Test: `tests/player/player-mode.test.js`

- [ ] **Step 1: Registrar as funções puras da v7 no harness.** Em `PURE_HELPER_NAMES` (`tests/vod/loadVodHelpers.js`), acrescentar ao final do array:

```js
  "resolvePlayerScrolledAway", "keepSelectionIfPresent",
  "sanitizeDiagnosticText", "describeCodecSupport", "buildPlaybackDiagnostic",
  "refineDirectPlayErrorMessage", "fileExtFromUrl", "formatBytes",
```

- [ ] **Step 2: Escrever o teste que falha** (acrescentar em `tests/player/player-mode.test.js`):

```js
test("voltar de Configurações zera a medida antiga de 'player fora da tela'", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "settings", section: "catalog", scrolledAway: true }), false);
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "settings", section: "vod", scrolledAway: true }), false);
});

test("fora dessa volta, a medida da rolagem é mantida", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "catalog", section: "catalog", scrolledAway: true }), true);
  assert.equal(ctx.resolvePlayerScrolledAway({ prevSection: "vod", section: "settings", scrolledAway: true }), true);
});
```

- [ ] **Step 3:** `node --test tests/player/player-mode.test.js` deve dar FAIL (`resolvePlayerScrolledAway is not a function`).

- [ ] **Step 4: Implementar.** Logo depois de `let _playerScrolledAway = false;`:

```js
// Seção em que o player estava no último setPlayerMode() (ver abaixo).
let _lastPlayerSection = null;

// Volta de Configurações: lá o player fica fora do lugar (mini/oculto) e a
// âncora vazia, então a medida antiga de "rolou para longe" não vale. Sem
// zerar, o player ficava preso como mini-player para sempre (ponto 1 da v7).
// Recomeça como visível e a rolagem mede de novo com o player no lugar.
function resolvePlayerScrolledAway({ prevSection, section, scrolledAway }) {
  if (prevSection === "settings" && section !== "settings") return false;
  return scrolledAway;
}
```

No começo de `setPlayerMode()`, logo depois de `if (!el) return;`:

```js
  _playerScrolledAway = resolvePlayerScrolledAway({ prevSection: _lastPlayerSection, section: _state.section, scrolledAway: _playerScrolledAway });
  _lastPlayerSection = _state.section;
```

Nos listeners, entrar e sair de Configurações também sobe para o topo, como a troca de abas:

```js
  document.getElementById("nav-settings-btn").addEventListener("click", () => {
    setState({ section: "settings" });
    closeSidebar();
    loadSettingsForm();
    window.scrollTo({ top: 0 });
  });
  document.getElementById("settings-back").addEventListener("click", () => {
    setState({ section: "catalog" });
    window.scrollTo({ top: 0 });
  });
```

- [ ] **Step 5:** `npm test` deve dar PASS.
- [ ] **Step 6: Commit** `fix(player): restore the big player after coming back from Configurações`.

---

### Task 2: Mini-player some com o menu aberto (ponto 2)

**Files:**
- Modify: `sintoniza-link.html` (`openSidebar`/`closeSidebar`, CSS depois de `#player-screen.player-hidden`)
- Test: `tests/player/player-markup.test.js`

- [ ] **Step 1: Escrever o teste que falha** (acrescentar em `tests/player/player-markup.test.js`):

```js
test("mini-player some enquanto o menu das 3 listras está aberto", () => {
  assert.match(html, /body\.sidebar-open #player-screen\.mini-player\s*\{[^}]*display:\s*none/);
  assert.match(html, /document\.body\.classList\.add\("sidebar-open"\)/);
  assert.match(html, /document\.body\.classList\.remove\("sidebar-open"\)/);
});
```

- [ ] **Step 2:** `node --test tests/player/player-markup.test.js` deve dar FAIL.

- [ ] **Step 3: Implementar.**

```js
function openSidebar()  {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-scrim").classList.add("open");
  // Esconde o mini-player enquanto o menu está aberto (ele fica por cima
  // do menu e atrapalha a navegação - ponto 2 da v7).
  document.body.classList.add("sidebar-open");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-scrim").classList.remove("open");
  document.body.classList.remove("sidebar-open");
}
```

CSS, logo depois de `#player-screen.player-hidden { display: none; }`:

```css
    /* Menu das 3 listras aberto: o mini-player (z-index 500) sai da frente. */
    body.sidebar-open #player-screen.mini-player { display: none !important; }
```

- [ ] **Step 4:** `npm test` deve dar PASS.
- [ ] **Step 5: Commit** `fix(nav): hide the mini-player while the side menu is open`.

---

### Task 3: Player ocioso sem canal automático (ponto 5)

**Files:**
- Modify: `sintoniza-link.html` (`loadPlaylistFromUrl`, `loadPlaylistFromFile`, boot demo, `clear-btn`, `renderPlayerInfo`, CSS)
- Test: `tests/vod/selection.test.js` (novo)

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/vod/selection.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const channels = [{ id: 1, name: "Canal Rural" }, { id: 2, name: "ESPN" }];

test("sem nada escolhido, a lista nova não escolhe canal nenhum", () => {
  assert.equal(loadVodHelpers().keepSelectionIfPresent(null, channels), null);
});

test("mantém o canal escolhido se ele continua na lista", () => {
  assert.deepEqual(loadVodHelpers().keepSelectionIfPresent({ id: 2, name: "ESPN" }, channels), { id: 2, name: "ESPN" });
});

test("canal que sumiu da lista deixa o player ocioso", () => {
  assert.equal(loadVodHelpers().keepSelectionIfPresent({ id: 9, name: "X" }, channels), null);
});

test("filme/episódio tocando não depende da lista de canais", () => {
  assert.deepEqual(loadVodHelpers().keepSelectionIfPresent({ id: "resume-vod-4", isVod: true }, channels), { id: "resume-vod-4", isVod: true });
});
```

- [ ] **Step 2:** `node --test tests/vod/selection.test.js` deve dar FAIL.

- [ ] **Step 3: Implementar.** Função pura, logo depois de `setSection`:

```js
// Mantém o canal/filme escolhido só se ele ainda existir na lista nova.
// Nunca escolhe um canal sozinho: o player fica ocioso (fundo preto e
// dourado) até o usuário escolher algo (ponto 5 da v7).
function keepSelectionIfPresent(selected, channels) {
  if (!selected) return null;
  if (selected.isVod) return selected;
  return channels.some(c => c.id === selected.id) ? selected : null;
}
```

Em `loadPlaylistFromUrl`, trocar o bloco `// Seleciona primeiro canal` + `if (...) { setState({ selected: channels[0] }, true); }` por:

```js
    // Nada de canal automático: mantém a escolha só se ela ainda existir
    setState({ selected: keepSelectionIfPresent(_state.selected, channels) }, true);
```

Em `loadPlaylistFromFile`, trocar `selected: channels[0]` por `selected: keepSelectionIfPresent(_state.selected, channels)`. No boot, no ramo sem lista salva, apagar a linha `setState({ selected: DEMO_CHANNELS[0] }, true);`. No `clear-btn`, trocar `selected: DEMO_CHANNELS[0]` por `selected: null`.

Em `renderPlayerInfo()`, trocar as duas primeiras linhas do corpo por:

```js
  const ch = _state.selected;
  // Nada escolhido ainda: só o fundo preto e dourado (ponto 5 da v7).
  document.getElementById("player-screen").classList.toggle("is-idle", !ch);
  if (!ch) return;
```

CSS, junto de `.play-center.hidden`:

```css
    /* Player ocioso (nada escolhido ainda): só o fundo preto e dourado,
       sem nome, selo, logo, play nem barra de controles. */
    #player-screen.is-idle .player-copy,
    #player-screen.is-idle .channel-monogram,
    #player-screen.is-idle .player-art-logo,
    #player-screen.is-idle .play-center,
    #player-screen.is-idle .player-controls,
    #player-screen.is-idle .vod-seek-row { display: none !important; }
```

- [ ] **Step 4:** `npm test` deve dar PASS.
- [ ] **Step 5: Commit** `fix(player): start idle (black/gold background) instead of auto-selecting the first channel`.

---

### Task 4: Sem avisos técnicos de buffer e reconexão (ponto 4)

**Files:**
- Modify: `sintoniza-link.html` (`escalateBufferStage`, watchdog N3, `reloadCurrentChannel`, timeout do `playStream`)
- Test: `tests/player/player-markup.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test("sem avisos técnicos de buffer/reconexão na tela", () => {
  for (const text of ["Blindagem ativa", "Conexão demorando", "Canal instável — reconectando", "Recarregando sinal de"]) {
    assert.ok(!html.includes(text), `aviso técnico "${text}" ainda existe`);
  }
});
```

- [ ] **Step 2:** `node --test tests/player/player-markup.test.js` deve dar FAIL.

- [ ] **Step 3: Implementar**, só apagando linhas; os `console.warn` ficam para diagnóstico:
  - Em `escalateBufferStage()`: apagar `showToast(\`Blindagem ativa: Buffer expandido para ${stage.seconds}s\`);`.
  - No watchdog N3: apagar `showToast("Canal instável — reconectando completamente...");`.
  - Em `reloadCurrentChannel()`: apagar o bloco `if (!isSilent) { showToast("Recarregando sinal de " + ch.name + "..."); }`. O ícone girando do botão recarregar já é o retorno visual.
  - No timeout de 15s do `playStream()`: apagar `showToast("Conexão demorando — restabelecendo sinal...");`.

- [ ] **Step 4:** `npm test` deve dar PASS.
- [ ] **Step 5: Commit** `fix(player): drop technical buffer/reconnect toasts`.

---

### Task 5: Diagnóstico real da falha de filme/série (ponto 3)

**Files:**
- Modify: `sintoniza-link.html` (funções puras junto de `describeDirectPlayError`; `fail()` de `tryDirectPlay`; `showPlayerError`; markup e CSS do `#player-error`; listener do botão)
- Modify: `tests/vod/direct-play-policy.test.js` (mensagem do MEDIA_ERR 4 fica neutra)
- Test: `tests/vod/playback-diagnostic.test.js` (novo)

- [ ] **Step 1: Escrever os testes que falham**

```js
// tests/vod/playback-diagnostic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("sanitizeDiagnosticText remove URLs (que levam usuário/senha)", () => {
  const out = loadVodHelpers().sanitizeDiagnosticText("falhou em http://srv:80/movie/joao/s3nh4/9.mp4 agora");
  assert.equal(out, "falhou em [url] agora");
  assert.doesNotMatch(out, /s3nh4|joao/);
});

test("describeCodecSupport lista sim/não por formato", () => {
  const out = loadVodHelpers().describeCodecSupport({ "H.264": "probably", HEVC: "", AAC: "maybe", AC3: "", "E-AC3": "", MKV: "" });
  assert.equal(out, "H.264 sim · HEVC não · AAC sim · AC3 não · E-AC3 não · MKV não");
});

test("fileExtFromUrl e formatBytes", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.fileExtFromUrl("http://s/movie/u/p/9.MP4?t=1"), "mp4");
  assert.equal(ctx.fileExtFromUrl("http://s/live/u/p/9"), "");
  assert.equal(ctx.formatBytes(1610612736), "1.5 GB");
  assert.equal(ctx.formatBytes(734003200), "700 MB");
});

test("servidor com HTTP 4xx/5xx: a mensagem culpa o servidor com o código", () => {
  const msg = loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 403, contentType: "", baseMessage: "base" });
  assert.match(msg, /HTTP 403/);
  assert.match(msg, /limite de telas/);
});

test("servidor entregou vídeo: a mensagem culpa o formato no aparelho", () => {
  const msg = loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 200, contentType: "video/mp4", baseMessage: "base" });
  assert.match(msg, /formato/);
  assert.doesNotMatch(msg, /limite de telas/);
});

test("sem resposta da sondagem: mantém a mensagem original", () => {
  assert.equal(loadVodHelpers().refineDirectPlayErrorMessage({ httpStatus: 0, contentType: "", baseMessage: "base" }), "base");
});

test("buildPlaybackDiagnostic junta tudo e nunca inclui URL", () => {
  const text = loadVodHelpers().buildPlaybackDiagnostic({
    appVersion: "v7", platform: "android", userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) Chrome/129",
    fileExt: "mp4", errorName: "NotSupportedError", mediaErrorCode: 4,
    mediaErrorMessage: "DEMUXER_ERROR_NO_SUPPORTED_STREAMS: http://srv/movie/u/p/9.mp4",
    attempts: 6, httpStatus: 200, contentType: "video/mp4", contentLength: 1610612736, probeError: "",
    codecSummary: "H.264 sim · HEVC sim · AAC sim · AC3 não · E-AC3 não · MKV não",
  });
  assert.match(text, /^Sintoniza v7 · android/);
  assert.match(text, /Player: NotSupportedError · MEDIA_ERR 4 · 6 tentativa\(s\)/);
  assert.match(text, /Detalhe do player: DEMUXER_ERROR_NO_SUPPORTED_STREAMS: \[url\]/);
  assert.match(text, /Servidor: HTTP 200 · video\/mp4 · 1\.5 GB/);
  assert.match(text, /Formatos do aparelho: H\.264 sim/);
  assert.doesNotMatch(text, /http:\/\//);
});

test("buildPlaybackDiagnostic sem resposta do servidor", () => {
  const text = loadVodHelpers().buildPlaybackDiagnostic({
    appVersion: "v7", platform: "ios", userAgent: "iPhone", fileExt: "mp4", errorName: "NotSupportedError",
    mediaErrorCode: 4, mediaErrorMessage: "", attempts: 6, httpStatus: 0, contentType: "", contentLength: 0,
    probeError: "Failed to fetch", codecSummary: "H.264 sim",
  });
  assert.match(text, /Servidor: sem resposta \(Failed to fetch\)/);
  assert.doesNotMatch(text, /Detalhe do player/);
});
```

Em `tests/vod/direct-play-policy.test.js`, o teste "mensagem de erro explica o limite de telas e mostra o código real" passa a checar a mensagem neutra, porque antes da sondagem não dá para saber a causa:

```js
test("mensagem de erro do MEDIA_ERR 4 é neutra e mostra o código real", () => {
  const ctx = loadVodHelpers();
  const r = ctx.describeDirectPlayError({ errorName: "NotSupportedError", mediaErrorCode: 4, url: "http://x/movie/u/p/1.mp4", isIOS: true, attempts: 6 });
  assert.match(r.message, /recusou/);
  assert.match(r.message, /formato/);
  assert.doesNotMatch(r.message, /CORS/);
  assert.equal(r.code, "NotSupportedError · MEDIA_ERR 4 · 6 tentativas");
});
```

- [ ] **Step 2:** `node --test tests/vod/playback-diagnostic.test.js tests/vod/direct-play-policy.test.js` deve dar FAIL.

- [ ] **Step 3: Funções puras**, logo depois de `shouldApplyResume`:

```js
// ─── Diagnóstico de falha de filme/série (ponto 3 da v7) ───
// MEDIA_ERR 4 sozinho não diz se o servidor recusou ou se o aparelho não
// decodifica o formato. Juntamos o detalhe interno do player, a resposta
// do servidor (sondagem HEAD) e o que o aparelho diz suportar num texto
// que o usuário copia e manda. Nenhuma URL entra no texto, porque as URLs
// do Xtream carregam usuário e senha.
const APP_VERSION = "v7";

function sanitizeDiagnosticText(text) {
  return String(text || "").replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").trim();
}

// Tipos testados com video.canPlayType() no aparelho.
const CODEC_PROBES = [
  { label: "H.264", type: 'video/mp4; codecs="avc1.640028"' },
  { label: "HEVC", type: 'video/mp4; codecs="hvc1.1.6.L120.90"' },
  { label: "AAC", type: 'audio/mp4; codecs="mp4a.40.2"' },
  { label: "AC3", type: 'audio/mp4; codecs="ac-3"' },
  { label: "E-AC3", type: 'audio/mp4; codecs="ec-3"' },
  { label: "MKV", type: "video/x-matroska" },
];

// canPlay: { [label]: "" | "maybe" | "probably" }
function describeCodecSupport(canPlay) {
  return CODEC_PROBES.map(p => `${p.label} ${canPlay[p.label] ? "sim" : "não"}`).join(" · ");
}

function fileExtFromUrl(url) {
  const path = String(url || "").split("?")[0];
  const last = path.split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
}

function formatBytes(n) {
  if (!n) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

// Depois da sondagem, separa "servidor recusou" de "aparelho não toca o
// formato". Sem resposta (ex.: navegador comum, bloqueado por CORS), fica
// a mensagem original.
function refineDirectPlayErrorMessage({ httpStatus, contentType, baseMessage }) {
  if (httpStatus >= 400) {
    return `O servidor recusou o vídeo (HTTP ${httpStatus}). Costuma ser o limite de telas simultâneas do plano ou o login expirado.`;
  }
  if (httpStatus >= 200 && httpStatus < 400 && /video|octet-stream|matroska|mp4/i.test(contentType || "")) {
    return "O servidor enviou o vídeo, mas este aparelho não conseguiu tocar o formato dele (provavelmente áudio Dolby AC3/E-AC3 ou vídeo HEVC).";
  }
  return baseMessage;
}

function buildPlaybackDiagnostic({ appVersion, platform, userAgent, fileExt, errorName, mediaErrorCode, mediaErrorMessage, attempts, httpStatus, contentType, contentLength, probeError, codecSummary }) {
  const player = [errorName, mediaErrorCode ? `MEDIA_ERR ${mediaErrorCode}` : "", attempts ? `${attempts} tentativa(s)` : ""].filter(Boolean).join(" · ");
  const lines = [
    `Sintoniza ${appVersion} · ${platform}`,
    `Aparelho: ${sanitizeDiagnosticText(userAgent)}`,
    `Arquivo: .${fileExt || "?"}`,
    `Player: ${player}`,
  ];
  if (mediaErrorMessage) lines.push(`Detalhe do player: ${sanitizeDiagnosticText(mediaErrorMessage)}`);
  lines.push(httpStatus
    ? `Servidor: HTTP ${httpStatus}${contentType ? ` · ${contentType}` : ""}${contentLength ? ` · ${formatBytes(contentLength)}` : ""}`
    : `Servidor: sem resposta${probeError ? ` (${sanitizeDiagnosticText(probeError)})` : ""}`);
  lines.push(`Formatos do aparelho: ${codecSummary}`);
  return lines.join("\n");
}
```

Em `describeDirectPlayError`, trocar o texto do ramo `mediaErrorCode === 4 || errorName === "NotSupportedError"` por:

```js
    return { message: "O servidor recusou o vídeo ou este aparelho não suporta o formato dele.", code };
```

- [ ] **Step 4: Parte de DOM.** Depois de `tryDirectPlay`:

```js
// Último diagnóstico de falha (sem URLs), para o botão "Copiar diagnóstico".
let lastPlaybackDiagnostic = "";

function collectCodecSupport(video) {
  const out = {};
  CODEC_PROBES.forEach(p => {
    try { out[p.label] = video.canPlayType(p.type); } catch (e) { out[p.label] = ""; }
  });
  return out;
}

// Sondagem HEAD. No app nativo o fetch passa pelo HTTP nativo (CapacitorHttp),
// sem CORS. Traz status, tipo e tamanho sem baixar o vídeo. Timeout próprio,
// porque o fetch nativo ignora AbortController.
async function probeVodUrl(url) {
  const timeout = new Promise(resolve => setTimeout(() => resolve({ httpStatus: 0, probeError: "tempo esgotado" }), 8000));
  const request = fetch(url, { method: "HEAD", cache: "no-store" })
    .then(res => ({
      httpStatus: res.status,
      contentType: res.headers.get("content-type") || "",
      contentLength: Number(res.headers.get("content-length") || 0),
    }))
    .catch(e => ({ httpStatus: 0, probeError: (e && e.message) || String(e) }));
  return Promise.race([request, timeout]);
}

async function reportDirectPlayFailure({ url, video, errorName, mediaErrorCode, mediaErrorMessage, attempts, baseMessage, gen }) {
  const base = {
    appVersion: APP_VERSION,
    platform: (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || "web",
    userAgent: navigator.userAgent,
    fileExt: fileExtFromUrl(url),
    errorName, mediaErrorCode, mediaErrorMessage, attempts,
    codecSummary: describeCodecSupport(collectCodecSupport(video)),
  };
  lastPlaybackDiagnostic = buildPlaybackDiagnostic({ ...base, httpStatus: 0, contentType: "", contentLength: 0, probeError: "verificando..." });
  document.getElementById("copy-diagnostic-btn").style.display = "";
  const probe = await probeVodUrl(url);
  if (gen !== playbackGeneration) return; // outra reprodução já começou
  lastPlaybackDiagnostic = buildPlaybackDiagnostic({ ...base, contentType: "", contentLength: 0, probeError: "", ...probe });
  document.getElementById("player-error-msg").textContent =
    refineDirectPlayErrorMessage({ httpStatus: probe.httpStatus, contentType: probe.contentType, baseMessage });
}

// Copia texto; com alternativa para WebViews sem a Clipboard API.
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  ta.remove();
  return ok;
}
```

Em `fail()` de `tryDirectPlay`, no ramo final (depois do `if (shouldRetryDirectPlay…) {…}`), trocar as três linhas `releaseVideoElement(video); const { message, code } = …; showPlayerError(message, code);` por:

```js
    // Guarda o detalhe interno antes de soltar o vídeo (release() limpa o erro)
    const mediaErrorMessage = (video.error && video.error.message) || "";
    releaseVideoElement(video);
    const { message, code } = describeDirectPlayError({ errorName, mediaErrorCode, url, isIOS: ios, attempts: attempt });
    showPlayerError(message, code);
    reportDirectPlayFailure({ url, video, errorName, mediaErrorCode, mediaErrorMessage, attempts: attempt, baseMessage: message, gen });
```

Em `showPlayerError`, antes de `document.getElementById("player-error").classList.add("active");`:

```js
  // O botão de diagnóstico só aparece para falhas de filme/série
  // (reportDirectPlayFailure o mostra logo depois).
  document.getElementById("copy-diagnostic-btn").style.display = "none";
```

Markup, logo depois de `<button class="retry-btn" id="retry-btn">Tentar novamente</button>`:

```html
        <button class="diag-btn" id="copy-diagnostic-btn" style="display:none">Copiar diagnóstico</button>
```

CSS, depois de `.retry-btn { … }`:

```css
    .diag-btn {
      background: none; border: 1px solid oklch(1 0 0 / 25%); border-radius: .5rem;
      color: oklch(0.85 0.01 75); padding: .4rem .9rem; font-size: .78rem;
    }
```

Listener no boot, logo depois do de `retry-btn`:

```js
  document.getElementById("copy-diagnostic-btn").addEventListener("click", async () => {
    const ok = lastPlaybackDiagnostic && await copyTextToClipboard(lastPlaybackDiagnostic);
    showToast(ok ? "Diagnóstico copiado. Cole no WhatsApp e mande para o suporte." : "Não foi possível copiar o diagnóstico.");
  });
```

- [ ] **Step 5:** `npm test` deve dar PASS.
- [ ] **Step 6: Commit** `feat(vod): real playback diagnostic (player detail, server probe, device formats) with copy button`.

---

### Task 6: Investigação de backend: usuários, login e mensalidade (ponto 6, SÓ PESQUISA)

**Files:**
- Create: `docs/superpowers/research/2026-09-23-backend-usuarios-assinaturas.md`

Nenhum código de app é criado nesta task. É só um relatório, em português, com fontes (links) conferidas na web em setembro de 2026. As cotas gratuitas mudam com frequência; cada número precisa vir de uma fonte datada.

- [ ] **Step 1: Pesquisar e escrever o relatório** cobrindo:
  1. **Contexto do app:** é um `sintoniza-link.html` empacotado com Capacitor (iOS/Android) e `sintoniza-tv` para webOS/Tizen, todos rodando no cliente. Tudo que vai no app é público: só chaves "anon/publishable" podem ir no app, e chaves de serviço ficam só no servidor (env/secrets).
  2. **Opções gratuitas comparadas** (tabela: cota grátis real, limites, pausa por inatividade, vendor lock-in, facilidade para um dev solo): Supabase Free, Firebase Spark, Cloudflare (Workers + D1 + KV + Turnstile), Appwrite Cloud Free, PocketBase auto-hospedado. Recomendar uma, com justificativa.
  3. **Funcionalidades pedidas** e como cada opção entrega: cadastro e login com e-mail e senha; confirmação de e-mail válido (link ou OTP) e o limite de envio de e-mail grátis (SMTP próprio, ex.: Resend/Brevo free tier); troca e recuperação de senha; sessão/JWT com expiração e refresh; limite de aparelhos/telas por conta.
  4. **Mensalidade com cancelamento automático:** modelo de dados; como receber pagamento no Brasil (PIX/cartão via Mercado Pago ou Asaas, e Stripe como comparação), com o custo por transação (nenhum gateway é "grátis" por transação: deixar isso explícito); webhook de pagamento que ativa ou renova; job agendado (pg_cron / Cloudflare Cron Triggers) que vence e bloqueia contas atrasadas, com período de carência; e o app checando o status no login e ao abrir.
  5. **Esquema de banco proposto** (SQL comentado): `profiles`, `plans`, `subscriptions` (status: trialing/active/past_due/canceled, `current_period_end`), `payments` (id do gateway, idempotência), `devices`/`sessions` (limite de telas), `audit_log`. Com as políticas de Row Level Security.
  6. **Segurança** (checklist prático): hash de senha (bcrypt/argon2, feito pelo provedor); rate limit e bloqueio após tentativas; CAPTCHA (Turnstile) no cadastro, no login e no "esqueci a senha"; RLS obrigatório; validação de webhook por assinatura; segredos em env (`.env` fora do git, secrets do provedor/GitHub Actions); HTTPS; CORS restrito; proteção contra DDoS (Cloudflare na frente); o que NÃO proteger no cliente (o app pode ser descompilado, então a regra de acesso fica no servidor); backups e LGPD (dados mínimos, exclusão de conta).
  7. **Riscos e ponto de atenção legal:** cobrar mensalidade por acesso a canais ou filmes exige ter direito de distribuição desse conteúdo; IPTV sem licença é alvo ativo de bloqueio (Anatel) e de ação judicial. Deixar o backend neutro (conta e assinatura do app/player) e o conteúdo sob responsabilidade da lista do próprio usuário. Um parágrafo objetivo, sem sermão.
  8. **Próximos passos sugeridos** (fases), sem implementar nada.

- [ ] **Step 2: Commit** `docs: research on a free backend for users, login and subscriptions`.

---

### Task 7: Regenerar o `www/`, verificação, push da v7 e builds

**Files:**
- Modify: `www/index.html` (gerado)

- [ ] **Step 1:** `node scripts/prepare-mobile.js` e depois `npm test`. Tudo deve passar.
- [ ] **Step 2:** Teste de fumaça no Chrome headless (tela 390×844, app nativo simulado), cobrindo:
  - ida e volta de Configurações com um filme selecionado: o player deve voltar grande;
  - menu aberto com o mini-player: o mini deve sumir;
  - app aberto com lista carregada: player ocioso, sem nome de canal;
  - filme apontando para um servidor que recusa: tela de erro com "Copiar diagnóstico" e texto sem URL.
- [ ] **Step 3:** Commit `chore: regenerate www/index.html for v7`.
- [ ] **Step 4:** `git push -u origin v7`, disparar o workflow "Build Android APK e iOS IPA" na `v7` e baixar `app ios/sintoniza-ios-unsigned-v7.ipa` e `app android/sintoniza-android-debug-v7.apk`.
- [ ] **Step 5:** A `main` só muda depois do OK do Gustavo no iPhone.

## Roteiro de teste no iPhone (e no Android do amigo)

1. Com um filme tocando, abrir Configurações e voltar: o player grande está no topo.
2. Com o mini-player visível, tocar nas 3 listras: o mini some e volta ao fechar o menu.
3. Abrir o app do zero: o player aparece só com o fundo preto e dourado.
4. Deixar um canal instável: nenhum aviso de "buffer" aparece.
5. **No Android do amigo:** abrir um filme. Se der erro, tocar em "Copiar diagnóstico" e mandar o texto. As linhas "Servidor" e "Formatos do aparelho" respondem a causa com certeza.
