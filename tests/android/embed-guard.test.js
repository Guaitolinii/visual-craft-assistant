import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Não há JDK nos testes: conferimos o código-fonte Java (lista de domínios, ligações e nomes que o JS usa).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const JAVA_DIR = path.join(ROOT, "android", "app", "src", "main", "java", "com", "sintoniza", "iptv");
const read = (name) => readFileSync(path.join(JAVA_DIR, name), "utf8");

function adDomains() {
  const src = read("EmbedGuard.java");
  const bloco = src.match(/AD_DOMAINS = \{([\s\S]*?)\};/);
  assert.ok(bloco, "lista AD_DOMAINS não encontrada");
  return [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("AD_DOMAINS: domínios válidos, minúsculos, sem repetição e sem nada que o app ou players legítimos precisem", () => {
  const lista = adDomains();
  assert.ok(lista.length >= 10);
  assert.equal(new Set(lista).size, lista.length, "domínio repetido");
  for (const d of lista) {
    assert.match(d, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `domínio inválido: ${d}`);
  }
  // CDNs, provedores de nuvem, Google/YouTube e os hosts do próprio projeto nunca podem entrar (quebrariam o app/players)
  const proibidos = ["google", "youtube", "googlevideo", "gstatic", "cloudflare", "amazonaws", "jsdelivr", "unpkg",
    "archive.org", "sintonizatv", "supabase", "xjet", "vidlink", "themoviedb", "tmdb", "github"];
  for (const d of lista) {
    for (const p of proibidos) assert.ok(!d.includes(p), `${d} contém "${p}"`);
  }
});

test("EmbedGuard: casa o domínio e subdomínios, nunca por sufixo de texto", () => {
  const src = read("EmbedGuard.java");
  assert.match(src, /h\.equals\(domain\) \|\| h\.endsWith\("\." \+ domain\)/);
  assert.match(src, /static volatile boolean active = false;/);
  assert.match(src, /static boolean isAllowedExternal\(Uri url\)/);
});

test("GuardedWebViewClient: só age com a guarda ligada; subframe segue; só o endereço do player abre fora", () => {
  const src = read("GuardedWebViewClient.java");
  assert.match(src, /class GuardedWebViewClient extends BridgeWebViewClient/);
  // anúncios: só com a guarda ligada
  assert.match(src, /shouldInterceptRequest[\s\S]*?EmbedGuard\.active[\s\S]*?EmbedGuard\.isAdHost\(/);
  assert.match(src, /return super\.shouldInterceptRequest\(view, request\)/);
  // navegação: guarda desligada = comportamento padrão do Capacitor
  assert.match(src, /if \(!EmbedGuard\.active\) return super\.shouldOverrideUrlLoading\(view, request\);/);
  assert.match(src, /if \(!request\.isForMainFrame\(\)\) return false;/);
  assert.match(src, /if \(EmbedGuard\.isAllowedExternal\(url\)\) return super\.shouldOverrideUrlLoading\(view, request\);/);
  // o último return da navegação descarta a abertura (true)
  assert.match(src, /isAllowedExternal\(url\)\) return super\.shouldOverrideUrlLoading\(view, request\);\s*return true;/);
});

test("MainActivity registra o plugin e troca o WebViewClient depois do super.onCreate", () => {
  const src = read("MainActivity.java");
  assert.match(src, /registerPlugin\(SintonizaEmbedPlugin\.class\);/);
  const iSuper = src.indexOf("super.onCreate(savedInstanceState);");
  const iClient = src.indexOf("getBridge().setWebViewClient(new GuardedWebViewClient(getBridge()));");
  assert.ok(iSuper > 0 && iClient > iSuper, "o client precisa ser trocado depois que o bridge existe");
});

test("plugin SintonizaEmbed: o nome e o método são os mesmos que o JS chama", () => {
  const plugin = read("SintonizaEmbedPlugin.java");
  assert.match(plugin, /@CapacitorPlugin\(name = "SintonizaEmbed"\)/);
  assert.match(plugin, /public void setGuard\(PluginCall call\)/);
  assert.match(plugin, /EmbedGuard\.allowUrl = call\.getString\("allowUrl", ""\);/);
  assert.match(plugin, /EmbedGuard\.active = Boolean\.TRUE\.equals\(call\.getBoolean\("active", false\)\);/);
  const html = readFileSync(path.join(ROOT, "sintoniza-link.html"), "utf8");
  assert.match(html, /callNativePlugin\("SintonizaEmbed", "setGuard", \{ active: !!active, allowUrl: allowUrl \|\| "" \}\)/);
});
