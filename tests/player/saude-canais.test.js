import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const html = readFileSync(LINK_HTML_PATH, "utf8");

// ═══════════════════════════════════════════════════════════════
// 1. FUNÇÃO PURA: saudeChave
// ═══════════════════════════════════════════════════════════════
test("saudeChave: normaliza nome, remove acentos, minúsculas, colapsa espaços e trata inválidos", () => {
  const helpers = loadVodHelpers();
  assert.equal(typeof helpers.saudeChave, "function", "saudeChave deve ser exportada");

  assert.equal(helpers.saudeChave("ESPN HD"), "espn hd");
  assert.equal(helpers.saudeChave("  Séries   Premiére  1 HD "), "series premiere 1 hd");
  assert.equal(helpers.saudeChave(""), "");
  assert.equal(helpers.saudeChave(null), "");
  assert.equal(helpers.saudeChave(undefined), "");
  assert.equal(helpers.saudeChave(42), "");
});

// ═══════════════════════════════════════════════════════════════
// 2. FUNÇÃO PURA: saudeValidar
// ═══════════════════════════════════════════════════════════════
test("saudeValidar: validações de raiz (null, não-objeto, array, v diferente, gerado inválido, canais inválido)", () => {
  const helpers = loadVodHelpers();
  assert.equal(typeof helpers.saudeValidar, "function", "saudeValidar deve ser exportada");

  assert.equal(helpers.saudeValidar(null), null);
  assert.equal(helpers.saudeValidar("x"), null);
  assert.equal(helpers.saudeValidar([]), null);
  assert.equal(helpers.saudeValidar({}), null);
  assert.equal(helpers.saudeValidar({ v: 2, gerado: 1793600000, canais: {} }), null);

  // gerado inválido: NaN, 0, negativo, texto
  assert.equal(helpers.saudeValidar({ v: 1, gerado: NaN, canais: {} }), null);
  assert.equal(helpers.saudeValidar({ v: 1, gerado: 0, canais: {} }), null);
  assert.equal(helpers.saudeValidar({ v: 1, gerado: -100, canais: {} }), null);
  assert.equal(helpers.saudeValidar({ v: 1, gerado: "1793600000", canais: {} }), null);

  // canais não é objeto simples (array)
  assert.equal(helpers.saudeValidar({ v: 1, gerado: 1793600000, canais: [] }), null);
});

test("saudeValidar: filtra entradas inválidas mantendo as válidas e trunca/converte m", () => {
  const helpers = loadVodHelpers();
  const dados = {
    v: 1,
    gerado: 1793600000,
    canais: {
      "espn hd": { e: "removido", d: 1793560000, m: "xui-not_in_bouquet" },
      "sporty net": { e: "invalido", d: 1793590000, m: "status errado" }, // e inválido: descartada
      "canal d texto": { e: "removido", d: "1793590000", m: "d em texto" }, // d texto: descartada
      "": { e: "removido", d: 1793590000, m: "chave vazia" }, // chave vazia: descartada
      "   ": { e: "removido", d: 1793590000, m: "chave espacos" }, // chave espaços: descartada
      "canal m gigante": { e: "instavel", d: 1793590000, m: "a".repeat(120) }, // m > 80: truncado
      "canal m numero": { e: "vivo", d: 1793590000, m: 42 } // m número: vira texto
    }
  };

  const res = helpers.saudeValidar(dados);
  assert.ok(res, "resultado não deve ser nulo");
  assert.equal(res.gerado, 1793600000);
  assert.ok(res.canais instanceof Map, "canais deve ser um Map");

  // Válido mantido
  assert.deepEqual(res.canais.get("espn hd"), { e: "removido", d: 1793560000, m: "xui-not_in_bouquet" });
  // Inválidos descartados
  assert.equal(res.canais.has("sporty net"), false);
  assert.equal(res.canais.has("canal d texto"), false);
  assert.equal(res.canais.has(""), false);
  // m truncado a 80
  const gigante = res.canais.get("canal m gigante");
  assert.ok(gigante);
  assert.equal(gigante.m.length, 80);
  assert.equal(gigante.m, "a".repeat(80));
  // m convertido para texto
  const numero = res.canais.get("canal m numero");
  assert.ok(numero);
  assert.equal(numero.m, "42");
});

