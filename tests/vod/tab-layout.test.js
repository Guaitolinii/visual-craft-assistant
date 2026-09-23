import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("Início mostra só as listas pessoais (sem busca e sem canais)", () => {
  const l = loadVodHelpers().getCatalogTabLayout("Início");
  assert.equal(l.showHomeLists, true);
  assert.equal(l.showSearch, false);
  assert.equal(l.showCatalog, false);
});

test("Favoritos mostra só os canais favoritos, com busca própria", () => {
  const l = loadVodHelpers().getCatalogTabLayout("Favoritos");
  assert.equal(l.showHomeLists, false);
  assert.equal(l.showCatalog, true);
  assert.equal(l.showPills, false);
  assert.equal(l.searchPlaceholder, "Buscar nos favoritos...");
});

test("Canais (e qualquer categoria) mostram a grade completa com as categorias", () => {
  const ctx = loadVodHelpers();
  for (const active of ["Todos os canais", "Esportes"]) {
    const l = ctx.getCatalogTabLayout(active);
    assert.equal(l.showHomeLists, false);
    assert.equal(l.showCatalog, true);
    assert.equal(l.showPills, true);
  }
});

test("categorias acendem a aba Canais", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.getMobileTabForSection("Início"), "Início");
  assert.equal(ctx.getMobileTabForSection("Favoritos"), "Favoritos");
  assert.equal(ctx.getMobileTabForSection("Esportes"), "Todos os canais");
  assert.equal(ctx.getMobileTabForSection("Todos os canais"), "Todos os canais");
});
