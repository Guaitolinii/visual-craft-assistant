# MPEG-TS/HLS Resilience Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three concrete, previously-unaddressed reliability gaps in `sintoniza.html`'s MPEG-TS playback (unhandled `mpegts.js` MEDIA_ERROR/OTHER_ERROR events, a fixed prebuffer timeout that doesn't adapt to connection quality, no cap on automatic reconnect attempts) and extend the reconnect cap to HLS too, since both stream types share the same watchdog/reload machinery.

**Architecture:** Same pattern as the prior resilience plan (`docs/superpowers/plans/2026-09-17-iptv-player-resilience.md`): new pure, dependency-free functions appended to the existing `<script id="resilience-helpers">` block (unit-tested via `node:test` + the `extractInlineScriptById`/`vm` harness already in `tests/`), then wired into the big classic `<script>` block below it. No ES modules, no external files, no new dependencies — `sintoniza.html` keeps working when opened directly via `file://`.

**Tech Stack:** Vanilla JS (ES2017+), Node's built-in `node:test`/`node:assert/strict`/`node:vm`, hls.js (CDN), mpegts.js (CDN).

**Spec:** No separate spec doc — this plan implements the gap list from an investigation of the current (post-Lovable-edits) state of `sintoniza.html`'s player code, cross-referenced against `mpegts.js`'s documented `ErrorTypes` (`docs/api.md` on `xqq/mpegts.js`) and a real-world HLS/IPTV player's reconnect-capping pattern ("N reconnects within a window ⇒ considered dead").

## Global Constraints

- `sintoniza.html` must keep working when opened directly via `file://` — no ES module `import`, no external JS file, no bundler step.
- No new npm/bun dependencies — use `node:test` (already wired up in `tests/`) for all automated tests.
- **Do not touch `detectStreamType()` or `isChannelHls()`** (the HLS-vs-MPEG-TS playback detection and the cosmetic "HLS" badge rule) — explicitly out of scope per prior instruction.
- Do not touch the pre-existing unrelated pending changes in the working tree (`src/routeTree.gen.ts`, `package-lock.json`) — stage only files this plan creates/modifies.
- Commit after every task. Push to `origin/main` only in the final task, after all tasks are committed and verified — this is a plain fast-forward (no history rewrite), same as the prior plan's push.

---

### Task 1: `computeMaxPrebufferMs` pure helper

**Files:**
- Modify: `sintoniza.html` (append to the `resilience-helpers` script block, after `getVisibilityAction`, before the closing `</script>` at line 1095)
- Modify: `tests/player/resilience-helpers.test.js`

**Interfaces:**
- Produces: `function computeMaxPrebufferMs(connectionEffectiveType) -> number` (milliseconds). Used by Task 2.

- [ ] **Step 1: Write the failing test**

Append to `tests/player/resilience-helpers.test.js`:

```js
test("computeMaxPrebufferMs: gives slow connections more patience before releasing partial buffer", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.computeMaxPrebufferMs("slow-2g"), 15000);
  assert.equal(ctx.computeMaxPrebufferMs("2g"), 15000);
});

test("computeMaxPrebufferMs: gives 3g a middle-ground timeout", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.computeMaxPrebufferMs("3g"), 10000);
});

test("computeMaxPrebufferMs: keeps the original 6s timeout on fast/unknown connections", () => {
  const ctx = loadResilienceHelpers();
  assert.equal(ctx.computeMaxPrebufferMs("4g"), 6000);
  assert.equal(ctx.computeMaxPrebufferMs(undefined), 6000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `ctx.computeMaxPrebufferMs is not a function`.

- [ ] **Step 3: Implement**

In `sintoniza.html`, find this exact text (the end of the `resilience-helpers` script block):

```js
function getVisibilityAction(visibilityState) {
  return visibilityState === "hidden" ? "SUSPEND_WATCHDOG" : "RESUME_WATCHDOG";
}
</script>
```

Replace with:

```js
function getVisibilityAction(visibilityState) {
  return visibilityState === "hidden" ? "SUSPEND_WATCHDOG" : "RESUME_WATCHDOG";
}

