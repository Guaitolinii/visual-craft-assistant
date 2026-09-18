import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");

mkdirSync(WWW, { recursive: true });

copyFileSync(path.join(ROOT, "sintoniza-link.html"), path.join(WWW, "index.html"));
console.log("[prepare-mobile] sintoniza-link.html -> www/index.html");

const favicon = path.join(ROOT, "public", "favicon.ico");
if (existsSync(favicon)) {
  copyFileSync(favicon, path.join(WWW, "favicon.ico"));
  console.log("[prepare-mobile] public/favicon.ico -> www/favicon.ico");
}
