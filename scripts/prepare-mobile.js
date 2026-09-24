import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");

// Substitui os tokens de URL padrão pelo valor real (build de CI, via
// secrets) ou por string vazia (build sem secrets - comportamento idêntico
// ao onboarding em branco de hoje). Nunca lê nem escreve a credencial no
// arquivo-fonte versionado - só no www/ gerado, que build-mobile.yml sobe
// como artefato de download, não como commit.
export function injectDefaults(html, env) {
  return html
    .replaceAll("__DEFAULT_CHANNELS_URL__", env.DEFAULT_CHANNELS_URL || "")
    .replaceAll("__DEFAULT_VOD_URL__", env.DEFAULT_VOD_URL || "");
}

function main() {
  mkdirSync(WWW, { recursive: true });

  // Copia passando pelos tokens: o index.html gerado recebe as URLs padrão
  // do ambiente (ou "" quando não há secrets).
  const linkHtml = readFileSync(path.join(ROOT, "sintoniza-link.html"), "utf8");
  writeFileSync(path.join(WWW, "index.html"), injectDefaults(linkHtml, process.env));
  console.log("[prepare-mobile] sintoniza-link.html -> www/index.html");

  const favicon = path.join(ROOT, "public", "favicon.ico");
  if (existsSync(favicon)) {
    copyFileSync(favicon, path.join(WWW, "favicon.ico"));
    console.log("[prepare-mobile] public/favicon.ico -> www/favicon.ico");
  }
}

// Só executa a cópia quando rodado direto (node scripts/prepare-mobile.js);
// importar o módulo (nos testes) não mexe em www/. No Windows a letra do
// drive pode vir em caixa diferente, por isso a comparação ignora caixa lá.
const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(__filename)) {
  main();
}
