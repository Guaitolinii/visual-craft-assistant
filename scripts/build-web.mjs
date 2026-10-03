// Build web do app: transforma o sintoniza-link.html no app de navegador (PWA) em <saida>/app/.
//   node scripts/build-web.mjs --out <pasta> [--offline] [--cache <pasta>]
// Gera: app/index.html, app/manifest.webmanifest, app/sw.js, app/icons/*, app/vendor/*
// (bibliotecas e fonte baixadas das versões fixas de web/vendor.json, com SHA-256 conferido).
// Não altera o sintoniza-link.html original.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectDefaults } from "./prepare-mobile.js";

const __filename = fileURLToPath(import.meta.url);
const RAIZ = path.join(path.dirname(__filename), "..");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Troca exatamente uma ocorrência (se o fonte mudar e o padrão sumir, o build falha em voz alta).
function trocarUma(html, padrao, novo, rotulo) {
  let total;
  if (typeof padrao === "string") total = html.split(padrao).length - 1;
  else total = (html.match(new RegExp(padrao.source, padrao.flags.replace("g", "") + "g")) || []).length;
  if (total !== 1) throw new Error(`build-web: "${rotulo}" encontrado ${total}x no sintoniza-link.html (esperado 1)`);
  return html.replace(padrao, () => novo);
}

