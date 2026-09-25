// sintoniza-tv-app/src/main.test.ts
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');

test('main.tsx chama init() da Norigin Spatial Navigation antes de montar o app', () => {
  // Sem isso, TODO uso de useFocusable() em produção quebra com "Cannot
  // read property 'measureLayout' of undefined" (confirmado ao vivo na
  // TV) - a biblioteca só cria o adaptador de layout dentro do próprio
  // init(). Os arquivos de teste de componente chamam isso sozinhos no
  // beforeEach, o que mascarava a falta dessa chamada no app de verdade.
  expect(mainSrc).toMatch(/init\(\s*\{[^}]*\}\s*\)/);
  expect(mainSrc).toContain("from '@noriginmedia/norigin-spatial-navigation'");
});

test('main.tsx não usa a propriedade CSS "inset" (sem suporte no Chromium desta TV)', () => {
  expect(mainSrc).not.toMatch(/inset\s*:/);
});
