import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWeb } from "../../scripts/build-web.mjs";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const origem = path.join(RAIZ, "sintoniza-link.html");
const origemAntes = createHash("sha256").update(readFileSync(origem)).digest("hex");

// Build offline: cache vazio de teste + arquivos de bibliotecas "de mentira" (nunca usa a rede)
const out = mkdtempSync(path.join(tmpdir(), "sint-web-"));
const cache = mkdtempSync(path.join(tmpdir(), "sint-web-cache-"));
const res = await buildWeb({ outDir: out, offline: true, cacheDir: cache, stubVendor: true });
const html = readFileSync(path.join(out, "app", "index.html"), "utf8");

test("o app web sai em /app/ com manifest, service worker e ícones", () => {
  for (const f of ["index.html", "manifest.webmanifest", "sw.js", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/favicon-32.png", "vendor/outfit.css", "vendor/lucide.min.js", "vendor/hls.min.js", "vendor/mpegts.js"]) {
    assert.ok(existsSync(path.join(out, "app", f)), f);
  }
});

test("tags de PWA e iOS", () => {
  assert.match(html, /<link rel="manifest" href="\/app\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#08080D">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Sintoniza">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/app\/icons\/icon-180\.png">/);
  assert.match(html, /navigator\.serviceWorker\.register\("\/app\/sw\.js"/);
  assert.match(html, /<html lang="pt-BR" data-web-app="1">/);
});

test("as tags de PWA vêm antes do primeiro script embutido", () => {
  const iTag = html.indexOf('<link rel="manifest"');
  const iScript = html.search(/^[ \t]*<script>/m);
  assert.ok(iTag > 0 && iTag < iScript);
});

test("nenhuma biblioteca vem de CDN @latest e nenhum segredo é embutido", () => {
  assert.doesNotMatch(html, /unpkg\.com|cdn\.jsdelivr\.net|@latest|fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(html, /__DEFAULT_CHANNELS_URL__|__DEFAULT_VOD_URL__/);
  assert.match(html, /\/app\/vendor\//);
});

test("o manifest abre em /app/ como app independente", () => {
  const m = JSON.parse(readFileSync(path.join(out, "app", "manifest.webmanifest"), "utf8"));
  assert.equal(m.start_url, "/app/");
  assert.equal(m.scope, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "pt-BR");
  assert.ok(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  for (const i of m.icons) assert.ok(existsSync(path.join(out, i.src.replace(/^\/app\//, "app/"))), i.src);
});

test("o service worker não cacheia API, proxy, listas nem streams", () => {
  const sw = readFileSync(path.join(out, "app", "sw.js"), "utf8");
  assert.match(sw, /\/api\//);
  assert.match(sw, /BUILD_ID/);
  assert.doesNotMatch(sw, /supabase\.co/); // chamadas ao backend não passam pelo cache
  assert.doesNotMatch(sw, /__BUILD_ID__|__SHELL__|__OPCIONAIS__/);
  assert.match(sw, /headers\.has\("range"\)/); // vídeo parcial vai direto à rede
  assert.match(sw, /url\.origin !== self\.location\.origin/); // outras origens ficam de fora
  assert.match(sw, new RegExp('BUILD_ID = "' + res.buildId + '"'));
});

test("o build reaproveita o arquivo do app sem tocar no original", () => {
  assert.ok(res.htmlBytes > 100000);
  assert.equal(createHash("sha256").update(readFileSync(origem)).digest("hex"), origemAntes);
});

test("a fonte própria vira CSS local com os dois subconjuntos", () => {
  const css = readFileSync(path.join(out, "app", "vendor", "outfit.css"), "utf8");
  assert.match(css, /font-family: 'Outfit'/);
  assert.match(css, /font-weight: 400 700/);
  assert.match(css, /src: url\(outfit-latin\.woff2\)/);
  assert.match(css, /src: url\(outfit-latin-ext\.woff2\)/);
  assert.doesNotMatch(css, /https?:/);
});

test("offline sem o arquivo no cache falha (sem stub) e o hash é conferido", async () => {
  const vazio = mkdtempSync(path.join(tmpdir(), "sint-web-vazio-"));
  await assert.rejects(buildWeb({ outDir: mkdtempSync(path.join(tmpdir(), "sint-web-o-")), offline: true, cacheDir: vazio }), /offline/);
  // cache com o conteúdo errado: recusa
  const ruim = mkdtempSync(path.join(tmpdir(), "sint-web-ruim-"));
  const vendor = JSON.parse(readFileSync(path.join(RAIZ, "web", "vendor.json"), "utf8"));
  writeFileSync(path.join(ruim, vendor.scripts[0].arquivo), "conteudo adulterado");
  await assert.rejects(buildWeb({ outDir: mkdtempSync(path.join(tmpdir(), "sint-web-o-")), offline: true, cacheDir: ruim }), /SHA-256/);
});

test("com cache íntegro (hash confere) o build offline funciona sem stub", async () => {
  // vendor de teste com conteúdo próprio e o hash correspondente
  const dir = mkdtempSync(path.join(tmpdir(), "sint-web-v-"));
  const conteudo = Buffer.from("console.log('lib');");
  const h = createHash("sha256").update(conteudo).digest("hex");
  const real = JSON.parse(readFileSync(path.join(RAIZ, "web", "vendor.json"), "utf8"));
  const v = {
    scripts: real.scripts.map((s) => ({ ...s, sha256: h })),
    fontes: { ...real.fontes, arquivos: real.fontes.arquivos.map((f) => ({ ...f, sha256: h })) },
  };
  const vf = path.join(dir, "vendor.json");
  writeFileSync(vf, JSON.stringify(v));
  const c = path.join(dir, "cache");
  mkdirSync(c);
  for (const s of v.scripts) writeFileSync(path.join(c, s.arquivo), conteudo);
  for (const f of v.fontes.arquivos) writeFileSync(path.join(c, f.arquivo), conteudo);
  const o = path.join(dir, "out");
  await buildWeb({ outDir: o, offline: true, cacheDir: c, vendorFile: vf });
  assert.equal(readFileSync(path.join(o, "app", "vendor", "hls.min.js"), "utf8"), "console.log('lib');");
});