// ═══════════════════════════════════════════════════════════════
// 3. FUNÇÃO PURA: saudeEscondidos
// ═══════════════════════════════════════════════════════════════
test("saudeEscondidos: regras de idade do arquivo, tolerância de 6h, status permitido e validado nulo", () => {
  const helpers = loadVodHelpers();
  assert.equal(typeof helpers.saudeEscondidos, "function", "saudeEscondidos deve ser exportada");

  // validado nulo -> Set vazio
  const nulo = helpers.saudeEscondidos(null, 1793600000 * 1000);
  assert.ok(nulo instanceof Set);
  assert.equal(nulo.size, 0);

  const gerado = 1793600000;
  const mapa = new Map();
  // removido há 5h 59min (21540 s)
  mapa.set("ch 5h59", { e: "removido", d: gerado - 21540, m: "recente" });
  // removido há 6h 01min (21660 s)
  mapa.set("ch 6h01", { e: "removido", d: gerado - 21660, m: "antigo" });
  // instável há 10h (36000 s)
  mapa.set("ch instavel", { e: "instavel", d: gerado - 36000, m: "timeout" });
  // vivo há 10h
  mapa.set("ch vivo", { e: "vivo", d: gerado - 36000, m: "ok" });

  const validado = { gerado, canais: mapa };

  // Arquivo recente (< 48h): gerado agora
  const nowMs = gerado * 1000;
  const res = helpers.saudeEscondidos(validado, nowMs);
  assert.ok(res instanceof Set);
  assert.equal(res.has("ch 5h59"), false, "removido há 5h59 não deve ser escondido");
  assert.equal(res.has("ch 6h01"), true, "removido há 6h01 deve ser escondido");
  assert.equal(res.has("ch instavel"), false, "instavel nunca deve ser escondido");
  assert.equal(res.has("ch vivo"), false, "vivo nunca deve ser escondido");
  assert.equal(res.size, 1);

  // Arquivo velho (> 48h): nowMs/1000 - gerado > 48 * 3600
  const nowVelhoMs = (gerado + 48 * 3600 + 1) * 1000;
  const resVelho = helpers.saudeEscondidos(validado, nowVelhoMs);
  assert.ok(resVelho instanceof Set);
  assert.equal(resVelho.size, 0, "arquivo velho com mais de 48h deve resultar em Set vazio (falha aberta)");
});

// ═══════════════════════════════════════════════════════════════
// 4. FUNÇÃO PURA: saudeFiltrarCanais
// ═══════════════════════════════════════════════════════════════
test("saudeFiltrarCanais: mesma referência se vazio/não-array/>70%, filtro normal e normalização de chave", () => {
  const helpers = loadVodHelpers();
  assert.equal(typeof helpers.saudeFiltrarCanais, "function", "saudeFiltrarCanais deve ser exportada");

  const listaOriginal = [
    { id: 1, name: "ESPN HD" },
    { id: 2, name: "SporTV" },
    { id: 3, name: "Telecine Premium" },
    { id: 4, name: "HBO" },
    { id: 5, name: "Séries Premiére 1 HD" },
    { id: 6, name: "Canal Brasil" },
    { id: 7, name: "Globo SP" },
    { id: 8, name: "SBT" },
    { id: 9, name: "Band" },
    { id: 10, name: "Record" }
  ];

  // escondidos vazio -> mesma referência
  assert.equal(helpers.saudeFiltrarCanais(listaOriginal, new Set()), listaOriginal);
  assert.equal(helpers.saudeFiltrarCanais(listaOriginal, null), listaOriginal);

  // canais não-array
  assert.equal(helpers.saudeFiltrarCanais(null, new Set(["espn hd"])), null);
  assert.equal(helpers.saudeFiltrarCanais("canais", new Set(["espn hd"])), "canais");

  // Esconder 80% (8 de 10) -> devolve a mesma referência (falha aberta)
  const esconder80 = new Set([
    "espn hd", "sportv", "telecine premium", "hbo",
    "series premiere 1 hd", "canal brasil", "globo sp", "sbt"
  ]);
  const res80 = helpers.saudeFiltrarCanais(listaOriginal, esconder80);
  assert.equal(res80, listaOriginal, "esconder mais de 70% deve manter lista intacta (falha aberta)");

  // Esconder 40% (4 de 10) -> novo array só com os restantes
  const esconder40 = new Set(["espn hd", "sportv", "telecine premium", "hbo"]);
  const res40 = helpers.saudeFiltrarCanais(listaOriginal, esconder40);
  assert.notEqual(res40, listaOriginal, "deve retornar um novo array");
  assert.equal(res40.length, 6);
  assert.deepEqual(res40.map(c => c.name), [
    "Séries Premiére 1 HD", "Canal Brasil", "Globo SP", "SBT", "Band", "Record"
  ]);

  // Canal sem name e nome com acento/caixa diferente
  const listaMista = [
    { id: 101, name: "  SÉRIES  PREMIÈRE  1 HD " },
    { id: 102 }, // sem name
    { id: 103, name: null }, // name null
    { id: 104, name: "ESPN HD" }
  ];
  const esconderMisto = new Set(["series premiere 1 hd"]);
  const resMisto = helpers.saudeFiltrarCanais(listaMista, esconderMisto);
  assert.equal(resMisto.length, 3);
  assert.equal(resMisto[0].id, 102);
  assert.equal(resMisto[1].id, 103);
  assert.equal(resMisto[2].id, 104);
});

