import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. REPRODUÇÃO DO BUG (Implementação Legada)
 * ═══════════════════════════════════════════════════════════════════════════
 * Na implementação legada, a decisão de liberação dependia exclusivamente de:
 *   if (currentBuf >= targetBuf) -> _launchMpegPlayback()
 * com um timeout de segurança definido como:
 *   maxPrebufMs = Math.max(35000, (targetBuf + 15) * 1000) // 40.000ms para 25s!
 */
function legacyPrebufferEvaluator(currentBuf, targetBuf, elapsedMs) {
  const maxPrebufMs = Math.max(35000, (targetBuf + 15) * 1000); // 40s para target 25s
  if (currentBuf >= targetBuf) {
    return { action: "LAUNCH", reason: "TARGET_REACHED" };
  }
  if (elapsedMs >= maxPrebufMs) {
    return { action: "LAUNCH", reason: "SAFETY_TIMEOUT" };
  }
  const pct = Math.min(100, Math.round((currentBuf / targetBuf) * 100));
  return {
    action: "WAITING",
    reason: `Carregando buffer: ${currentBuf.toFixed(1)}s de ${targetBuf}s (${pct}%)`,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 2. CONTRATO DE API LIMPO (PrebufferController)
 * ═══════════════════════════════════════════════════════════════════════════
 * Isola a mutação de estado e as regras de negócio em um controlador puro,
 * sem efeitos colaterais de DOM ou de player.
 *
 * Contrato:
 * - Entradas: currentBufSec (float), deltaMs (int)
 * - Saída: { action: 'WAITING' | 'LAUNCH' | 'RECONNECT', reason: string, progressPct: number }
 */
export function createPrebufferController(opts = {}) {
  const targetBufSec       = opts.targetBufSec || 20;
  const solidCushionSec    = opts.solidCushionSec || 15.0;
  const burstCeilingMinSec = opts.burstCeilingMinSec || 6.0;
  const plateauThreshold   = opts.plateauThreshold || 5; // 5 ticks * 300ms = 1.5s
  const maxWaitMs          = opts.maxWaitMs || 12000;   // 12s de teto absoluto

  let lastBuf = 0;
  let plateauTicks = 0;
  let elapsedMs = 0;
  let finished = false;

  return {
    tick(currentBufSec, deltaMs = 300) {
      if (finished) {
        return { action: "ALREADY_FINISHED", progressPct: 100 };
      }

      elapsedMs += deltaMs;

      // Rastreamento de platô (quando o buffer para de subir porque o burst da fonte acabou)
      if (currentBufSec > 0 && Math.abs(currentBufSec - lastBuf) < 0.15) {
        plateauTicks++;
      } else {
        plateauTicks = 0;
        lastBuf = currentBufSec;
      }

      const progressPct = Math.min(100, Math.round((currentBufSec / targetBufSec) * 100));

      // Regra 1: Alvo atingido
      if (currentBufSec >= targetBufSec) {
        finished = true;
        return { action: "LAUNCH", reason: "TARGET_REACHED", progressPct: 100 };
      }

      // Regra 2: Colchão seguro excelente (>= 15s) já disponível
      if (currentBufSec >= solidCushionSec) {
        finished = true;
        return { action: "LAUNCH", reason: "SOLID_CUSHION", progressPct };
      }

      // Regra 3: Teto de burst atingido (>= 6s e buffer estabilizado por 1.5s)
      if (currentBufSec >= burstCeilingMinSec && plateauTicks >= plateauThreshold) {
        finished = true;
        return { action: "LAUNCH", reason: "BURST_CEILING_REACHED", progressPct };
      }

      // Regra 4: Timeout absoluto de segurança
      if (elapsedMs >= maxWaitMs) {
        finished = true;
        if (currentBufSec >= 3.0) {
          return { action: "LAUNCH", reason: "TIMEOUT_PARTIAL_BUFFER", progressPct };
        }
        return { action: "RECONNECT", reason: "TIMEOUT_DEAD_SOURCE", progressPct: 0 };
      }

      // Em carregamento normal
      return {
        action: "WAITING",
        reason: `Carregando buffer: ${currentBufSec.toFixed(1)}s de ${targetBufSec}s (${progressPct}%)`,
        progressPct,
      };
    },

    getElapsedMs() {
      return elapsedMs;
    },

    isFinished() {
      return finished;
    },

    reset() {
      lastBuf = 0;
      plateauTicks = 0;
      elapsedMs = 0;
      finished = false;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTES DE REPRODUÇÃO E VERIFICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

test("REPRODUÇÃO DO BUG: Implementação legada trava em 18.7s de 25s", () => {
  const target = 25;
  const currentBuf = 18.7;

  // Simula o buffer após 2 segundos de burst da fonte
  let decision = legacyPrebufferEvaluator(currentBuf, target, 2000);
  assert.equal(decision.action, "WAITING");
  assert.equal(decision.reason, "Carregando buffer: 18.7s de 25s (75%)");

  // Mesmo após 10 segundos, 20 segundos e 30 segundos, continua WAITING!
  decision = legacyPrebufferEvaluator(currentBuf, target, 10000);
  assert.equal(decision.action, "WAITING");

  decision = legacyPrebufferEvaluator(currentBuf, target, 25000);
  assert.equal(decision.action, "WAITING");

  decision = legacyPrebufferEvaluator(currentBuf, target, 35000);
  assert.equal(decision.action, "WAITING");

  console.log("  [BUG CONFIRMADO NO LEGADO]: Em 35 segundos com 18.7s no buffer, o status continuou:", decision.reason);
});

test("CORREÇÃO COM API LIMPA: PrebufferController libera imediatamente com 18.7s (Solid Cushion)", () => {
  const controller = createPrebufferController({ targetBufSec: 25 });

  // Simula progressão do buffer: 0s -> 6s -> 12s -> 18.7s
  assert.equal(controller.tick(0, 300).action, "WAITING");
  assert.equal(controller.tick(6.0, 300).action, "WAITING");
  assert.equal(controller.tick(12.0, 300).action, "WAITING");

  // Ao atingir 18.7s (colchão seguro >= 15s), libera instantaneamente!
  const decision = controller.tick(18.7, 300);
  assert.equal(decision.action, "LAUNCH");
  assert.equal(decision.reason, "SOLID_CUSHION");
  assert.equal(decision.progressPct, 75);

  console.log("  [CORREÇÃO SOLID CUSHION]: 18.7s liberado instantaneamente com motivo:", decision.reason, `(${decision.progressPct}%)`);
});

test("CORREÇÃO COM API LIMPA: Canal com burst curto (8.5s) que para de crescer libera por platô", () => {
  const controller = createPrebufferController({ targetBufSec: 25 });

  // Sobe até 8.5s
  controller.tick(3.0, 300);
  controller.tick(8.5, 300);

  // Buffer para de crescer em 8.5s por 5 ticks (1.5 segundos)
  assert.equal(controller.tick(8.5, 300).action, "WAITING");
  assert.equal(controller.tick(8.5, 300).action, "WAITING");
  assert.equal(controller.tick(8.5, 300).action, "WAITING");
  assert.equal(controller.tick(8.5, 300).action, "WAITING");

  // 5º tick no mesmo valor: detecta platô do burst e libera
  const decision = controller.tick(8.5, 300);
  assert.equal(decision.action, "LAUNCH");
  assert.equal(decision.reason, "BURST_CEILING_REACHED");

  console.log("  [CORREÇÃO BURST CEILING]: Canal com 8.5s liberou após platô de 1.5s com motivo:", decision.reason);
});

test("CORREÇÃO COM API LIMPA: Canal com 0 buffer reconecta rapidamente no timeout de 12s", () => {
  const controller = createPrebufferController({ targetBufSec: 25, maxWaitMs: 12000 });

  // Simula 11.7s sem nenhum dado da fonte (0 buffer)
  for (let t = 0; t < 11700; t += 300) {
    assert.equal(controller.tick(0, 300).action, "WAITING");
  }

  // Aos 12s, fonte inativa dispara RECONNECT
  const decision = controller.tick(0, 300);
  assert.equal(decision.action, "RECONNECT");
  assert.equal(decision.reason, "TIMEOUT_DEAD_SOURCE");

  console.log("  [CORREÇÃO DEAD SOURCE]: Conexão inativa detectada e ordenada reconexão com motivo:", decision.reason);
});
