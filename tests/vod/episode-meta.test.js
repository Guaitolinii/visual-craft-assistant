import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("formatEpisodeTitle usa o nome da série + temporada/episódio", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.formatEpisodeTitle("Escola Minerva", "1", "3"), "Escola Minerva · T1E3");
  assert.equal(ctx.formatEpisodeTitle("", 2, 5), "T2E5");
  assert.equal(ctx.formatEpisodeTitle("Dark", undefined, ""), "Dark · T1");
});

test("trimVodItem guarda só os campos usados para reabrir o título", () => {
  const ctx = loadVodHelpers();
  const trimmed = ctx.trimVodItem({ series_id: 9, name: "Dark", cover: "http://c/d.jpg", plot: "…", cast: "muita gente", backdrop_path: ["a", "b"] });
  assert.deepEqual(trimmed, { series_id: 9, name: "Dark", cover: "http://c/d.jpg", plot: "…" });
  assert.equal(ctx.trimVodItem(null), null);
});
