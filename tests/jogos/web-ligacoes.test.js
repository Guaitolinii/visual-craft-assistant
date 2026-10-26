import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, "..", "..", "sintoniza-link.html"), "utf8");

test("menu lateral e barra do celular têm o item Jogos (data-jogos-open)", () => {
  assert.match(html, /<button class="nav-item" data-jogos-open id="nav-jogos-btn">[\s\S]*?<span>Jogos<\/span>/);
  assert.match(html, /<button class="mobile-tab" data-jogos-open>[\s\S]*?<span>Jogos<\/span>/);
});

test("a barra do celular acomoda seis abas (colunas automáticas, não mais cinco fixas)", () => {
  assert.doesNotMatch(html, /\.mobile-tabs \{[^}]*grid-template-columns: repeat\(5, 1fr\)/);
  assert.match(html, /\.mobile-tabs \{[^}]*grid-auto-flow: column;[^}]*grid-auto-columns: 1fr;/);
});

test("a tela e a folha existem e começam escondidas", () => {
  assert.match(html, /<div class="view hidden" id="jogos-view">/);
  assert.match(html, /id="jogos-content"/);
  assert.match(html, /<div id="jogos-sheet" class="action-sheet hidden" role="dialog" aria-modal="true" aria-hidden="true">/);
  assert.match(html, /id="jogos-sheet-actions"/);
});

test("renderPageSection e renderNav conhecem a seção jogos", () => {
  assert.match(html, /getElementById\("jogos-view"\)\.classList\.toggle\("hidden", section !== "jogos"\)/);
  assert.match(html, /querySelectorAll\("\[data-jogos-open\]"\)\.forEach\(el => \{\s+el\.classList\.toggle\("active", section === "jogos"\);/);
});

test("há estilos para a grade de cards, o selo ao vivo e a folha", () => {
  for (const c of [".jogos-secao", ".jogos-grade", ".jogo-card", ".jogo-vivo", ".jogo-times", ".jogo-canal"]) {
    assert.ok(html.includes(c), c);
  }
});

test("o arquivo vem do vod-data, com tempo limite, e o cache só é lido se íntegro", () => {
  assert.match(html, /const JOGOS_URL = "https:\/\/raw\.githubusercontent\.com\/Guaitolinii\/visual-craft-assistant\/vod-data\/jogos\.json";/);
  assert.match(html, /async function jogosBaixar\(\)[\s\S]*?setTimeout\(\(\) => ctrl\.abort\(\), 12000\)[\s\S]*?fetch\(JOGOS_URL, \{ cache: "no-cache", signal: ctrl\.signal \}\)/);
  assert.match(html, /async function loadJogos\(force\)[\s\S]*?jogosLerCache\(raw, agora\)[\s\S]*?jogosBaixar\(\)/);
});

test("abrir a aba muda a seção, baixa os jogos e liga o relógio que atualiza o AO VIVO", () => {
  assert.match(html, /function openJogosSection\(\)[\s\S]*?setState\(\{ section: "jogos" \}\)[\s\S]*?closeSidebar\(\)[\s\S]*?loadJogos\(false\)/);
  assert.match(html, /setInterval\(\(\) => \{[\s\S]*?_state\.section !== "jogos"[\s\S]*?clearInterval/);
});

test("tocar no card: um canal toca direto (selectChannel), vários abrem a folha, nenhum avisa", () => {
  assert.match(html, /function abrirJogo\(id\)[\s\S]*?jogosAcaoClique\(jogo, getChannels\(\)\)[\s\S]*?selectChannel\(acao\.canal\)[\s\S]*?abrirJogosSheet\(jogo, acao\.canais\)[\s\S]*?showToast\("Esse canal não está na sua lista\."\)/);
  assert.match(html, /querySelectorAll\("\[data-jogos-open\]"\)\.forEach\(el => el\.addEventListener\("click", openJogosSection\)\)/);
  assert.match(html, /getElementById\("jogos-content"\)\.addEventListener\("click", e => \{[\s\S]*?\[data-jogo-id\]/);
  assert.match(html, /getElementById\("jogos-sheet-actions"\)\.addEventListener\("click", e => \{[\s\S]*?data-jogos-canal/);
});

test("o card mostra times, horário (ou AO VIVO) e o canal; nada do arquivo entra sem escape", () => {
  assert.match(html, /function jogoCardHtml\(j, agoraMs, diaRotulo\)[\s\S]*?escapeHtmlText\(j\.competicao\)/);
  assert.match(html, /Canal não confirmado/);
  assert.match(html, /function jogoTimeHtml\(t\)[\s\S]*?sanitizeImageUrl\(t\.escudo\)[\s\S]*?escapeHtmlText\(t\.nome\)/);
});