// Releasing playback with only a few seconds of accumulated buffer is fine
// on a fast line (the background fill-to-20s continues right after), but on
// a slow line it just trades a clean wait for a guaranteed stall-and-recover
// cycle a few seconds later. Give slower connections more patience before
// giving up and releasing with whatever partial buffer they managed to
// accumulate. Mirrors the same Network Information API signal already used
// by pickInitialBufferStageIndex.
function computeMaxPrebufferMs(connectionEffectiveType) {
  if (connectionEffectiveType === "slow-2g" || connectionEffectiveType === "2g") {
    return 15000;
  }
  if (connectionEffectiveType === "3g") {
    return 10000;
  }
  return 6000;
}
</script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html tests/player/resilience-helpers.test.js
git commit -m "feat(player): add computeMaxPrebufferMs connection-aware prebuffer timeout"
```

---

### Task 2: Wire `computeMaxPrebufferMs` into the MPEG-TS prebuffer timeout

**Files:**
- Modify: `sintoniza.html` (mpegts prebuffer setup inside `playStream`, currently around line 2022)

**Interfaces:**
- Consumes: `computeMaxPrebufferMs` (Task 1).

- [ ] **Step 1: Replace the hardcoded 6-second timeout**

Find this exact text in `sintoniza.html`:

```js
        // ─── Timeout de segurança rápido: 6 segundos para liberar a reprodução ───
        const maxPrebufMs = 6000;
```

Replace with:

```js
        // ─── Timeout de segurança: escala com a qualidade de conexão reportada ───
        const maxPrebufMs = computeMaxPrebufferMs(navigator.connection && navigator.connection.effectiveType);
```

- [ ] **Step 2: Run the automated tests to confirm nothing broke**

Run: `npm run test`
Expected: PASS — this task only touches wiring inside `playStream`, not `resilience-helpers`, so all existing tests are unaffected.

- [ ] **Step 3: Commit**

```bash
git add sintoniza.html
git commit -m "fix(mpegts): scale prebuffer safety timeout with connection quality"
```

---

### Task 3: Handle `mpegts.ErrorTypes.MEDIA_ERROR` (not just `NETWORK_ERROR`)

**Files:**
- Modify: `sintoniza.html` (the `mpegtsPlayer.on(mpegts.Events.ERROR, ...)` handler, currently around line 2030)

**Interfaces:** none new — this generalizes existing wiring, no pure logic to unit-test. Verified in Task 6's manual browser check.

`mpegts.js` reports three error categories via `mpegts.ErrorTypes`: `NETWORK_ERROR`, `MEDIA_ERROR` (format/codec/decode issues — including the library's own known "corrupted sync_byte freezes the demuxer" failure mode), and `OTHER_ERROR`. The current handler only reacts to `NETWORK_ERROR`; a `MEDIA_ERROR` event is logged via `console.warn` and then silently ignored, leaving the demuxer stuck until the generic 7-11s freeze-based watchdog eventually notices — several seconds slower than reacting to the error event directly.

- [ ] **Step 1: Generalize the error handler**

Find this exact block in `sintoniza.html`:

```js
        mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
          console.warn('[mpegts error event]', errorType, errorDetail);
          if (errorType === mpegts.ErrorTypes.NETWORK_ERROR && !isReloadingStream) {
            let hasBuf = false;
            if (video && video.buffered && video.buffered.length > 0) {
              const cur = video.currentTime || 0;
              for (let i = 0; i < video.buffered.length; i++) {
                if (video.buffered.start(i) <= cur && (video.buffered.end(i) - cur) > 2) {
                  hasBuf = true;
                  break;
                }
              }
            }
            if (hasBuf) {
              console.warn('[mpegts network error] Vídeo com buffer seguro. Reconectando em segundo plano sem travar a tela...');
              try {
                mpegtsPlayer.unload();
                mpegtsPlayer.load();
                mpegtsPlayer.play();
              } catch (e) {}
            } else {
              reloadCurrentChannel(true);
            }
          }
        });
```

Replace with:

```js
        mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
          console.warn('[mpegts error event]', errorType, errorDetail);
          if (isReloadingStream) return;

          // MEDIA_ERROR (formato/codec/demux, ex: o bug conhecido de sync_byte
          // corrompido travando o demuxer) recebe a mesma recuperação suave que
          // NETWORK_ERROR: reiniciar o transporte já resolve ambos os casos.
          // OTHER_ERROR é raro/não classificado - vai direto para recarga completa.
          const isRecoverableType = errorType === mpegts.ErrorTypes.NETWORK_ERROR
            || errorType === mpegts.ErrorTypes.MEDIA_ERROR;
          if (!isRecoverableType) {
            reloadCurrentChannel(true);
            return;
          }

          let hasBuf = false;
          if (video && video.buffered && video.buffered.length > 0) {
            const cur = video.currentTime || 0;
            for (let i = 0; i < video.buffered.length; i++) {
              if (video.buffered.start(i) <= cur && (video.buffered.end(i) - cur) > 2) {
                hasBuf = true;
                break;
              }
            }
          }
          if (hasBuf) {
            console.warn(`[mpegts ${errorType}] Vídeo com buffer seguro. Reconectando em segundo plano sem travar a tela...`);
            try {
              mpegtsPlayer.unload();
              mpegtsPlayer.load();
              mpegtsPlayer.play();
            } catch (e) {}
          } else {
            reloadCurrentChannel(true);
          }
        });
