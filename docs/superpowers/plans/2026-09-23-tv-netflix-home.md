# TV Netflix-Style Home + VOD Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `sintoniza-tv.html`'s tab-based, channels-only grid with one unified, Netflix-style home (Continuar Assistindo → Canais ao Vivo → Filmes/Séries rows, with streaming badges from `vod-providers.json`), remote-navigable via the app's existing spatial-nav system, where selecting anything expands that same card into the full screen — never a modal. Series expand into a full-screen detail scene (synopsis + episode rows); picking an episode expands again into the identical player chrome used for channels and movies. Both list URLs (channels `.m3u` and VOD Xtream credentials) come pre-filled into the compiled app/TV package via a GitHub Actions secret injected at build time — never into the committed, publicly-served HTML source.

**Architecture:** `sintoniza-tv.html` gains the same pure Xtream/VOD/provider-grouping helpers already added to `sintoniza-link.html` in the companion plan (`2026-09-23-vod-streaming-crossref.md`), a new unified-home renderer replacing today's `renderTabs`/`renderChannels` grid, and a shared-element "morph" transition (card → fullscreen) lifted directly from the approved prototype (`https://claude.ai/artifact/Yb6pomV5UgeggBUsajSWui`). Real playback keeps using the TV's existing engine selection (Tizen AVPlay / webOS+browser hls.js/mpegts.js) — the new chrome sits on top of it, it doesn't replace it. Credential defaults are injected by `scripts/prepare-mobile.js` at build time from env vars sourced from GitHub Actions secrets (new `build-mobile-v9.yml`), replacing placeholder tokens that stay inert (blank) in the committed source and in the GitHub Pages deployment.

**Tech Stack:** Same as the companion plan — plain JS (`function`/`var`), no build step, `node --test`. Node's `fs`/`path` for the `prepare-mobile.js` token-replacement step (already a Node script).

**Spec:** This document + `2026-09-23-vod-streaming-crossref.md` (shared helpers, `vod-providers.json` contract, `PROVIDERS_BR`/`PROVIDER_ORDER`) + the approved prototype linked above (visual/interaction reference — read it before Task 3).

## Global Constraints

