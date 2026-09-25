// sintoniza-tv-app/scripts/package-tv.mjs
// Builda com Vite e organiza dist/ para o ares-package/tizen package
// pegarem exatamente como pegam hoje o sintoniza-tv/ vanilla: appinfo.json,
// config.xml e icon.png precisam estar ao lado do index.html gerado.
import { execSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('> vite build');
execSync('npx vite build', { cwd: root, stdio: 'inherit' });

for (const file of ['appinfo.json', 'config.xml']) {
  copyFileSync(path.join(root, file), path.join(root, 'dist', file));
}
copyFileSync(path.join(root, 'public', 'icon.png'), path.join(root, 'dist', 'icon.png'));

console.log('dist/ pronta para: npx -y -p @webos-tools/cli ares-package dist -o "app tv"');
