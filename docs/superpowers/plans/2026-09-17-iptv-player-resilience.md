# IPTV Player Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-priority buffering/stability gaps identified in the HLS/MPEG-TS research for `sintoniza.html` (the standalone IPTV player), without breaking its "single file, no build, works via `file://`" design.

**Architecture:** `sintoniza.html` currently ships as ONE classic (non-module) `<script>` block. We add a **second, separate classic `<script id="resilience-helpers">` block** placed immediately before the existing one. It holds small, pure, dependency-free functions (no DOM/network access — all inputs passed as arguments). Because both are classic scripts on the same page, functions/vars declared with `function`/`var` in the new block become real globals the existing big script can call directly — no `import`, no bundler, no change to how the file is opened. The same purity lets us unit-test them for real: a test helper extracts the `resilience-helpers` script's source text out of the actual `sintoniza.html` file and runs it in a Node `vm` sandbox, so tests exercise the literal shipped code, not a duplicate copy.

Testing uses Node's **built-in** test runner (`node --test`) — zero new dependencies, so nothing touches `bun.lock`/`package-lock.json` or the bunfig.toml 24h supply-chain guard.

**Tech Stack:** Vanilla JS (ES2017+), Node.js built-in `node:test` / `node:assert/strict` / `node:vm`, hls.js (CDN), mpegts.js (CDN).

