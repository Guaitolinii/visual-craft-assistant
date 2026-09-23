# Sintoniza v8: Downloads, tela flutuante e correções. Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** Entregar na v8, a partir da `main` = v7:
- as correções da v7.1 (segurança dos textos vindos do provedor e cancelamento da sondagem do diagnóstico);
- os cartões "?" corrigidos nos recentes;
- um "x" no mini-player;
- downloads de filmes e séries (com o app aberto ou minimizado);
- a janela flutuante (PiP) ao sair do app;
- o app da TV com a mesma correção de segurança e empacotado para o teste da noite.

**Arquitetura:** Mesmo padrão da v6/v7: `sintoniza-link.html` é um arquivo único; regras novas viram funções puras testadas via `tests/vod/loadVodHelpers.js` (`PURE_HELPER_NAMES`). Recursos nativos são chamados pelo bridge do Capacitor sem bundler:
- `callNativePlugin(plugin, método, opções)` → `Capacitor.nativePromise`;
- progresso via `Capacitor.addListener(plugin, evento, cb)`;
- arquivo local tocado via `Capacitor.convertFileSrc(uri)`.

Os três existem no `native-bridge.js` do Capacitor 8 (verificado em `node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js`).

**Tech Stack:** HTML/JS vanilla, Capacitor 8 + plugins oficiais `@capacitor/filesystem` 8.1.3 (download/arquivos) e `@capacitor/share` 8.0.2 (já instalados, autorizados pelo Gustavo), plugin Android local `SintonizaPip` (Java), `node:test`.

**Branch:** `v8`, criada a partir da `main` (`1fbc9b6`).

**Autorizações do Gustavo (2026-09-23):**
- instalar `@capacitor/filesystem` e `@capacitor/share`;
- ajustes nativos (`Info.plist`, `AndroidManifest`, `MainActivity`);
- download só com o app aberto ou minimizado;
- seguir sem pedir aprovação durante a execução.

## Restrições globais

- Não usar `sed -i` em arquivos CRLF (a cópia de trabalho é CRLF, `core.autocrlf=true`). Use a ferramenta Edit.
- `npm test` (136 passando na base). Ele regenera `www/index.html`: não commitar esse arquivo nas tasks; quem commita é a Task 9. Pode restaurar com `git checkout -- www/index.html`.
- Commit: `git -c user.name="Gustavo Guaitolini" -c user.email="gustavo.guaitolini@pbastones.com.br" commit ...`, mensagem terminando em `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push, exceto na Task 9.
- Comentários em português. `downloadFile` do Filesystem está marcado como obsoleto (em favor de `@capacitor/file-transfer`), mas funciona na 8.x. Usamos ele para não instalar outro plugin sem autorização.

## Pontos e onde cada um é resolvido

| # | Ponto | Task |
|---|---|---|
| 1 | v7.1: nomes/capas do provedor entram no HTML sem tratamento (XSS) | Task 1 |
| 2 | v7.1: sondagem do diagnóstico não é cancelada ao tocar "Tentar novamente" | Task 1 |
| 3 | Retângulos laranja com "?" no fim dos recentes | Task 2 |
| 4 | "x" para fechar o mini-player | Task 3 |
| 5 | Downloads (filme, episódio, temporada, série completa), item "Downloads" no menu, salvar no aparelho/Arquivos | Tasks 4 e 5 |
| 6 | Janela flutuante ao sair do app, que só fecha no "x" ou fechando o app | Task 6 |
| 7 | App da TV pronto para teste hoje à noite | Task 7 |
| 8 | Pesquisa: vários perfis dentro de um login (só investigação) | Task 8 (subagente de pesquisa, já em andamento) |

---

### Task 1: Segurança dos textos do provedor + sondagem cancelável (v7.1)

**Causa do ponto 1:** `parseM3U` guarda `name`/`category`/`logo` crus da lista, e os catálogos de VOD guardam `name`/`stream_icon`/`cover` crus da API. Os templates (`cardHTML`, `listHTML`, `renderOnNow`, `logoImgOrInitials`, `vodCardHtml`, `homeRecentCardHtml`, episódios no `openVodModal`) interpolam esses valores em `innerHTML`. Um título como `<img src=x onerror=...>` executaria código com acesso ao bridge nativo.

**Correção em duas camadas:**
- limpar na entrada (nome e categoria sem `<>"`, logo/capa só `http(s)://` sem espaço nem aspas);
- escapar nos templates de VOD e dos episódios.

**Files:** `sintoniza-link.html`, `tests/vod/loadVodHelpers.js` (`PURE_HELPER_NAMES` += `"sanitizeLabel", "sanitizeImageUrl", "sanitizeVodItem", "parseM3U"`), `tests/vod/text-safety.test.js` (novo).

- [ ] **Step 1: Testes que falham**

```js
// tests/vod/text-safety.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("sanitizeLabel tira caracteres que abrem HTML", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.sanitizeLabel('<img src=x onerror="alert(1)">ESPN'), "img src=x onerror=alert(1)ESPN");
  assert.equal(ctx.sanitizeLabel("A&E Brasil"), "A&E Brasil");
  assert.equal(ctx.sanitizeLabel(null), "");
});

test("sanitizeImageUrl só aceita http(s) sem aspas/espaços", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.sanitizeImageUrl("https://cdn.x/logo.png"), "https://cdn.x/logo.png");
  assert.equal(ctx.sanitizeImageUrl('x" onerror="alert(1)'), "");
  assert.equal(ctx.sanitizeImageUrl("javascript:alert(1)"), "");
  assert.equal(ctx.sanitizeImageUrl(""), "");
});

test("sanitizeVodItem limpa nome, capa e plot do item da API", () => {
  const ctx = loadVodHelpers();
  const out = ctx.sanitizeVodItem({ stream_id: 1, name: "<b>Duna</b>", stream_icon: "javascript:x", cover: "https://c/d.jpg", plot: "<script>x</script>ok" });
  assert.equal(out.name, "bDuna/b");
  assert.equal(out.stream_icon, "");
  assert.equal(out.cover, "https://c/d.jpg");
  assert.equal(out.plot, "scriptx/scriptok");
  assert.equal(out.stream_id, 1);
});

test("parseM3U limpa nome, categoria e logo maliciosos", () => {
  const ctx = loadVodHelpers();
  const m3u = '#EXTM3U\n#EXTINF:-1 tvg-logo="x&quot; onerror=&quot;alert(1)" group-title="<b>Esportes</b>",<img src=x onerror=alert(1)>ESPN\nhttp://srv/live/u/p/1.ts\n';
  const [ch] = ctx.parseM3U(m3u);
  assert.equal(ch.name, "img src=x onerror=alert(1)ESPN");
  assert.equal(ch.category, "bEsportes/b");
  assert.equal(ch.logo, null);
});
```

