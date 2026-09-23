import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("formatEpisodeTitle usa o nome da série + S01E03", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.formatEpisodeTitle("Escola Minerva", "1", "3"), "Escola Minerva · S01E03");
  assert.equal(ctx.formatEpisodeTitle("", 2, 5), "S02E05");
  assert.equal(ctx.formatEpisodeTitle("Dark", undefined, ""), "Dark · S01");
});

test("formatEpisodeCode completa com zero à esquerda", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.formatEpisodeCode(1, 3), "S01E03");
  assert.equal(ctx.formatEpisodeCode("10", "12"), "S10E12");
  assert.equal(ctx.formatEpisodeCode(undefined, ""), "S01");
});

test("splitEpisodeTitle separa nome e código (formatos v6, v7 e antigo)", () => {
  const ctx = loadVodHelpers();
  assert.deepEqual(ctx.splitEpisodeTitle("Escola Minerva · S01E03"), { name: "Escola Minerva", code: "S01E03" });
  assert.deepEqual(ctx.splitEpisodeTitle("Escola Minerva · T1E3"), { name: "Escola Minerva", code: "S01E03" });
  assert.deepEqual(ctx.splitEpisodeTitle("S01E01"), { name: "", code: "S01E01" });
  assert.deepEqual(ctx.splitEpisodeTitle("One Last Shot"), { name: "One Last Shot", code: "" });
});

test("trimVodItem guarda só os campos usados para reabrir o título", () => {
  const ctx = loadVodHelpers();
  const trimmed = ctx.trimVodItem({ series_id: 9, name: "Dark", cover: "http://c/d.jpg", plot: "…", cast: "muita gente", backdrop_path: ["a", "b"] });
  assert.deepEqual(trimmed, { series_id: 9, name: "Dark", cover: "http://c/d.jpg", plot: "…" });
  assert.equal(ctx.trimVodItem(null), null);
});
