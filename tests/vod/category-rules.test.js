import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";
import { LINK_HTML_PATH, plain } from "../ott/loadOtt.js";

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx, {
    filename: "resilience-helpers.js",
  });
  return ctx;
}

const html = readFileSync(LINK_HTML_PATH, "utf8");

test("normalizeCategoryName normaliza minúsculas e remove acentos mantendo o +", () => {
  const { normalizeCategoryName } = load();
  assert.equal(typeof normalizeCategoryName, "function");
  assert.equal(normalizeCategoryName("Ação"), "acao");
  assert.equal(normalizeCategoryName("Comédia"), "comedia");
  assert.equal(normalizeCategoryName("Universal+"), "universal+");
  assert.equal(normalizeCategoryName("Disney+"), "disney+");
  assert.equal(normalizeCategoryName(""), "");
  assert.equal(normalizeCategoryName(undefined), "");
  assert.equal(normalizeCategoryName(null), "");
  assert.equal(normalizeCategoryName(123), "");
  assert.equal(normalizeCategoryName({}), "");
});

test("isAdultCategory reconhece categorias adultas e rejeita falsos positivos e tipos inválidos", () => {
  const { isAdultCategory } = load();
  assert.equal(typeof isAdultCategory, "function");

  const adultCases = [
    "ADULTOS XXX",
    "ADULTOS XXX - BELA DA SEMANA",
    "ADULTOS XXX - GAYS",
    "ADULTOS XXX - LEGENDADOS",
    "ADULTOS XXX - ONLYFANS",
    "ADULTOS XXX - TRANS",
    "Canal | XXX ADULTOS",
    "Filmes +18",
    "18+",
    "Erótico",
    "Hentai",
  ];
  for (const name of adultCases) {
    assert.equal(isAdultCategory(name), true, `Deveria ser adulto: ${name}`);
  }

  const nonAdultCases = [
    "Ação",
    "Aventura",
    "Animação",
    "Comédia",
    "Documentários",
    "Drama",
    "Família",
    "Suspense",
    "Terror",
    "Universal+",
    "Discovery+",
    "Paramount+",
    "Star+",
    "Apple TV+",
    "Disney+",
    "Canal | ESPN",
    "Canal | GLOBO - INTERIOR",
    "TRANSMISSÃO AO VIVO",
  ];
  for (const name of nonAdultCases) {
    assert.equal(isAdultCategory(name), false, `Não deveria ser adulto: ${name}`);
  }

  const invalidCases = ["", undefined, null, 123, NaN, {}, []];
  for (const val of invalidCases) {
    assert.equal(isAdultCategory(val), false, `Valor inválido deve ser falso: ${String(val)}`);
  }
});

test("streamingRank pontua streamings na ordem de prioridade e devolve -1 para os demais e inválidos", () => {
  const { streamingRank } = load();
  assert.equal(typeof streamingRank, "function");

  assert.equal(streamingRank("Netflix"), 0);
  assert.equal(streamingRank("AMAZON PRIME VIDEO"), 1);
  assert.equal(streamingRank("HBO Max"), 2);
  assert.equal(streamingRank("MAX"), 2);
  assert.equal(streamingRank("Disney Plus"), 3);
  assert.equal(streamingRank("Disney+"), 3);
  assert.equal(streamingRank("Apple TV+"), 4);
  assert.equal(streamingRank("Globoplay"), 5);
  assert.equal(streamingRank("Paramount+"), 6);
  assert.equal(streamingRank("Star+"), 7);
  assert.equal(streamingRank("Discovery+"), 8);
  assert.equal(streamingRank("Crunchyroll"), 9);
  assert.equal(streamingRank("Telecine"), 10);
  assert.equal(streamingRank("Claro"), 11);
  assert.equal(streamingRank("Universal+"), 12);
  assert.equal(streamingRank("Pluto"), 13);
  assert.equal(streamingRank("MGM"), 14);
  assert.equal(streamingRank("Hulu"), 15);
  assert.equal(streamingRank("Peacock"), 16);
  assert.equal(streamingRank("Lionsgate"), 17);
  assert.equal(streamingRank("Looke"), 18);
  assert.equal(streamingRank("MUBI"), 19);

  // Não-streamings e falso positivo evitado
  assert.equal(streamingRank("MAXIMA"), -1);
  assert.equal(streamingRank("Ação"), -1);
  assert.equal(streamingRank("Terror"), -1);

  // Entradas inválidas
  assert.equal(streamingRank(""), -1);
  assert.equal(streamingRank(undefined), -1);
  assert.equal(streamingRank(null), -1);
  assert.equal(streamingRank(123), -1);
  assert.equal(streamingRank({}), -1);
});

