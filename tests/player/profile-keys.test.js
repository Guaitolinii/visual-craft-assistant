import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";
import { LINK_HTML_PATH } from "../ott/loadOtt.js";

const ID = "3f2b8c1e-9a77-4d0f-8a55-2b1c7e9d4a10";

test("chave por perfil: sem perfil usa a antiga; com perfil usa sint_p<id8>_<nome>", () => {
  const h = loadVodHelpers();
  assert.equal(h.profKeyFor("sint_fav", null), "sint_fav");
  assert.equal(h.profKeyFor("sint_fav", ID), "sint_p3f2b8c1e_fav");
  assert.equal(h.profKeyFor("sint_recents", ID), "sint_p3f2b8c1e_recents");
  assert.equal(h.profKeyFor("sint_fav_kind", ID), "sint_p3f2b8c1e_fav_kind");
  assert.equal(h.profKeyFor("sint_continue", ID), "sint_p3f2b8c1e_continue");
  assert.equal(h.profKeyFor("sint_mylist", ID), "sint_p3f2b8c1e_mylist");
  // não são por perfil: continuam por aparelho
  assert.equal(h.profKeyFor("sint_url", ID), "sint_url");
  assert.equal(h.profKeyFor("sint_view", ID), "sint_view");
  assert.equal(h.profKeyFor("sint_fit", ID), "sint_fit");
  assert.equal(h.profKeyFor("sint_downloads", ID), "sint_downloads");
});

test("o perfil ativo vem de sint_profile_active; sem ele, profKey devolve a chave antiga", () => {
  const h = loadVodHelpers();
  assert.equal(h.activeProfileId(), null);
  assert.equal(h.profKey("sint_fav"), "sint_fav");
  h.localStorage.setItem("sint_profile_active", ID);
  assert.equal(h.activeProfileId(), ID);
  assert.equal(h.profKey("sint_fav"), "sint_p3f2b8c1e_fav");
  assert.equal(h.profKey("sint_view"), "sint_view");
});

test("adotar os dados antigos: copia (sem apagar) só no perfil principal e só uma vez", () => {
  const h = loadVodHelpers();
  const ls = h.localStorage;
  ls.setItem("sint_fav", '["ESPN"]');
  ls.setItem("sint_continue", '{"resume-vod-1":{"id":"resume-vod-1"}}');
  ls.setItem("sint_view", "list");
  // perfil que não é o principal: não migra e não marca
  assert.equal(h.profileAdoptLegacy("aaaaaaaa-0000-4000-8000-000000000000", false), false);
  assert.equal(ls.getItem("sint_paaaaaaaa_fav"), null);
  assert.equal(ls.getItem("sint_profiles_migrated"), null);
  // principal pela primeira vez: copia
  assert.equal(h.profileAdoptLegacy(ID, true), true);
  assert.equal(ls.getItem("sint_p3f2b8c1e_fav"), '["ESPN"]');
  assert.equal(ls.getItem("sint_p3f2b8c1e_continue"), '{"resume-vod-1":{"id":"resume-vod-1"}}');
  assert.equal(ls.getItem("sint_p3f2b8c1e_mylist"), null); // não havia nada para copiar
  assert.equal(ls.getItem("sint_p3f2b8c1e_view"), null);   // sint_view não é por perfil
  assert.equal(ls.getItem("sint_fav"), '["ESPN"]');         // as antigas continuam
  assert.equal(ls.getItem("sint_profiles_migrated"), "1");
  // segunda vez: não sobrescreve
  ls.setItem("sint_p3f2b8c1e_fav", '["Globo"]');
  assert.equal(h.profileAdoptLegacy(ID, true), false);
  assert.equal(ls.getItem("sint_p3f2b8c1e_fav"), '["Globo"]');
});

test("o estado inicial lê as chaves do perfil (e não lança com os mocks do carregador)", () => {
  const h = loadVodHelpers();
  assert.equal(typeof h.profKey, "function");
});

test("activeProfileIsMain: sem perfil ou sem cache é principal; com cache vale o campo padrao", () => {
  const h = loadVodHelpers();
  assert.equal(h.activeProfileIsMain(), true);
  h.localStorage.setItem("sint_profile_active", ID);
  assert.equal(h.activeProfileIsMain(), true);
  h.localStorage.setItem("sint_profiles", JSON.stringify([{ id: ID, nome: "Bia", avatar: "pipoca", padrao: false }]));
  assert.equal(h.activeProfileIsMain(), false);
  h.localStorage.setItem("sint_profiles", JSON.stringify([{ id: ID, nome: "Ana", avatar: "padrao", padrao: true }]));
  assert.equal(h.activeProfileIsMain(), true);
});

test("nenhum acesso direto às 5 chaves por perfil: tudo passa por profKey", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  assert.doesNotMatch(html, /localStorage\.(get|set|remove)Item\(\s*"(sint_fav|sint_recents|sint_fav_kind|sint_continue|sint_mylist)"/);
  assert.doesNotMatch(html, /localStorage\.(get|set|remove)Item\(\s*(CONTINUE_KEY|MYLIST_KEY|FAV_KIND_KEY)\b/);
});