- [ ] **Step 2:** `node --test tests/vod/text-safety.test.js` deve dar FAIL.

- [ ] **Step 3: Funções puras**, logo antes de `function parseM3U`:

```js
// ─── Textos vindos do provedor (lista M3U / API Xtream) ───
// Entram no HTML da tela; um nome como <img onerror=...> rodaria código
// com acesso ao bridge nativo do app. Limpamos na entrada: rótulo sem
// < > " e imagem só http(s) sem aspas/espaços (v8, correção da v7.1).
function sanitizeLabel(text) {
  return String(text == null ? "" : text).replace(/[<>"]/g, "").trim();
}

function sanitizeImageUrl(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : "";
}

function sanitizeVodItem(item) {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  ["name", "title", "plot", "category_name"].forEach(k => { if (out[k] != null) out[k] = sanitizeLabel(out[k]); });
  ["stream_icon", "cover"].forEach(k => { if (out[k] != null) out[k] = sanitizeImageUrl(out[k]); });
  return out;
}
```

Em `parseM3U`, no bloco `extinf = { ... }`, trocar por:

```js
      extinf = {
        name:     sanitizeLabel(displayName || (tvgName ? tvgName[1] : 'Canal')) || 'Canal',
        logo:     logoMatch  ? (sanitizeImageUrl(logoMatch[1]) || null) : null,
        category: groupMatch ? (sanitizeLabel(groupMatch[1]) || 'Geral') : 'Geral',
      };
```

Em `loadVodCatalog`, trocar `const deduped = dedupeVodItemsByTitle(streams);` por `const deduped = dedupeVodItemsByTitle(streams.map(sanitizeVodItem));`. Também aplicar `sanitizeVodItem` aos itens de categoria antes de usá-los (`const cats = (await catRes.json())` → `.map(sanitizeVodItem)` se for array). No `openVodModal` das séries: `const episodes = Object.values(data.episodes || {}).flat().map(sanitizeVodItem);`.

Nos templates de VOD, escapar mesmo assim, porque a Minha Lista e o histórico antigos já estão salvos:
- `vodCardHtml`: `const poster = escapeHtmlText(sanitizeImageUrl(item.stream_icon || item.cover || ""));` e `<p>${escapeHtmlText(title)}</p>`;
- nos episódios do modal: `${escapeHtmlText(epTitle)}`;
- `vodCardArtHtml`: `src="${escapeHtmlText(cover)}"`.

- [ ] **Step 4: Sondagem cancelável.** Guardar o controller atual:

```js
// Controller da sondagem HEAD em andamento: uma reprodução nova (retry,
// outro filme) cancela a sondagem velha para ela não ocupar a vaga de tela
// no servidor (v8, correção da v7.1).
let _pendingProbeController = null;
function abortPendingProbe() {
  if (_pendingProbeController) { try { _pendingProbeController.abort(); } catch (e) {} _pendingProbeController = null; }
}
```

Em `probeVodUrl`, logo depois de `const controller = new AbortController();`, colocar `_pendingProbeController = controller;`. No `finally` implícito, ao terminar request ou timeout, limpar só se ainda for o mesmo: `if (_pendingProbeController === controller) _pendingProbeController = null;`, nos dois ramos, junto com o `clearTimeout(timer)`. Chamar `abortPendingProbe();` logo depois de `const gen = ++playbackGeneration;` em `playStream` e logo depois de `playbackGeneration++;` em `stopStream`.

- [ ] **Step 5:** `npm test` deve dar PASS.
- [ ] **Step 6: Commit** `fix(security): sanitize provider text/images and cancel stale diagnostic probes`.

---

### Task 2: Cartões "?" nos recentes

**Causa:** versões antigas gravavam `sint_recents` como números (o id do canal). A conversão do `_state` só trata texto, então o número segue cru. Em `homeRecentCardHtml` ele não tem `type`, cai em `continueCardHtml` sem título e vira a inicial "?". Por não ter `ts`, vai para o fim.

**Files:** `sintoniza-link.html`, `tests/vod/loadVodHelpers.js` (`PURE_HELPER_NAMES` += `"normalizeChannelRecents"`), `tests/vod/home-recents.test.js`.

- [ ] **Step 1: Teste que falha** (acrescentar em `tests/vod/home-recents.test.js`):

```js
test("normalizeChannelRecents converte ids antigos (número/texto) e descarta lixo", () => {
  const ctx = loadVodHelpers();
  const out = ctx.normalizeChannelRecents([5, "7", { id: 3, type: "channel", ts: 10 }, null, "", { foo: 1 }], 100000);
  assert.deepEqual(out, [
    { id: 5, type: "channel", ts: 99000 },
    { id: 7, type: "channel", ts: 98000 },
    { id: 3, type: "channel", ts: 10 },
  ]);
  assert.deepEqual(ctx.normalizeChannelRecents("lixo", 1), []);
});
```

- [ ] **Step 2:** o teste deve dar FAIL.

- [ ] **Step 3: Implementar.** Função pura, perto de `getUnifiedRecentItems`:

```js
// Recentes de canal gravados por versões antigas: número ou texto (id do
// canal) viram { id, type: "channel", ts }; o resto é descartado. Antes,
// ids numéricos antigos viravam cartões laranja com "?" no fim da lista.
function normalizeChannelRecents(raw, nowMs) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const fallbackTs = nowMs - (i + 1) * 1000;
    if (typeof item === "number") return { id: item, type: "channel", ts: fallbackTs };
    if (typeof item === "string" && item.trim()) {
      return { id: /^\d+$/.test(item) ? Number(item) : item, type: "channel", ts: fallbackTs };
    }
    if (item && typeof item === "object" && item.id != null) {
      return { ...item, type: item.type || "channel", ts: Number(item.ts) || fallbackTs };
    }
    return null;
  }).filter(Boolean);
}
```

Em `_state`, trocar a linha `recents:` (e a `.map` dela) por:

```js
  recents:   normalizeChannelRecents(JSON.parse(localStorage.getItem("sint_recents") || "[]"), Date.now()),
```

Em `homeRecentCardHtml`, antes de `return continueCardHtml(item);`:

```js
  // Só filme/série de verdade; entradas sem tipo conhecido não viram cartão
  if (item.type !== "vod" && item.type !== "series") return "";
```

- [ ] **Step 4:** `npm test` deve dar PASS. **Step 5: Commit** `fix(home): convert legacy numeric channel recents and drop unknown entries (no more "?" cards)`.

---

### Task 3: "x" no mini-player

**Files:** `sintoniza-link.html`, `tests/player/player-markup.test.js`.

- [ ] **Step 1: Teste que falha:**

