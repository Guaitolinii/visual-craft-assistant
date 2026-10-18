import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";
import { LINK_HTML_PATH, fakeStorage, plain } from "../ott/loadOtt.js";

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx, {
    filename: "resilience-helpers.js",
  });
  return ctx;
}

const html = readFileSync(LINK_HTML_PATH, "utf8");

// ─── 1. metaKey ───

test("metaKey: normaliza minúsculas, remove acentos e pontuação, tipos tv e movie diferem", () => {
  const { metaKey } = load();
  assert.equal(typeof metaKey, "function");

  // Hipótese do Amor! -> hipotese do amor
  assert.equal(metaKey("Hipótese do Amor!", "", "movie"), "hipotese do amor||movie");
  assert.equal(metaKey("Hipótese do Amor!", 2024, "movie"), "hipotese do amor|2024|movie");

  // Toy Story 5 [4k] (2026) vs toy story 5 com anos diferentes geram chaves diferentes
  const key1 = metaKey("Toy Story 5 [4k] (2026)", 2026, "movie");
  const key2 = metaKey("toy story 5", 2025, "movie");
  assert.notEqual(key1, key2);

  // tipo tv !== movie
  const keyMovie = metaKey("Planeta Terra", 2006, "movie");
  const keyTv = metaKey("Planeta Terra", 2006, "tv");
  assert.notEqual(keyMovie, keyTv);
  assert.equal(keyMovie, "planeta terra|2006|movie");
  assert.equal(keyTv, "planeta terra|2006|tv");

  // tipo 'series' normaliza para 'tv'
  assert.equal(metaKey("Planeta Terra", 2006, "series"), "planeta terra|2006|tv");
});

test("metaKey: entradas inválidas e títulos vazios devolvem string vazia", () => {
  const { metaKey } = load();
  assert.equal(metaKey("", 2026, "movie"), "");
  assert.equal(metaKey("   ", 2026, "movie"), "");
  assert.equal(metaKey("!!!", 2026, "movie"), "");
  assert.equal(metaKey(null, 2026, "movie"), "");
  assert.equal(metaKey(undefined, 2026, "movie"), "");
  assert.equal(metaKey(12345, 2026, "movie"), "");
  assert.equal(metaKey({}, 2026, "movie"), "");
  assert.equal(metaKey([], 2026, "movie"), "");
});

test("metaKey: anos inválidos (0, abc, 1800) geram campo de ano vazio na chave", () => {
  const { metaKey } = load();
  assert.equal(metaKey("Matrix", 0, "movie"), "matrix||movie");
  assert.equal(metaKey("Matrix", "abc", "movie"), "matrix||movie");
  assert.equal(metaKey("Matrix", 1800, "movie"), "matrix||movie");
  assert.equal(metaKey("Matrix", null, "movie"), "matrix||movie");
  assert.equal(metaKey("Matrix", undefined, "movie"), "matrix||movie");

  // Ano válido de 4 dígitos (1900-2100)
  assert.equal(metaKey("Matrix", 1999, "movie"), "matrix|1999|movie");
  assert.equal(metaKey("Matrix", "1999", "movie"), "matrix|1999|movie");
});

// ─── 2. metaCacheRead & metaCacheWrite ───

test("metaCacheRead/Write: grava e lê resultado positivo", () => {
  const { metaCacheRead, metaCacheWrite } = load();
  const storage = fakeStorage();
  const now = 1000000000;
  const meta = { c: "https://image.tmdb.org/t/p/w500/poster.jpg", s: "Sinopse do filme", n: 8.5 };

  metaCacheWrite(storage, "matrix|1999|movie", meta, now);
  const read = metaCacheRead(storage, "matrix|1999|movie", now);

  assert.deepEqual(plain(read), {
    c: "https://image.tmdb.org/t/p/w500/poster.jpg",
    s: "Sinopse do filme",
    n: 8.5,
    x: 0,
  });
});

