# Selo de Streaming (VOD × TMDB) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each movie/series in the app's VOD catalog with a badge naming which streaming service (Netflix, Prime Video, Max, Disney+, Apple TV+, Paramount+, Globoplay) carries it in Brazil today, with a second display mode that regroups the catalog by streaming service instead of by genre, ending in a "Demais filmes"/"Demais séries" row for anything unmatched. The provider data is computed once a day by a GitHub Action (not by the app at runtime) and published as a small JSON file the app fetches.

**Architecture:** A new, isolated data pipeline: a Python script running on a GitHub Actions cron pulls the current VOD/series catalog from the provider's Xtream `player_api.php` (same actions `sintoniza-link.html` already calls), builds "who's on Netflix/Prime/Max/…" ID sets from TMDB's `discover` endpoint (bulk, ~5 pages per provider, not per-title), matches each catalog title against TMDB by name+year, and writes `vod-providers.json`. That file is pushed to a **dedicated `vod-data` branch** (never `main`), so it doesn't touch the Lovable-synced branch or retrigger the mobile build. The app fetches that JSON over `raw.githubusercontent.com` (repo is public, no auth needed), merges it into the catalog client-side by the exact same `name|year` key the app's own dedup logic already uses, and renders either a badge on each card or a full regroup-by-provider view.

**Tech Stack:** Python 3.11 stdlib only (`urllib.request`, `json`) for the Action script — no pip installs, matches the zero-dependency style of the rest of the repo's tooling. Plain JS (`function`/`var`, no build step) for the app, consistent with `sintoniza-link.html`'s existing style. `node --test` for JS unit tests (existing convention). GitHub Actions (`schedule` + `workflow_dispatch`).

**Spec:** This document (no separate spec file — requirements were established in conversation: keep genre view working as a fallback, both display modes read the same data, unmatched titles get a trailing "Demais" row, nothing in this feature touches `main`/`build-mobile.yml`/`pages.yml`, a new `v9` branch and a new mobile-build workflow copy carry the app-side changes).

## Global Constraints

