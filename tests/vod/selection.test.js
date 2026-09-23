import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

const channels = [{ id: 1, name: "Canal Rural" }, { id: 2, name: "ESPN" }];

test("sem nada escolhido, a lista nova não escolhe canal nenhum", () => {
  assert.equal(loadVodHelpers().keepSelectionIfPresent(null, channels), null);
});

test("mantém o canal escolhido se ele continua na lista", () => {
  assert.deepEqual(loadVodHelpers().keepSelectionIfPresent({ id: 2, name: "ESPN" }, channels), { id: 2, name: "ESPN" });
});

test("canal que sumiu da lista deixa o player ocioso", () => {
  assert.equal(loadVodHelpers().keepSelectionIfPresent({ id: 9, name: "X" }, channels), null);
});

test("filme/episódio tocando não depende da lista de canais", () => {
  assert.deepEqual(loadVodHelpers().keepSelectionIfPresent({ id: "resume-vod-4", isVod: true }, channels), { id: "resume-vod-4", isVod: true });
});