test("metaCacheRead: vence após 14 dias (+1 ms)", () => {
  const { metaCacheRead, metaCacheWrite } = load();
  const storage = fakeStorage();
  const t0 = 1000000000;
  const catorzeDias = 14 * 24 * 60 * 60 * 1000; // 1209600000 ms

  metaCacheWrite(storage, "matrix|1999|movie", { c: "https://img.org/p.jpg", s: "S", n: 7 }, t0);

  // Exatamente aos 14 dias: ainda válido
  assert.ok(metaCacheRead(storage, "matrix|1999|movie", t0 + catorzeDias));

  // 14 dias + 1 ms: expirado
  assert.equal(metaCacheRead(storage, "matrix|1999|movie", t0 + catorzeDias + 1), null);
});

test("metaCacheRead: resultado negativo vence após 2 dias (+1 ms)", () => {
  const { metaCacheRead, metaCacheWrite } = load();
  const storage = fakeStorage();
  const t0 = 1000000000;
  const doisDias = 2 * 24 * 60 * 60 * 1000; // 172800000 ms

  metaCacheWrite(storage, "desconhecido||movie", { c: "", s: "", n: null, x: 1 }, t0);

  // Exatamente em 2 dias: válido
  const r = metaCacheRead(storage, "desconhecido||movie", t0 + doisDias);
  assert.ok(r);
  assert.equal(r.x, 1);

  // 2 dias + 1 ms: expirado
  assert.equal(metaCacheRead(storage, "desconhecido||movie", t0 + doisDias + 1), null);
});

test("metaCacheWrite: limite de 2500 entradas (grave 2505, os 5 mais antigos somem)", () => {
  const { metaCacheRead, metaCacheWrite } = load();
  const storage = fakeStorage();
  const baseTs = 1000000;

  for (let i = 1; i <= 2505; i++) {
    metaCacheWrite(storage, `item${i}||movie`, { c: `https://img.org/${i}.jpg`, s: `S${i}`, n: 5 }, baseTs + i);
  }

  const raw = JSON.parse(storage.getItem("sint_meta"));
  const keys = Object.keys(raw);
  assert.equal(keys.length, 2500);

  // Os primeiros 5 itens (mais antigos) devem ter sido descartados
  for (let i = 1; i <= 5; i++) {
    assert.equal(metaCacheRead(storage, `item${i}||movie`, baseTs + 3000), null, `item${i} deveria ter sido descartado`);
  }

  // Os itens 6 a 2505 continuam no cache
  assert.ok(metaCacheRead(storage, `item6||movie`, baseTs + 3000));
  assert.ok(metaCacheRead(storage, `item2505||movie`, baseTs + 3000));
});

test("metaCacheRead/Write: entradas inválidas, storage nulo/quebrado, JSON de lixo e __proto__", () => {
  const { metaCacheRead, metaCacheWrite } = load();

  // Storage nulo ou indefinido não quebra
  assert.equal(metaCacheRead(null, "key", 1000), null);
  assert.equal(metaCacheRead(undefined, "key", 1000), null);
  assert.doesNotThrow(() => metaCacheWrite(null, "key", { c: "" }, 1000));
  assert.doesNotThrow(() => metaCacheWrite(undefined, "key", { c: "" }, 1000));

  // JSON de lixo no storage -> devolve null
  const storageLixo = fakeStorage({ sint_meta: "{ lixo corrupto !@#$" });
  assert.equal(metaCacheRead(storageLixo, "key", 1000), null);

  // Chave inválida / __proto__
  const storageProto = fakeStorage();
  assert.equal(metaCacheRead(storageProto, "__proto__", 1000), null);
  metaCacheWrite(storageProto, "__proto__", { c: "https://evil.org/x.jpg" }, 1000);
  assert.equal(metaCacheRead(storageProto, "__proto__", 1000), null);
  const data = JSON.parse(storageProto.getItem("sint_meta") || "{}");
  assert.equal(Object.prototype.hasOwnProperty.call(data, "__proto__"), false);

  // Storage que lança em setItem (cota cheia) apaga metade das entradas mais antigas e tenta de novo
  let throwOnce = true;
  const quotaStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("QuotaExceededError");
      }
      this._data[k] = String(v);
    },
  };

  // Preenche algumas entradas
  for (let i = 1; i <= 10; i++) {
    quotaStorage._data.sint_meta = JSON.stringify({
      ...JSON.parse(quotaStorage._data.sint_meta || "{}"),
      [`k${i}||movie`]: { c: "x", s: "s", n: 1, t: i * 100 },
    });
  }

  // A escrita abaixo dispara cota cheia na primeira tentativa e recupera
  assert.doesNotThrow(() => {
    metaCacheWrite(quotaStorage, "k11||movie", { c: "x", s: "s", n: 1 }, 2000);
  });
  const recoveredData = JSON.parse(quotaStorage.getItem("sint_meta"));
  // Metade das entradas mais antigas foi apagada + a nova gravada
  assert.ok(Object.keys(recoveredData).length < 10);
  assert.ok(recoveredData["k11||movie"]);

  // Storage que lança sempre nunca quebra a execução
  const brokenStorage = {
    getItem() { return null; },
    setItem() { throw new Error("Storage quebrado"); },
  };
  assert.doesNotThrow(() => metaCacheWrite(brokenStorage, "k||movie", { c: "" }, 1000));
});

