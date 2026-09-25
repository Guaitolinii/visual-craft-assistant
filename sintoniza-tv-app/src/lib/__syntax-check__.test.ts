// sintoniza-tv-app/src/lib/__syntax-check__.test.ts
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

// Roda DEPOIS de `npm run build` (não faz parte do `npm test` comum, que
// roda antes do build existir) - ver instrução de uso abaixo.
const distDir = path.join(__dirname, '..', '..', 'dist', 'assets');
const distIndexHtml = path.join(__dirname, '..', '..', 'dist', 'index.html');

test.skipIf(!existsSync(distIndexHtml))('dist/index.html referencia assets com caminho relativo, não absoluto', () => {
  // Confirmado ao vivo via o domínio Network do CDP: com caminho absoluto
  // ("/assets/..."), o app instalado (file:///.../applications/<id>/
  // index.html) tentava carregar file:///assets/... - a raiz do sistema
  // de arquivos do aparelho, não a pasta do app - e recebia
  // net::ERR_ACCESS_DENIED para TUDO (CSS e os dois scripts). Tela preta,
  // zero erro de JavaScript (o recurso nem chegava a carregar). Precisa
  // de base:'./' no vite.config.ts para isso nunca voltar.
  const html = readFileSync(distIndexHtml, 'utf8');
  const absoluteRefs = html.match(/(?:src|href)="\/assets\//g) || [];
  expect(absoluteRefs).toEqual([]);
});

describe.skipIf(!existsSync(distDir))('bundle final é compatível com o teto real desta TV (webOS ~6.x / Chromium ~79)', () => {
  test('todo chunk .js do build tem sintaxe aceita até ES2019', () => {
    // Sem "-legacy" no filtro: desde que tiramos o renderLegacyChunks (a
    // dança de detecção via SystemJS quebrava nesta TV - ver vite.config.ts),
    // existe um único conjunto de bundles, todos ES module.
    const files = require('node:fs').readdirSync(distDir).filter((f: string) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(path.join(distDir, file), 'utf8');
      expect(() => acorn.parse(src, { ecmaVersion: 2019, sourceType: 'module' })).not.toThrow();
    }
  });
});