- Everything in this plan lands on the `v9` branch (created in the companion plan's Task 6), never on `main`, `v8`, or by editing `build-mobile.yml`/`pages.yml`.
- No Xtream credential (channels or VOD) is ever written as a literal value into `sintoniza-tv.html` or `sintoniza-link.html`. Defaults are placeholder tokens (`__DEFAULT_CHANNELS_URL__`, `__DEFAULT_VOD_URL__`) replaced only in the build output, from env vars, never committed.
- Reuse the TV app's existing spatial-navigation system (`data-focusable`, `tabindex="0"`, arrow-key nearest-neighbor mover at `sintoniza-tv.html:1452`) for every new focusable element. Do not write a second navigation system.
- Reuse the TV app's existing playback engine selection (`IS_TIZEN`/`IS_WEBOS`, `playViaTizenAVPlay`, hls.js/mpegts.js paths, `sintoniza-tv.html:386-1002`) unchanged — the new player chrome is a visual layer on top, not a new engine.
- `providerKeyForItem`/`attachProviders`/`groupItemsByProvider`/`PROVIDERS_BR`/`PROVIDER_ORDER` must be byte-identical in behavior to the copies added to `sintoniza-link.html` in the companion plan (same key format: `` `${name.trim().toLowerCase()}|${year}` ``) — both apps read the same `vod-providers.json`.
- Respect `prefers-reduced-motion` in the morph transition (instant cut, no scale/position animation) — carry this over from the prototype, which already handles it.

---

### Task 1: Credential defaults injected at build time, not in source

**Files:**
- Modify: `scripts/prepare-mobile.js`
- Modify: `sintoniza-link.html` (one `<input>` default-value attribute area — the `list-url`/`vod-url` fields already read from `localStorage` on boot per `loadSettingsForm`, so this task only needs a fallback constant, not a markup change — see Step 3)
- Modify: `sintoniza-tv/sintoniza-tv.html` (the `tv-m3u-url`/new `tv-vod-url` inputs, see Task 5)
- Create: `.gitignore` entry for local secret files
- Test: `scripts/prepare-mobile.test.js`

**Interfaces:**
- Produces: `prepare-mobile.js` reads `process.env.DEFAULT_CHANNELS_URL` and `process.env.DEFAULT_VOD_URL` (both optional — absent in the untouched `build-mobile.yml` path, so that workflow's output is byte-identical to today); when present, replaces the literal tokens `__DEFAULT_CHANNELS_URL__` / `__DEFAULT_VOD_URL__` in the copied `www/index.html` (and, once Task 5 adds the TV copy step, `www/sintoniza-tv.html`) with the env values; when absent, replaces the tokens with `""` (empty string — behaves exactly like today's blank onboarding fields).

- [ ] **Step 1: Write the failing test**

```js
// scripts/prepare-mobile.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { injectDefaults } from "./prepare-mobile.js";

test("injectDefaults replaces both tokens when env values are present", () => {
  const html = `<input id="a" value="__DEFAULT_CHANNELS_URL__"><input id="b" value="__DEFAULT_VOD_URL__">`;
  const out = injectDefaults(html, { DEFAULT_CHANNELS_URL: "http://x/ch.m3u", DEFAULT_VOD_URL: "http://y/get.php?x=1" });
  assert.equal(out, `<input id="a" value="http://x/ch.m3u"><input id="b" value="http://y/get.php?x=1">`);
});

test("injectDefaults replaces tokens with empty string when env values are absent", () => {
  const html = `value="__DEFAULT_CHANNELS_URL__" value="__DEFAULT_VOD_URL__"`;
  const out = injectDefaults(html, {});
  assert.equal(out, `value="" value=""`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/prepare-mobile.test.js`
Expected: FAIL — `injectDefaults` is not exported yet.

- [ ] **Step 3: Implement `injectDefaults` and wire it into the existing copy step**

Read the current `scripts/prepare-mobile.js` first (it's short — a `copyFileSync` call per file). Add the function and route the HTML copies through it instead of a raw `copyFileSync`:

```js
// Substitui os tokens de URL padrão pelo valor real (build de CI, via
// secrets) ou por string vazia (build sem secrets - comportamento idêntico
// ao onboarding em branco de hoje). Nunca lê nem escreve a credencial no
// arquivo-fonte versionado - só no www/ gerado, que build-mobile.yml sobe
// como artefato de download, não como commit.
export function injectDefaults(html, env) {
  return html
    .replaceAll("__DEFAULT_CHANNELS_URL__", env.DEFAULT_CHANNELS_URL || "")
    .replaceAll("__DEFAULT_VOD_URL__", env.DEFAULT_VOD_URL || "");
}
```

In `main()` (or wherever `copyFileSync(path.join(ROOT, "sintoniza-link.html"), path.join(WWW, "index.html"))` runs today), replace that one call with:

```js
const linkHtml = readFileSync(path.join(ROOT, "sintoniza-link.html"), "utf8");
writeFileSync(path.join(WWW, "index.html"), injectDefaults(linkHtml, process.env));
```

(Add `readFileSync`/`writeFileSync` to the existing `node:fs` import line — the file already imports `copyFileSync`, `mkdirSync`, `existsSync` from there.)

- [ ] **Step 4: Add the placeholder tokens to `sintoniza-link.html`**

In `loadSettingsForm` (`sintoniza-link.html:5076-5085`, or wherever it's shifted to after the companion plan's edits), the fields already read from `localStorage.getItem(LS.URL)`/`LS.VOD_URL` and fall back to `""`. Change only the fallback:

```js
const url  = localStorage.getItem(LS.URL)  || "__DEFAULT_CHANNELS_URL__";
// ...
const vodUrl = localStorage.getItem(LS.VOD_URL) || "__DEFAULT_VOD_URL__";
```

And right after reading them, before using them to populate inputs or auto-load, strip a token that never got replaced (e.g. running via `npm run dev`, not through `prepare-mobile.js`):

```js
const cleanUrl = url.startsWith("__DEFAULT_") ? "" : url;
const cleanVodUrl = vodUrl.startsWith("__DEFAULT_") ? "" : vodUrl;
```

Use `cleanUrl`/`cleanVodUrl` everywhere `url`/`vodUrl` was about to be used in that function (populating the inputs, and the auto-load call at boot).

- [ ] **Step 5: Add the local-secret gitignore entry**

```bash
echo "" >> .gitignore
echo "# Credenciais locais para build manual (nunca versionar)" >> .gitignore
echo ".env.local" >> .gitignore
```

- [ ] **Step 6: Run the test**

Run: `node --test scripts/prepare-mobile.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/prepare-mobile.js scripts/prepare-mobile.test.js sintoniza-link.html .gitignore
git commit -m "feat(mobile): inject default catalog URLs at build time via env, never in source"
```

---

### Task 2: Wire the secrets into the v9 mobile-build workflow

**Files:**
- Modify: `.github/workflows/build-mobile-v9.yml` (created in the companion plan's Task 6 — this task only adds env vars to its existing steps)

**Interfaces:**
- Consumes: repository secrets `DEFAULT_CHANNELS_URL`, `DEFAULT_VOD_URL` (add these two, once, in Settings → Secrets — same screen as the companion plan's Task 5 secrets).

- [ ] **Step 1: Add the two secrets** (GitHub UI, once)

Repo → Settings → Secrets and variables → Actions → New repository secret:
- `DEFAULT_CHANNELS_URL` = (a URL completa do seu link de canais, com usuário/senha - cole direto no GitHub, não registre aqui)
- `DEFAULT_VOD_URL` = (a URL completa do seu link de filmes/séries, com usuário/senha - cole direto no GitHub, não registre aqui)

- [ ] **Step 2: Pass them to the "Preparar www/" step**

In `build-mobile-v9.yml`, both the `android` and `ios` jobs have a step `run: node scripts/prepare-mobile.js`. Add `env:` to each:

```yaml
      - name: Preparar www/
        env:
          DEFAULT_CHANNELS_URL: ${{ secrets.DEFAULT_CHANNELS_URL }}
          DEFAULT_VOD_URL: ${{ secrets.DEFAULT_VOD_URL }}
        run: node scripts/prepare-mobile.js
```

- [ ] **Step 3: Verify**

Push to `v9`, wait for the workflow, download the `sintoniza-android-debug-v9` artifact, install it, and confirm the app opens straight to the home (no onboarding screen, no URL to type).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-mobile-v9.yml
git commit -m "ci(v9): pass default catalog URLs from secrets into the mobile build"
```

---

### Task 3: Port pure Xtream/VOD/provider helpers into `sintoniza-tv.html`

**Files:**
- Modify: `sintoniza-tv/sintoniza-tv.html`
- Create: `tests/vod/loadTvVodHelpers.js` (mirrors `tests/vod/loadVodHelpers.js` but points at the TV file)
- Create: `tests/vod/tv-vod-parity.test.js`

**Interfaces:**
- Produces (all copied **verbatim**, byte-for-byte, from `sintoniza-link.html` — exact current line ranges, re-check after the companion plan's edits since line numbers shift): `parseXtreamCredentials` (`:4315-4333`), `buildVodStreamUrl`/`buildSeriesEpisodeUrl` (`:4336-4344`), `xtreamApiUrl` (`:4346-4353`), `vodItemYearKey`/`vodItemAddedTs` (`:4415-4422`), `dedupeVodItemsByTitle` (`:4423-4437`), `selectNewestVodItems` (`:4449-4455`), `providerKeyForItem`/`attachProviders`/`groupItemsByProvider` (added by the companion plan, Task 1), `PROVIDERS_BR`/`PROVIDER_ORDER` (added by the companion plan, Task 2).

- [ ] **Step 1: Write the parity test first**

This guards against silent drift between the two copies (the real risk of duplicating code across two HTML files):

```js
// tests/vod/tv-vod-parity.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { loadTvVodHelpers } from "./loadTvVodHelpers.js";

const SHARED_FN_NAMES = [
  "providerKeyForItem", "attachProviders", "groupItemsByProvider",
  "dedupeVodItemsByTitle", "vodItemYearKey", "vodItemAddedTs", "selectNewestVodItems",
  "parseXtreamCredentials", "buildVodStreamUrl", "buildSeriesEpisodeUrl", "xtreamApiUrl",
];

test("sintoniza-tv.html's ported VOD helpers behave identically to sintoniza-link.html's", () => {
  const app = loadVodHelpers();
  const tv = loadTvVodHelpers();
  const sampleItem = { name: "Duna: Parte Dois", year: "2024", added: "100" };
  for (const name of SHARED_FN_NAMES) {
    assert.equal(typeof tv[name], "function", `${name} missing from the TV copy`);
  }
  // Comportamento idêntico num caso real, não só presença da função.
  assert.equal(app.providerKeyForItem(sampleItem), tv.providerKeyForItem(sampleItem));
  assert.deepEqual(
    app.attachProviders([sampleItem], { "duna: parte dois|2024": ["max"] }),
    tv.attachProviders([sampleItem], { "duna: parte dois|2024": ["max"] })
  );
  assert.equal(
    app.parseXtreamCredentials("http://x/get.php?username=u&password=p").base,
    tv.parseXtreamCredentials("http://x/get.php?username=u&password=p").base
  );
});
```

- [ ] **Step 2: Create the TV test loader** (copy `tests/vod/loadVodHelpers.js` and repoint it)

```js
// tests/vod/loadTvVodHelpers.js
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TV_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html");

const PURE_HELPER_NAMES = [
  "providerKeyForItem", "attachProviders", "groupItemsByProvider",
  "dedupeVodItemsByTitle", "vodItemYearKey", "vodItemAddedTs", "selectNewestVodItems",
  "parseXtreamCredentials", "buildVodStreamUrl", "buildSeriesEpisodeUrl", "xtreamApiUrl",
];

function toHostRealm(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function loadTvVodHelpers() {
  const html = readFileSync(TV_HTML_PATH, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const mainScript = scripts[scripts.length - 1][1];

  const sandbox = { window: {}, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(mainScript, sandbox);

  const out = {};
  for (const name of PURE_HELPER_NAMES) {
    if (typeof sandbox[name] === "function") {
      out[name] = (...args) => toHostRealm(sandbox[name](...args));
    }
  }
  return out;
}
```

(If `sintoniza-tv.html`'s existing inline `<script>` structure needs more sandbox globals than this — check what `tests/vod/loadVodHelpers.js` provides beyond this for `sintoniza-link.html` and mirror any it needs, e.g. `navigator`, `location` stubs, since the TV file references `window.tizen`/`window.webOS` at parse time.)

- [ ] **Step 3: Run to verify it fails**

Run: `node --test tests/vod/tv-vod-parity.test.js`
Expected: FAIL — functions don't exist in `sintoniza-tv.html` yet.

- [ ] **Step 4: Copy the functions into `sintoniza-tv.html`**

Insert all eleven functions (verbatim copies from the exact line ranges listed in this task's Interfaces block) into `sintoniza-tv.html`, in a new block right after its own `parseM3U` function (`sintoniza-tv.html:495`, after the closing brace). Keep their exact bodies and comments — this is a straight port, not a rewrite.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/vod/tv-vod-parity.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sintoniza-tv/sintoniza-tv.html tests/vod/loadTvVodHelpers.js tests/vod/tv-vod-parity.test.js
git commit -m "feat(tv): port Xtream/VOD/provider-grouping pure helpers from sintoniza-link.html"
```

---

### Task 4: Unified home — markup, tokens, and the morph transition

**Files:**
- Modify: `sintoniza-tv/sintoniza-tv.html` (replace the current `#tv-app` channel-grid markup/CSS with the prototype's structure, adapted to real ids already in use where they overlap)

**Interfaces:**
- Consumes: Task 3's helpers; the TV's existing `data-focusable`/arrow-key mover (`sintoniza-tv.html:1452`); the existing sidebar toggle/`onClick` helper pattern.
- Produces: `#tv-rows` (replaces the channel-only grid), `#tv-morph`, `#tv-player-scene`, `#tv-detail-scene` — same structural roles as the prototype's `#rows`/`#morph`/`#player-scene`/`#detail-scene`.

- [ ] **Step 1: Add the design tokens**, merged into the existing `<style>` block (don't replace the file's current tokens if `sintoniza-tv.html` already defines `--bg`/`--ink`-style variables under a different name — grep first and reconcile names rather than creating a second parallel token set):

```css
:root {
  --tv-bg: #0a0c11; --tv-surface: #171b26; --tv-surface2: #212739; --tv-line: #2b3245;
  --tv-ink: #f2f4f9; --tv-muted: #8b93a8; --tv-accent: #22cdd6; --tv-focus: #ffffff; --tv-live: #ff3b4e;
}
```

- [ ] **Step 2: Copy the prototype's row/tile/morph/scene CSS and markup**, reading it from the published artifact (`action: "read"` on `https://claude.ai/artifact/Yb6pomV5UgeggBUsajSWui`, or the local scratch file it was built from) as the literal source, adapting only:
  - `.tile[data-r][data-c]` keeps `data-focusable tabindex="0"` (the prototype used bare `tabindex="0"`; the TV app's real mover looks for `[data-focusable]` OR `[tabindex="0"]` per its selector at `:1311-1312`, so either works, but add `data-focusable` for consistency with the rest of the file's markup).
  - Replace the prototype's `#stage`/`#home` wrapper with the TV app's existing top-level container structure (don't nest a second full-viewport wrapper if one already exists).
  - Keep the existing `#tv-sidebar`, `#tv-header` elements; the new rows view replaces only the channel-grid content area, not the whole shell.

- [ ] **Step 2 (verification, no unit test — this is markup/CSS): manual check**

Run: `npm run dev`, open the TV file directly in a browser, confirm the row layout renders with placeholder/no-data state (empty rows are fine at this step — Task 5 wires real data).

- [ ] **Step 3: Commit**

```bash
git add sintoniza-tv/sintoniza-tv.html
git commit -m "feat(tv): unified Netflix-style home markup, tokens, and morph-transition CSS"
```

---

### Task 5: Wire real data — channels, VOD catalog, and the provider badge/group toggle

**Files:**
- Modify: `sintoniza-tv/sintoniza-tv.html`

**Interfaces:**
- Consumes: existing `loadPlaylist(url)` (`:506`) for channels; Task 3's `xtreamApiUrl`/`parseXtreamCredentials` for VOD; the companion plan's `VOD_PROVIDERS_URL` fetch pattern (`sintoniza-link.html`, companion Task 3) — copy that fetch function verbatim too, same reasoning as Task 3 here.
- Produces: `renderTvRows()` — populates `#tv-rows` with: a "Continuar assistindo" row (from `sint_recents`, already tracked — `:409`), a "Canais ao vivo" row (from `getChannels()`/`visibleChannels()`, already present), then one row per VOD category (badge mode) or per streaming provider (group mode, plus a trailing "Demais filmes"/"Demais séries" row), exactly mirroring `renderVodRows` from the companion plan's Task 3 — this is the fourth copy of that grouping logic's *call site* (not its pure logic, already shared via Task 3 here), so keep the row-building loop itself simple and inline rather than abstracting further.
- Also add: a `tv-vod-url` onboarding input (mirrors `tv-m3u-url` at `sintoniza-tv.html:36-41`), saved to the shared key `sint_vod_url` (same key `sintoniza-link.html`'s `LS.VOD_URL` uses — picked up automatically if the same browser profile already has it, same trick already used for `sint_url`).

- [ ] **Step 1: Add the `tv-vod-url` onboarding field**, right after the existing `tv-epg-url` block (`sintoniza-tv.html:48-56`):

```html
  <p style="font-size:18px;color:#5c5c78;margin-top:24px">Filmes/Séries — credenciais Xtream (opcional)</p>
  <div class="tv-onboarding-input-group">
    <input
      id="tv-vod-url"
      class="tv-input"
      type="url"
      placeholder="__DEFAULT_VOD_URL__"
      value="__DEFAULT_VOD_URL__"
      autocomplete="off"
      data-focusable
      tabindex="0"
    />
  </div>
```

- [ ] **Step 2: Save it on load**, in the existing `onClick('tv-load-btn', ...)` handler (`:1391-1401`), alongside the EPG save:

```js
    const vodEl = document.getElementById('tv-vod-url');
    const vodUrl = vodEl && vodEl.value ? vodEl.value.trim() : '';
    if (vodUrl && !vodUrl.startsWith('__DEFAULT_')) localStorage.setItem('sint_vod_url', vodUrl);
```

- [ ] **Step 3: Add the sidebar entries** for Filmes/Séries (mirrors `sb-favs` markup at `:158-161`), and a `renderTvRows` call wired to them:

```html
  <div class="tv-sidebar-item" id="sb-vod" data-focusable tabindex="0">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 4v16M16 4v16"/></svg>
    Filmes e Séries
  </div>
```

```js
onClick('sb-vod', () => {
  closeSidebar();
  const creds = parseXtreamCredentials(localStorage.getItem('sint_vod_url'));
  if (!creds) { showTVToast('Configure as credenciais de Filmes/Séries na tela inicial.'); return; }
  loadTvVodCatalog(creds);
});
```

- [ ] **Step 4: Implement `loadTvVodCatalog`** (adapted from `loadVodCatalog`, `sintoniza-link.html:4837` — same `get_vod_categories`+`get_vod_streams` / `get_series_categories`+`get_series` calls via `xtreamApiUrl`, same `Promise.allSettled` pattern), writing into `#tv-rows` via the row-builder from Task 4, and fetching `vod-providers.json` (copy the fetch function from the companion plan's Task 3 verbatim) to call `attachProviders`/`groupItemsByProvider` before rendering.

- [ ] **Step 5: Manual verification**

With real credentials in `.env.local` (never committed) driving a local `prepare-mobile.js` run, or by typing them once into the onboarding fields in a dev browser: confirm "Canais ao vivo" and both VOD rows populate, and provider badges show on VOD tiles.

- [ ] **Step 6: Commit**

```bash
git add sintoniza-tv/sintoniza-tv.html
git commit -m "feat(tv): wire real channel + VOD catalog data into the unified home rows"
```

---

### Task 6: Detail scene (series) and episode navigation

**Files:**
- Modify: `sintoniza-tv/sintoniza-tv.html`

**Interfaces:**
- Consumes: `buildSeriesEpisodeUrl` (Task 3); `xtreamApiUrl(creds, "get_series_info", { series_id })` (same call `sintoniza-link.html` makes at `:4997`).
- Produces: `openTvDetail(seriesItem)` — populates `#tv-detail-scene` (backdrop, title, meta, synopsis, season/episode rows) from `get_series_info`, using the prototype's exact detail-scene markup/CSS and its grid-based `detailNav` focus model (section: `"actions" | "episode"`) ported verbatim, swapping its sample-data calls for the real `get_series_info` response fields (`info.plot`, `info.rating`, `episodes` keyed by season).

- [ ] **Step 1: Port the detail-scene DOM/CSS and `detailNav`/`paintDetailFocus` logic** verbatim from the prototype, into `sintoniza-tv.html`.

- [ ] **Step 2: Replace the prototype's dummy `openDetail(item)` body** with a fetch to `get_series_info`, populating the same DOM the prototype targets, and building the episode row from the real episode list (grouped by season — start with season 1, matching the prototype's single-season demo; a season switcher is out of scope for this task and can be a fast-follow).

- [ ] **Step 3: Wire `pressOk()`'s series/episode branches** (ported from the prototype) to call the real `buildSeriesEpisodeUrl(creds, episodeId, containerExtension)` instead of the prototype's placeholder string, feeding that URL into Task 7's player.

- [ ] **Step 4: Manual verification**

Focus a series tile in the home, press OK/Enter: confirm the detail scene opens with real synopsis/episodes; press OK on an episode: confirms it hands off into playback (Task 7 makes that actually play).

- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv/sintoniza-tv.html
git commit -m "feat(tv): full-screen series detail scene with real episode data"
```

---

### Task 7: Unified player chrome over the existing playback engine

**Files:**
- Modify: `sintoniza-tv/sintoniza-tv.html`

**Interfaces:**
- Consumes: the existing engine-selection code unchanged (`IS_TIZEN`/`IS_WEBOS` branch at `:837-843`, `playViaTizenAVPlay` at `:1003`, the hls.js/mpegts.js path already present for webOS/browser).
- Produces: the prototype's `#tv-player-scene` chrome (title, live dot, transport controls) laid over whichever engine is already playing — this task does not touch how playback starts, only how its controls are drawn and how the morph transition hands off into it.

- [ ] **Step 1: Port the player-scene DOM/CSS** verbatim from the prototype.

- [ ] **Step 2: Replace the app's current channel-tap-to-play flow's UI entry point** so that selecting a channel tile in the new home (instead of the old grid) calls the morph transition (Task 4) into `#tv-player-scene`, then calls the existing, unmodified channel-play function with that channel's `url` — check what that function is named today (likely `playStream` or similar; grep `sintoniza-tv.html` for where `tv-load-btn`-loaded channels currently start playback on click) and call it exactly as today, only after the visual transition finishes.
- [ ] **Step 3: Route VOD/episode playback through the same entry point**, using `buildVodStreamUrl`/`buildSeriesEpisodeUrl` (Task 3/6) output as the `url` passed to that same existing play function — movies and episodes use the webOS/browser hls.js/mpegts.js path (Xtream VOD is not typically an Tizen-AVPlay live case, but do not special-case this without checking: if `playViaTizenAVPlay` already handles arbitrary `.mp4`/`.ts` VOD urls fine on Tizen, keep using it uniformly rather than branching by content type).

- [ ] **Step 4: Manual, per-platform verification** (this task cannot be meaningfully unit-tested — it's real playback on real hardware/emulators):
  - Browser (dev): channel, movie, and episode each play with the new chrome.
  - LG webOS emulator or real device: same three cases.
  - Samsung Tizen emulator or real device: same three cases, confirming `playViaTizenAVPlay` still engages correctly.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv/sintoniza-tv.html
git commit -m "feat(tv): unified full-screen player chrome for channels, movies, and episodes"
```

---

### Task 8: End-to-end verification and `v9` push

**Files:** none (verification only)

- [ ] **Step 1:** `npm test` — full suite green (Tasks 1, 3's unit/parity tests, plus everything from the companion plan).
- [ ] **Step 2:** Push `v9`, confirm `build-mobile-v9.yml` runs and both artifacts build successfully with Task 1/2's injected defaults.
- [ ] **Step 3:** Install the Android debug APK; confirm it opens straight to the unified home, channels and VOD rows populate, badges show, and the morph transition works for a channel, a movie, and a series → episode.
- [ ] **Step 4:** Sideload `sintoniza-tv.html` (with real, locally-exported `.env.local` values run through `prepare-mobile.js`, or built the same way CI does) onto an LG webOS or Samsung Tizen device/emulator; repeat the same checks, including that `playViaTizenAVPlay` engages on Tizen.

## Self-Review Notes

- **Spec coverage:** unified home (channels+VOD, no separate tabs) ✓ Task 4; card-expands-to-fullscreen, no modal, identical for channel/movie/series/episode ✓ Tasks 4/6/7; Netflix-adapted rows with streaming badges ✓ Task 5 (reuses companion plan's data contract); TV onboarding matching the app's visual language ✓ Task 4 (shared token names); both catalog URLs pre-filled without typing on the remote ✓ Tasks 1–2; credentials never in committed source ✓ Global Constraints + Task 1.
- **Placeholder scan:** Tasks 6–7's DOM/CSS steps say "port verbatim from the prototype" rather than re-printing ~200 lines of markup already published and readable at the artifact URL — this is a precise, executable instruction (read a specific, fixed source) and not a vague placeholder, but flagged here for the plan's executor: read the artifact via `Artifact` tool's `read` action (or the local scratch file) before starting Task 4, 6, or 7.
- **Type consistency:** `streamingProviders`, `PROVIDERS_BR`, `PROVIDER_ORDER`, the `name|year` key format, and `vod-providers.json`'s shape are all defined once in the companion plan and only ever consumed here, never redefined differently.