**Spec:** No separate spec doc — this plan implements the gap list from the investigation delivered earlier in this conversation (HLS.js / mpegts.js best practices research, sources: hls.js buffer/error-recovery docs, `alvarolobato/iptv-proxy` PR #51, MDN Page Visibility API, MDN Network Information API).

## Global Constraints

- `sintoniza.html` must keep working when opened directly via `file://` (double-click) — **no ES module `import`, no external JS file, no bundler step** for anything shipped to the browser.
- No new npm/bun dependencies — use `node:test` (built into Node ≥18) for all automated tests.
- Do not touch the pre-existing unrelated pending changes in the working tree (`src/routeTree.gen.ts` modified, `package-lock.json` untracked) — stage only files this plan creates/modifies.
- Out of scope (explicitly deferred, not part of this plan): multi-source/mirror failover (needs real M3U data with backup URLs to design against — speculative today), LL-HLS / CMCD (wrong fit for a relay-style IPTV player that intentionally favors buffer stability over latency).
- Commit after every task. Push to `origin/main` (`https://github.com/Guaitolinii/visual-craft-assistant.git`) only in the final task, after all tasks are committed and verified.

---

### Task 1: Test harness scaffold + `pickInitialBufferStageIndex`

**Files:**
- Create: `tests/helpers/extractInlineScript.js`
- Create: `tests/player/resilience-helpers.test.js`
- Modify: `sintoniza.html:991` (insert new script block right before the existing `<script>` at line 992)
- Modify: `package.json:6-13` (add `"test"` script)

**Interfaces:**
- Produces: `extractInlineScriptById(htmlFilePath, scriptId) -> string` — reads the HTML file and returns the raw source text of `<script id="scriptId">...</script>`. Used by every test file in this plan.
- Produces: `loadResilienceHelpers() -> vm.Context` (local test helper, one per test file) — evaluates the extracted script in a sandbox and returns the resulting global object, exposing every `function`/`var` declared in `resilience-helpers` as a property.
- Produces (in `sintoniza.html`): `function pickInitialBufferStageIndex({ connectionEffectiveType, stagesLength })` — used by Task 6.

- [ ] **Step 1: Write the failing test for the extraction helper**

Create `tests/helpers/extractInlineScript.js` is the implementation, so first write its test:

```js
// tests/helpers/extractInlineScript.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "./extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "..", "..", "sintoniza.html");

test("extractInlineScriptById returns the source of the resilience-helpers script", () => {
  const source = extractInlineScriptById(HTML_PATH, "resilience-helpers");
  assert.match(source, /function pickInitialBufferStageIndex/);
});

test("extractInlineScriptById throws a clear error when the id is missing", () => {
  assert.throws(
    () => extractInlineScriptById(HTML_PATH, "does-not-exist"),
    /does-not-exist/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/helpers/extractInlineScript.test.js`
Expected: FAIL — `Cannot find module './extractInlineScript.js'` (file doesn't exist yet) and/or `sintoniza.html` has no `id="resilience-helpers"` script yet.

- [ ] **Step 3: Implement the extraction helper**

Create `tests/helpers/extractInlineScript.js`:

```js
import { readFileSync } from "node:fs";

export function extractInlineScriptById(htmlFilePath, scriptId) {
  const html = readFileSync(htmlFilePath, "utf8");
  const pattern = new RegExp(
    `<script id="${scriptId}">([\\s\\S]*?)</script>`
  );
  const match = html.match(pattern);
  if (!match) {
    throw new Error(
      `No <script id="${scriptId}"> found in ${htmlFilePath}`
    );
  }
  return match[1];
}
```

- [ ] **Step 4: Insert the (still-empty) resilience-helpers script block into `sintoniza.html`**

Find this exact text at `sintoniza.html:991-992` (immediately before the big script tag):

```html
  <!-- mpegts.js para streams MPEG-TS diretos (.ts) -->
  <script src="https://cdn.jsdelivr.net/npm/mpegts.js@latest"></script>
```

That's in `<head>`. The big script tag we care about is the one starting at line 992 further down, right before `</body>`. Locate this exact text (the line immediately before the main script block):

```html
</div>

<script>
```

Replace it with:

```html
</div>

<script id="resilience-helpers">
// ─── Resilience Helpers (pure, dependency-free) ───
// Declared with `function`/`var` (not `const`/`let`) on purpose: as a classic
// <script> tag these become real globals the script below can call directly,
// AND the same property-on-global-object behavior is what lets the Node test
// harness (tests/helpers/extractInlineScript.js + node:vm) read them back
// after evaluating this block's source in a sandbox. Keep every function here
// pure — no `document`, `window`, `navigator`, `fetch`, or timers inside this
// block — so it stays trivially unit-testable.

function pickInitialBufferStageIndex(opts) {
  var connectionEffectiveType = opts && opts.connectionEffectiveType;
  var stagesLength = opts && opts.stagesLength;
  if (!stagesLength || stagesLength < 1) return 0;
  var index = 0;
  if (connectionEffectiveType === "slow-2g" || connectionEffectiveType === "2g") {
    index = 2;
  } else if (connectionEffectiveType === "3g") {
    index = 1;
  }
  return Math.min(index, stagesLength - 1);
}
</script>

<script>
```

- [ ] **Step 5: Write the resilience-helpers test for `pickInitialBufferStageIndex`**

Create `tests/player/resilience-helpers.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "..", "..", "sintoniza.html");

export function loadResilienceHelpers() {
  const source = extractInlineScriptById(HTML_PATH, "resilience-helpers");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "resilience-helpers.js" });
  return context;
}

test("pickInitialBufferStageIndex: defaults to stage 0 on fast/unknown connections", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "4g", stagesLength: 5 }),
    0
  );
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: undefined, stagesLength: 5 }),
    0
  );
});

test("pickInitialBufferStageIndex: starts higher on 3g", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "3g", stagesLength: 5 }),
    1
  );
});

test("pickInitialBufferStageIndex: starts even higher on 2g/slow-2g", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "2g", stagesLength: 5 }),
    2
  );
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "slow-2g", stagesLength: 5 }),
    2
  );
});

test("pickInitialBufferStageIndex: clamps to the last stage when the ladder is short", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(
    ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "2g", stagesLength: 2 }),
    1
  );
});

test("pickInitialBufferStageIndex: returns 0 when stagesLength is missing or 0", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.pickInitialBufferStageIndex({ connectionEffectiveType: "2g", stagesLength: 0 }), 0);
  assert.equal(ctx.pickInitialBufferStageIndex({}), 0);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/`
Expected: PASS — all tests in `tests/helpers/extractInlineScript.test.js` and `tests/player/resilience-helpers.test.js` green.

- [ ] **Step 7: Add the `test` script to `package.json`**

In `package.json`, the `"scripts"` block currently reads:

```json
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
```

Replace with:

```json
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "node --test tests/"
  },
```

- [ ] **Step 8: Run the new script to confirm it works**

Run: `npm run test`
Expected: PASS — same output as Step 6, invoked through the new script.

- [ ] **Step 9: Commit**

```bash
git add tests/helpers/extractInlineScript.js tests/player/resilience-helpers.test.js sintoniza.html package.json
git commit -m "test: add resilience-helpers test harness with pickInitialBufferStageIndex"
```

---

### Task 2: `MPEGTS_RESILIENCE_CONFIG`

**Files:**
- Modify: `sintoniza.html` (append to the `resilience-helpers` script block from Task 1)
- Modify: `tests/player/resilience-helpers.test.js`

**Interfaces:**
- Consumes: nothing (standalone constant).
- Produces: `MPEGTS_RESILIENCE_CONFIG` (object) — used by Task 7 when constructing the mpegts.js player config.

- [ ] **Step 1: Write the failing test**

Append to `tests/player/resilience-helpers.test.js`:

```js
test("MPEGTS_RESILIENCE_CONFIG: balances latency-chasing against stall-proofing", () => {
  const ctx = loadResilienceHelpers();
  assert.deepEqual(ctx.MPEGTS_RESILIENCE_CONFIG, {
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 10,
    liveBufferLatencyMinRemain: 4,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 60,
    autoCleanupMinBackwardDuration: 30,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: FAIL — `ctx.MPEGTS_RESILIENCE_CONFIG` is `undefined`.

- [ ] **Step 3: Implement**

In `sintoniza.html`, inside the `resilience-helpers` script block, append after `pickInitialBufferStageIndex`'s closing `}`:

```js

// Relaxed latency-chasing (10s max / 4s min remain) + bounded backward cleanup
// (60s/30s) instead of "no chasing + never clean up". Values match the fix
// validated in production by a real mpegts.js-based IPTV player
// (alvarolobato/iptv-proxy PR #51): the old chase-to-1.5s config caused 28
// stalls per 45s; disabling chasing entirely (this project's previous config)
// avoids that but lets the buffer grow forever, risking memory bloat on
// hours-long viewing sessions. This keeps ~5-6s of forward buffer while
// pruning the backward buffer instead of letting it grow unbounded.
var MPEGTS_RESILIENCE_CONFIG = {
  liveBufferLatencyChasing: true,
  liveBufferLatencyMaxLatency: 10,
  liveBufferLatencyMinRemain: 4,
  autoCleanupSourceBuffer: true,
  autoCleanupMaxBackwardDuration: 60,
  autoCleanupMinBackwardDuration: 30,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html tests/player/resilience-helpers.test.js
git commit -m "feat(player): add MPEGTS_RESILIENCE_CONFIG constant"
```

---

### Task 3: `computeReconnectBackoffMs`

**Files:**
- Modify: `sintoniza.html` (append to `resilience-helpers`)
- Modify: `tests/player/resilience-helpers.test.js`

**Interfaces:**
- Produces: `function computeReconnectBackoffMs(attempt, opts)` — `opts: { baseMs?, maxMs?, randomFn? }`, returns milliseconds. Used by Task 8 for HLS `NETWORK_ERROR` retry scheduling.

- [ ] **Step 1: Write the failing test**

Append to `tests/player/resilience-helpers.test.js`:

```js
test("computeReconnectBackoffMs: grows exponentially with attempt number", () => {
  const ctx = loadResilienceHelpers();
  const fixedRandom = () => 0; // pin jitter to the low end (50% of the exponential value)
  assert.equal(ctx.computeReconnectBackoffMs(0, { baseMs: 1000, randomFn: fixedRandom }), 500);
  assert.equal(ctx.computeReconnectBackoffMs(1, { baseMs: 1000, randomFn: fixedRandom }), 1000);
  assert.equal(ctx.computeReconnectBackoffMs(2, { baseMs: 1000, randomFn: fixedRandom }), 2000);
});

test("computeReconnectBackoffMs: caps at maxMs regardless of attempt", () => {
  const ctx = loadResilienceHelpers();
  const fixedRandom = () => 1; // pin jitter to the high end (100% of the exponential value)
  assert.equal(
    ctx.computeReconnectBackoffMs(10, { baseMs: 1000, maxMs: 15000, randomFn: fixedRandom }),
    15000
  );
});

test("computeReconnectBackoffMs: uses sane defaults when opts is omitted", () => {
  const ctx = loadResilienceHelpers();
  const value = ctx.computeReconnectBackoffMs(0);
  assert.ok(value >= 500 && value <= 1000, `expected 500-1000, got ${value}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: FAIL — `ctx.computeReconnectBackoffMs is not a function`.

- [ ] **Step 3: Implement**

Append to the `resilience-helpers` script block in `sintoniza.html`:

```js

// Exponential backoff with jitter for HLS NETWORK_ERROR retries. Without
// this, hls.js's NETWORK_ERROR handler called startLoad() immediately on
// every fatal network error — if the origin is truly down, that hammers it
// with requests instead of backing off.
function computeReconnectBackoffMs(attempt, opts) {
  var options = opts || {};
  var baseMs = options.baseMs || 1000;
  var maxMs = options.maxMs || 15000;
  var randomFn = options.randomFn || Math.random;
  var exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  var jitter = 0.5 + randomFn() * 0.5; // 50%-100% of the exponential value
  return Math.round(exp * jitter);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html tests/player/resilience-helpers.test.js
git commit -m "feat(player): add computeReconnectBackoffMs exponential backoff helper"
```

---

### Task 4: `createMediaErrorEscalation`

**Files:**
- Modify: `sintoniza.html` (append to `resilience-helpers`)
- Modify: `tests/player/resilience-helpers.test.js`

**Interfaces:**
- Produces: `function createMediaErrorEscalation(opts?) -> { record(nowMs) -> "RECOVER"|"SWAP_AUDIO_CODEC"|"FULL_REBUILD", reset() }`. Used by Task 9 for HLS `MEDIA_ERROR` handling.

- [ ] **Step 1: Write the failing test**

Append to `tests/player/resilience-helpers.test.js`:

```js
test("createMediaErrorEscalation: escalates RECOVER -> SWAP_AUDIO_CODEC -> FULL_REBUILD", () => {
  const ctx = loadResilienceHelpers();
  const escalation = ctx.createMediaErrorEscalation();
  assert.equal(escalation.record(0), "RECOVER");
  assert.equal(escalation.record(100), "SWAP_AUDIO_CODEC");
  assert.equal(escalation.record(200), "FULL_REBUILD");
  assert.equal(escalation.record(300), "FULL_REBUILD");
});

test("createMediaErrorEscalation: resets the ladder after a quiet window", () => {
  const ctx = loadResilienceHelpers();
  const escalation = ctx.createMediaErrorEscalation({ windowMs: 20000 });
  assert.equal(escalation.record(0), "RECOVER");
  assert.equal(escalation.record(5000), "SWAP_AUDIO_CODEC");
  // 30s of healthy playback passes before the next error - ladder should reset
  assert.equal(escalation.record(35000), "RECOVER");
});

test("createMediaErrorEscalation: reset() manually clears the ladder", () => {
  const ctx = loadResilienceHelpers();
  const escalation = ctx.createMediaErrorEscalation();
  escalation.record(0);
  escalation.record(100);
  escalation.reset();
  assert.equal(escalation.record(200), "RECOVER");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: FAIL — `ctx.createMediaErrorEscalation is not a function`.

- [ ] **Step 3: Implement**

Append to the `resilience-helpers` script block in `sintoniza.html`:

```js

// HLS MEDIA_ERROR escalation ladder. Previously every fatal MEDIA_ERROR
// called recoverMediaError() unconditionally, which can loop forever without
// ever trying a different recovery strategy. hls.js's own recommended
// pattern: 1st error -> recoverMediaError(); 2nd in a row -> swap the audio
// codec and try again; 3rd -> give up and rebuild the player from scratch.
function createMediaErrorEscalation(opts) {
  var options = opts || {};
  var windowMs = options.windowMs || 20000;
  var consecutiveErrors = 0;
  var lastErrorMs = null;

  return {
    record: function (nowMs) {
      if (lastErrorMs !== null && (nowMs - lastErrorMs) > windowMs) {
        consecutiveErrors = 0;
      }
      consecutiveErrors++;
      lastErrorMs = nowMs;
      if (consecutiveErrors === 1) return "RECOVER";
      if (consecutiveErrors === 2) return "SWAP_AUDIO_CODEC";
      return "FULL_REBUILD";
    },
    reset: function () {
      consecutiveErrors = 0;
      lastErrorMs = null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html tests/player/resilience-helpers.test.js
git commit -m "feat(player): add createMediaErrorEscalation ladder for HLS MEDIA_ERROR"
```

---

### Task 5: `getVisibilityAction`

**Files:**
- Modify: `sintoniza.html` (append to `resilience-helpers`)
- Modify: `tests/player/resilience-helpers.test.js`

**Interfaces:**
- Produces: `function getVisibilityAction(visibilityState) -> "SUSPEND_WATCHDOG"|"RESUME_WATCHDOG"`. Used by Task 10.

- [ ] **Step 1: Write the failing test**

Append to `tests/player/resilience-helpers.test.js`:

```js
test("getVisibilityAction: hidden tab suspends the watchdog", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.getVisibilityAction("hidden"), "SUSPEND_WATCHDOG");
});

test("getVisibilityAction: visible tab resumes the watchdog", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.getVisibilityAction("visible"), "RESUME_WATCHDOG");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/player/resilience-helpers.test.js`
Expected: FAIL — `ctx.getVisibilityAction is not a function`.

- [ ] **Step 3: Implement**

Append to the `resilience-helpers` script block in `sintoniza.html`:

```js

// While the tab is hidden, background-tab timer throttling can make the
// watchdog's 1s interval fire unevenly, producing false "frozen" readings
// and needless reconnection storms nobody is there to see. Suspend the
// watchdog while hidden and resume (with fresh counters) when visible again.
function getVisibilityAction(visibilityState) {
  return visibilityState === "hidden" ? "SUSPEND_WATCHDOG" : "RESUME_WATCHDOG";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: PASS — every test file green.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html tests/player/resilience-helpers.test.js
git commit -m "feat(player): add getVisibilityAction for tab-visibility handling"
```

---

### Task 6: Wire `pickInitialBufferStageIndex` into channel selection, remove dead `preflightChannelCheck`

**Files:**
- Modify: `sintoniza.html` (`selectChannel`, and delete the unused/buggy `preflightChannelCheck`)

**Interfaces:**
- Consumes: `pickInitialBufferStageIndex` (Task 1), `BUFFER_STAGES` (existing).

This task has no new pure logic to unit-test (it's DOM/browser-integration wiring); it's verified by the manual browser check in Task 11. Two edits:

- [ ] **Step 1: Replace the hardcoded stage reset in `selectChannel`**

Find this exact text in `sintoniza.html` (inside `function selectChannel`):

```js
function selectChannel(ch, autoPlay = true) {
  if (!ch) return;
  // Reinicia no buffer base de 15 segundos ao entrar em qualquer canal
  currentBufferStageIndex = 0;
```

Replace with:

```js
function selectChannel(ch, autoPlay = true) {
  if (!ch) return;
  // Escolhe o degrau inicial de buffer pela qualidade de conexão reportada
  // pelo navegador (Network Information API) em vez de sempre começar no
  // degrau mais raso e só escalar depois de já ter travado.
  currentBufferStageIndex = pickInitialBufferStageIndex({
    connectionEffectiveType: navigator.connection && navigator.connection.effectiveType,
    stagesLength: BUFFER_STAGES.length,
  });
```

- [ ] **Step 2: Delete the dead, buggy `preflightChannelCheck` function**

Find this exact block in `sintoniza.html` (it is never called anywhere in the file and references the undefined global `STASH_BUFFERS`, which would throw `ReferenceError` if it were ever invoked):

```js
// ─── Pré-teste de 800ms (Channel Health Check) ───
async function preflightChannelCheck(url) {
  const startTime = performance.now();
  let status = "good";
  let latency = 0;
  let recommendedStash = STASH_BUFFERS.NORMAL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);

    await fetch(url, {
      method: "GET",
      headers: { "Range": "bytes=0-1024" },
      signal: controller.signal,
      cache: "no-store"
    });
    clearTimeout(timer);
    latency = Math.round(performance.now() - startTime);

    if (latency < 450) {
      status = "excellent";
      recommendedStash = STASH_BUFFERS.NORMAL;
    } else {
      status = "good";
      recommendedStash = STASH_BUFFERS.NORMAL;
    }
  } catch (err) {
    latency = Math.round(performance.now() - startTime);
    // Demorou mais de 800ms ou deu erro de socket
    status = "slow_or_unstable";
    recommendedStash = STASH_BUFFERS.UNSTABLE; // abre com buffer reforçado de 2048KB
    console.log(`[Preflight] Canal com resposta lenta (${latency}ms). Buffer inicial expandido para 2048KB.`);
  }

  return { status, latency, recommendedStash };
}
```

Delete it entirely (replace with nothing / empty string).

- [ ] **Step 3: Run the automated tests to confirm nothing broke**

Run: `node --test tests/`
Expected: PASS — this task didn't touch `resilience-helpers`, so all existing tests still pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add sintoniza.html
git commit -m "fix(player): pick initial buffer stage from connection quality, drop dead preflightChannelCheck"
```

---

### Task 7: Wire `MPEGTS_RESILIENCE_CONFIG` into the mpegts.js player

**Files:**
- Modify: `sintoniza.html` (mpegts player construction inside `playStream`)

**Interfaces:**
- Consumes: `MPEGTS_RESILIENCE_CONFIG` (Task 2).

- [ ] **Step 1: Replace the old buffer/cleanup config with the new constant**

Find this exact block in `sintoniza.html`:

```js
        mpegtsPlayer = mpegts.createPlayer({
          type: 'm2ts',
          isLive: true,
          url: playUrl
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 1024 * 1024, // 1MB stash fixo — apenas suaviza jitter de rede, não é o buffer principal
          liveBufferLatencyChasing: false, // Sem chasing: deixamos o buffer crescer livremente
          autoCleanupSourceBuffer: false,  // Não descarta buffer acumulado prematuramente
```

Replace the last two config lines with a spread of the new constant:

```js
        mpegtsPlayer = mpegts.createPlayer({
          type: 'm2ts',
          isLive: true,
          url: playUrl
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 1024 * 1024, // 1MB stash fixo — apenas suaviza jitter de rede, não é o buffer principal
          ...MPEGTS_RESILIENCE_CONFIG,
```

(Leave every line after this untouched — whatever config keys currently follow stay exactly as they are, just after the spread.)

- [ ] **Step 2: Run the automated tests to confirm nothing broke**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add sintoniza.html
git commit -m "fix(mpegts): apply relaxed-chasing + bounded-cleanup buffer strategy"
```

---

### Task 8: Wire `computeReconnectBackoffMs` into HLS `NETWORK_ERROR` handling

**Files:**
- Modify: `sintoniza.html` (state declarations near line 1260-1273, HLS error handler, `resetWatchdogCounters`)

**Interfaces:**
- Consumes: `computeReconnectBackoffMs` (Task 3).

- [ ] **Step 1: Add a retry-attempt counter next to the other player state**

Find this exact block in `sintoniza.html`:

```js
let hlsInstance = null;
let mpegtsPlayer = null;
let watchdogTimer = null;
let watchdogFrozenSeconds = 0;
let watchdogWaitingSeconds = 0;
let watchdogLastTime = 0;
let watchdogLastFrames = 0;
let isReloadingStream = false;
let initialLoadTimeout = null;
let currentStreamType = "unknown";
let sessionReconnectCount = 0;
let isDebugOverlayVisible = false;
let mpegPrebufferTimer = null;
let mpegPrebufferTimeout = null;
```

Replace with:

```js
let hlsInstance = null;
let mpegtsPlayer = null;
let watchdogTimer = null;
let watchdogFrozenSeconds = 0;
let watchdogWaitingSeconds = 0;
let watchdogLastTime = 0;
let watchdogLastFrames = 0;
let isReloadingStream = false;
let initialLoadTimeout = null;
let currentStreamType = "unknown";
let sessionReconnectCount = 0;
let isDebugOverlayVisible = false;
let mpegPrebufferTimer = null;
let mpegPrebufferTimeout = null;
let hlsNetworkRetryAttempt = 0;
let hlsNetworkRetryTimer = null;
```

- [ ] **Step 2: Reset the retry counter whenever the watchdog confirms healthy playback**

Find this exact block in `sintoniza.html`:

```js
function resetWatchdogCounters() {
  watchdogFrozenSeconds = 0;
  watchdogWaitingSeconds = 0;
  watchdogLastTime = 0;
  watchdogLastFrames = 0;
}
```

Replace with:

```js
function resetWatchdogCounters() {
  watchdogFrozenSeconds = 0;
  watchdogWaitingSeconds = 0;
  watchdogLastTime = 0;
  watchdogLastFrames = 0;
  hlsNetworkRetryAttempt = 0;
  if (hlsNetworkRetryTimer) {
    clearTimeout(hlsNetworkRetryTimer);
    hlsNetworkRetryTimer = null;
  }
}
```

- [ ] **Step 3: Replace the immediate `startLoad()` retry with a backed-off retry**

Find this exact block in `sintoniza.html`:

```js
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        console.warn("[HLS Event Error]", data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
```

Replace with:

```js
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        console.warn("[HLS Event Error]", data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: {
              // Backoff instead of hammering the origin with an immediate
              // startLoad() on every fatal network error.
              const backoffMs = computeReconnectBackoffMs(hlsNetworkRetryAttempt);
              hlsNetworkRetryAttempt++;
              sessionReconnectCount++;
              updateDebugOverlay();
              if (hlsNetworkRetryTimer) clearTimeout(hlsNetworkRetryTimer);
              hlsNetworkRetryTimer = setTimeout(() => {
                if (hlsInstance) hlsInstance.startLoad();
              }, backoffMs);
              break;
            }
```

- [ ] **Step 4: Run the automated tests to confirm nothing broke**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html
git commit -m "fix(hls): back off exponentially on fatal NETWORK_ERROR instead of retrying immediately"
```

---

### Task 9: Wire `createMediaErrorEscalation` into HLS `MEDIA_ERROR` handling

**Files:**
- Modify: `sintoniza.html` (state declarations, `resetWatchdogCounters`, HLS error handler, `playStream` instance setup)

**Interfaces:**
- Consumes: `createMediaErrorEscalation` (Task 4).

- [ ] **Step 1: Add the escalation-instance variable next to the other player state**

Find this exact text in `sintoniza.html` (added in Task 8, now extend it further):

```js
let hlsNetworkRetryAttempt = 0;
let hlsNetworkRetryTimer = null;
```

Replace with:

```js
let hlsNetworkRetryAttempt = 0;
let hlsNetworkRetryTimer = null;
let mediaErrorEscalation = createMediaErrorEscalation();
```

- [ ] **Step 2: Reset the escalation ladder whenever the watchdog confirms healthy playback**

Find this exact text in `sintoniza.html` (from Task 8's edit to `resetWatchdogCounters`):

```js
  hlsNetworkRetryAttempt = 0;
  if (hlsNetworkRetryTimer) {
    clearTimeout(hlsNetworkRetryTimer);
    hlsNetworkRetryTimer = null;
  }
}
```

Replace with:

```js
  hlsNetworkRetryAttempt = 0;
  if (hlsNetworkRetryTimer) {
    clearTimeout(hlsNetworkRetryTimer);
    hlsNetworkRetryTimer = null;
  }
  mediaErrorEscalation.reset();
}
```

- [ ] **Step 3: Replace the unconditional `recoverMediaError()` with the escalation ladder**

Find this exact block in `sintoniza.html`:

```js
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
```

Replace with:

```js
            case Hls.ErrorTypes.MEDIA_ERROR: {
              const action = mediaErrorEscalation.record(Date.now());
              if (action === "RECOVER") {
                hlsInstance.recoverMediaError();
              } else if (action === "SWAP_AUDIO_CODEC") {
                hlsInstance.swapAudioCodec();
                hlsInstance.recoverMediaError();
              } else if (!isReloadingStream) {
                reloadCurrentChannel(true);
              }
              break;
            }
```

- [ ] **Step 4: Give each fresh `playStream()` call a clean escalation ladder**

Find this exact block in `sintoniza.html` (near the top of `playStream`, where old instances are torn down):

```js
  // Limpa instâncias anteriores
  if (hlsInstance) {
    try { hlsInstance.stopLoad(); hlsInstance.destroy(); } catch (e) {}
    hlsInstance = null;
  }
```

Replace with:

```js
  // Limpa instâncias anteriores
  mediaErrorEscalation.reset();
  if (hlsInstance) {
    try { hlsInstance.stopLoad(); hlsInstance.destroy(); } catch (e) {}
    hlsInstance = null;
  }
```

- [ ] **Step 5: Run the automated tests to confirm nothing broke**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sintoniza.html
git commit -m "fix(hls): escalate MEDIA_ERROR recovery (recover -> swap codec -> full rebuild)"
```

---

### Task 10: Wire `getVisibilityAction` into a `visibilitychange` listener

**Files:**
- Modify: `sintoniza.html` (state declarations, `startWatchdog`, new listener registration)

**Interfaces:**
- Consumes: `getVisibilityAction` (Task 5), `startWatchdog` (existing), `stopWatchdog` (existing).

- [ ] **Step 1: Track the URL the watchdog is currently guarding**

Find this exact text in `sintoniza.html` (the `startWatchdog` function signature):

```js
// ─── Watchdog Escalonado em 3 Níveis (4s / 7s / 11s) ───
function startWatchdog(url) {
  stopWatchdog();
  resetWatchdogCounters();
```

Replace with:

```js
// ─── Watchdog Escalonado em 3 Níveis (4s / 7s / 11s) ───
function startWatchdog(url) {
  currentWatchdogUrl = url;
  stopWatchdog();
  resetWatchdogCounters();
```

- [ ] **Step 2: Declare `currentWatchdogUrl` next to the other player state**

Find this exact text in `sintoniza.html` (extended in Task 9):

```js
let mediaErrorEscalation = createMediaErrorEscalation();
```

Replace with:

```js
let mediaErrorEscalation = createMediaErrorEscalation();
let currentWatchdogUrl = null;
```

- [ ] **Step 3: Register the `visibilitychange` listener**

Find this exact text in `sintoniza.html` (the closing of `stopWatchdog`, right before `preflightChannelCheck` used to sit — now right before `detectStreamType`):

```js
function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
```

Leave `stopWatchdog`'s body untouched, but locate its closing brace and the blank line after it (look for the next `}` at the same indent level followed by a blank line, then the `// ─── Detecção Inteligente de Stream & Dual-Stack HLS Probe ───` comment) and insert this new block right after `stopWatchdog`'s closing brace and before that comment:

```js

// Background tabs throttle timers, which can make the 1s watchdog interval
// fire unevenly and misread throttling as a freeze - triggering pointless
// reconnects while nobody is watching. Suspend the watchdog while hidden and
// resume with a clean slate when the tab becomes visible again.
document.addEventListener("visibilitychange", () => {
  const action = getVisibilityAction(document.visibilityState);
  if (action === "SUSPEND_WATCHDOG") {
    stopWatchdog();
  } else if (action === "RESUME_WATCHDOG" && currentWatchdogUrl && _state.playing) {
    startWatchdog(currentWatchdogUrl);
  }
});
```

- [ ] **Step 4: Run the automated tests to confirm nothing broke**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html
git commit -m "feat(player): suspend watchdog on hidden tab, resume cleanly when visible"
```

---

### Task 11: Manual browser verification, repo hygiene, and push

**Files:**
- Modify: `.gitignore` (exclude the `graphify-out/` artifact directory created during earlier investigation — unrelated to this feature and not meant to be committed)

**Interfaces:** none (verification + repo hygiene + push).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `node --test tests/`
Expected: PASS — every test from Tasks 1-5 green.

- [ ] **Step 2: Serve `sintoniza.html` locally and smoke-test in a real browser**

`file://` still works for opening it directly, but to see console errors clearly use a static server:

Run: `npx --yes serve -l 5500 .` (or `python -m http.server 5500`), then open `http://localhost:5500/sintoniza.html`.

Manually verify:
- Page loads with no console errors (checks the new `resilience-helpers` script tag parses cleanly and `preflightChannelCheck`'s removal didn't leave a dangling reference).
- Select a channel, confirm it starts playing (checks `pickInitialBufferStageIndex` wiring didn't break `selectChannel`).
- Open the debug overlay and confirm the buffer/reconnect counters still update (checks `updateDebugOverlay` call added in Task 8 didn't throw).
- Switch browser tabs away and back while a channel is playing; confirm no error appears and playback resumes normally (checks the Task 10 `visibilitychange` listener).

Expected: no uncaught exceptions in the browser console during any of the above.

- [ ] **Step 3: Add `graphify-out/` to `.gitignore`**

Find this exact text at the end of `.gitignore`:

```
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
```

Replace with:

```
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# graphify knowledge-graph output (local investigation artifact)
graphify-out/
```

- [ ] **Step 4: Review what's staged before committing**

Run: `git status --short`
Expected output shows exactly:
```
 M .gitignore
?? docs/superpowers/plans/2026-09-17-iptv-player-resilience.md
```
plus nothing else new (the resilience commits from Tasks 1-10 are already committed individually). Confirm `src/routeTree.gen.ts` (pre-existing modification) and `package-lock.json` (pre-existing untracked file) are **not** staged — they predate this plan and are out of scope.

- [ ] **Step 5: Commit the hygiene + plan doc**

```bash
git add .gitignore docs/superpowers/plans/2026-09-17-iptv-player-resilience.md
git commit -m "chore: ignore graphify-out/ artifact directory, add resilience plan doc"
```

- [ ] **Step 6: Push to GitHub**

```bash
git push origin main
```

Expected: push succeeds against `https://github.com/Guaitolinii/visual-craft-assistant.git`, `main` branch, with every commit from Tasks 1-11 now on the remote.

- [ ] **Step 7: Verify the push**

Run: `git log origin/main -1 --oneline` and `git status --short`
Expected: `origin/main` HEAD matches local HEAD; `git status --short` shows no unpushed commits ahead of `origin/main` (the pre-existing unrelated `src/routeTree.gen.ts`/`package-lock.json` state may still show, which is expected and out of scope).

---

## Self-Review Notes

- **Spec coverage:** all 5 in-scope research findings (mpegts buffer/cleanup strategy, HLS network backoff, HLS media-error escalation, Page Visibility handling, Network-Information-driven initial buffer stage) each map to a task. The 2 explicitly-deferred findings (multi-source failover, LL-HLS/CMCD) are documented as out of scope in Global Constraints, not silently dropped.
- **Bug found during investigation** (`STASH_BUFFERS` undefined, dead `preflightChannelCheck`) is fixed by deletion in Task 6, since activating it would add a blocking 800ms fetch to every channel switch — a latency cost the original author evidently decided against (hence it was never wired in). Replaced with the zero-latency Network Information API check instead.
- **Type/name consistency check:** `pickInitialBufferStageIndex`, `MPEGTS_RESILIENCE_CONFIG`, `computeReconnectBackoffMs`, `createMediaErrorEscalation`, `getVisibilityAction` are named identically at definition (Tasks 1-5) and at every call site (Tasks 6-10) — verified by re-reading each wiring task against its producing task.
- **No placeholders:** every step has real, runnable code and exact `Run:`/`Expected:` pairs; no "add error handling" or "similar to Task N" shortcuts.