test("metaCache: a chave guardada não contém a URL do provedor nem usuário/senha", () => {
  const { metaKey, metaCacheWrite } = load();
  const storage = fakeStorage();

  const providerUrl = "http://xjet.fun:8080/movie/user123/pass456/999.mp4";
  const title = "Interestelar";
  const year = 2014;
  const key = metaKey(title, year, "movie");

  metaCacheWrite(storage, key, { c: "https://image.tmdb.org/t/p/w500/inter.jpg", s: "Espaço", n: 8.6 }, Date.now());

  const storedRaw = storage.getItem("sint_meta");
  assert.ok(!storedRaw.includes("xjet.fun"), "Não deve conter o domínio do provedor");
  assert.ok(!storedRaw.includes("user123"), "Não deve conter o usuário");
  assert.ok(!storedRaw.includes("pass456"), "Não deve conter a senha");
  assert.ok(!storedRaw.includes("8080"), "Não deve conter a porta do provedor");
});

// ─── 3. metaApplyToItem ───

test("metaApplyToItem: troca capa nos 3 campos, sinopse só se vazia, nota só se vazia/0", () => {
  const { metaApplyToItem } = load();
  assert.equal(typeof metaApplyToItem, "function");

  const original = {
    stream_id: 123,
    name: "Filme Teste",
    stream_icon: "http://provedor.fun/capa_velha.jpg",
    cover: "http://provedor.fun/capa_velha.jpg",
    movie_image: "http://provedor.fun/capa_velha.jpg",
    plot: "",
    rating: 0,
  };

  const meta = {
    c: "https://image.tmdb.org/t/p/w500/nova_capa.jpg",
    s: "Sinopse rica do TMDB",
    n: 8.7,
  };

  const applied = metaApplyToItem(original, meta);

  // Não muta o original
  assert.notEqual(applied, original);
  assert.equal(original.stream_icon, "http://provedor.fun/capa_velha.jpg");
  assert.equal(original.plot, "");
  assert.equal(original.rating, 0);

  // Substitui os 3 campos de capa
  assert.equal(applied.stream_icon, "https://image.tmdb.org/t/p/w500/nova_capa.jpg");
  assert.equal(applied.cover, "https://image.tmdb.org/t/p/w500/nova_capa.jpg");
  assert.equal(applied.movie_image, "https://image.tmdb.org/t/p/w500/nova_capa.jpg");

  // Substitui sinopse vazia e nota 0
  assert.equal(applied.plot, "Sinopse rica do TMDB");
  assert.equal(applied.rating, 8.7);
});

test("metaApplyToItem: preserva sinopse e nota existentes do provedor", () => {
  const { metaApplyToItem } = load();

  const original = {
    stream_id: 456,
    name: "Filme Já Descrito",
    stream_icon: "http://provedor.fun/velha.jpg",
    plot: "Sinopse original do provedor",
    rating: 6.5,
  };

  const meta = {
    c: "https://image.tmdb.org/t/p/w500/nova.jpg",
    s: "Sinopse do TMDB",
    n: 9.0,
  };

  const applied = metaApplyToItem(original, meta);

  assert.equal(applied.stream_icon, "https://image.tmdb.org/t/p/w500/nova.jpg");
  assert.equal(applied.plot, "Sinopse original do provedor", "Não deve sobrescrever sinopse não-vazia");
  assert.equal(applied.rating, 6.5, "Não deve sobrescrever nota maior que 0");
});

