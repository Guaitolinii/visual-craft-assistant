// sintoniza-tv-app/src/lib/__syntax-check__.test.ts
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

// Roda DEPOIS de `npm run build` (não faz parte do `npm test` comum, que
// roda antes do build existir) - ver instrução de uso abaixo.
const distDir = path.join(__dirname, '..', '..', 'dist', 'assets');

describe.skipIf(!existsSync(distDir))('bundle final é compatível com o teto real desta TV (webOS ~6.x / Chromium ~79)', () => {
  test('todo chunk "-legacy" gerado pelo @vitejs/plugin-legacy tem sintaxe aceita até ES2019', () => {
    const files = require('node:fs').readdirSync(distDir).filter((f: string) => f.includes('-legacy') && f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(path.join(distDir, file), 'utf8');
      expect(() => acorn.parse(src, { ecmaVersion: 2019, sourceType: 'script', allowReturnOutsideFunction: true })).not.toThrow();
    }
  });
});