// Obtém um arquivo de vendor: cache local (com hash conferido) ou download (conferido contra vendor.json).
async function obterVendor(item, { cacheDir, offline, stub }) {
  const doCache = path.join(cacheDir, item.arquivo);
  if (existsSync(doCache)) {
    const buf = readFileSync(doCache);
    if (sha256(buf) === item.sha256) return buf;
    if (offline && !stub) throw new Error(`build-web: ${item.arquivo} no cache não confere com o SHA-256 de vendor.json`);
  }
  if (offline) {
    if (stub) return Buffer.from(`/* ${item.arquivo}: arquivo de teste (build offline) */\n`);
    throw new Error(`build-web: ${item.arquivo} não está em ${cacheDir} e o build é offline`);
  }
  const resp = await fetch(item.url);
  if (!resp.ok) throw new Error(`build-web: falha ao baixar ${item.url} (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const hash = sha256(buf);
  if (hash !== item.sha256) throw new Error(`build-web: SHA-256 de ${item.arquivo} diferente do fixado em vendor.json (obtido ${hash})`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(doCache, buf);
  return buf;
}

// CSS local da fonte (um @font-face por subconjunto; a fonte é variável, vale de 400 a 700).
function cssDaFonte(fontes) {
  return fontes.arquivos
    .map((f) => `/* ${f.subconjunto} */\n@font-face {\n  font-family: '${fontes.familia}';\n  font-style: normal;\n  font-weight: ${fontes.peso};\n  font-display: swap;\n  src: url(${f.arquivo}) format('woff2');\n  unicode-range: ${f.unicodeRange};\n}\n`)
    .join("");
}

// Gera o app web em <outDir>/app/. Opções: offline (nunca usa a rede; bibliotecas vêm de cacheDir),
// cacheDir (padrão .web-cache/), vendorFile/sourceHtml (testes), stubVendor (só em teste: com
// offline, arquivo ausente vira um stub em vez de erro - a CLI nunca liga isto).
export async function buildWeb({ outDir, offline = false, cacheDir, vendorFile, sourceHtml, stubVendor = false } = {}) {
  if (!outDir) throw new Error("build-web: informe outDir");
  const cache = cacheDir || path.join(RAIZ, ".web-cache");
  const vendor = JSON.parse(readFileSync(vendorFile || path.join(RAIZ, "web", "vendor.json"), "utf8"));
  const appDir = path.join(outDir, "app");
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(path.join(appDir, "vendor"), { recursive: true });

  // 1) bibliotecas e fonte próprias em app/vendor/
  const opts = { cacheDir: cache, offline, stub: stubVendor };
  for (const s of vendor.scripts) writeFileSync(path.join(appDir, "vendor", s.arquivo), await obterVendor(s, opts));
  for (const f of vendor.fontes.arquivos) writeFileSync(path.join(appDir, "vendor", f.arquivo), await obterVendor(f, opts));
  writeFileSync(path.join(appDir, "vendor", "outfit.css"), cssDaFonte(vendor.fontes));
  const arquivo = (nome) => vendor.scripts.find((s) => s.nome === nome).arquivo;

  // 2) o HTML do app (LF no artefato)
  let html = readFileSync(sourceHtml || path.join(RAIZ, "sintoniza-link.html"), "utf8").replace(/\r\n/g, "\n");
  // (a) CDNs e Google Fonts -> arquivos próprios
  html = trocarUma(html, /[ \t]*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>\n/, "", "preconnect googleapis");
  html = trocarUma(html, /[ \t]*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin \/>\n/, "", "preconnect gstatic");
  const latin = vendor.fontes.arquivos.find((f) => f.subconjunto === "latin");
  html = trocarUma(
    html,
    /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Outfit[^"]*" \/>/,
    `<link rel="preload" href="/app/vendor/${latin.arquivo}" as="font" type="font/woff2" crossorigin />\n  <link rel="stylesheet" href="/app/vendor/outfit.css" />`,
    "folha de fontes",
  );
  html = trocarUma(html, '<script src="https://unpkg.com/lucide@latest"></script>', `<script src="/app/vendor/${arquivo("lucide")}"></script>`, "lucide");
  html = trocarUma(html, '<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>', `<script src="/app/vendor/${arquivo("hls.js")}"></script>`, "hls.js");
  html = trocarUma(html, '<script src="https://cdn.jsdelivr.net/npm/mpegts.js@latest"></script>', `<script src="/app/vendor/${arquivo("mpegts.js")}"></script>`, "mpegts.js");
  // (b) sem URLs padrão embutidas (o app web nunca leva listas do ambiente de build)
  html = injectDefaults(html, {});
  // (c) tags de PWA/iOS antes do primeiro <script> embutido
  const tags = [
    '<link rel="manifest" href="/app/manifest.webmanifest">',
    '<meta name="theme-color" content="#08080D">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="Sintoniza">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/app/icons/icon-180.png">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/app/icons/favicon-32.png">',
  ];
  if (!/^[ \t]*<script>/m.test(html)) throw new Error("build-web: nenhum <script> embutido encontrado no sintoniza-link.html");
  html = html.replace(/^([ \t]*)<script>/m, (m, ind) => tags.map((t) => `${ind}${t}\n`).join("") + m);
  // (d) marca o modo web
  html = trocarUma(html, '<html lang="pt-BR">', '<html lang="pt-BR" data-web-app="1">', "tag html");
  // (e) registro do service worker, só quando servido de /app/
  const registro =
    '<script>\nif ("serviceWorker" in navigator && /^\\/app(\\/|$)/.test(location.pathname)) {\n' +
    '  window.addEventListener("load", function () {\n' +
    '    navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(function () {});\n' +
    "  });\n}\n</script>\n";
  html = trocarUma(html, "</body>", registro + "</body>", "</body>");
  writeFileSync(path.join(appDir, "index.html"), html);

  // 3) manifest
  writeFileSync(path.join(appDir, "manifest.webmanifest"), readFileSync(path.join(RAIZ, "web", "manifest.template.json"), "utf8"));

  // 4) ícones
  cpSync(path.join(RAIZ, "web", "icons"), path.join(appDir, "icons"), { recursive: true });

  // 5) service worker (BUILD_ID = hash do index.html)
  const buildId = sha256(Buffer.from(html)).slice(0, 12);
  const icones = ["icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon-32.png"].map((i) => `/app/icons/${i}`);
  const shell = ["/app/", "/app/manifest.webmanifest", ...icones];
  const opcionais = [...vendor.scripts.map((s) => s.arquivo), "outfit.css", ...vendor.fontes.arquivos.map((f) => f.arquivo)].map((a) => `/app/vendor/${a}`);
  const sw = readFileSync(path.join(RAIZ, "web", "sw.template.js"), "utf8")
    .replace("__BUILD_ID__", () => buildId)
    .replace("__SHELL__", () => JSON.stringify(shell))
    .replace("__OPCIONAIS__", () => JSON.stringify(opcionais));
  writeFileSync(path.join(appDir, "sw.js"), sw);

  return { outDir, appDir, buildId, htmlBytes: Buffer.byteLength(html) };
}

function lerArgs(argv) {
  const a = { out: "dist-web", offline: false, cache: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--offline") a.offline = true;
    else if (argv[i] === "--cache") a.cache = argv[++i];
    else throw new Error(`argumento desconhecido: ${argv[i]}`);
  }
  return a;
}

// Só executa quando rodado direto (importar nos testes não gera nada).
const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(__filename)) {
  try {
    const a = lerArgs(process.argv.slice(2));
    const r = await buildWeb({ outDir: path.resolve(a.out), offline: a.offline, cacheDir: a.cache ? path.resolve(a.cache) : undefined });
    console.log(`[build-web] app web gerado em ${r.appDir} (build ${r.buildId}, index.html ${r.htmlBytes} bytes)`);
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  }
}