```js
test("mini-player tem um x para fechar", () => {
  assert.ok(html.includes('id="mini-close-btn"'), "botão x do mini-player não existe");
  assert.match(html, /#player-screen\.mini-player \.mini-close-btn\s*\{[^}]*display:\s*flex/);
  assert.match(html, /function closeMiniPlayer\(\)/);
});
```

- [ ] **Step 2:** o teste deve dar FAIL.

- [ ] **Step 3: Implementar.** Markup logo depois do `</button>` do `#mini-play-btn`:

```html
        <button class="mini-close-btn" id="mini-close-btn" aria-label="Fechar o mini-player">
          <i data-lucide="x" style="width:20px;height:20px"></i>
        </button>
```

CSS logo depois da regra `#player-screen.mini-player .mini-play-btn { … }`:

```css
    .mini-close-btn { display: none; }
    #player-screen.mini-player .mini-close-btn {
      display: flex !important; align-items: center; justify-content: center;
      width: 2.5rem; height: 2.5rem; flex-shrink: 0;
      background: none; border: none; color: var(--muted-fg); cursor: pointer;
    }
```

JS, logo depois de `closeCardActions` (ou perto de `setPlayerMode`):

```js
// "x" do mini-player: para o que está tocando e deixa o player ocioso
// (fundo preto e dourado). O progresso do filme/episódio já está salvo.
function closeMiniPlayer() {
  stopStream();
  setState({ selected: null, playing: false });
}
```

Listener no boot, junto dos do mini-player:

```js
  document.getElementById("mini-close-btn").addEventListener("click", e => {
    e.stopPropagation();
    closeMiniPlayer();
  });
```

- [ ] **Step 4:** `npm test` deve dar PASS. **Step 5: Commit** `feat(player): close button on the mini-player`.

---

### Task 4: Downloads, regras puras (fila, nomes, agrupamento)

**Files:** `sintoniza-link.html`, `tests/vod/loadVodHelpers.js` (`PURE_HELPER_NAMES` += `"safeFileBase", "buildDownloadEntry", "enqueueDownloads", "nextQueuedDownload", "updateDownload", "removeDownload", "resetInterruptedDownloads", "groupDownloads", "formatDownloadProgress", "seasonsOf"`), `tests/vod/downloads.test.js` (novo).

- [ ] **Step 1: Testes que falham**

```js
// tests/vod/downloads.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const movie = ctx => ctx.buildDownloadEntry({ kind: "movie", id: 9, title: "Duna: Parte 2", cover: "https://c/d.jpg", ext: "mp4", url: "http://s/movie/u/p/9.mp4" }, 1000);
const ep = (ctx, id, code, ts = 2000) => ctx.buildDownloadEntry({ kind: "episode", id, title: `Dark · ${code}`, seriesName: "Dark", code, cover: "", ext: "mkv", url: `http://s/series/u/p/${id}.mkv`, seriesId: 77 }, ts);

test("buildDownloadEntry monta nome de arquivo seguro e estado inicial", () => {
  const ctx = loadVodHelpers();
  const m = movie(ctx);
  assert.equal(m.key, "movie-9");
  assert.equal(m.fileName, "Duna  Parte 2 [9].mp4".replace("  ", " "));
  assert.equal(m.status, "queued");
  assert.equal(ep(ctx, 501, "S01E03").fileName, "Dark - S01E03 [501].mkv");
  assert.equal(ctx.buildDownloadEntry({ kind: "movie", id: 1, title: "X", ext: "mp4&x=1", url: "u" }, 1).fileName, "X [1].mp4");
});

test("safeFileBase remove caracteres proibidos", () => {
  assert.equal(loadVodHelpers().safeFileBase('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
});

test("enqueueDownloads não duplica e nextQueuedDownload respeita um por vez", () => {
  const ctx = loadVodHelpers();
  let list = ctx.enqueueDownloads([], [movie(ctx), ep(ctx, 501, "S01E03")]);
  list = ctx.enqueueDownloads(list, [movie(ctx)]);
  assert.equal(list.length, 2);
  assert.equal(ctx.nextQueuedDownload(list).key, "movie-9");
  list = ctx.updateDownload(list, "movie-9", { status: "downloading" });
  assert.equal(ctx.nextQueuedDownload(list), null);
  list = ctx.updateDownload(list, "movie-9", { status: "done" });
  assert.equal(ctx.nextQueuedDownload(list).key, "episode-501");
  assert.equal(ctx.removeDownload(list, "movie-9").length, 1);
});

test("resetInterruptedDownloads devolve 'baixando' para a fila", () => {
  const ctx = loadVodHelpers();
  const list = ctx.resetInterruptedDownloads([{ key: "a", status: "downloading", bytes: 50 }, { key: "b", status: "done", bytes: 9 }]);
  assert.deepEqual(list.map(e => [e.status, e.bytes]), [["queued", 0], ["done", 9]]);
});

test("groupDownloads separa filmes e agrupa episódios por série, em ordem", () => {
  const ctx = loadVodHelpers();
  const g = ctx.groupDownloads([ep(ctx, 502, "S01E04"), movie(ctx), ep(ctx, 501, "S01E03")]);
  assert.deepEqual(g.movies.map(e => e.key), ["movie-9"]);
  assert.equal(g.series.length, 1);
  assert.equal(g.series[0].seriesName, "Dark");
  assert.deepEqual(g.series[0].episodes.map(e => e.code), ["S01E03", "S01E04"]);
});

test("formatDownloadProgress e seasonsOf", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.formatDownloadProgress(805306368, 1610612736), "50% · 768 MB de 1.5 GB");
  assert.equal(ctx.formatDownloadProgress(0, 0), "");
  assert.deepEqual(ctx.seasonsOf([{ season: "2" }, { season: 1 }, { season: "2" }, {}]), [1, 2]);
});
```

- [ ] **Step 2:** os testes devem dar FAIL.

- [ ] **Step 3: Implementar**, num bloco novo `// ─── Downloads (v8) ───`, logo depois das funções da Minha Lista:

```js
// ─── Downloads (v8) ───
// Filmes/episódios salvos no aparelho para ver sem internet. Um download
// por vez (o provedor conta cada download como uma tela). Entrada:
// { key, kind: "movie"|"episode", id, title, seriesName, code, cover, url,
//   seriesId, fileName, status: queued|downloading|done|error, bytes,
//   total, error, ts, fileUri }
const DOWNLOADS_KEY = "sint_downloads";
const DOWNLOAD_DIR_NAME = "Sintoniza";

function safeFileBase(text) {
  return String(text || "video").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "video";
}

function buildDownloadEntry({ kind, id, title, seriesName, code, cover, ext, url, seriesId }, nowMs) {
  const fileExt = /^[a-z0-9]{1,5}$/i.test(ext || "") ? String(ext).toLowerCase() : "mp4";
  const label = kind === "episode" ? `${seriesName || "Série"} - ${code || ""}`.trim() : (title || "Filme");
  return {
    key: `${kind}-${id}`, kind, id: String(id), title: title || label,
    seriesName: seriesName || "", code: code || "", cover: cover || "", url,
    seriesId: seriesId != null ? String(seriesId) : "",
    fileName: `${safeFileBase(label)} [${id}].${fileExt}`,
    status: "queued", bytes: 0, total: 0, error: "", ts: nowMs, fileUri: "",
  };
}

function enqueueDownloads(list, entries) {
  const keys = new Set(list.map(e => e.key));
  const added = [];
  entries.forEach(e => { if (!keys.has(e.key)) { keys.add(e.key); added.push(e); } });
  return list.concat(added);
}

function nextQueuedDownload(list) {
  if (list.some(e => e.status === "downloading")) return null;
  return list.find(e => e.status === "queued") || null;
}

function updateDownload(list, key, patch) {
  return list.map(e => (e.key === key ? { ...e, ...patch } : e));
}

function removeDownload(list, key) {
  return list.filter(e => e.key !== key);
}

// Ao abrir o app: o que estava "baixando" foi interrompido (app fechado),
// então volta para a fila e recomeça.
function resetInterruptedDownloads(list) {
  return list.map(e => (e.status === "downloading" ? { ...e, status: "queued", bytes: 0 } : e));
}

function groupDownloads(list) {
  const movies = list.filter(e => e.kind === "movie").sort((a, b) => b.ts - a.ts);
  const bySeries = new Map();
  list.filter(e => e.kind === "episode").forEach(e => {
    const k = e.seriesId || e.seriesName;
    if (!bySeries.has(k)) bySeries.set(k, { seriesName: e.seriesName, cover: e.cover, episodes: [] });
    bySeries.get(k).episodes.push(e);
  });
  const series = Array.from(bySeries.values()).map(s => ({
    ...s, episodes: s.episodes.slice().sort((a, b) => a.code.localeCompare(b.code)),
  }));
  return { movies, series };
}

function formatDownloadProgress(bytes, total) {
  if (!total) return bytes ? formatBytes(bytes) : "";
  const pct = Math.min(100, Math.floor((bytes / total) * 100));
  return `${pct}% · ${formatBytes(bytes) || "0 MB"} de ${formatBytes(total)}`;
}

function seasonsOf(episodes) {
  return Array.from(new Set(episodes.map(e => Number(e.season)).filter(n => n > 0))).sort((a, b) => a - b);
}
```

(No teste do nome do filme, "Duna: Parte 2" vira "Duna Parte 2 [9].mp4": o ":" vira espaço e os espaços duplos se juntam.)

- [ ] **Step 4:** `npm test` deve dar PASS. **Step 5: Commit** `feat(downloads): pure queue/naming/grouping rules`.

---

### Task 5: Downloads, motor nativo, tela "Downloads" e botões de baixar

**Files:** `sintoniza-link.html`; `ios/App/App/Info.plist`; `android/app/src/main/AndroidManifest.xml`; arquivos gerados pelo `npx cap sync` (`ios/App/CapApp-SPM/Package.swift`, `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`) e `package.json`/`package-lock.json` (plugins já instalados); `tests/player/player-markup.test.js`.

- [ ] **Step 1: Teste de estrutura que falha:**

```js
test("tela e menu de Downloads existem, com baixar filme/episódio/temporada/série", () => {
  for (const id of ["nav-downloads-btn", "downloads-view", "downloads-list", "vod-modal-download"]) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" não existe`);
  }
  assert.match(html, /data-dl-season=/);
  assert.match(html, /data-dl-series=/);
  assert.match(html, /class="ep-dl-btn"/);
  assert.match(html, /callNativePlugin\("Filesystem", "downloadFile"/);
});
```

- [ ] **Step 2:** o teste deve dar FAIL.

- [ ] **Step 3: Configuração nativa.**
  - `ios/App/App/Info.plist`: antes de `<key>UIViewControllerBasedStatusBarAppearance</key>`, acrescentar
    `<key>UIFileSharingEnabled</key><true/>` e `<key>LSSupportsOpeningDocumentsInPlace</key><true/>`. Com isso, a pasta do app aparece no app **Arquivos** ("No meu iPhone › Sintoniza TV").
  - `android/app/src/main/AndroidManifest.xml`: na tag `<application`, acrescentar `android:requestLegacyExternalStorage="true"`. Antes de `</manifest>`, acrescentar
    `<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />` e `<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />`. É isso que permite gravar em Documentos no Android 10 e anteriores. No 11+, o app grava na própria pasta dentro de Documentos, sem permissão.
  - Rodar `npx cap sync`, que inclui os plugins Filesystem e Share nos projetos nativos. Commitar só os arquivos gerados que mudarem de verdade: descartar alterações que sejam só de fim de linha em `android/capacitor-cordova-android-plugins` e `ios/capacitor-cordova-ios-plugins` com `git checkout --`.

- [ ] **Step 4: Motor (JS)**, logo depois das funções puras da Task 4:

```js
let _downloads = [];
let _downloadListenerOn = false;

function loadDownloads() {
  try { return JSON.parse(localStorage.getItem(DOWNLOADS_KEY) || "[]"); } catch (e) { return []; }
}
function setDownloads(list) {
  _downloads = list;
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(list));
  renderDownloads();
}

// Download só existe no app instalado (precisa do plugin Filesystem).
function canDownload() {
  return isNativeApp() && isNativePluginAvailable("Filesystem");
}

// Progresso vem do plugin a cada ~100ms; atualiza só a linha na tela (sem
// regravar o localStorage a cada pedaço).
function ensureDownloadProgressListener() {
  const cap = window.Capacitor;
  if (_downloadListenerOn || !cap || typeof cap.addListener !== "function") return;
  _downloadListenerOn = true;
  cap.addListener("Filesystem", "progress", data => {
    const active = _downloads.find(e => e.status === "downloading");
    if (!active || !data) return;
    active.bytes = Number(data.bytes) || 0;
    active.total = Number(data.contentLength) || active.total;
    updateDownloadRow(active);
  });
}

