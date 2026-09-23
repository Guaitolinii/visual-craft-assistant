import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const movie = ctx => ctx.buildDownloadEntry({ kind: "movie", id: 9, title: "Duna: Parte 2", cover: "https://c/d.jpg", ext: "mp4", url: "http://s/movie/u/p/9.mp4" }, 1000);
const ep = (ctx, id, code, ts = 2000) => ctx.buildDownloadEntry({ kind: "episode", id, title: `Dark · ${code}`, seriesName: "Dark", code, cover: "", ext: "mkv", url: `http://s/series/u/p/${id}.mkv`, seriesId: 77 }, ts);

test("buildDownloadEntry monta nome de arquivo seguro e estado inicial", () => {
  const ctx = loadVodHelpers();
  const m = movie(ctx);
  assert.equal(m.key, "movie-9");
  assert.equal(m.fileName, "Duna  Parte 2 [9].mp4".replace("  ", " "));
  assert.equal(m.status, "queued");
  assert.equal(ep(ctx, 501, "S01E03").fileName, "Dark - S01E03 [501].mkv");
  assert.equal(ctx.buildDownloadEntry({ kind: "movie", id: 1, title: "X", ext: "mp4&x=1", url: "u" }, 1).fileName, "X [1].mp4");
});

test("safeFileBase remove caracteres proibidos", () => {
  assert.equal(loadVodHelpers().safeFileBase('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
});

test("enqueueDownloads não duplica e nextQueuedDownload respeita um por vez", () => {
  const ctx = loadVodHelpers();
  let list = ctx.enqueueDownloads([], [movie(ctx), ep(ctx, 501, "S01E03")]);
  list = ctx.enqueueDownloads(list, [movie(ctx)]);
  assert.equal(list.length, 2);
  assert.equal(ctx.nextQueuedDownload(list).key, "movie-9");
  list = ctx.updateDownload(list, "movie-9", { status: "downloading" });
  assert.equal(ctx.nextQueuedDownload(list), null);
  list = ctx.updateDownload(list, "movie-9", { status: "done" });
  assert.equal(ctx.nextQueuedDownload(list).key, "episode-501");
  assert.equal(ctx.removeDownload(list, "movie-9").length, 1);
});

test("resetInterruptedDownloads devolve 'baixando' para a fila", () => {
  const ctx = loadVodHelpers();
  const list = ctx.resetInterruptedDownloads([{ key: "a", status: "downloading", bytes: 50 }, { key: "b", status: "done", bytes: 9 }]);
  assert.deepEqual(list.map(e => [e.status, e.bytes]), [["queued", 0], ["done", 9]]);
});

test("groupDownloads separa filmes e agrupa episódios por série, em ordem", () => {
  const ctx = loadVodHelpers();
  const g = ctx.groupDownloads([ep(ctx, 502, "S01E04"), movie(ctx), ep(ctx, 501, "S01E03")]);
  assert.deepEqual(g.movies.map(e => e.key), ["movie-9"]);
  assert.equal(g.series.length, 1);
  assert.equal(g.series[0].seriesName, "Dark");
  assert.deepEqual(g.series[0].episodes.map(e => e.code), ["S01E03", "S01E04"]);
});

test("formatDownloadProgress e seasonsOf", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.formatDownloadProgress(805306368, 1610612736), "50% · 768 MB de 1.5 GB");
  assert.equal(ctx.formatDownloadProgress(0, 0), "");
  assert.deepEqual(ctx.seasonsOf([{ season: "2" }, { season: 1 }, { season: "2" }, {}]), [1, 2]);
});