- Never hardcode the Xtream VOD credentials (`dbonline.tech-cdn.top` username/password) in any file that gets committed. They live only as GitHub Actions repository secrets: `VOD_XTREAM_BASE`, `VOD_XTREAM_USER`, `VOD_XTREAM_PASS`.
- Never disable TLS certificate verification (no `ssl.CERT_NONE`) in the Python script.
- The generated `vod-providers.json` is pushed **only** to a branch named `vod-data`, created as an orphan branch (no shared history with `main`/`v8`/`v9`) so it never appears in a PR diff against the app branches.
- Do not edit `.github/workflows/build-mobile.yml` or `.github/workflows/pages.yml`. Any mobile-build trigger for the new work goes in a new file.
- All new app-side JS is added to `sintoniza-link.html` only (not `sintoniza.html`, which doesn't have the VOD subsystem) and only on the `v9` branch.
- The client must degrade silently to the current genre-only view if the providers JSON is missing, stale, or fails to fetch — VOD playback must never depend on this feature.
- Match the existing key format exactly: `` `${name.trim().toLowerCase()}|${yearKey}` `` (see `dedupeVodItemsByTitle`, `sintoniza-link.html:4434`). No accent-stripping, no extra normalization — the Python side must produce keys byte-for-byte compatible with this.

---

### Task 1: Pure JS helpers for provider grouping

**Files:**
- Modify: `sintoniza-link.html` (add functions near `dedupeVodItemsByTitle`, around line 4448)
- Modify: `tests/vod/loadVodHelpers.js` (register the new pure function names)
- Create: `tests/vod/vod-provider-grouping.test.js`

**Interfaces:**
- Consumes: `vodItemYearKey(item)` (existing, `sintoniza-link.html:4423`) for the year part of the key.
- Produces:
  - `providerKeyForItem(item) -> string` — `` `${name}|${year}` `` lowercase-trimmed, same shape as the dedup key.
  - `attachProviders(items, providerMap) -> items[]` — returns a **new array**; each item gets `item.streamingProviders = string[]` (provider ids like `"netflix"`, `"max"`; `[]` when unmatched). Does not mutate input items.
  - `groupItemsByProvider(items, providerOrder) -> { providerId: string, items: object[] }[]` — one group per id in `providerOrder` that has at least one match, in that order, **plus a trailing group `{ providerId: "outros", items: [...] }`** for every item whose `streamingProviders` is empty. Items with multiple providers appear in every matching group (a title on both Netflix and another service shows in both rows).

- [ ] **Step 1: Write the failing tests**

```js
// tests/vod/vod-provider-grouping.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("providerKeyForItem matches dedupeVodItemsByTitle's key shape", () => {
  const ctx = loadVodHelpers();
  const item = { name: "  Duna: Parte Dois ", year: "2024" };
  assert.equal(ctx.providerKeyForItem(item), "duna: parte dois|2024");
});

test("attachProviders adds streamingProviders without mutating the input", () => {
  const ctx = loadVodHelpers();
  const items = [{ name: "Barbie", year: "2023" }, { name: "Sem Match", year: "1999" }];
  const map = { "barbie|2023": ["netflix", "max"] };
  const result = ctx.attachProviders(items, map);
  assert.deepEqual(result[0].streamingProviders, ["netflix", "max"]);
  assert.deepEqual(result[1].streamingProviders, []);
  assert.equal(items[0].streamingProviders, undefined, "input item must not be mutated");
});

test("groupItemsByProvider orders groups by providerOrder and appends 'outros' last", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders(
    [
      { name: "A", year: "2020" },
      { name: "B", year: "2021" },
      { name: "C", year: "2022" },
    ],
    { "a|2020": ["max"], "b|2021": ["netflix"] }
  );
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.deepEqual(groups.map(g => g.providerId), ["netflix", "max", "outros"]);
  assert.deepEqual(groups.find(g => g.providerId === "outros").items.map(i => i.name), ["C"]);
});

test("groupItemsByProvider omits a provider with zero matches instead of an empty row", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders([{ name: "A", year: "2020" }], { "a|2020": ["netflix"] });
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.deepEqual(groups.map(g => g.providerId), ["netflix"]);
});

test("groupItemsByProvider lists a multi-provider title in every matching group", () => {
  const ctx = loadVodHelpers();
  const items = ctx.attachProviders([{ name: "A", year: "2020" }], { "a|2020": ["netflix", "max"] });
  const groups = ctx.groupItemsByProvider(items, ["netflix", "max"]);
  assert.equal(groups.find(g => g.providerId === "netflix").items.length, 1);
  assert.equal(groups.find(g => g.providerId === "max").items.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/vod/vod-provider-grouping.test.js`
Expected: FAIL — `ctx.providerKeyForItem is not a function` (the helpers don't exist yet).

- [ ] **Step 3: Register the new function names in the test loader**

In `tests/vod/loadVodHelpers.js`, add to `PURE_HELPER_NAMES`:

```js
  "providerKeyForItem", "attachProviders", "groupItemsByProvider",
```

- [ ] **Step 4: Implement the helpers in `sintoniza-link.html`**

Insert right after `dedupeVodItemsByTitle` (after line 4448, before `selectNewestVodItems`):

```js
// ─── Selo de streaming: cruzamento com o JSON gerado pelo GitHub Actions ───
// Mesma forma de chave usada por dedupeVodItemsByTitle (nome+ano em
// minúsculas) para que o mapa gerado offline (Python, ver
// scripts/vod_providers/build_provider_map.py) e o catálogo carregado no
// app apontem exatamente para a mesma entrada, sem normalização extra.
function providerKeyForItem(item) {
  return `${(item.name || "").trim().toLowerCase()}|${vodItemYearKey(item)}`;
}

// Não muta os itens de entrada (o cache _vodCatalogCache.itemsByCategory
// guarda os mesmos objetos em várias chaves; mutar aqui vazaria o campo
// para outras cópias antes delas passarem por este mesmo cruzamento).
function attachProviders(items, providerMap) {
  return items.map(item => ({
    ...item,
    streamingProviders: providerMap[providerKeyForItem(item)] || [],
  }));
}

// Uma fileira por streaming, na ordem dada, só para quem tem pelo menos um
// título (evita fileira vazia). Título com mais de um streaming aparece em
// cada fileira correspondente. Fecha com "outros" para quem não bateu com
// nenhum streaming mapeado - nunca descarta um item do catálogo.
function groupItemsByProvider(items, providerOrder) {
  const groups = providerOrder.map(id => ({
    providerId: id,
    items: items.filter(it => (it.streamingProviders || []).includes(id)),
  })).filter(g => g.items.length > 0);
  const outros = items.filter(it => !(it.streamingProviders || []).length);
  if (outros.length) groups.push({ providerId: "outros", items: outros });
  return groups;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/vod/vod-provider-grouping.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sintoniza-link.html tests/vod/loadVodHelpers.js tests/vod/vod-provider-grouping.test.js
git commit -m "feat(vod): pure helpers to attach and group catalog items by streaming provider"
```

---

### Task 2: Provider badges, "outros" label, and the display-mode toggle (UI + CSS)

**Files:**
- Modify: `sintoniza-link.html` (markup around line 1372, `vodCardHtml` at line 4759, CSS near the other `.vod-*` rules)
- Test: `tests/player/player-markup.test.js` (extend, following its existing pattern for asserting an element exists)

**Interfaces:**
- Consumes: `groupItemsByProvider`, `attachProviders` from Task 1; `PROVIDERS_BR` constant (this task defines it, see below).
- Produces: `PROVIDERS_BR` (id → `{ label, bg, fg }`), `PROVIDER_ORDER` (array of ids in display order), `vodCardHtml(item, contType)` updated to render a badge when `item.streamingProviders.length`, and a new toggle in the DOM with ids `vod-display-badge-btn` / `vod-display-group-btn` that later tasks wire up.

- [ ] **Step 1: Write the failing markup test**

Append to `tests/player/player-markup.test.js` (follow the file's existing style of reading `sintoniza-link.html` and asserting an id exists — see how it already checks `vod-skip-back-btn`):

```js
test("VOD view has a display-mode toggle (selo nos cartões / agrupar por streaming)", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  for (const id of ["vod-display-badge-btn", "vod-display-group-btn"]) {
    assert.ok(html.includes(`id="${id}"`), `expected #${id} in the VOD view`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/player/player-markup.test.js`
Expected: FAIL — ids not found.

- [ ] **Step 3: Add the toggle markup**

In `sintoniza-link.html`, replace the block at lines 1362–1373 (the `search-dock-slot` + the two divs right after it):

```html
      <div class="search-dock-slot">
        <label class="search-box" for="vod-search-input">
          <i data-lucide="search" style="width:18px;height:18px"></i>
          <input type="text" id="vod-search-input" placeholder="Buscar..." aria-label="Buscar catálogo de VOD" />
          <button class="search-clear" id="vod-search-clear" style="display:none" aria-label="Limpar busca">
            <i data-lucide="x" style="width:16px;height:16px"></i>
          </button>
        </label>
      </div>

      <!-- Só aparece quando vod-providers.json carregou com sucesso (ver
           updateVodDisplayToggleVisibility) - sem selo nenhum, alternar
           modo não faz sentido e ficaria um controle morto na tela. -->
      <div class="vod-display-toggle" id="vod-display-toggle" style="display:none" role="group" aria-label="Forma de exibição do catálogo">
        <button id="vod-display-badge-btn" class="vod-display-btn" aria-pressed="true">Selo nos cartões</button>
        <button id="vod-display-group-btn" class="vod-display-btn" aria-pressed="false">Agrupar por streaming</button>
      </div>

      <div class="vod-carousel-grid" id="vod-search-results" style="display:none"></div>
      <div id="vod-carousels"></div>
```

- [ ] **Step 4: Add the CSS** (near the other `.vod-row`/`.vod-carousel` rules, search for `.vod-carousel {` in the `<style>` block and add after it)

```css
.vod-display-toggle { display: flex; gap: 3px; padding: 4px; margin: 10px 0 4px; width: fit-content; background: var(--surface, #1a1e29); border: 1px solid var(--line-solid, #2a3245); border-radius: 999px; }
.vod-display-btn { appearance: none; border: 0; cursor: pointer; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 999px; background: transparent; color: var(--muted, #9aa2b6); }
.vod-display-btn[aria-pressed="true"] { background: var(--surface-2, #232a3c); color: var(--text, #eceef4); }
.vod-provider-badge { position: absolute; top: 8px; left: 8px; z-index: 3; font-size: 10.5px; font-weight: 700; padding: 3px 7px; border-radius: 7px; box-shadow: 0 2px 8px -2px #000b; white-space: nowrap; }
.vod-row-provider-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; margin-right: 7px; vertical-align: middle; }
```

- [ ] **Step 5: Define provider colors and badge rendering**

Right before `function vodCardHtml` (around line 4759 today — search for the function, it may have shifted after Task 1's insert), add:

```js
// Cores de marca por streaming (mesmas do protótipo aprovado) - texto
// simples em vez de logo (evita reproduzir marca registrada), mas com a
// cor certa de cada serviço para reconhecimento rápido no cartão.
const PROVIDERS_BR = {
  netflix:   { label: "Netflix",     bg: "#E50914", fg: "#fff" },
  prime:     { label: "Prime Video", bg: "#12b3f0", fg: "#04222e" },
  max:       { label: "Max",         bg: "#3b2fe3", fg: "#fff" },
  disney:    { label: "Disney+",     bg: "#0c2a8c", fg: "#fff" },
  apple:     { label: "Apple TV+",   bg: "#16181d", fg: "#fff" },
  paramount: { label: "Paramount+",  bg: "#0064ff", fg: "#fff" },
  globoplay: { label: "Globoplay",   bg: "#ff2d55", fg: "#fff" },
};
const PROVIDER_ORDER = ["netflix", "prime", "max", "disney", "apple", "paramount", "globoplay"];

function vodProviderBadgeHtml(streamingProviders) {
  if (!streamingProviders || !streamingProviders.length) return "";
  const p = PROVIDERS_BR[streamingProviders[0]];
  if (!p) return "";
  return `<span class="vod-provider-badge" style="background:${p.bg};color:${p.fg}">${p.label}</span>`;
}
```

Then in `vodCardHtml`, add the badge right after the opening `<button ...>` tag, before the `<img ...>` line:

```js
function vodCardHtml(item, contType) {
  const id = contType === "series" ? item.series_id : item.stream_id;
  const key = `${contType}-${id}`;
  _vodCardsIndex[key] = item;
  const poster = item.stream_icon || item.cover || "";
  const title  = item.name || item.title || "Sem título";
  return `
    <button class="vod-card" data-vod-key="${key}" data-lp="vod" tabindex="0">
      ${vodProviderBadgeHtml(item.streamingProviders)}
      <img src="${poster}" alt="" loading="lazy" onerror="this.style.opacity='0.15'">
      <p>${title}</p>
    </button>`;
}
```

(Note: `.vod-card` needs `position: relative` for the badge's `position: absolute` to anchor correctly — check the existing `.vod-card` rule; if it doesn't already have `position: relative`, add it there rather than duplicating the rule.)

- [ ] **Step 6: Run the markup test**

Run: `node --test tests/player/player-markup.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add sintoniza-link.html tests/player/player-markup.test.js
git commit -m "feat(vod): provider badges on catalog cards and a display-mode toggle"
```

---

### Task 3: Fetch the providers JSON and wire it into catalog rendering

**Files:**
- Modify: `sintoniza-link.html` (near `loadVodCatalog`, line 4837, and its render call sites)

**Interfaces:**
- Consumes: `attachProviders`, `groupItemsByProvider`, `PROVIDER_ORDER`, `PROVIDERS_BR` (Tasks 1–2).
- Produces: `VOD_PROVIDERS_URL` (constant), `fetchVodProviderMap()` (async, returns `{}` on any failure — never throws), `_vodProviderMap` (module-level cache), `vodDisplayMode` (module-level state, `"badge" | "group"`), `renderVodRows(items, contType)` (replaces the inline row-building block currently inside `loadVodCatalog`'s per-category `.then`).

- [ ] **Step 1: Add the fetch + state, and the toggle's click handlers**

Add near the top of the VOD section (right before `let _vodCatalogCache = ...`, around line 4374):

```js
// URL pública do JSON gerado 1x/dia pelo GitHub Actions (ver
// .github/workflows/vod-providers.yml e scripts/vod_providers/). Fica numa
// branch separada (vod-data) que nunca é mesclada em main/v9 - é só um
// canal de dados, atualizado por commit direto do bot.
const VOD_PROVIDERS_URL = "https://raw.githubusercontent.com/Guaitolinii/visual-craft-assistant/vod-data/vod-providers.json";

let _vodProviderMap = {};      // { "titulo|ano": ["netflix", "max"], ... }
let vodDisplayMode = "badge";  // "badge" | "group" - lido por renderVodRows

// Nunca lança: se o JSON ainda não existir, estiver com erro de rede, ou o
// bucket vier vazio, o catálogo continua funcionando só sem selo nenhum -
// este recurso nunca pode travar a reprodução ou a lista de VOD.
async function fetchVodProviderMap() {
  try {
    const res = await fetch(VOD_PROVIDERS_URL, { cache: "no-cache" });
    if (!res.ok) return {};
    const data = await res.json();
    return { ...(data.movies || {}), ...(data.series || {}) };
  } catch (e) {
    return {};
  }
}

function updateVodDisplayToggleVisibility() {
  const toggle = document.getElementById("vod-display-toggle");
  if (toggle) toggle.style.display = Object.keys(_vodProviderMap).length ? "flex" : "none";
}
```

- [ ] **Step 2: Extract the row-rendering into `renderVodRows`, reused by both modes**

Replace the block inside `loadVodCatalog` that builds `topCats.map(cat => ...)` and the per-category HTML (the section rendering `.vod-row` elements directly into `carouselsEl.innerHTML`) so that, instead of always rendering by category, it dispatches on `vodDisplayMode`. Add this function right after `vodCategoryDisplayName` (around line 4832):

```js
// Um único ponto de renderização das fileiras de catálogo, usado tanto na
// carga inicial de loadVodCatalog quanto na troca de modo (badge/agrupar) -
// troca de modo nunca refaz fetch, só re-renderiza com os mesmos itens já
// carregados em _vodCatalogCache.
function renderVodRows(allItems, contType) {
  const carouselsEl = document.getElementById("vod-carousels");
  const enriched = attachProviders(allItems, _vodProviderMap);

  if (vodDisplayMode === "group" && Object.keys(_vodProviderMap).length) {
    const groups = groupItemsByProvider(enriched, PROVIDER_ORDER);
    carouselsEl.innerHTML = groups.map(g => {
      const label = g.providerId === "outros"
        ? (contType === "series" ? "Demais séries" : "Demais filmes")
        : PROVIDERS_BR[g.providerId].label;
      const dot = g.providerId === "outros" ? "" :
        `<span class="vod-row-provider-dot" style="background:${PROVIDERS_BR[g.providerId].bg}"></span>`;
      return `
        <div class="vod-row" data-cat-id="${g.providerId}">
          <div class="vod-row-header"><h2>${dot}${label}</h2></div>
          <div class="vod-carousel">${g.items.slice(0, VOD_ROW_INITIAL_COUNT).map(item => vodCardHtml(item, contType)).join("")}</div>
        </div>`;
    }).join("");
    return;
  }

  // Modo "badge" (padrão): mantém o agrupamento por gênero/categoria já
  // existente, só que cada cartão ganha attachProviders aplicado.
  const byCategory = {};
  for (const item of enriched) (byCategory[item.category_id] ||= []).push(item);
  carouselsEl.innerHTML = _vodCatalogCache.categories.map(cat => {
    const items = byCategory[cat.category_id] || [];
    if (!items.length) return "";
    return `
      <div class="vod-row" data-cat-id="${cat.category_id}">
        <div class="vod-row-header">
          <h2>${vodCategoryDisplayName(cat)}</h2>
          <button class="vod-see-all" data-cat-id="${cat.category_id}">Ver todos</button>
        </div>
        <div class="vod-carousel" id="vod-carousel-${cat.category_id}">${items.slice(0, VOD_ROW_INITIAL_COUNT).map(item => vodCardHtml(item, contType)).join("")}</div>
      </div>`;
  }).join("");
}
```

Note for whoever implements this step: `loadVodCatalog` today renders each category's row as soon as its own fetch resolves (progressive, per-category). Switching to `renderVodRows` driven off `_vodCatalogCache` means rows now render once, after enough categories have resolved. Keep `loadVodCatalog`'s existing `Promise.allSettled(categoryFetches)` block, and call `renderVodRows(Object.values(_vodCatalogCache.itemsByCategory).flat(), contType)` from inside that `.then`, instead of (or in addition to, guarded to run once) the per-category immediate render. Preserve the existing "Novidades" row behavior exactly as-is; `renderVodRows` only replaces the genre/provider rows, not the personal rows (Minha Lista, Continue Assistindo, Novidades) which stay prepended exactly as they are today.

- [ ] **Step 3: Fetch the provider map once, alongside the catalog, and wire the toggle buttons**

Inside `loadVodCatalog`, right after the existing `_vodCatalogCache = { vodType, categories: [], itemsByCategory: {} };` reset line, add:

```js
  if (!Object.keys(_vodProviderMap).length) {
    fetchVodProviderMap().then(map => {
      _vodProviderMap = map;
      updateVodDisplayToggleVisibility();
      renderVodRows(Object.values(_vodCatalogCache.itemsByCategory).flat(), contType);
    });
  }
```

Wire the two toggle buttons once, in the same place `document.getElementById("reload-stream-btn")` and similar one-time listeners are attached (search for where `vod-search-input`'s listener is attached and add nearby):

```js
document.getElementById("vod-display-badge-btn").addEventListener("click", () => {
  vodDisplayMode = "badge";
  document.getElementById("vod-display-badge-btn").setAttribute("aria-pressed", "true");
  document.getElementById("vod-display-group-btn").setAttribute("aria-pressed", "false");
  renderVodRows(Object.values(_vodCatalogCache.itemsByCategory).flat(), _vodCatalogCache.vodType === "series" ? "series" : "vod");
});
document.getElementById("vod-display-group-btn").addEventListener("click", () => {
  vodDisplayMode = "group";
  document.getElementById("vod-display-group-btn").setAttribute("aria-pressed", "true");
  document.getElementById("vod-display-badge-btn").setAttribute("aria-pressed", "false");
  renderVodRows(Object.values(_vodCatalogCache.itemsByCategory).flat(), _vodCatalogCache.vodType === "series" ? "series" : "vod");
});
```

- [ ] **Step 4: Manual verification (this task has no new pure-function surface — Tasks 1–2 already cover those with unit tests)**

Run: `npm test` (confirms Tasks 1–2's tests and everything else still pass; this task's wiring is exercised live).
Then, with `npm run dev` running and a browser open on the VOD tab: confirm the toggle stays hidden until `vod-providers.json` exists (Task 5), and confirm switching modes re-renders without a network request (check the Network tab — no new `player_api.php` calls on toggle click).

- [ ] **Step 5: Commit**

```bash
git add sintoniza-link.html
git commit -m "feat(vod): fetch provider map once per session and switch catalog rendering by display mode"
```

---

### Task 4: The Python cross-reference script

**Files:**
- Create: `scripts/vod_providers/build_provider_map.py`
- Create: `scripts/vod_providers/test_build_provider_map.py`

**Interfaces:**
- Consumes: env vars `VOD_XTREAM_BASE`, `VOD_XTREAM_USER`, `VOD_XTREAM_PASS`, `TMDB_API_KEY` (all required; script exits with a clear error naming the missing one if absent).
- Produces: `vod-providers.json` written to the current working directory, shaped `{"generatedAt": "<ISO8601>", "movies": {"<key>": ["netflix", ...]}, "series": {"<key>": [...]}}`. Also exposes, importable for the test file: `normalize_key(name, year) -> str`, `fetch_provider_id_sets(tmdb_api_key, media_type) -> dict[int, set[int]]`, `search_tmdb_id(tmdb_api_key, media_type, name, year) -> int | None`.

- [ ] **Step 1: Write the failing unit tests (pure logic only — no network)**

```python
# scripts/vod_providers/test_build_provider_map.py
import unittest
from build_provider_map import normalize_key, PROVIDERS_BR

class TestNormalizeKey(unittest.TestCase):
    def test_matches_js_key_shape(self):
        # Precisa bater exatamente com providerKeyForItem no sintoniza-link.html:
        # `${name.trim().toLowerCase()}|${year}` - mesmo par nome+ano, sem
        # remover acento nem pontuação, senão as chaves nunca se encontram.
        self.assertEqual(normalize_key("  Duna: Parte Dois ", "2024"), "duna: parte dois|2024")

    def test_lowercases_accented_characters(self):
        self.assertEqual(normalize_key("Ação", "2020"), "ação|2020")

    def test_empty_year_still_produces_a_key(self):
        self.assertEqual(normalize_key("Sem Ano", ""), "sem ano|")

class TestProvidersConfig(unittest.TestCase):
    def test_seven_brazilian_providers_configured(self):
        # Mesmo conjunto usado nos badges do app (Task 2) - se um lado
        # adicionar um streaming nomeado diferente, o selo nunca aparece.
        self.assertEqual(
            set(PROVIDERS_BR.values()),
            {"netflix", "prime", "max", "disney", "apple", "paramount", "globoplay"},
        )

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts/vod_providers && python -m unittest test_build_provider_map -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'build_provider_map'`.

- [ ] **Step 3: Implement `build_provider_map.py`**

```python
"""
Cruza o catálogo de Filmes/Séries do provedor Xtream com a base pública da
TMDB (watch/providers, região BR) e gera vod-providers.json: um mapa
"titulo|ano" -> lista de streamings onde aquele título está disponível hoje.

Roda 1x/dia via .github/workflows/vod-providers.yml. Não lê nem escreve
nenhuma credencial de usuário final - as do Xtream vêm só de variáveis de
ambiente (secrets do repositório), nunca de um valor fixo no código.

IDs de provedor TMDB para o Brasil (https://api.themoviedb.org/3/watch/providers/movie?watch_region=BR):
netflix=8, prime video=119, disney plus=337, max=1899, apple tv plus=350,
paramount plus=531, globoplay=307.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TMDB_BASE = "https://api.themoviedb.org/3"
DISCOVER_PAGES_PER_PROVIDER = 5  # ~100 títulos mais populares por streaming

# id TMDB -> chave curta usada no app (badges de PROVIDERS_BR em sintoniza-link.html)
PROVIDERS_BR = {
    8: "netflix",
    119: "prime",
    337: "disney",
    1899: "max",
    350: "apple",
    531: "paramount",
    307: "globoplay",
}


def _http_get_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "vod-provider-crossref/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize_key(name, year):
    """Mesma forma de chave usada por providerKeyForItem() no app - nome em
    minúsculas e sem espaços nas pontas, sem remover acento ou pontuação, e
    o ano concatenado com '|'. Qualquer normalização a mais aqui faria as
    chaves nunca baterem com o lado JS."""
    return f"{(name or '').strip().lower()}|{year or ''}"


def fetch_provider_id_sets(tmdb_api_key, media_type):
    """media_type: 'movie' ou 'tv'. Devolve {tmdb_provider_id: set(tmdb_ids)}."""
    endpoint = "discover/movie" if media_type == "movie" else "discover/tv"
    result = {}
    for provider_id in PROVIDERS_BR:
        ids = set()
        for page in range(1, DISCOVER_PAGES_PER_PROVIDER + 1):
            params = urllib.parse.urlencode({
                "api_key": tmdb_api_key,
                "watch_region": "BR",
                "with_watch_providers": provider_id,
                "sort_by": "popularity.desc",
                "page": page,
            })
            try:
                data = _http_get_json(f"{TMDB_BASE}/{endpoint}?{params}")
            except Exception as exc:
                print(f"[aviso] {endpoint} provider={provider_id} page={page} falhou: {exc}", file=sys.stderr)
                break
            for entry in data.get("results", []):
                ids.add(entry["id"])
            if page >= data.get("total_pages", 1):
                break
        result[provider_id] = ids
        print(f"  -> provider {provider_id} ({media_type}): {len(ids)} títulos")
    return result


def search_tmdb_id(tmdb_api_key, media_type, name, year):
    """Busca o id TMDB de um título do catálogo por nome (+ano quando houver).
    Devolve None se não achar - o item some do mapa (fica sem selo), nunca
    quebra o restante do processamento."""
    endpoint = "search/movie" if media_type == "movie" else "search/tv"
    year_param = "year" if media_type == "movie" else "first_air_date_year"
    params = {"api_key": tmdb_api_key, "query": name, "language": "pt-BR"}
    if year:
        params[year_param] = year
    try:
        data = _http_get_json(f"{TMDB_BASE}/{endpoint}?{urllib.parse.urlencode(params)}")
    except Exception as exc:
        print(f"[aviso] busca falhou para '{name}' ({year}): {exc}", file=sys.stderr)
        return None
    results = data.get("results") or []
    return results[0]["id"] if results else None


def fetch_xtream_catalog(base, user, password, action):
    """action: 'get_vod_streams' ou 'get_series'. Mesmo endpoint que o app
    já usa (xtreamApiUrl em sintoniza-link.html) - lista completa, sem
    paginar por categoria aqui porque não precisamos separar por gênero
    neste script, só cruzar título+ano."""
    params = urllib.parse.urlencode({"username": user, "password": password, "action": action})
    return _http_get_json(f"{base}/player_api.php?{params}")


def build_map_for(base, user, password, tmdb_api_key, xtream_action, media_type):
    print(f"[*] Baixando catálogo Xtream ({xtream_action})...")
    catalog = fetch_xtream_catalog(base, user, password, xtream_action)
    if not isinstance(catalog, list):
        print(f"[aviso] resposta inesperada de {xtream_action}, pulando.", file=sys.stderr)
        return {}

    print(f"[*] Baixando catálogos de streaming BR via TMDB ({media_type})...")
    provider_id_sets = fetch_provider_id_sets(tmdb_api_key, media_type)

    out = {}
    for entry in catalog:
        name = entry.get("name") or entry.get("title") or ""
        year = entry.get("year") or str(entry.get("releaseDate", ""))[:4]
        if not name:
            continue
        tmdb_id = search_tmdb_id(tmdb_api_key, media_type, name, year)
        time.sleep(0.05)  # respeita o rate limit da TMDB (~50 req/s)
        if tmdb_id is None:
            continue
        providers = [short for pid, short in PROVIDERS_BR.items() if tmdb_id in provider_id_sets.get(pid, ())]
        if providers:
            out[normalize_key(name, year)] = providers
    print(f"[✓] {len(out)}/{len(catalog)} títulos casados com pelo menos um streaming.")
    return out


def main():
    base = os.environ.get("VOD_XTREAM_BASE")
    user = os.environ.get("VOD_XTREAM_USER")
    password = os.environ.get("VOD_XTREAM_PASS")
    tmdb_api_key = os.environ.get("TMDB_API_KEY")
    missing = [n for n, v in [("VOD_XTREAM_BASE", base), ("VOD_XTREAM_USER", user),
                              ("VOD_XTREAM_PASS", password), ("TMDB_API_KEY", tmdb_api_key)] if not v]
    if missing:
        print(f"[erro] variáveis de ambiente ausentes: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    movies = build_map_for(base, user, password, tmdb_api_key, "get_vod_streams", "movie")
    series = build_map_for(base, user, password, tmdb_api_key, "get_series", "tv")

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "movies": movies,
        "series": series,
    }
    with open("vod-providers.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print("[✓] vod-providers.json gravado.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd scripts/vod_providers && python -m unittest test_build_provider_map -v`
Expected: PASS (3 tests). These only exercise `normalize_key` and `PROVIDERS_BR` — no network call runs in CI-less local testing.

- [ ] **Step 5: One real, manual smoke run (needs real secrets — run locally once, not in CI)**

```bash
export VOD_XTREAM_BASE="http://dbonline.tech-cdn.top:80"
export VOD_XTREAM_USER="<seu usuário Xtream real - não registre o valor aqui>"
export VOD_XTREAM_PASS="<sua senha Xtream real - não registre o valor aqui>"
export TMDB_API_KEY="<sua chave gratuita de themoviedb.org>"
python scripts/vod_providers/build_provider_map.py
```

Expected: prints progress per provider, ends with `[✓] vod-providers.json gravado.`; open the file and confirm it has both a `movies` and a `series` object with at least a few entries. **This step's env vars are for your own terminal only — never commit a `.env` with these, and clear your shell history of this block afterward** (`history -d` for the relevant lines, or just close the terminal).

- [ ] **Step 6: Commit**

```bash
git add scripts/vod_providers/build_provider_map.py scripts/vod_providers/test_build_provider_map.py
git commit -m "feat(vod-providers): script to cross-reference the VOD catalog against TMDB watch providers (BR)"
```

---

### Task 5: The GitHub Actions workflow (daily cron + manual run)

**Files:**
- Create: `.github/workflows/vod-providers.yml`

**Interfaces:**
- Consumes: repository secrets `VOD_XTREAM_BASE`, `VOD_XTREAM_USER`, `VOD_XTREAM_PASS`, `TMDB_API_KEY` (you add these once, see Step 1).
- Produces: a commit on the **orphan branch `vod-data`** containing `vod-providers.json`, which is what `VOD_PROVIDERS_URL` (Task 3) reads from `raw.githubusercontent.com`.

- [ ] **Step 1: Add the four repository secrets** (GitHub UI, once — not a code step)

Repo → **Settings → Secrets and variables → Actions → New repository secret**, four times:
- `VOD_XTREAM_BASE` = `http://dbonline.tech-cdn.top:80`
- `VOD_XTREAM_USER` = (seu usuário Xtream real - cole direto no GitHub, não registre aqui)
- `VOD_XTREAM_PASS` = (sua senha Xtream real - cole direto no GitHub, não registre aqui)
- `TMDB_API_KEY` = (your free key from themoviedb.org → Settings → API)

- [ ] **Step 2: Create the orphan `vod-data` branch** (once — this is what keeps it fully isolated from `main`/`v8`/`v9`)

```bash
git checkout --orphan vod-data
git rm -rf .
echo '{"generatedAt": null, "movies": {}, "series": {}}' > vod-providers.json
git add vod-providers.json
git commit -m "chore(vod-data): seed empty provider map"
git push origin vod-data
git checkout main
```

- [ ] **Step 3: Write the workflow**

```yaml
name: Atualizar mapa de streaming do catálogo VOD

on:
  schedule:
    - cron: "0 8 * * *" # 05:00 no horário de Brasília
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout (branch de dados)
        uses: actions/checkout@v4
        with:
          ref: vod-data

      - name: Baixar o script de cruzamento da main
        # O script vive em main (versionado junto do resto do código); só o
        # JSON gerado mora em vod-data. Copiamos o script para dentro do
        # checkout da branch de dados só para rodar aqui, sem commitá-lo.
        run: |
          git fetch origin main --depth=1
          git show origin/main:scripts/vod_providers/build_provider_map.py > build_provider_map.py

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Gerar vod-providers.json
        env:
          VOD_XTREAM_BASE: ${{ secrets.VOD_XTREAM_BASE }}
          VOD_XTREAM_USER: ${{ secrets.VOD_XTREAM_USER }}
          VOD_XTREAM_PASS: ${{ secrets.VOD_XTREAM_PASS }}
          TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}
        run: python build_provider_map.py

      - name: Commitar só o JSON (o script baixado não entra na branch de dados)
        run: |
          rm -f build_provider_map.py
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add vod-providers.json
          if git diff --staged --quiet; then
            echo "Sem mudanças no catálogo de streaming hoje."
          else
            git commit -m "chore(vod-data): atualizar mapa de streaming"
            git push origin vod-data
          fi
```

- [ ] **Step 4: Run it once by hand and verify**

GitHub UI → **Actions → "Atualizar mapa de streaming do catálogo VOD" → Run workflow**. Wait for it to finish, then check:

```bash
curl -s https://raw.githubusercontent.com/Guaitolinii/visual-craft-assistant/vod-data/vod-providers.json | head -c 300
```

Expected: real JSON with a non-null `generatedAt` and populated `movies`/`series` objects (not the empty seed from Step 2).

- [ ] **Step 5: Commit the workflow file itself to `main` (or to `v9`, see Task 6 — either is fine, since this workflow's trigger is `schedule`/`workflow_dispatch`, not a push filter, so branch placement doesn't matter for it to run)**

```bash
git add .github/workflows/vod-providers.yml
git commit -m "ci(vod-providers): daily cross-reference of the VOD catalog against TMDB watch providers"
```

---

### Task 6: `v9` branch and its own mobile-build workflow (without touching `build-mobile.yml`)

**Files:**
- Create: `.github/workflows/build-mobile-v9.yml` (copy of `build-mobile.yml` with the branch filter and artifact names changed)
- No modification to `.github/workflows/build-mobile.yml` or `.github/workflows/pages.yml`.

- [ ] **Step 1: Create the `v9` branch from `v8`** (the current frontier — `v8` already has fixes `main` doesn't)

```bash
git fetch origin v8
git checkout -b v9 origin/v8
```

- [ ] **Step 2: Apply Tasks 1–3's `sintoniza-link.html`/test changes on top of `v9`**

If Tasks 1–3 were done on a branch off `main`, cherry-pick or rebase those commits onto `v9`:

```bash
git cherry-pick <sha-task-1> <sha-task-2> <sha-task-3>
```

(If `sintoniza-link.html` diverged meaningfully between `main` and `v8`, resolve conflicts keeping `v8`'s existing fixes and layering this feature's hunks on top — the helper functions and markup added in Tasks 1–2 are additive blocks, so conflicts should be limited to nearby line-number shifts, not logic clashes.)

- [ ] **Step 3: Copy the mobile-build workflow with only the trigger changed**

```bash
cp .github/workflows/build-mobile.yml .github/workflows/build-mobile-v9.yml
```

Edit `build-mobile-v9.yml`:
- `name: Build Android APK e iOS IPA` → `name: Build Android APK e iOS IPA (v9)`
- `on.push.branches: [main]` → `on.push.branches: [v9]`
- `paths:` list stays identical (same files still matter)
- both `upload-artifact` steps: `name: sintoniza-android-debug` → `name: sintoniza-android-debug-v9`, `name: sintoniza-ios-unsigned` → `name: sintoniza-ios-unsigned-v9`

- [ ] **Step 4: Push `v9` and confirm the new workflow fires on it, not on `main`**

```bash
git add .github/workflows/build-mobile-v9.yml
git commit -m "ci(v9): mobile build workflow scoped to the v9 branch, build-mobile.yml untouched"
git push -u origin v9
```

GitHub UI → **Actions**: confirm a run of "Build Android APK e iOS IPA (v9)" started for the `v9` push, and that "Build Android APK e iOS IPA" (the original) did **not** run.

- [ ] **Step 5: Manual end-to-end check**

Download the `sintoniza-android-debug-v9` artifact from that run, install it on a device or emulator, open **Filmes** or **Séries**, confirm:
- The "Selo nos cartões" / "Agrupar por streaming" toggle is visible (meaning `vod-providers.json` fetched successfully over the device's real network).
- Switching modes shows badges in one, and a "Demais filmes"/"Demais séries" row as the last row in the other.

---

## Self-Review Notes

- **Spec coverage:** genre view kept as default and working without the feature (Task 3, silent-failure fetch) ✓; both display modes read one dataset (Task 1's `attachProviders` feeds both `renderVodRows` branches) ✓; trailing "Demais filmes"/"Demais séries" row (Task 1's `groupItemsByProvider` + Task 3's label logic) ✓; toggle placement in the real app (Task 2, exact line) ✓; GitHub Actions cross-reference producing a ready-to-use URL (Task 4 + 5) ✓; credentials never hardcoded (Global Constraints + Task 5 secrets) ✓; `build-mobile.yml`/`pages.yml` untouched, new `v9` branch and workflow instead (Task 6) ✓.
- **Placeholder scan:** no TBDs; every step has real code or an exact command.
- **Type consistency:** `streamingProviders` (array of provider-id strings) is the one shape used everywhere — Task 1 produces it, Task 2's badge/CSS reads `item.streamingProviders[0]`, Task 3's `renderVodRows` passes it through, Task 4's Python output keys (`"netflix"`, `"prime"`, …) match `PROVIDERS_BR`'s JS keys exactly.