async function processDownloadQueue() {
  if (!canDownload()) return;
  const next = nextQueuedDownload(_downloads);
  if (!next) return;
  ensureDownloadProgressListener();
  setDownloads(updateDownload(_downloads, next.key, { status: "downloading", error: "", bytes: 0 }));
  try {
    if (window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "android") {
      await callNativePlugin("Filesystem", "requestPermissions"); // só o Android ≤10 pede
    }
    const result = await callNativePlugin("Filesystem", "downloadFile", {
      url: next.url, path: `${DOWNLOAD_DIR_NAME}/${next.fileName}`, directory: "DOCUMENTS", progress: true, recursive: true,
    });
    if (!result) throw new Error("recurso de download indisponível");
    const cur = _downloads.find(e => e.key === next.key);
    if (cur) setDownloads(updateDownload(_downloads, next.key, { status: "done", bytes: cur.total || cur.bytes, fileUri: result.path || "" }));
  } catch (e) {
    if (_downloads.some(x => x.key === next.key)) {
      setDownloads(updateDownload(_downloads, next.key, { status: "error", error: sanitizeDiagnosticText((e && e.message) || String(e)) }));
    }
  }
  processDownloadQueue();
}

function queueDownloads(entries) {
  if (!canDownload()) { showToast("Downloads funcionam no app instalado (iPhone/Android)."); return; }
  const before = _downloads.length;
  setDownloads(enqueueDownloads(_downloads, entries));
  const added = _downloads.length - before;
  showToast(added ? `${added} ${added > 1 ? "itens adicionados" : "item adicionado"} aos downloads` : "Já está nos downloads");
  processDownloadQueue();
}

async function downloadFileUri(entry) {
  if (entry.fileUri) return entry.fileUri;
  const r = await callNativePlugin("Filesystem", "getUri", { path: `${DOWNLOAD_DIR_NAME}/${entry.fileName}`, directory: "DOCUMENTS" });
  return (r && r.uri) || "";
}

async function playDownloaded(entry) {
  const uri = await downloadFileUri(entry);
  if (!uri) { showToast("Arquivo não encontrado."); return; }
  const isEp = entry.kind === "episode";
  playVodSelection(window.Capacitor.convertFileSrc(uri), {
    id: entry.id, contType: isEp ? "series" : "vod", title: entry.title, cover: entry.cover,
  });
}

async function shareDownloaded(entry) {
  const uri = await downloadFileUri(entry);
  if (!uri) { showToast("Arquivo não encontrado."); return; }
  try { await callNativePlugin("Share", "share", { title: entry.title, files: [uri] }); } catch (e) {}
}

async function deleteDownloaded(entry) {
  if (entry.status === "done" || entry.status === "error") {
    try { await callNativePlugin("Filesystem", "deleteFile", { path: `${DOWNLOAD_DIR_NAME}/${entry.fileName}`, directory: "DOCUMENTS" }); } catch (e) {}
  }
  setDownloads(removeDownload(_downloads, entry.key));
}
```

- [ ] **Step 5: Tela e menu.**
  - Sidebar: dentro de `.sidebar-nav`, logo depois do botão "Canais" (`data-section="Todos os canais"`), acrescentar
    `<button class="nav-item" id="nav-downloads-btn" style="display:none"><i data-lucide="download" style="width:19px;height:19px"></i><span>Downloads</span></button>`.
  - View, logo depois de `<!-- /vod-view -->`:

```html
  <!-- ══ DOWNLOADS VIEW (v8) ══ -->
  <div class="view hidden" id="downloads-view">
    <div class="content-shell">
      <section class="welcome-row">
        <div>
          <p class="eyebrow">DOWNLOADS</p>
          <h1>Seus downloads</h1>
          <p>Filmes e episódios salvos no aparelho para assistir sem internet. Baixa com o app aberto ou minimizado.</p>
        </div>
      </section>
      <div id="downloads-list"></div>
    </div>
  </div><!-- /downloads-view -->
```

  - `renderPageSection()`: acrescentar `document.getElementById("downloads-view").classList.toggle("hidden", section !== "downloads");`. Em `renderNav()`: `document.getElementById("nav-downloads-btn").classList.toggle("active", section === "downloads");`.
  - Render da tela:

```js
const DOWNLOAD_STATUS_LABEL = { queued: "Na fila", downloading: "Baixando", done: "Baixado", error: "Erro" };

function downloadRowHtml(entry) {
  const label = entry.kind === "episode" ? (entry.code || entry.title) : entry.title;
  const progress = entry.status === "downloading" || entry.status === "done" ? formatDownloadProgress(entry.bytes, entry.total) : "";
  const pct = entry.total ? Math.min(100, Math.floor((entry.bytes / entry.total) * 100)) : 0;
  const actions = [
    entry.status === "done" ? `<button class="dl-btn" data-dl-action="play" aria-label="Assistir"><i data-lucide="play" style="width:18px;height:18px"></i></button>` : "",
    entry.status === "done" ? `<button class="dl-btn" data-dl-action="share" aria-label="Salvar em Arquivos / compartilhar"><i data-lucide="share-2" style="width:18px;height:18px"></i></button>` : "",
    entry.status === "error" ? `<button class="dl-btn" data-dl-action="retry" aria-label="Tentar de novo"><i data-lucide="rotate-cw" style="width:18px;height:18px"></i></button>` : "",
    entry.status !== "downloading" ? `<button class="dl-btn danger" data-dl-action="remove" aria-label="Remover"><i data-lucide="trash-2" style="width:18px;height:18px"></i></button>` : "",
  ].join("");
  return `
    <div class="dl-row" data-dl-key="${escapeHtmlText(entry.key)}">
      <div class="dl-info">
        <p class="dl-title">${escapeHtmlText(label)}</p>
        <p class="dl-status" data-dl-status>${DOWNLOAD_STATUS_LABEL[entry.status] || ""}${progress ? " · " + escapeHtmlText(progress) : ""}${entry.status === "error" && entry.error ? " · " + escapeHtmlText(entry.error) : ""}</p>
        ${entry.status === "downloading" ? `<div class="dl-bar"><span data-dl-bar style="width:${pct}%"></span></div>` : ""}
      </div>
      <div class="dl-actions">${actions}</div>
    </div>`;
}

function renderDownloads() {
  const el = document.getElementById("downloads-list");
  if (!el || _state.section !== "downloads") return;
  if (!_downloads.length) {
    el.innerHTML = `<div class="empty-state"><i data-lucide="download" style="width:2rem;height:2rem"></i><h3>Nenhum download ainda</h3><p>Abra um filme ou série e toque em "Baixar".</p></div>`;
    lucide.createIcons();
    return;
  }
  const { movies, series } = groupDownloads(_downloads);
  el.innerHTML = (movies.length ? `<div class="dl-group"><h2>Filmes</h2>${movies.map(downloadRowHtml).join("")}</div>` : "")
    + series.map(s => `<div class="dl-group"><h2>${escapeHtmlText(s.seriesName || "Série")}</h2>${s.episodes.map(downloadRowHtml).join("")}</div>`).join("");
  lucide.createIcons();
}