test("metaApplyToItem: capa vazia mantém a do provedor; meta nulo ou x devolve o item sem mutar", () => {
  const { metaApplyToItem } = load();

  const original = {
    stream_id: 789,
    name: "Sem Capa TMDB",
    stream_icon: "http://provedor.fun/provedor.jpg",
    cover: "http://provedor.fun/provedor.jpg",
    plot: "",
  };

  // Capa vazia
  const appliedCapaVazia = metaApplyToItem(original, { c: "", s: "Nova sinopse", n: 7 });
  assert.equal(appliedCapaVazia.stream_icon, "http://provedor.fun/provedor.jpg");
  assert.equal(appliedCapaVazia.cover, "http://provedor.fun/provedor.jpg");
  assert.equal(appliedCapaVazia.plot, "Nova sinopse");

  // Meta nulo ou indefinido devolve o item original
  assert.equal(metaApplyToItem(original, null), original);
  assert.equal(metaApplyToItem(original, undefined), original);

  // Meta negativo (x: 1) devolve o item original
  assert.equal(metaApplyToItem(original, { c: "", s: "", n: null, x: 1 }), original);
});

// ─── 4. Cliente em lote e entradas inválidas (servidor sem capa, capa http://, resultados faltantes, disjuntor) ───

test("cliente em lote: capa http:// é ignorada e capa sem https vira vazia", async () => {
  const metaClientMatch = html.match(/\/\/ ─── Cliente em lote do TMDB \(\/api\/meta\) ───[\s\S]*?function metaOnResolved\([\s\S]*?\n\}/);
  assert.ok(metaClientMatch, "Cliente em lote deve existir");
  const storage = fakeStorage({ sint_ott_token: "tok123" });
  const ctx = {
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    isWebApp: () => true,
    OTT_PANEL_URL: "https://sintonizatv.com.br",
    OTT_KEYS: { TOKEN: "sint_ott_token" },
    location: { origin: "https://meuapp.com" },
    localStorage: storage,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        resultados: [
          { achou: true, capa: "http://inseguro.org/capa.jpg", sinopse: "Sinopse", nota: 8 },
          { achou: true, sinopse: "Sem capa", nota: 7 },
        ]
      })
    }),
    document: { querySelectorAll: () => [], getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx);
  vm.runInContext(metaClientMatch[0], ctx);

  ctx.metaQueue({ name: "Filme Http", year: 2020 }, "movie");
  ctx.metaQueue({ name: "Filme Sem Capa", year: 2021 }, "movie");

  await new Promise((r) => setTimeout(r, 20));

  const readHttp = ctx.metaCacheRead(storage, "filme http|2020|movie", Date.now());
  assert.ok(readHttp);
  assert.equal(readHttp.c, "", "Capa http:// deve ser descartada (fica vazia)");

  const readSemCapa = ctx.metaCacheRead(storage, "filme sem capa|2021|movie", Date.now());
  assert.ok(readSemCapa);
  assert.equal(readSemCapa.c, "", "Resultado sem capa fica com c vazio");
});