test("orderCategories remove adultas, coloca streamings no topo ordenados e mantém os demais na ordem original", () => {
  const { orderCategories } = load();
  assert.equal(typeof orderCategories, "function");

  const input = [
    "AÇÃO",
    "ADULTOS XXX",
    "Disney Plus",
    "COMEDIA",
    "Netflix",
    "ADULTOS XXX - GAYS",
    "Amazon Prime Video",
    "Terror",
    "Max",
  ];
  const copy = [...input];

  const expected = [
    "Netflix",
    "Amazon Prime Video",
    "Max",
    "Disney Plus",
    "AÇÃO",
    "COMEDIA",
    "Terror",
  ];

  const result = plain(orderCategories(input));
  assert.deepEqual(result, expected);
  assert.deepEqual(input, copy, "orderCategories não deve mutar a lista de entrada");

  // Empate estável em streamings de mesmo rank (ex: Netflix e Netflix Kids)
  const tieInput = ["Netflix", "Netflix Kids"];
  assert.deepEqual(plain(orderCategories(tieInput)), ["Netflix", "Netflix Kids"]);
  const tieInputReverse = ["Netflix Kids", "Netflix"];
  assert.deepEqual(plain(orderCategories(tieInputReverse)), ["Netflix Kids", "Netflix"]);

  // Lista vazia, não-array e só adultas
  assert.deepEqual(plain(orderCategories([])), []);
  assert.deepEqual(plain(orderCategories(null)), []);
  assert.deepEqual(plain(orderCategories(undefined)), []);
  assert.deepEqual(plain(orderCategories("não-array")), []);
  assert.deepEqual(plain(orderCategories(123)), []);
  assert.deepEqual(plain(orderCategories(["ADULTOS XXX", "18+", "Hentai"])), []);

  // Objetos com nameOf customizado
  const objCats = [
    { category_id: "1", category_name: "Ação" },
    { category_id: "2", category_name: "ADULTOS XXX" },
    { category_id: "3", category_name: "Disney Plus" },
    { category_id: "4", category_name: "Netflix" },
    { category_id: "5" }, // sem category_name
  ];
  const objResult = plain(orderCategories(objCats, (c) => c.category_name));
  assert.deepEqual(
    objResult.map((c) => c.category_id),
    ["4", "3", "1", "5"]
  );

});

test("filterAdultChannels remove canais com categoria adulta, preserva canais sem categoria e ordem", () => {
  const { filterAdultChannels } = load();
  assert.equal(typeof filterAdultChannels, "function");

  const channels = [
    { name: "Globo", category: "Canal | GLOBO - INTERIOR" },
    { name: "Adulto 1", category: "Canal | XXX ADULTOS" },
    { name: "ESPN", category: "Canal | ESPN" },
    { name: "Adulto 2", category: "ADULTOS XXX - BELA DA SEMANA" },
    { name: "Sem Categoria" },
    { name: "Outro Sem Cat", category: null },
    { name: "Cat Vazia", category: "" },
    { name: "Adulto 3", category: "18+" },
  ];
  const copy = [...channels];

  const filtered = plain(filterAdultChannels(channels));
  assert.deepEqual(channels, copy, "filterAdultChannels não deve mutar a lista de canais");
  assert.deepEqual(
    filtered.map((c) => c.name),
    ["Globo", "ESPN", "Sem Categoria", "Outro Sem Cat", "Cat Vazia"]
  );

  // Entradas inválidas
  assert.deepEqual(plain(filterAdultChannels(null)), []);
  assert.deepEqual(plain(filterAdultChannels(undefined)), []);
  assert.deepEqual(plain(filterAdultChannels("não-array")), []);
  assert.deepEqual(plain(filterAdultChannels(123)), []);
  assert.deepEqual(plain(filterAdultChannels([])), []);
});

test("pontos de ligação no sintoniza-link.html chamam orderCategories e filterAdultChannels", () => {
  // vodFetchCategories deve chamar orderCategories(raw.map(sanitizeVodItem), (c) => c.category_name)
  const vodMatch = html.match(/function vodFetchCategories\([\s\S]*?\{([\s\S]*?)\n\}/);
  assert.ok(vodMatch, "vodFetchCategories deve existir no HTML");
  assert.match(
    vodMatch[1],
    /orderCategories\(\s*raw\.map\(sanitizeVodItem\)\s*,\s*\(?c\)?\s*=>\s*c\.category_name\s*\)/,
    "vodFetchCategories deve chamar orderCategories com sanitizeVodItem e extrator category_name"
  );

  // loadPlaylistFromUrl deve chamar filterAdultChannels(parseM3U(text))
  const urlMatch = html.match(/async function loadPlaylistFromUrl\([\s\S]*?\{([\s\S]*?)\n\}/);
  assert.ok(urlMatch, "loadPlaylistFromUrl deve existir no HTML");
  assert.match(
    urlMatch[1],
    /const channels = filterAdultChannels\(parseM3U\(text\)\);/,
    "loadPlaylistFromUrl deve chamar filterAdultChannels(parseM3U(text))"
  );

  // loadPlaylistFromFile deve chamar filterAdultChannels(parseM3U(text))
  const fileMatch = html.match(/async function loadPlaylistFromFile\([\s\S]*?\{([\s\S]*?)\n\}/);
  assert.ok(fileMatch, "loadPlaylistFromFile deve existir no HTML");
  assert.match(
    fileMatch[1],
    /const channels = filterAdultChannels\(parseM3U\(text\)\);/,
    "loadPlaylistFromFile deve chamar filterAdultChannels(parseM3U(text))"
  );
});

test("streamingRank só casa 'prime' e 'claro' como palavra inteira (PRIMEIROS FILMES e ESCLARECIDO não são streaming)", () => {
  const { streamingRank } = load();
  assert.equal(streamingRank("PRIMEIROS FILMES"), -1);
  assert.equal(streamingRank("Esclarecido"), -1);
  assert.equal(streamingRank("Prime Video"), 1);
  assert.equal(streamingRank("AMAZON PRIME VIDEO"), 1);
  assert.equal(streamingRank("Claro Video"), 11);
});