// Atualiza só a linha que está baixando (chamado a cada evento de progresso).
function updateDownloadRow(entry) {
  const row = document.querySelector(`.dl-row[data-dl-key="${CSS.escape(entry.key)}"]`);
  if (!row) return;
  const status = row.querySelector("[data-dl-status]");
  if (status) status.textContent = `Baixando · ${formatDownloadProgress(entry.bytes, entry.total)}`;
  const bar = row.querySelector("[data-dl-bar]");
  if (bar && entry.total) bar.style.width = `${Math.min(100, Math.floor((entry.bytes / entry.total) * 100))}%`;
}
```

CSS, junto do bloco do VOD:

```css
    /* ════════════ DOWNLOADS (v8) ════════════ */
    .dl-group { margin-bottom: 1.75rem; }
    .dl-group h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: .75rem; }
    .dl-row {
      display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; margin-bottom: .5rem;
      background: var(--card); border: 1px solid var(--border); border-radius: .6rem;
    }
    .dl-info { flex: 1; min-width: 0; }
    .dl-title { font-weight: 600; font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dl-status { font-size: .75rem; color: var(--muted-fg); margin-top: .15rem; }
    .dl-bar { height: 4px; background: var(--secondary); border-radius: 4px; margin-top: .4rem; overflow: hidden; }
    .dl-bar span { display: block; height: 100%; background: var(--primary); transition: width 300ms; }
    .dl-actions { display: flex; gap: .35rem; flex-shrink: 0; }
    .dl-btn { width: 2.4rem; height: 2.4rem; border-radius: 999px; border: none; background: var(--secondary); color: var(--foreground); display: flex; align-items: center; justify-content: center; }
    .dl-btn.danger { color: var(--error); }
    .vod-dl-bar { display: flex; flex-wrap: wrap; gap: .5rem; margin: .25rem 0 .75rem; }
    .ep-row { display: flex; gap: .5rem; align-items: stretch; }
    .ep-row .ep-btn { flex: 1; }
    .ep-dl-btn { width: 3rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--card); color: var(--foreground); display: flex; align-items: center; justify-content: center; }
```

  - Boot (DOMContentLoaded):
    - `document.getElementById("nav-downloads-btn").style.display = canDownload() ? "" : "none";`
    - clique no item de menu: `setState({ section: "downloads" }); closeSidebar(); window.scrollTo({ top: 0 }); renderDownloads();`
    - delegação em `#downloads-list` por `[data-dl-action]`: acha a linha `.dl-row` e a entrada em `_downloads`; `play` → `playDownloaded`, `share` → `shareDownloaded`, `remove` → `deleteDownloaded`, `retry` → `setDownloads(updateDownload(_downloads, key, { status: "queued", error: "" })); processDownloadQueue();`.
    - no fim do boot: `_downloads = resetInterruptedDownloads(loadDownloads()); localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(_downloads)); processDownloadQueue();`
  - Em `render()`, depois de `renderHomeLists();`: `renderDownloads();`.

- [ ] **Step 6: Botões de baixar no modal.**
  - Markup, em `#vod-modal-actions`, depois de `#vod-modal-mylist`:
    `<button class="btn-ghost" id="vod-modal-download" style="display:none"><i data-lucide="download" style="width:18px;height:18px"></i> <span>Baixar</span></button>`, com CSS `#vod-modal-download { display: inline-flex; align-items: center; gap: .5rem; }` (o `style` inline controla o esconder).
  - Guardar os episódios do modal: `let _vodModalEpisodes = [];` junto de `_vodModalItem`, e `let _vodModalCreds = null;` para montar URLs. Em `openVodModal`, `_vodModalCreds = creds;`.
  - Filme (ramo `!isSeries`): `const dlBtn = document.getElementById("vod-modal-download"); dlBtn.style.display = canDownload() ? "inline-flex" : "none"; dlBtn.onclick = () => queueDownloads([buildDownloadEntry({ kind: "movie", id: item.stream_id, title, cover: item.stream_icon || item.cover, ext: item.container_extension, url: buildVodStreamUrl(creds, item.stream_id, item.container_extension) }, Date.now())]);`
  - Série: esconder `#vod-modal-download` (`style.display = "none"`). Depois de carregar `episodes`, guardar `_vodModalEpisodes = episodes;`. Se `canDownload()`, renderizar antes da lista uma barra com um botão por temporada e um de série completa:

```js
      const seasons = seasonsOf(episodes);
      const dlBar = canDownload()
        ? `<div class="vod-dl-bar">${seasons.map(s => `<button class="btn-ghost" data-dl-season="${s}"><i data-lucide="download" style="width:16px;height:16px"></i> Temporada ${s}</button>`).join("")}<button class="btn-ghost" data-dl-series="1"><i data-lucide="download" style="width:16px;height:16px"></i> Série completa</button></div>`
        : "";
```

  e cada episódio vira uma linha com o botão de baixar ao lado, pois não pode haver botão dentro de botão:

```js
      return `<div class="ep-row"><button class="ep-btn" data-ep-id="${ep.id}" data-ep-ext="${escapeHtmlText(ep.container_extension || "mp4")}" data-ep-season="${ep.season || 1}" data-ep-num="${ep.episode_num || ""}">
        <span>T${ep.season || 1} E${ep.episode_num || "?"} — ${escapeHtmlText(epTitle)}</span>
        <i data-lucide="play" style="width:18px;height:18px"></i>
      </button>${canDownload() ? `<button class="ep-dl-btn" data-ep-dl="${ep.id}" aria-label="Baixar episódio"><i data-lucide="download" style="width:18px;height:18px"></i></button>` : ""}</div>`;
```

  com `epsContainer.innerHTML = dlBar + episodes.map(...).join("")`.
  - Montar a entrada de episódio a partir do item da série:

```js
// Entrada de download de um episódio, com o nome/capa da série do modal.
function episodeDownloadEntry(ep) {
  const series = (_vodModalItem && _vodModalItem.item) || {};
  const seriesName = series.name || series.title || "Série";
  return buildDownloadEntry({
    kind: "episode", id: ep.id,
    title: formatEpisodeTitle(seriesName, ep.season, ep.episode_num),
    seriesName, code: formatEpisodeCode(ep.season, ep.episode_num),
    cover: series.cover || series.stream_icon || "", ext: ep.container_extension,
    url: buildSeriesEpisodeUrl(_vodModalCreds, ep.id, ep.container_extension), seriesId: series.series_id,
  }, Date.now());
}
```

  - No listener de `#vod-modal-episodes`, antes do `closest(".ep-btn")`:

