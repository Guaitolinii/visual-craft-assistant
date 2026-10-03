// Marcação da tela de perfis ("Quem está assistindo?"), do editor, do avatar no topo e do cartão nas Configurações.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_HTML_PATH } from "./loadOtt.js";

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("seletor, editor e cartão de perfis existem", () => {
  for (const id of ["profile-gate", "profile-grid", "profile-manage-btn", "profile-editor", "profile-name-input", "profile-avatar-grid", "profile-save-btn", "profile-delete-btn", "profile-btn", "profiles-card", "welcome-h1"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
});

test("os avatares ficam num script próprio entre o ott-core e o script principal", () => {
  const i = (s) => html.indexOf(s);
  assert.ok(i('<script id="ott-core">') < i('<script id="avatars">'));
  const ultimo = html.lastIndexOf("<script>");
  assert.ok(i('<script id="avatars">') < ultimo);
  assert.match(html, /function avatarHtml\(/);
  assert.match(html, /const AVATARS = \[/);
});

test("a saudação usa o perfil, não um nome fixo", () => {
  assert.doesNotMatch(html, /<span>Guaitolini\.<\/span>/);
  assert.doesNotMatch(html, /<p class="user-name">Guaitolini<\/p>/);
  assert.doesNotMatch(html, /<div class="avatar">GA<\/div>/);
  assert.match(html, /function renderWelcome\(/);
  assert.match(html, /ottGreeting\(/);
});

test("o seletor cobre o app como o ott-gate e fica abaixo dele", () => {
  assert.match(html, /html\.profile-open #profile-gate \{ display: flex; \}/);
  assert.match(html, /html\.profile-open body > \*:not\(#profile-gate\):not\(#ott-gate\):not\(script\) \{ visibility: hidden; \}/);
  const z = (id) => Number((html.match(new RegExp(`#${id} \\{[^}]*z-index: (\\d+)`)) || [])[1]);
  assert.ok(z("profile-gate") > 99999, "acima da tela cheia simulada (99999) e dos avisos (10002)");
  assert.ok(z("profile-gate") < z("ott-gate"), "o ott-gate (ativação/bloqueio) fica por cima do seletor");
});

test("o <script> do head marca profile-open cedo, só com perfil ativo e 2+ perfis no cache", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  const m = head.match(/<script>\(function ?\(\) ?\{try\{[^<]*profile-open[^<]*<\/script>/);
  assert.ok(m, "falta o script do head que marca profile-open");
  assert.match(m[0], /sint_profile_active/);
  assert.match(m[0], /sint_profiles/);
  assert.match(m[0], /length>=2/);
  assert.match(m[0], /noott/);
  assert.match(m[0], /sessionStorage/);
});

test("os botões do seletor mostram que foram tocados (is-pressed)", () => {
  assert.match(html, /#profile-gate \.ott-btn, #profile-gate \.ott-link/);
  assert.match(html, /\.pg-card:active, \.pg-card\.is-pressed/);
});

test("o cartão de perfis é do modo conta e NÃO é um cartão de lista manual", () => {
  const m = html.match(/<div class="settings-card ott-only" id="profiles-card"[^>]*>/);
  assert.ok(m, "falta o cartão #profiles-card com as classes settings-card ott-only");
  assert.doesNotMatch(m[0], /data-manual-list/);
  assert.equal((html.match(/<div class="settings-card"[^>]*data-manual-list/g) || []).length, 3);
});

test("o avatar do topo cabe na barra sem cobrir a busca encaixada", () => {
  assert.match(html, /<button class="icon-btn[^"]*" id="profile-btn"/);
  assert.match(html, /body\.has-profile-btn \.search-box\.docked \{[^}]*right:/);
});

test("o campo do nome tem no máximo 20 caracteres e o excluir some no principal", () => {
  assert.match(html, /<input[^>]*id="profile-name-input"[^>]*maxlength="20"/);
  assert.match(html, /function profileChoose\(/);
  assert.match(html, /function profileBoot\(/);
  assert.match(html, /profileBoot\(\)/);
});

test("o envio à TV não depende de perfil: o botão de envio fica fora do seletor", () => {
  const gate = html.slice(html.indexOf('<div id="profile-gate"'), html.indexOf("<!-- SIDEBAR -->"));
  assert.ok(gate.length > 200, "não achei o bloco do seletor");
  assert.doesNotMatch(gate, /tv-cast-btn/);
  // o envio não consulta perfil nenhum: só manda o perfilId ativo (se houver)
  const cast = html.slice(html.indexOf("function castCurrentToTv"), html.indexOf("function castCurrentToTv") + 2500);
  assert.doesNotMatch(cast, /profileOpenGate|profile-gate/);
});
