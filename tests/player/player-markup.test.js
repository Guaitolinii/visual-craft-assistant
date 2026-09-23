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

test("tela cheia tem linha do tempo, ±10s, girar, bloquear e sair", () => {
  for (const id of ["fs-ui", "fs-seek-bar", "fs-skip-back-btn", "fs-skip-fwd-btn", "fs-play-btn", "fs-rotate-btn", "fs-fit-btn", "fs-lock-btn", "fs-exit-btn", "fs-lock-shield", "fs-unlock-btn"]) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" não existe`);
  }
  assert.match(html, /Toque no cadeado para desbloquear/);
});

test("botões de ±10s desenham o número 10 dentro do próprio ícone", () => {
  for (const id of ["vod-skip-back-btn", "vod-skip-fwd-btn"]) {
    assert.match(buttonHtml(id), /<svg[\s\S]*<text[^>]*>10<\/text>[\s\S]*<\/svg>/);
  }
});

test("mini-player some enquanto o menu das 3 listras está aberto", () => {
  assert.match(html, /body\.sidebar-open #player-screen\.mini-player\s*\{[^}]*display:\s*none/);
  assert.match(html, /document\.body\.classList\.add\("sidebar-open"\)/);
  assert.match(html, /document\.body\.classList\.remove\("sidebar-open"\)/);
});

test("mini-player tem um x para fechar", () => {
  assert.ok(html.includes('id="mini-close-btn"'), "botão x do mini-player não existe");
  assert.match(html, /#player-screen\.mini-player \.mini-close-btn\s*\{[^}]*display:\s*flex/);
  assert.match(html, /function closeMiniPlayer\(\)/);
});

test("sem avisos técnicos de buffer/reconexão na tela", () => {
  for (const text of ["Blindagem ativa", "Conexão demorando", "Canal instável — reconectando", "Recarregando sinal de"]) {
    assert.ok(!html.includes(text), `aviso técnico "${text}" ainda existe`);
  }
});

test("tela e menu de Downloads existem, com baixar filme/episódio/temporada/série", () => {
  for (const id of ["nav-downloads-btn", "downloads-view", "downloads-list", "vod-modal-download"]) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" não existe`);
  }
  assert.match(html, /data-dl-season=/);
  assert.match(html, /data-dl-series=/);
  assert.match(html, /class="ep-dl-btn"/);
  assert.match(html, /callNativePlugin\("Filesystem", "downloadFile"/);
});

test("título do EPG (nowPlaying) vai escapado pro innerHTML de cardHTML e listHTML", () => {
  // getNowPlayingTitle devolve texto do XMLTV (decodeXmlEntities), que pode
  // conter <img onerror=...> - cardHTML/listHTML embutem em innerHTML, então
  // precisam escapar antes de interpolar (v8, correção da v7.1 pt.2).
  const occurrences = html.match(/Agora: \$\{escapeHtmlText\(nowPlaying\)\}/g) || [];
  assert.equal(occurrences.length, 2, "esperado em cardHTML e em listHTML");
});

test("#vod-modal-actions quebra linha (3 botões: Assistir, Minha Lista, Baixar)", () => {
  const match = html.match(/#vod-modal-actions\s*\{[^}]*\}/);
  assert.ok(match, "#vod-modal-actions não encontrado");
  assert.match(match[0], /flex-wrap:\s*wrap/);
});

test("janela flutuante: botão, modo PiP e ligação com o Android", () => {
  assert.ok(html.includes('id="pip-btn"'), "botão de janela flutuante não existe");
  assert.match(html, /body\.pip-active/);
  assert.match(html, /addEventListener\("sintonizapip"/);
  assert.match(html, /callNativePlugin\("SintonizaPip", "setAutoEnter"/);
});

test("janela flutuante: pausa só no fechamento nativo, suspende ao compartilhar e respeita filme pausado", () => {
  // Pausa pelo aviso "closed" do Android, sem a corrida do setTimeout
  assert.match(html, /!active && e\.closed\) pauseAfterPipClosed\(\)/);
  assert.doesNotMatch(html, /setTimeout\(\(\) => \{ if \(document\.visibilityState === "hidden"\) pauseAfterPipClosed/);
  // Compartilhar e escolher arquivo desligam a janela automática
  const share = html.match(/async function shareDownloaded[\s\S]*?\n\}/);
  assert.ok(share, "shareDownloaded não encontrada");
  assert.match(share[0], /suspendAutoPip\(\)[\s\S]*callNativePlugin\("Share"[\s\S]*resumeAutoPip\(\)/);
  assert.match(html, /getElementById\("file-input"\)\.addEventListener\("click", \(\) => suspendAutoPip\(\)\)/);
  // Filme pausado pelo usuário não conta como "tocando"
  assert.match(html, /_state\.playing && !\(_state\.selected\.isVod && userPausedVod\)/);
  // Suporte real consultado no Android
  assert.match(html, /callNativePlugin\("SintonizaPip", "isSupported"\)/);
  // Trava da tela cheia some dentro da janela
  assert.match(html, /body\.pip-active #player-screen \.fs-lock-shield/);
  assert.match(html, /body\.pip-active #player-screen \.fs-lock-hint/);
});

test("VOD view has a display-mode toggle (selo nos cartões / agrupar por streaming)", () => {
  for (const id of ["vod-display-badge-btn", "vod-display-group-btn"]) {
    assert.ok(html.includes(`id="${id}"`), `expected #${id} in the VOD view`);
  }
});

test("cartão de VOD desenha o selo do streaming ancorado no próprio cartão", () => {
  const card = html.match(/function vodCardHtml\([\s\S]*?\n\}/);
  assert.ok(card, "vodCardHtml não encontrada");
  assert.match(card[0], /\$\{vodProviderBadgeHtml\(item\.streamingProviders\)\}/);
  // .vod-provider-badge é position:absolute - sem position:relative no
  // .vod-card o selo ancoraria num ancestral qualquer, fora do pôster.
  const rule = html.match(/\n\s*\.vod-card \{[^}]*\}/);
  assert.ok(rule, "regra .vod-card não encontrada");
  assert.match(rule[0], /position:\s*relative/);
});