test("cliente em lote: lista resultados menor que a enviada não grava no cache para os faltantes", async () => {
  const metaClientMatch = html.match(/\/\/ ─── Cliente em lote do TMDB \(\/api\/meta\) ───[\s\S]*?function metaOnResolved\([\s\S]*?\n\}/);
  const storage = fakeStorage({ sint_ott_token: "tok123" });
  let timerCb = null;
  const ctx = {
    setTimeout: (fn) => { timerCb = fn; return 1; },
    clearTimeout: () => {},
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    isWebApp: () => true,
    OTT_PANEL_URL: "https://sintonizatv.com.br",
    OTT_KEYS: { TOKEN: "sint_ott_token" },
    location: { origin: "https://meuapp.com" },
    localStorage: storage,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        // Enviou 2, mas o servidor só devolveu 1 resultado
        resultados: [
          { achou: true, capa: "https://tmdb.org/1.jpg", sinopse: "S1" }
        ]
      })
    }),
    document: { querySelectorAll: () => [], getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx);
  vm.runInContext(metaClientMatch[0], ctx);

  ctx.metaQueue({ name: "Item Um", year: 2020 }, "movie");
  ctx.metaQueue({ name: "Item Faltante", year: 2021 }, "movie");
  // Dispara o flush após os 2 itens estarem na fila
  if (timerCb) timerCb();

  await new Promise((r) => setTimeout(r, 20));

  assert.ok(ctx.metaCacheRead(storage, "item um|2020|movie", Date.now()));
  assert.equal(ctx.metaCacheRead(storage, "item faltante|2021|movie", Date.now()), null, "Item faltante não deve ser gravado");
});
test("cliente em lote: erro 401/403/429/5xx ou erro de rede dispara disjuntor de 60s sem gravar cache", async () => {
  const metaClientMatch = html.match(/\/\/ ─── Cliente em lote do TMDB \(\/api\/meta\) ───[\s\S]*?function metaOnResolved\([\s\S]*?\n\}/);
  const storage = fakeStorage({ sint_ott_token: "tok123" });
  let fetchAttempts = 0;
  const ctx = {
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    isWebApp: () => true,
    OTT_PANEL_URL: "https://sintonizatv.com.br",
    OTT_KEYS: { TOKEN: "sint_ott_token" },
    location: { origin: "https://meuapp.com" },
    localStorage: storage,
    fetch: async () => {
      fetchAttempts++;
      return { ok: false, status: 503, text: async () => "Unavailable" };
    },
    document: { querySelectorAll: () => [], getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(extractInlineScriptById(LINK_HTML_PATH, "resilience-helpers"), ctx);
  vm.runInContext(metaClientMatch[0] + "\n;this.getPausa = () => _metaPausaAte;", ctx);

  const before = Date.now();
  ctx.metaQueue({ name: "Filme Erro", year: 2020 }, "movie");
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(fetchAttempts, 1);
  assert.ok(ctx.getPausa() >= before + 59000, "Disjuntor deve pausar por ~60s");
  assert.equal(ctx.metaCacheRead(storage, "filme erro|2020|movie", Date.now()), null);

  ctx.metaQueue({ name: "Outro Filme", year: 2020 }, "movie");
  assert.equal(fetchAttempts, 1, "Não deve chamar fetch enquanto o disjuntor estiver ativo");
});

// ─── 5. Ligações no sintoniza-link.html ───

test("ligações no sintoniza-link.html: vodCardHtml tem data-meta-key e usa poster do cache", () => {
  const vodCardMatch = html.match(/function vodCardHtml\([\s\S]*?\{([\s\S]*?)\n\}/);
  assert.ok(vodCardMatch, "vodCardHtml deve existir no HTML");
  assert.match(vodCardMatch[1], /data-meta-key=/, "vodCardHtml deve conter data-meta-key=");
});

test("ligações no sintoniza-link.html: cliente em lote existe com disjuntor e IntersectionObserver", () => {
  assert.match(html, /function metaQueue\(/, "deve existir function metaQueue(");
  assert.match(html, /function metaFlush\(/, "deve existir function metaFlush(");
  assert.match(html, /_metaPausaAte/, "deve existir a variável _metaPausaAte para o disjuntor");
  assert.match(html, /IntersectionObserver[\s\S]*?rootMargin:\s*['"]200px['"]/, "deve configurar IntersectionObserver com rootMargin: '200px'");
});

test("ligações no sintoniza-link.html: openVodModal chama metaQueue e usa cache imediato", () => {
  const openModalMatch = html.match(/async function openVodModal\([\s\S]*?\{([\s\S]*?)\n\}/);
  assert.ok(openModalMatch, "openVodModal deve existir no HTML");
  assert.match(openModalMatch[1], /metaQueue\(/, "openVodModal deve chamar metaQueue(");
});

test("ligações no sintoniza-link.html: corpo do POST usa text/plain e /api/meta?t=", () => {
  assert.match(html, /["']Content-Type["']:\s*["']text\/plain["']/, "deve enviar Content-Type: text/plain");
  assert.match(html, /\/api\/meta\?t=/, "deve chamar o endpoint /api/meta?t=");
});

test("lote do cliente é 12 (24 estourava o limite de subrequisições do servidor) e falha transitória do servidor não vira cache negativo", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  assert.match(html, /const META_BATCH_MAX = 12;/);
  assert.match(html, /_metaQueue\.splice\(0, META_BATCH_MAX\)/);
  assert.match(html, /if \(r && r\.erro\) continue;/);
});