// ═══════════════════════════════════════════════════════════════
// 5. REDE & RESILIÊNCIA: saudeBaixar
// ═══════════════════════════════════════════════════════════════
test("saudeBaixar: HTTP 500, JSON quebrado, erro de rede, timeout > 8s mantêm estado anterior sem erro", async () => {
  const ctx = loadVodHelpers();
  ctx.AbortController = AbortController;

  const validadoAntigo = {
    gerado: Math.floor(Date.now() / 1000),
    canais: new Map([["espn hd", { e: "removido", d: Math.floor(Date.now() / 1000) - 30000, m: "old" }]])
  };
  vm.runInContext(`
    _saude.validado = { gerado: ${validadoAntigo.gerado}, canais: new Map([["espn hd", { e: "removido", d: ${validadoAntigo.gerado - 30000}, m: "old" }]]) };
    _saude.escondidos = new Set(["espn hd"]);
    _saude.versao = 1;
  `, ctx);

  // 1. HTTP 500
  ctx.fetch = async () => ({ ok: false, status: 500 });
  await vm.runInContext("saudeBaixar()", ctx);
  assert.equal(vm.runInContext("_saude.versao", ctx), 1);
  assert.equal(vm.runInContext("_saude.escondidos.has('espn hd')", ctx), true);

  // 2. JSON quebrado
  ctx.fetch = async () => ({ ok: true, json: async () => { throw new Error("JSON quebrado"); } });
  await vm.runInContext("saudeBaixar()", ctx);
  assert.equal(vm.runInContext("_saude.versao", ctx), 1);

  // 3. fetch que lança erro de rede
  ctx.fetch = async () => { throw new Error("Falha de rede"); };
  await vm.runInContext("saudeBaixar()", ctx);
  assert.equal(vm.runInContext("_saude.versao", ctx), 1);

  // 4. Timeout / cancelamento do AbortController
  ctx.fetch = async (_url, { signal }) => {
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      setTimeout(() => reject(new Error("timeout")), 20);
    });
  };
  await vm.runInContext("saudeBaixar()", ctx);
  assert.equal(vm.runInContext("_saude.versao", ctx), 1);
});

test("saudeBaixar: sucesso atualiza validado, escondidos, incrementa versao, salva cache e notifica", async () => {
  const ctx = loadVodHelpers();
  ctx.AbortController = AbortController;

  let notifyCalled = 0;
  ctx._notify = () => { notifyCalled++; };

  const agoraSec = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    gerado: agoraSec,
    canais: {
      "espn hd": { e: "removido", d: agoraSec - 25000, m: "xui-not_in_bouquet" }
    }
  };

  ctx.fetch = async () => ({
    ok: true,
    json: async () => payload
  });

  await vm.runInContext("saudeBaixar()", ctx);
  assert.equal(vm.runInContext("_saude.versao", ctx), 1);
  assert.equal(vm.runInContext("_saude.escondidos.has('espn hd')", ctx), true);
  assert.ok(notifyCalled >= 1, "_notify deve ter sido chamado após alteração nos escondidos");

  // Verifica que salvou no localStorage
  const rawCache = ctx.localStorage.getItem("sint_saude_cache");
  assert.ok(rawCache, "cache deve ser gravado");
  const parsedCache = JSON.parse(rawCache);
  assert.equal(parsedCache.data.v, 1);
});

// ═══════════════════════════════════════════════════════════════
// 6. STORAGE & DESLIGAMENTO (sint_saude_off e ?saude=0)
// ═══════════════════════════════════════════════════════════════
test("localStorage indisponível ou lançando não quebra saudeCarregarCache nem saudeBaixar", async () => {
  const ctx = loadVodHelpers();
  ctx.AbortController = AbortController;
  ctx.localStorage = {
    getItem: () => { throw new Error("SecurityError: localStorage blocked"); },
    setItem: () => { throw new Error("QuotaExceededError"); }
  };

  assert.doesNotThrow(() => {
    vm.runInContext("saudeCarregarCache()", ctx);
  });

  const agoraSec = Math.floor(Date.now() / 1000);
  ctx.fetch = async () => ({
    ok: true,
    json: async () => ({
      v: 1,
      gerado: agoraSec,
      canais: { "espn hd": { e: "removido", d: agoraSec - 25000, m: "ok" } }
    })
  });

  await assert.doesNotReject(async () => {
    await vm.runInContext("saudeBaixar()", ctx);
  });
});

