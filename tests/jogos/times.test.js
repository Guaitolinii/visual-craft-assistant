import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizarTime, mesmoTime, mesmoJogo } from "../../scripts/jogos/times.mjs";

const ALIASES = JSON.parse(readFileSync(new URL("../../scripts/jogos/aliases-times.json", import.meta.url), "utf8"));

test("normalizarTime: sem acento, pontuação nem palavras vazias (fc, ec, de...)", () => {
  assert.equal(normalizarTime("Grêmio FC"), "gremio");
  assert.equal(normalizarTime("São Paulo F.C."), "sao paulo");
  assert.equal(normalizarTime("Sport Club Internacional"), "sport internacional");
  assert.equal(normalizarTime("FC"), "fc"); // só palavra vazia: devolve o texto normalizado
  assert.equal(normalizarTime(null), "");
});

test("normalizarTime: apelidos levam ao mesmo nome", () => {
  assert.equal(normalizarTime("Atlético Mineiro", ALIASES), normalizarTime("Atlético-MG", ALIASES));
  assert.equal(normalizarTime("Inter Milan", ALIASES), normalizarTime("Inter de Milão", ALIASES));
  assert.equal(normalizarTime("Paris Saint-Germain", ALIASES), normalizarTime("PSG", ALIASES));
  assert.equal(normalizarTime("Bayern Munich", ALIASES), normalizarTime("Bayern de Munique", ALIASES));
});

test("mesmoTime: igual, apelido e nome abreviado casam; times diferentes não", () => {
  assert.equal(mesmoTime("Vasco da Gama", "Vasco", ALIASES), true);
  assert.equal(mesmoTime("Atlético-MG", "Atlético Mineiro", ALIASES), true);
  assert.equal(mesmoTime("Atlético-MG", "Atlético-PR", ALIASES), false);
  assert.equal(mesmoTime("Flamengo", "Fluminense", ALIASES), false);
  assert.equal(mesmoTime("Inter", "Internacional", ALIASES), false);
  assert.equal(mesmoTime("", "Sevilla", ALIASES), false);
});

const jogo = (casa, fora, iso) => ({ casa: { nome: casa }, fora: { nome: fora }, inicio: Date.parse(iso) / 1000 });

test("mesmoJogo: mesmos times (mesmo trocados) e horário a menos de 45 min", () => {
  const a = jogo("Sevilla", "Osasuna", "2026-10-26T20:00:00Z");
  assert.equal(mesmoJogo(a, jogo("Osasuna", "Sevilla", "2026-10-26T20:30:00Z"), ALIASES, 45 * 60), true);
  assert.equal(mesmoJogo(a, jogo("Sevilla", "Osasuna", "2026-10-26T21:00:00Z"), ALIASES, 45 * 60), false);
  // Um time igual no mesmo horário já identifica o jogo (o outro nome muda de idioma entre as fontes)
  assert.equal(mesmoJogo(a, jogo("Sevilla", "Betis", "2026-10-26T20:00:00Z"), ALIASES, 45 * 60), true);
  assert.equal(mesmoJogo(a, { inicio: a.inicio, titulo: "UFC 300" }, ALIASES, 45 * 60), false);
});

test("mesmoJogo: casamento parcial (um time igual) e tolerâncias de horário", () => {
  // Marseille x Le Havre AC contra Olympique de Marselha x Le Havre, mesmo horário => true
  assert.equal(
    mesmoJogo(
      jogo("Marseille", "Le Havre AC", "2026-10-26T16:15:00-03:00"),
      jogo("Olympique de Marselha", "Le Havre", "2026-10-26T16:15:00-03:00"),
      ALIASES,
    ),
    true,
  );

  const base = jogo("Time A", "Time B", "2026-10-26T20:00:00Z");

  // Um time igual e início a 25 minutos de diferença => true; a 40 minutos de diferença => false
  assert.equal(mesmoJogo(base, jogo("Time A", "Outro C", "2026-10-26T20:25:00Z"), ALIASES), true);
  assert.equal(mesmoJogo(base, jogo("Time A", "Outro C", "2026-10-26T20:40:00Z"), ALIASES), false);

  // Nenhum time igual no mesmo horário => false
  assert.equal(mesmoJogo(base, jogo("Time X", "Time Y", "2026-10-26T20:00:00Z"), ALIASES), false);

  // Os dois times iguais com 40 minutos de diferença => true (a tolerância de 45 min continua valendo para os dois times)
  assert.equal(mesmoJogo(base, jogo("Time A", "Time B", "2026-10-26T20:40:00Z"), ALIASES), true);
});