```

- [ ] **Step 2: Run the automated tests to confirm nothing broke**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add sintoniza.html
git commit -m "fix(mpegts): recover from MEDIA_ERROR the same way as NETWORK_ERROR"
```

---

### Task 4: `createReconnectCircuitBreaker` pure helper

**Files:**
- Modify: `sintoniza.html` (append to the `resilience-helpers` script block, after `computeMaxPrebufferMs`)
- Modify: `tests/player/resilience-helpers.test.js`

**Interfaces:**
- Produces: `function createReconnectCircuitBreaker(opts?) -> { recordAttempt(nowMs) -> "RETRY"|"GIVE_UP", reset() }`. `opts: { maxAttempts?: number, windowMs?: number }`, defaults `maxAttempts: 5`, `windowMs: 300000` (5 minutes). Used by Task 5.

Currently `sessionReconnectCount` increments forever with no upper bound: a genuinely dead channel triggers the watchdog's automatic reload loop indefinitely (a toast/reconnect every 7-11s, forever). Production HLS/IPTV players cap this — e.g. "3+ reconnects within a 5-minute window ⇒ considered dead, stop auto-retrying." This gives `sintoniza.html` the same circuit breaker, applied generically at the `reloadCurrentChannel` choke point (Task 5) so it covers both HLS and MPEG-TS automatically.

- [ ] **Step 1: Write the failing test**

Append to `tests/player/resilience-helpers.test.js`:

```js
test("createReconnectCircuitBreaker: allows retries up to maxAttempts within the window", () => {
  const ctx = loadResilienceHelpers();
  const breaker = ctx.createReconnectCircuitBreaker({ maxAttempts: 3, windowMs: 60000 });
  assert.equal(breaker.recordAttempt(0), "RETRY");
  assert.equal(breaker.recordAttempt(1000), "RETRY");
  assert.equal(breaker.recordAttempt(2000), "RETRY");
});

test("createReconnectCircuitBreaker: gives up after exceeding maxAttempts within the window", () => {
  const ctx = loadResilienceHelpers();
  const breaker = ctx.createReconnectCircuitBreaker({ maxAttempts: 3, windowMs: 60000 });
  breaker.recordAttempt(0);
  breaker.recordAttempt(1000);
  breaker.recordAttempt(2000);
  assert.equal(breaker.recordAttempt(3000), "GIVE_UP");
});

test("createReconnectCircuitBreaker: attempts outside the window don't count against the limit", () => {
  const ctx = loadResilienceHelpers();
  const breaker = ctx.createReconnectCircuitBreaker({ maxAttempts: 2, windowMs: 5000 });
  assert.equal(breaker.recordAttempt(0), "RETRY");
  assert.equal(breaker.recordAttempt(1000), "RETRY");
  // 10s later - both earlier attempts have aged out of the 5s window
  assert.equal(breaker.recordAttempt(10000), "RETRY");
});

test("createReconnectCircuitBreaker: reset() clears attempt history", () => {
  const ctx = loadResilienceHelpers();
  const breaker = ctx.createReconnectCircuitBreaker({ maxAttempts: 1, windowMs: 60000 });
  breaker.recordAttempt(0);
  assert.equal(breaker.recordAttempt(1000), "GIVE_UP");
  breaker.reset();
  assert.equal(breaker.recordAttempt(2000), "RETRY");
});

test("createReconnectCircuitBreaker: uses sane defaults when opts is omitted", () => {
  const ctx = loadResilienceHelpers();
  const breaker = ctx.createReconnectCircuitBreaker();
  for (let i = 0; i < 5; i++) {
    assert.equal(breaker.recordAttempt(i * 1000), "RETRY");
  }
  assert.equal(breaker.recordAttempt(5000), "GIVE_UP");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `ctx.createReconnectCircuitBreaker is not a function`.

- [ ] **Step 3: Implement**

In `sintoniza.html`, append after `computeMaxPrebufferMs`'s closing `}` (still inside the `resilience-helpers` script block, before `</script>`):

```js