test("desligamento: sint_saude_off=1 ou ?saude=0 na URL não esconde nenhum canal", () => {
  // Teste 1: localStorage com sint_saude_off = "1"
  const ctx1 = loadVodHelpers();
  const listaCanais = [
    { id: 1, name: "ESPN HD" },
    { id: 2, name: "SporTV" },
    { id: 3, name: "Globo" }
  ];
  vm.runInContext(`_state.channels = ${JSON.stringify(listaCanais)}`, ctx1);
  ctx1.localStorage.setItem("sint_saude_off", "1");
  const agoraSec = Math.floor(Date.now() / 1000);
  const cacheData = {
    ts: Date.now(),
    data: {
      v: 1,
      gerado: agoraSec,
      canais: { "espn hd": { e: "removido", d: agoraSec - 25000, m: "ok" } }
    }
  };
  ctx1.localStorage.setItem("sint_saude_cache", JSON.stringify(cacheData));
  vm.runInContext("saudeCarregarCache()", ctx1);
  const canais1 = vm.runInContext("getChannels()", ctx1);
  assert.ok(canais1.some(c => c.name && c.name.toLowerCase().includes("espn")), "com sint_saude_off=1, canal não deve ser escondido");

  // Teste 2: ?saude=0 na URL
  const ctx2 = loadVodHelpers();
  vm.runInContext(`_state.channels = ${JSON.stringify(listaCanais)}`, ctx2);
  ctx2.window.location.search = "?saude=0";
  ctx2.localStorage.setItem("sint_saude_cache", JSON.stringify(cacheData));
  vm.runInContext("saudeCarregarCache()", ctx2);
  const canais2 = vm.runInContext("getChannels()", ctx2);
  assert.ok(canais2.some(c => c.name && c.name.toLowerCase().includes("espn")), "com ?saude=0, canal não deve ser escondido");

  // Contra-teste: sem desligamento, o canal DEVE ser escondido
  const ctx3 = loadVodHelpers();
  vm.runInContext(`_state.channels = ${JSON.stringify(listaCanais)}`, ctx3);
  ctx3.localStorage.setItem("sint_saude_cache", JSON.stringify(cacheData));
  vm.runInContext("saudeCarregarCache()", ctx3);
  const canais3 = vm.runInContext("getChannels()", ctx3);
  assert.equal(canais3.some(c => c.name && c.name.toLowerCase().includes("espn")), false, "sem desligamento, canal morto deve ser escondido");
});
// ═══════════════════════════════════════════════════════════════
// 7. LIGAÇÕES NO HTML
// ═══════════════════════════════════════════════════════════════
test("ligações no HTML: SAUDE_URL, SAUDE_CACHE_KEY, getChannels com memoização e visibilitychange", () => {
  assert.match(html, /const SAUDE_URL = "https:\/\/raw\.githubusercontent\.com\/Guaitolinii\/visual-craft-assistant\/vod-data\/canais-saude\.json";/);
  assert.match(html, /const SAUDE_CACHE_KEY = "sint_saude_cache";/);
  assert.match(html, /saudeFiltrarCanais\(/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /saudeBaixar\(\)/);
  assert.match(html, /saudeCarregarCache\(\)/);

  // Aba Jogos: aviso novo quando nenhum canal estiver disponível
  assert.match(html, /showToast\("Nenhum canal disponível para esse jogo agora\."\)/);
});

test("regressão: aplicar o cache na inicialização invalida a memória do getChannels", () => {
  const m = html.match(/function saudeCarregarCache\(\) \{[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(m, "saudeCarregarCache não encontrada");
  assert.match(m[0], /_saude\.versao\+\+/, "sem incrementar a versão, uma lista calculada antes do cache ficaria sem filtro");
});

test("o aviso da aba Jogos sem canal viável usa o texto novo e não sobrou código comentado", () => {
  assert.match(html, /showToast\("Nenhum canal disponível para esse jogo agora\."\)/);
  assert.doesNotMatch(html, /\/\/ showToast\("Esse canal não está na sua lista\."\)/);
});
