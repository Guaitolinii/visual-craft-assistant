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
//
// O token fica dentro de um literal de string JS ("..."), então o valor é
// escapado para esse contexto: JSON.stringify cuida de aspas, barra
// invertida e quebras de linha, e "<" vira < para um "</script>" no
// valor não fechar a tag. A substituição usa a forma com função: com uma
// string, replaceAll interpretaria "$$", "$&" etc. e corromperia uma senha
// com "$" sem erro nenhum.
function escapeForJsString(value) {
  return JSON.stringify(String(value)).slice(1, -1).replace(/</g, "\\u003c");
}

export function injectDefaults(html, env) {
  const channels = escapeForJsString(env.DEFAULT_CHANNELS_URL || "");
  const vod = escapeForJsString(env.DEFAULT_VOD_URL || "");
  return html
    .replaceAll("__DEFAULT_CHANNELS_URL__", () => channels)
    .replaceAll("__DEFAULT_VOD_URL__", () => vod);
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