```js
    const dlEp = e.target.closest("[data-ep-dl]");
    if (dlEp) {
      const ep = _vodModalEpisodes.find(x => String(x.id) === dlEp.dataset.epDl);
      if (ep) queueDownloads([episodeDownloadEntry(ep)]);
      return;
    }
    const dlSeason = e.target.closest("[data-dl-season]");
    if (dlSeason) {
      const s = Number(dlSeason.dataset.dlSeason);
      queueDownloads(_vodModalEpisodes.filter(x => Number(x.season) === s).map(episodeDownloadEntry));
      return;
    }
    if (e.target.closest("[data-dl-series]")) {
      queueDownloads(_vodModalEpisodes.map(episodeDownloadEntry));
      return;
    }
```

- [ ] **Step 7:** `npm test` deve dar PASS. **Step 8: Commit** `feat(downloads): download movies/episodes/seasons/series, Downloads screen, save to Files/share` (incluir `Info.plist`, `AndroidManifest.xml`, os arquivos gerados pelo sync que mudaram, `package.json`/`package-lock.json` e o teste).

---

### Task 6: Janela flutuante (PiP) ao sair do app

**iOS:** o iOS tem PiP nativo para `<video>`. O "x" e o botão de voltar são do próprio sistema. Precisa do modo de fundo de áudio no `Info.plist`. O jeito confiável é o botão de janela flutuante no player (gesto do usuário). Ao minimizar o app com algo tocando, também tentamos entrar sozinho, em melhor esforço: o iOS pode exigir o toque.

**Android:** plugin local `SintonizaPip` + `MainActivity`. Com algo tocando, ao sair do app (botão início/recentes) a Activity entra em PiP 16:9. O JS recebe o evento `sintonizapip` e mostra só o vídeo. Quando a janela é fechada no "x", pausa. Fechar o app de verdade encerra tudo.

**Files:** `ios/App/App/Info.plist`; `android/app/src/main/AndroidManifest.xml`; `android/app/src/main/java/com/sintoniza/iptv/MainActivity.java`; `android/app/src/main/java/com/sintoniza/iptv/SintonizaPipPlugin.java` (novo); `sintoniza-link.html`; `tests/player/player-markup.test.js`.

- [ ] **Step 1: Teste de estrutura que falha:**

```js
test("janela flutuante: botão, modo PiP e ligação com o Android", () => {
  assert.ok(html.includes('id="pip-btn"'), "botão de janela flutuante não existe");
  assert.match(html, /body\.pip-active/);
  assert.match(html, /addEventListener\("sintonizapip"/);
  assert.match(html, /callNativePlugin\("SintonizaPip", "setAutoEnter"/);
});
```

- [ ] **Step 2:** o teste deve dar FAIL.

- [ ] **Step 3: iOS.** No `Info.plist`, acrescentar `<key>UIBackgroundModes</key><array><string>audio</string></array>`.

- [ ] **Step 4: Android nativo.**

`android/app/src/main/java/com/sintoniza/iptv/SintonizaPipPlugin.java`:

```java
package com.sintoniza.iptv;

import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Janela flutuante (Picture-in-Picture) do Sintoniza: o JS liga o modo
// automático enquanto algo toca; ao sair do app, a MainActivity entra em PiP.
@CapacitorPlugin(name = "SintonizaPip")
public class SintonizaPipPlugin extends Plugin {
    static volatile boolean autoEnter = false;

    @PluginMethod
    public void setAutoEnter(PluginCall call) {
        autoEnter = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && getActivity().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE));
        call.resolve(ret);
    }

    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (MainActivity.enterPip(getActivity())) call.resolve();
            else call.reject("Janela flutuante indisponível neste aparelho");
        });
    }
}
```

`MainActivity.java`:

```java
package com.sintoniza.iptv;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins locais precisam ser registrados antes do super.onCreate
        registerPlugin(SintonizaPipPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Entra na janela flutuante 16:9 (Android 8+ com suporte do aparelho).
    static boolean enterPip(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        if (!activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false;
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9))
                .build();
            return activity.enterPictureInPictureMode(params);
        } catch (IllegalStateException e) {
            return false;
        }
    }

    // Saiu do app (início/recentes) com algo tocando: vira janela flutuante.
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (SintonizaPipPlugin.autoEnter) enterPip(this);
    }

    // Avisa o JS para mostrar só o vídeo dentro da janela (e pausar ao fechar).
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("sintonizapip", "{ \"active\": " + isInPictureInPictureMode + " }");
        }
    }
}
```

`AndroidManifest.xml`: na `<activity android:name=".MainActivity" ...>`, acrescentar `android:supportsPictureInPicture="true"` e `android:resizeableActivity="true"`.

- [ ] **Step 5: JS.**
  - Markup, antes de `<select ... id="fit-select">`:
    `<button class="ctrl-btn" id="pip-btn" aria-label="Janela flutuante" title="Janela flutuante" style="display:none"><i data-lucide="picture-in-picture-2" style="width:20px;height:20px"></i></button>`
  - Funções, perto da tela cheia:

```js
// ─── Janela flutuante / Picture-in-Picture (v8) ───
let _lastAutoPip = null;

function pipSupported() {
  const video = document.getElementById("player-video");
  return isNativePluginAvailable("SintonizaPip")
    || (video && typeof video.webkitSupportsPresentationMode === "function" && video.webkitSupportsPresentationMode("picture-in-picture"))
    || !!document.pictureInPictureEnabled;
}

async function enterPip() {
  const video = document.getElementById("player-video");
  if (isNativePluginAvailable("SintonizaPip")) { callNativePlugin("SintonizaPip", "enter"); return; }
  try {
    if (video.webkitSetPresentationMode) video.webkitSetPresentationMode("picture-in-picture");
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
  } catch (e) {
    showToast("Janela flutuante indisponível agora.");
  }
}

// Android: liga a janela automática enquanto algo toca de verdade.
function syncAutoPip() {
  const active = !!(_state.selected && _state.playing);
  if (_lastAutoPip === active) return;
  _lastAutoPip = active;
  callNativePlugin("SintonizaPip", "setAutoEnter", { enabled: active });
}

// Janela fechada no "x" (app continua em segundo plano): pausa.
function pauseAfterPipClosed() {
  const video = document.getElementById("player-video");
  if (!video || video.paused) return;
  if (_state.selected && _state.selected.isVod) { userPausedVod = true; video.pause(); }
  else { video.pause(); setState({ playing: false }); showPlayerArt(); }
}
```

  - Em `render()`, no fim: `syncAutoPip();` e `document.getElementById("pip-btn").style.display = (_state.selected && _state.playing && pipSupported()) ? "" : "none";`.
  - No boot:

