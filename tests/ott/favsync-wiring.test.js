import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";
import { LINK_HTML_PATH } from "./loadOtt.js";

const ID = "3f2b8c1e-9a77-4d0f-8a55-2b1c7e9d4a10";

test("estado da sincronização: tolera lixo e só aceita listas de textos", () => {
  const h = loadVodHelpers();
  assert.deepEqual(h.favSyncParse(null), { feito: false, pendentes: [], remover: [] });
  assert.deepEqual(h.favSyncParse("não é json"), { feito: false, pendentes: [], remover: [] });
  assert.deepEqual(h.favSyncParse('{"feito":true,"pendentes":["f:1",5,null],"remover":"x"}'), { feito: true, pendentes: ["f:1"], remover: [] });
});

test("marcar/desmarcar: sem confirmação da conta fica pendente; com confirmação sai da pendência", () => {
  const h = loadVodHelpers();
  const base = { feito: true, pendentes: ["f:1"], remover: ["c:espn"] };
  assert.deepEqual(h.favSyncMark(base, "f:2", true, false), { feito: true, pendentes: ["f:1", "f:2"], remover: ["c:espn"] });
  assert.deepEqual(h.favSyncMark(base, "f:1", true, true), { feito: true, pendentes: [], remover: ["c:espn"] });
  // desmarcar um que estava pendente de envio: não precisa mais enviar, mas precisa remover na conta
  assert.deepEqual(h.favSyncMark(base, "f:1", false, false), { feito: true, pendentes: [], remover: ["c:espn", "f:1"] });
  // marcar de novo um que estava para remover
  assert.deepEqual(h.favSyncMark(base, "c:espn", true, false), { feito: true, pendentes: ["f:1", "c:espn"], remover: [] });
  assert.deepEqual(h.favSyncMark({}, "s:9", true, true), { feito: false, pendentes: [], remover: [] });
});

test("tipo da conta pelo prefixo da chave", () => {
  const h = loadVodHelpers();
  assert.equal(h.favTipoDaChave("c:globo"), "canal");
  assert.equal(h.favTipoDaChave("f:1"), "filme");
  assert.equal(h.favTipoDaChave("s:1"), "serie");
});

test("o estado da sincronização é por perfil (sint_p<id8>_favsync)", () => {
  const h = loadVodHelpers();
  assert.equal(h.profKeyFor("sint_favsync", ID), "sint_p3f2b8c1e_favsync");
  assert.equal(h.profKeyFor("sint_favsync", null), "sint_favsync");
});

test("ligação no app: marcar/desmarcar, perfil escolhido e favoritos fixos só antes da 1ª sincronização", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  assert.match(html, /function syncFavorites\(/);
  assert.match(html, /async function syncFavorites\(/);
  // toggleFav e toggleMyListFor empurram para a conta
  assert.match(html, /function toggleFav\(id\)[\s\S]*?favPush\(ottFavItemsFromChannels\(\[chName\]\)\[0\], !isAlreadyFav\)/);
  assert.match(html, /function toggleMyListFor\([\s\S]*?favPush\(ottFavItemsFromMyList\(\[entry\]\)\[0\], !wasIn\)/);
  // os favoritos fixos param depois da 1ª sincronização
  assert.match(html, /function ensureEssentialFavorites\(\)[\s\S]*?if \(favSyncIsDone\(\)\) return;/);
  // só sincroniza depois de escolher o perfil; profileChoose dispara
  assert.match(html, /async function syncFavorites\(\)[\s\S]*?!_profile\.chosen/);
  assert.match(html, /function profileChoose\(p\)[\s\S]*?favSyncStart\(\)/);
});