// Caps automatic reconnect attempts so a genuinely dead channel eventually
// surfaces a clear error instead of silently retrying forever. Mirrors the
// "N reconnects within a window = considered dead" pattern used by
// production HLS/IPTV players. Only automatic (silent) reloads should ever
// call recordAttempt() - a manual user-initiated retry always gets a fresh
// attempt via reset().
function createReconnectCircuitBreaker(opts) {
  var options = opts || {};
  var maxAttempts = options.maxAttempts || 5;
  var windowMs = options.windowMs || 5 * 60 * 1000;
  var attempts = [];

  return {
    recordAttempt: function (nowMs) {
      attempts = attempts.filter(function (t) { return (nowMs - t) < windowMs; });
      attempts.push(nowMs);
      return attempts.length > maxAttempts ? "GIVE_UP" : "RETRY";
    },
    reset: function () {
      attempts = [];
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS — all tests, including every test from the prior resilience plan, green.

- [ ] **Step 5: Commit**

```bash
git add sintoniza.html tests/player/resilience-helpers.test.js
git commit -m "feat(player): add createReconnectCircuitBreaker to cap automatic reconnects"
```

---

### Task 5: Wire the circuit breaker into `reloadCurrentChannel`

**Files:**
- Modify: `sintoniza.html` (module state declarations around line 1397, `playStream`'s teardown around line 1788, `reloadCurrentChannel` around line 1739)

**Interfaces:**
- Consumes: `createReconnectCircuitBreaker` (Task 4), `showPlayerError` (existing — already wired to the `#retry-btn` "Tentar novamente" button, which calls `playStream(ch.url)` directly).

`reloadCurrentChannel(isSilent)` is the single choke point every automatic recovery path already goes through (watchdog N2/N3, HLS's fatal-error escalation, MPEG-TS's error handler) — every one of those calls it with `isSilent=true`. The only call site passing `isSilent=false` is the manual "Recarregar canal" button. That split is exactly what the breaker needs: silent calls count against it, the one manual call site always resets it.

- [ ] **Step 1: Declare the breaker next to the other player state**

Find this exact text in `sintoniza.html`:

```js
let mediaErrorEscalation = createMediaErrorEscalation();
let currentWatchdogUrl = null;
```

Replace with:

```js
let mediaErrorEscalation = createMediaErrorEscalation();
let currentWatchdogUrl = null;
let reconnectCircuitBreaker = createReconnectCircuitBreaker();
```

- [ ] **Step 2: Reset the breaker on every fresh channel start**

Find this exact text in `sintoniza.html` (inside `playStream`'s teardown):

```js
  // Limpa instâncias anteriores
  mediaErrorEscalation.reset();
```

Replace with:

```js
  // Limpa instâncias anteriores
  mediaErrorEscalation.reset();
  reconnectCircuitBreaker.reset();
```

- [ ] **Step 3: Check the breaker at the top of `reloadCurrentChannel`**

Find this exact block in `sintoniza.html`:

```js
async function reloadCurrentChannel(isSilent = false) {
  const ch = _state.selected;
  if (!ch || !ch.url) return;
  if (isReloadingStream) return;
  isReloadingStream = true;

  const reloadBtn = document.getElementById("reload-stream-btn");
  if (reloadBtn) reloadBtn.classList.add("spinning");

  if (!isSilent) {
    showToast("Recarregando sinal de " + ch.name + "...");
  }
```

Replace with:

```js
async function reloadCurrentChannel(isSilent = false) {
  const ch = _state.selected;
  if (!ch || !ch.url) return;
  if (isReloadingStream) return;

  if (isSilent) {
    // Only automatic (silent) reloads count against the breaker - a manual
    // tap on "Recarregar canal" or "Tentar novamente" always gets a fresh
    // attempt and resets the counter below.
    const verdict = reconnectCircuitBreaker.recordAttempt(Date.now());
    if (verdict === "GIVE_UP") {
      console.warn(`[Circuit Breaker] Muitas reconexões automáticas para "${ch.name}". Parando e pedindo ação manual.`);
      stopWatchdog();
      setState({ playing: false });
      showPlayerError(`Canal "${ch.name}" está instável. Toque em "Tentar novamente" quando quiser tentar de novo.`);
      return;
    }
  } else {
    reconnectCircuitBreaker.reset();
  }

  isReloadingStream = true;

  const reloadBtn = document.getElementById("reload-stream-btn");
  if (reloadBtn) reloadBtn.classList.add("spinning");

  if (!isSilent) {
    showToast("Recarregando sinal de " + ch.name + "...");
  }
```

- [ ] **Step 4: Run the automated tests to confirm nothing broke**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Syntax-check both inline script blocks**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('sintoniza.html', 'utf8');
const matches = [...html.matchAll(/<script(?:\s+id=\"[^\"]*\")?>([\s\S]*?)<\/script>/g)];
matches.forEach((m, i) => {
  try { new Function(m[1]); console.log('block', i, 'OK'); }
  catch (e) { console.log('block', i, 'SYNTAX ERROR:', e.message); }
});
"
```
Expected: `block 0 OK` and `block 1 OK`.

- [ ] **Step 6: Commit**

```bash
git add sintoniza.html
git commit -m "fix(player): cap automatic reconnect attempts with a circuit breaker"
```

---

### Task 6: Manual browser verification and push

**Files:** none — verification and push only.

- [ ] **Step 1: Run the full automated suite one more time**

Run: `npm run test`
Expected: PASS — every test from this plan and the prior resilience plan green (25 tests total: 16 from the prior plan + 9 new from Tasks 1 and 4).

- [ ] **Step 2: Serve `sintoniza.html` locally and smoke-test in a real browser**

`file://` still works for opening it directly, but a static server surfaces console errors more reliably:

Run: `npx --yes serve -l 5510 .` (or `python -m http.server 5510` if that port is free), then open `http://localhost:5510/sintoniza.html` (or the extensionless path `serve` redirects to).

Manually verify, using the browser DevTools console:
- Page loads with no console errors.
- `typeof computeMaxPrebufferMs`, `typeof createReconnectCircuitBreaker` both report `"function"`.
- Select a channel with a real MPEG-TS URL if available; confirm playback still starts normally (checks the `maxPrebufMs` wiring didn't break the prebuffer release path).
- To exercise the circuit breaker without waiting for a real dead channel, paste into the console after selecting a channel:
  ```js
  for (let i = 0; i < 6; i++) reloadCurrentChannel(true);
  ```
  Expected: after a few silent reloads, the player-error overlay appears with the "Canal ... está instável" message and the "Tentar novamente" button, instead of reloading a 6th time. Clicking "Tentar novamente" should successfully restart playback (confirms the breaker resets on manual retry).

Expected: no uncaught exceptions in the browser console during any of the above.

- [ ] **Step 3: Review what's staged before the final push**

Run: `git status --short`
Expected: only files from Tasks 1-5 show as already committed; `src/routeTree.gen.ts` and `package-lock.json` remain untouched/unstaged (pre-existing, out of scope).

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

Expected: fast-forward push succeeds against `https://github.com/Guaitolinii/visual-craft-assistant.git`, `main` branch.

- [ ] **Step 5: Verify the push**

Run: `git log origin/main -1 --oneline` and `git status --short -b`
Expected: `origin/main` HEAD matches local HEAD; no commits ahead of `origin/main`.

---

## Self-Review Notes

- **Spec coverage:** all three MPEG-TS findings (unhandled MEDIA_ERROR/OTHER_ERROR, fixed prebuffer timeout, unbounded reconnect loop) map to Tasks 1-2, 3, and 4-5 respectively. The HLS extension (same circuit breaker, since `reloadCurrentChannel` is shared by both stream types) is covered by Task 5 without any HLS-specific code changes needed. Deferred/low-priority items considered but not included: adaptive mpegts stash sizing by measured bitrate (memory-efficiency nice-to-have, not a stability fix), and coordinating HLS's fatal-error backoff counter with the watchdog's independent freeze-based `startLoad()` calls (real finding, but `reloadCurrentChannel`'s new breaker already bounds the worst-case outcome of that duplication, so it's a smaller residual risk than it was before this plan).
- **Placeholder scan:** every step has real, runnable code and exact `Run:`/`Expected:` pairs; no "add error handling" or "similar to Task N" shortcuts.
- **Type/name consistency check:** `computeMaxPrebufferMs` and `createReconnectCircuitBreaker` are named identically at definition (Tasks 1, 4) and at every call site (Tasks 2, 5) — verified by re-reading each wiring task against its producing task. `reconnectCircuitBreaker`'s `.recordAttempt()`/`.reset()` method names match between Task 4's factory and Task 5's call sites.