```js
  document.getElementById("pip-btn").addEventListener("click", e => { e.stopPropagation(); enterPip(); });
  // Android avisa quando entra/sai da janela flutuante
  window.addEventListener("sintonizapip", e => {
    const active = !!(e && e.active);
    document.body.classList.toggle("pip-active", active);
    if (!active) setTimeout(() => { if (document.visibilityState === "hidden") pauseAfterPipClosed(); }, 400);
  });
```

  - No listener de `visibilitychange` que já existe, acrescentar: ao ficar `hidden`, com algo tocando no iOS, tentar entrar sozinho:

```js
  if (document.visibilityState === "hidden" && isIOSDevice() && _state.playing) {
    const v = document.getElementById("player-video");
    try { if (v && v.webkitSetPresentationMode && v.webkitPresentationMode !== "picture-in-picture") v.webkitSetPresentationMode("picture-in-picture"); } catch (err) {}
  }
```

  - Em `closeMiniPlayer()` (Task 3), antes de `stopStream()`: sair do PiP do navegador se estiver ativo (`try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch (e) {}`).
  - CSS:

```css
    /* Android dentro da janela flutuante: só o vídeo, ocupando tudo. */
    body.pip-active .topbar, body.pip-active .mobile-tabs, body.pip-active .view,
    body.pip-active .sidebar, body.pip-active .sidebar-scrim, body.pip-active .player-controls,
    body.pip-active .vod-seek-row, body.pip-active .player-art, body.pip-active .fs-ui,
    body.pip-active .toast, body.pip-active .player-error, body.pip-active .player-loader { display: none !important; }
    body.pip-active #player-screen {
      position: fixed !important; inset: 0 !important; z-index: 99999 !important;
      width: 100% !important; height: 100% !important; margin: 0 !important;
      border-radius: 0 !important; padding: 0 !important; background: #000 !important;
      transform: none !important;
    }
    body.pip-active .player-media { position: absolute !important; inset: 0 !important; min-height: 0 !important; }
    body.pip-active .player-video-wrap { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; }
```

- [ ] **Step 6:** `npm test` deve dar PASS. **Step 7: Commit** `feat(pip): floating window when leaving the app (iOS native PiP, Android plugin)`.

---

### Task 7: App da TV para o teste de hoje à noite

**Files:** `sintoniza-tv/sintoniza-tv.html`, `sintoniza-tv/appinfo.json`, `sintoniza-tv/config.xml`, `tests/player/tv-safety.test.js` (novo), e a pasta local `app tv/` (fora do git, via `.git/info/exclude`).

- [ ] **Step 1: Teste que falha:**

```js
// tests/player/tv-safety.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tv = readFileSync(path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html"), "utf8");

test("TV limpa nome/categoria/logo vindos da lista M3U", () => {
  assert.match(tv, /function sanitizeLabel\(/);
  assert.match(tv, /function sanitizeImageUrl\(/);
  assert.match(tv, /sanitizeLabel\(/);
});
```

- [ ] **Step 2:** o teste deve dar FAIL.

- [ ] **Step 3:** No script principal da TV, acrescentar as mesmas `sanitizeLabel`/`sanitizeImageUrl` da Task 1, com o mesmo comentário. No `parseM3U` da TV (linha ~468), aplicar as duas no `extinf` (nome, categoria e logo), igual à Task 1. **Não mexer no bloco `<script id="epg-helpers">`**, que precisa ser idêntico byte a byte ao do app mobile.

- [ ] **Step 4:** Subir a versão para `1.8.0` em `appinfo.json` (`"version"`) e em `config.xml` (atributo `version` do `<widget>`).

- [ ] **Step 5:** `npm test` deve dar PASS. **Commit** `fix(tv): sanitize M3U names/categories/logos; bump TV app to 1.8.0`.

- [ ] **Step 6: Pacotes locais**, feitos pelo controlador e fora do git:
  - `app tv/sintoniza-tv-v8.zip`: a pasta `sintoniza-tv` zipada, para instalar via Tizen Studio/ares e servir de backup;
  - `app tv/com.sintoniza.iptv_1.8.0_all.ipk`: pacote LG webOS gerado com `npx -y @webos-tools/cli ares-package sintoniza-tv -o "app tv"` (o Gustavo autorizou as aprovações automáticas). Samsung (`.wgt`) exige o certificado da conta Samsung no Tizen Studio, então fica o zip e o guia do `sintoniza-tv/README.md`;
  - Link para testar direto no navegador da TV sem instalar (branch `v8`, repositório público): `https://raw.githack.com/Guaitolinii/visual-craft-assistant/v8/sintoniza-tv/sintoniza-tv.html`.

---

### Task 8: Pesquisa: vários perfis por login (SÓ INVESTIGAÇÃO)

Rodando em segundo plano. Gera `docs/superpowers/research/2026-09-23-perfis-por-conta.md` (modelo de dados `viewer_profiles` + dados por perfil com RLS, PIN com hash, perfil infantil, migração do localStorage atual, fluxo no celular/TV, fases). O controlador faz o commit do arquivo.

---

### Task 9: Regenerar o `www/`, verificar, push da v8, builds e downloads

- [ ] `node scripts/prepare-mobile.js` e depois `npm test`. Tudo deve passar.
- [ ] Teste de fumaça no Chrome headless:
  - recentes sem "?";
  - "x" do mini-player;
  - item Downloads escondido na web;
  - botões de baixar escondidos na web;
  - nome malicioso de canal renderizado como texto;
  - botão PiP aparece só com algo tocando.
- [ ] Commit `chore: regenerate www/index.html for v8`. `git push -u origin v8`.
- [ ] Disparar o workflow "Build Android APK e iOS IPA" na `v8` e baixar:
  - `app ios/sintoniza-ios-unsigned-v8.ipa`;
  - `app android/sintoniza-android-debug-v8.apk`.

  Se o build do Android falhar por causa do Java do PiP, corrigir e repetir.
- [ ] A `main` só muda com o OK do Gustavo.

## Roteiro de teste

1. **Recentes:** sem cartões "?".
2. **Mini-player:** o "x" fecha e deixa o player ocioso.
3. **Downloads:**
   - abrir um filme → Baixar;
   - abrir uma série → Baixar episódio / temporada / série completa;
   - menu ☰ → Downloads mostra o progresso;
   - com o download terminado: ▶ toca sem internet, e o ícone de compartilhar salva em Arquivos/Drive;
   - no iPhone, conferir o app Arquivos → No meu iPhone → Sintoniza TV → Sintoniza;
   - minimizar o app durante o download: continua; fechar o app: recomeça ao abrir.
4. **Janela flutuante:**
   - Android: com algo tocando, apertar o início, a janela aparece; o "x" fecha e pausa; fechar o app encerra tudo.
   - iPhone: tocar no botão de janela flutuante no player e depois ir para o início, a janela fica.
5. **TV:** instalar o `.ipk` (LG) ou abrir o link do raw.githack no navegador da TV; testar os canais.
