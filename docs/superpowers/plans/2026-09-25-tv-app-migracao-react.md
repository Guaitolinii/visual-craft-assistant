# Sintoniza TV — Migração para React/Preact + Vite Implementation Plan

> **Para agentes executores:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.
>
> **⚠️ NÃO EXECUTAR AINDA.** Este plano existe para ficar **engatilhado** — pronto para disparar quando o Gustavo decidir. Ele foi escrito depois de dois incidentes reais no app vanilla (v9: navegação por D-pad presa dentro de um campo de texto; depois, um boot inteiro quebrado por uma única linha de sintaxe incompatível em 70KB de JavaScript escrito à mão). A causa de fundo dos dois foi a mesma: **manter, à mão, um motor de foco e um limite de compatibilidade de JavaScript que ninguém consegue verificar de forma confiável olhando o código.** Este plano troca isso por ferramentas que fazem essa verificação sozinhas, sempre.
>
> Antes de disparar: reler `docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md` (o incidente mais recente) para confirmar que a causa raiz de lá já foi corrigida OU que este plano a resolve de vez (ele resolve — ver Tarefa 6).

**Goal:** Substituir o app de TV vanilla (`sintoniza-tv/sintoniza-tv.html`, 2500+ linhas escritas à mão) por um app React (ou Preact, ver Decisão 2) construído com Vite, mantendo os dois pacotes de saída (`.ipk` para LG webOS, `.wgt` para Samsung Tizen) gerados pelas MESMAS ferramentas de hoje (`ares-package`, `tizen package`) — só o que tem DENTRO do pacote muda.

**Architecture:** Um sub-projeto novo e independente (`sintoniza-tv-app/`, com seu próprio `package.json`/`node_modules`/`vite.config.ts` — não mexe no `package.json` da raiz nem no app React que já existe em `src/` para o Lovable). Componentes React fazem a interface; **Norigin Spatial Navigation** substitui o motor de D-pad escrito à mão; `@vitejs/plugin-legacy` compila automaticamente para o Chromium real desta TV (~79, ver `docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md`, seção 1.1) em vez de depender de alguém lembrar manualmente quais recursos de JS são seguros. A lógica pura (parsing de M3U, sanitização, helpers de EPG/Xtream) é portada com o MESMO comportamento e a MESMA suíte de testes de hoje, só migrando de "função solta num `<script>`" para "módulo TypeScript importável".

**Tech Stack:** React 19.2 (ou Preact 10 + `preact/compat`, ver Decisão 2) + TypeScript + Vite 8 + `@vitejs/plugin-legacy` + `@noriginmedia/norigin-spatial-navigation` + Vitest (testes de componente) + hls.js/mpegts.js (via npm em vez de CDN) + as mesmas ferramentas de empacotamento de hoje (`@webos-tools/cli`/`ares-package`, `tizen-studio`/`tizen package`).

---

## Decisões de arquitetura (leia antes de tocar em código)

### Decisão 1 — Por que trocar de arquitetura, e por que React já não é tecnologia nova neste projeto

Os dois incidentes documentados em `docs/superpowers/plans/2026-09-24-tv-app-reconstrucao.md` e `docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md` têm uma causa estrutural comum: um arquivo HTML de 2500+ linhas, sem bundler, onde:
- não existe verificação automática de que o JavaScript escrito é compatível com o motor real da TV (um recurso do ES2018/2019 em qualquer lugar do arquivo quebra o arquivo INTEIRO, silenciosamente);
- o motor de navegação por D-pad é uma reimplementação caseira de um problema que a indústria inteira já resolveu (ver pesquisa no documento de 25/09, seção 2.1).

**Este projeto já tem React instalado e em uso** — o app companion do Lovable, em `src/`, é um app TanStack Start + React 19.2 + Vite 8 (`package.json` da raiz: `"react": "^19.2.0"`, `"vite": "8.1.5"`, `"@vitejs/plugin-react": "^5.2.0"`). **Não estamos trazendo uma tecnologia desconhecida para o projeto** — só nunca foi usada para o app de TV. Importante: **o sub-projeto novo da TV NÃO vai usar o `vite.config.ts` da raiz nem o app TanStack Start** — aquele projeto é SSR (renderizado no servidor, roteamento em arquivo, integração com Cloudflare) e o próprio comentário no topo dele avisa "não adicione plugins manualmente ou o app quebra com plugins duplicados". A TV precisa do oposto: um bundle 100% estático, sem servidor, que vira um `.ipk`/`.wgt` — por isso ela ganha seu PRÓPRIO `package.json` e `vite.config.ts`, isolado, com sua própria versão de React/Vite (podem até divergir da raiz se um dia for preciso, mas por consistência este plano usa as mesmas versões já validadas no projeto).

### Decisão 2 — React ou Preact?

Pesquisei isso especificamente porque hardware de TV é fraco (CPU single-core, VRAM apertada) e o controle remoto dispara 15-30 eventos de tecla por segundo em uso normal — recomputar a árvore inteira de componentes a cada tecla é um jeito garantido de sentir atraso. Fonte: [Optimizing Performance in SmartTV Apps — TO THE NEW](https://www.tothenew.com/blog/optimizing-performance-in-smarttv-html-tv-apps).

- **React** puro: ~42KB gzipped de runtime, ecossistema maior, é o que já está instalado na raiz do projeto.
- **Preact + `preact/compat`**: ~3KB gzipped, "desenhado para velocidade, tamanho e simplicidade, especialmente em dispositivos de baixo poder" — é a recomendação comum do setor especificamente para TV. `preact/compat` é uma camada de compatibilidade que deixa usar bibliotecas do ecossistema React (incluindo a Norigin Spatial Navigation da Decisão 3) sem mudar uma linha de código React — só troca a configuração do bundler (alias `"react"`/`"react-dom"` → `"preact/compat"`).

Fontes: [Preact vs React em 2025 — Medium](https://medium.com/@marketing_96787/preact-vs-react-in-2025-which-javascript-framework-delivers-the-best-performance-f2ded55808a4), [React vs Preact — DEV Community](https://dev.to/dct_technology/react-vs-preact-are-you-choosing-the-right-one-for-performance-in-2025-che).

**Recomendação deste plano: Preact + `preact/compat`.** O ganho de responsividade num controle remoto físico, no hardware mais fraco que este projeto atende, pesa mais do que a familiaridade com "React puro" — e como o código escrito (JSX, hooks, componentes) é **idêntico** nos dois casos, trocar depois (se um dia quiser) é só mudar a configuração do Vite, não reescrever telas. A Tarefa 0 deixa isso como uma escolha de UMA linha no `vite.config.ts` (comentada, com as duas opções), então quem disparar este plano pode inverter a decisão sem reabrir o documento.

### Decisão 3 — Norigin Spatial Navigation, não Enact

A LG mantém oficialmente **Enact** (com o módulo **Spotlight** para navegação espacial), usado "em dezenas de milhões de TVs por ano". Só que Enact é um framework completo (com seu próprio CLI, seus próprios temas Moonstone/Sandstone) **exclusivo do webOS** — não ajuda em nada no lado Samsung Tizen, que este projeto também empacota. Fonte: [Enact — LG webOS TV Developer](https://webostv.developer.lge.com), [From TV to Touch — GitNation](https://gitnation.com/contents/from-tv-to-touch-how-we-made-react-ui-work-across-every-input-mode).

Em vez disso, este plano usa **Norigin Spatial Navigation** (`@noriginmedia/norigin-spatial-navigation`, mais os pacotes `-core` e `-react`), uma biblioteca open-source baseada em hooks React, "usada em produção em Tizen, webOS, Hisense, Vizio e set-top-boxes baseados em Chromium" — cobre os dois sistemas que este projeto precisa, com o mesmo código. Confirmei o peer dependency: `"react": ">=16.8.0"` — compatível com o React 19 já usado no projeto, e compatível com Preact via `preact/compat` (o pacote só importa `react`, que o bundler resolve para onde a Decisão 2 mandar). Fonte: [Norigin Spatial Navigation — GitHub](https://github.com/NoriginMedia/Norigin-Spatial-Navigation), [registry.npmjs.org — peerDependencies confirmado ao vivo em 25/09/2026].

O WICG (grupo de trabalho da W3C) confirma que navegação espacial nativa **ainda não existe em nenhum navegador** — não tem atalho de plataforma que estejamos perdendo. Fonte: [WICG/spatial-navigation](https://github.com/WICG/spatial-navigation).

### Decisão 4 — `@vitejs/plugin-legacy`, para nunca mais um erro de sintaxe quebrar o app inteiro

Confirmei ao vivo (documento de 25/09) que esta TV recusa `?.` (optional chaining, ES2020) com `SyntaxError`, e que um `SyntaxError` em QUALQUER PONTO de um bloco `<script>` impede o bloco INTEIRO de rodar — mesmo o trecho quebrado nunca sendo chamado. Isso é o tipo de bug que uma pessoa não consegue garantir sozinha para sempre, em um arquivo que só cresce.

`@vitejs/plugin-legacy` (confirmei a versão mais recente, `8.2.3`, publicada em agosto/2026, com peer dependency `"vite": "^8.0.0"` — compatível com o Vite 8.1.5 já usado no projeto) resolve isso na raiz: ele roda Babel (`@babel/preset-env`) configurado por uma lista de navegadores-alvo (`browserslist`), e gera automaticamente um bundle "legacy" transpilado + com polyfills para QUALQUER coisa acima do alvo — **em todo o código, incluindo bibliotecas de terceiros**, não só no nosso. Isso transforma "alguém lembrar manualmente o teto de sintaxe" em "o build falha ou corrige sozinho". Fonte: [@vitejs/plugin-legacy — GitHub](https://github.com/vitejs/vite/tree/main/packages/plugin-legacy), [registry.npmjs.org — peerDependencies e data de publicação confirmados ao vivo em 25/09/2026].

### Decisão 5 — Migração completa, não incremental dentro do arquivo único

Não dá para "misturar" JSX dentro do `sintoniza-tv.html` atual sem bundler — então a migração é: construir o app novo do zero num sub-projeto separado, telas por tela, com a MESMA lista de recursos do app vanilla de hoje, testando cada uma; só trocar o pacote que vai para a TV depois que o novo tiver alcançado o vanilla em paridade (Tarefa 8) E for validado ao vivo lado a lado no aparelho físico (Tarefa 9). O arquivo vanilla (`sintoniza-tv/`) **não é apagado até esse ponto** — fica como rede de segurança/rollback instantâneo (basta reinstalar o `.ipk` antigo).

---

## Estrutura de arquivos

```
sintoniza-tv-app/                     ← sub-projeto novo, independente
├── package.json                      ← próprio, não mexe no da raiz
├── vite.config.ts                    ← plugin-legacy + Preact/React + Norigin
├── tsconfig.json
├── index.html                        ← entry do Vite (vira dist/index.html)
├── public/
│   ├── icon.png                      ← REFEITO (Tarefa 7 do doc de 24/09: logo preenchendo o quadrado)
│   └── favicon.svg
├── appinfo.json                      ← manifesto LG webOS (copiado para dist/ no build)
├── config.xml                        ← manifesto Samsung Tizen (copiado para dist/ no build)
├── src/
│   ├── main.tsx                      ← bootstrap: monta <App/>, registra window.onerror/unhandledrejection
│   ├── App.tsx                       ← shell: Sidebar + roteamento de "scenes" por estado (sem react-router — TV não usa URL)
│   ├── ErrorBoundary.tsx             ← Error Boundary do React (Tarefa 6)
│   ├── lib/
│   │   ├── m3u.ts                    ← parseM3U, sanitizeLabel, sanitizeImageUrl, sanitizeVodItem (portado 1:1)
│   │   ├── m3u.test.ts
│   │   ├── epg.ts                    ← decodeXmlEntities, normalizeChannelName, extractXmltv*, etc. (portado 1:1)
│   │   ├── epg.test.ts
│   │   ├── xtream.ts                 ← parseXtreamCredentials, xtreamApiUrl, buildVodStreamUrl, buildSeriesEpisodeUrl
│   │   ├── xtream.test.ts
│   │   ├── vod-providers.ts          ← providerKeyForItem, attachProviders, groupItemsByProvider (portado da versão atual)
│   │   └── vod-providers.test.ts
│   ├── hooks/
│   │   ├── useLocalStorage.ts        ← wrapper tipado sobre localStorage (sint_url, sint_epg_url, sint_vod_url, sint_fav)
│   │   └── usePlayer.ts              ← wrapper de hls.js/mpegts.js (portado da lógica de detectStreamType/buffer stages)
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── OnScreenKeyboard.tsx      ← grade QWERTY navegável (mesmo design validado no doc de 24/09)
│   │   ├── FocusableRow.tsx          ← fileira Netflix-style com Norigin
│   │   └── Tile.tsx
│   └── scenes/
│       ├── HomeScene.tsx
│       ├── SettingsScene.tsx
│       ├── DetailScene.tsx
│       └── PlayerScene.tsx
├── vitest.config.ts                  ← ou dentro do vite.config.ts (projeto Vitest)
└── scripts/
    └── package-tv.mjs                ← builda com `vite build` e organiza dist/ para o ares-package/tizen package
```

**Por que um `package.json` próprio, e não um workspace npm:** o `package.json` da raiz (`tanstack_start_ts`) é gerenciado pelo Lovable e tem o aviso explícito de não mexer na configuração do Vite dele. Manter os dois totalmente separados (cada um com seu `node_modules`) evita qualquer risco de uma versão de dependência de um quebrar o outro, e continua o padrão que o projeto já usa para `ios/`, `android/`, `sintoniza-tv/` (cada um uma pasta autocontida).

---

## Tarefas

### Tarefa 0: Scaffold do sub-projeto

**Files:**
- Create: `sintoniza-tv-app/package.json`
- Create: `sintoniza-tv-app/vite.config.ts`
- Create: `sintoniza-tv-app/tsconfig.json`
- Create: `sintoniza-tv-app/index.html`
- Create: `sintoniza-tv-app/src/main.tsx`
- Create: `sintoniza-tv-app/.gitignore`

- [ ] **Step 1: Criar o `package.json`**

```json
{
  "name": "sintoniza-tv-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "package:tv": "node scripts/package-tv.mjs"
  },
  "dependencies": {
    "preact": "^10.24.0",
    "@noriginmedia/norigin-spatial-navigation": "^3.3.0",
    "hls.js": "^1.5.17",
    "mpegts.js": "^1.7.3"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.0",
    "@vitejs/plugin-legacy": "^8.2.3",
    "terser": "^5.36.0",
    "typescript": "^5.7.0",
    "vite": "^8.1.5",
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0",
    "@testing-library/preact": "^3.2.4",
    "@testing-library/jest-dom": "^6.6.0"
  }
}
```

- [ ] **Step 2: Instalar as dependências**

```bash
cd sintoniza-tv-app
npm install
```

Run: `cd sintoniza-tv-app && npm install`
Expected: instala sem erro, cria `sintoniza-tv-app/node_modules` e `sintoniza-tv-app/package-lock.json`.

- [ ] **Step 3: Criar `vite.config.ts`** (Decisão 2 e 4 aplicadas aqui — a troca Preact↔React é UMA linha comentada)

```ts
// sintoniza-tv-app/vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import legacy from '@vitejs/plugin-legacy';

// Decisão 2 (docs/superpowers/plans/2026-09-25-tv-app-migracao-react.md):
// Preact + preact/compat por padrão (runtime ~3KB vs ~42KB do React puro,
// recomendado para hardware de TV fraco). Para trocar para React puro,
// troque o plugin `preact()` abaixo por `react()` de '@vitejs/plugin-react'
// (`npm install -D @vitejs/plugin-react react react-dom` e ajuste os
// imports de 'preact/hooks' para 'react' nos componentes) - nada mais
// precisa mudar, porque todo o código em src/ usa a API padrão do React
// (hooks, JSX), que o Preact implementa via preact/compat.
export default defineConfig({
  plugins: [
    preact(),
    // Decisão 4: compila automaticamente para o teto real desta TV
    // (webOS ~6.x / Chromium ~79, confirmado ao vivo em
    // docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md).
    // Isso substitui a verificação manual de sintaxe por uma automática -
    // Babel processa TODO o bundle final, incluindo bibliotecas de terceiros.
    legacy({
      targets: ['chrome >= 68', 'samsung >= 6'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
      modernPolyfills: true,
    }),
  ],
  build: {
    target: 'es2017', // teto conservador; o plugin legacy cobre o resto
    outDir: 'dist',
  },
});
```

- [ ] **Step 4: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["ES2019", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Criar `index.html`** (entry do Vite — vira `dist/index.html` no build, igual ao `main` que `appinfo.json`/`config.xml` já apontam hoje)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, initial-scale=1" />
  <title>Sintoniza IPTV — Smart TV</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Criar `src/main.tsx`** (o bootstrap inclui a rede de segurança da Tarefa 6 desde o primeiro commit — nunca mais um app que quebra em silêncio)

```tsx
// sintoniza-tv-app/src/main.tsx
import { render } from 'preact';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

// Rede de segurança global: cobre erros que o Error Boundary do React/Preact
// NÃO pega (erros em event handlers, callbacks assíncronos, Promises sem
// .catch) - ver Tarefa 6 e docs/superpowers/plans/
// 2026-09-25-tv-app-boot-crash-e-boas-praticas.md, seção 2.3.
let fatalShown = false;
function showFatal(label: string, detail: string) {
  if (fatalShown) return;
  fatalShown = true;
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="position:fixed;inset:0;background:#1a0000;color:#ffdddd;font-family:monospace;padding:48px;font-size:22px;line-height:1.5;overflow:auto">
      <h1 style="color:#ff6666;font-size:32px">Erro ao iniciar o Sintoniza</h1>
      <pre style="white-space:pre-wrap;word-break:break-word;font-size:18px;opacity:.85">${label}\n\n${detail}</pre>
    </div>`;
  }
}
window.addEventListener('error', (e) => {
  showFatal('Erro de JavaScript', `${e.filename || '?'}:${e.lineno || '?'}:${e.colno || '?'}\n${e.message || 'sem mensagem'}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  showFatal('Promise rejeitada sem tratamento', (reason && reason.stack) || (reason && reason.message) || String(reason));
});

const root = document.getElementById('root')!;
render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  root
);
```

- [ ] **Step 7: Criar `.gitignore`**

```
node_modules
dist
*.ipk
*.wgt
```

- [ ] **Step 8: `App.tsx` provisório** (só para o build funcionar; as scenes de verdade entram nas Tarefas 3-5)

```tsx
// sintoniza-tv-app/src/App.tsx
export function App() {
  return <div>Sintoniza TV — em construção</div>;
}
```

- [ ] **Step 9: `ErrorBoundary.tsx` provisório** (a versão completa é a Tarefa 6 — aqui só o suficiente para `main.tsx` importar)

```tsx
// sintoniza-tv-app/src/ErrorBoundary.tsx
import { Component, type ComponentChildren } from 'preact';

export class ErrorBoundary extends Component<{ children: ComponentChildren }> {
  render() {
    return this.props.children;
  }
}
```

- [ ] **Step 10: `styles.css` provisório**

```css
/* sintoniza-tv-app/src/styles.css */
html, body { width: 1920px; height: 1080px; margin: 0; overflow: hidden; background: #0a0a12; color: #fff; font-family: system-ui, sans-serif; }
```

- [ ] **Step 11: Confirmar que builda**

Run: `cd sintoniza-tv-app && npm run build`
Expected: `dist/index.html` + `dist/assets/*.js` + `dist/assets/*-legacy.js` criados sem erro (o `-legacy.js` confirma que o `@vitejs/plugin-legacy` está gerando o chunk transpilado).

- [ ] **Step 12: Commit**

```bash
cd sintoniza-tv-app
git add -A
git commit -m "chore(tv-app): scaffold Preact + Vite + plugin-legacy sub-project"
```

---

### Tarefa 1: Portar os helpers puros de M3U/sanitização (TDD)

**Files:**
- Create: `sintoniza-tv-app/src/lib/m3u.ts`
- Create: `sintoniza-tv-app/src/lib/m3u.test.ts`

Estas funções já existem, testadas, em `sintoniza-link.html` e `sintoniza-tv/sintoniza-tv.html` (ver `tests/vod/loadVodHelpers.js` e `tests/vod/loadTvVodHelpers.js` no repositório principal). Aqui elas são portadas **com o mesmo comportamento**, só mudando de "função solta num `<script>`" para "módulo TypeScript exportado" — os testes abaixo são as MESMAS asserções que já existem hoje, adaptadas para `import`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// sintoniza-tv-app/src/lib/m3u.test.ts
import { describe, test, expect } from 'vitest';
import { sanitizeLabel, sanitizeImageUrl, sanitizeVodItem, parseM3U } from './m3u';

describe('sanitizeLabel', () => {
  test('tira caracteres que abrem HTML', () => {
    expect(sanitizeLabel('<img src=x onerror="alert(1)">ESPN')).toBe('img src=x onerror=alert(1)ESPN');
    expect(sanitizeLabel('A&E Brasil')).toBe('A&E Brasil');
    expect(sanitizeLabel(null)).toBe('');
  });
});

describe('sanitizeImageUrl', () => {
  test('só aceita http(s) sem aspas/espaços', () => {
    expect(sanitizeImageUrl('https://cdn.x/logo.png')).toBe('https://cdn.x/logo.png');
    expect(sanitizeImageUrl('x" onerror="alert(1)')).toBe('');
    expect(sanitizeImageUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeImageUrl('')).toBe('');
  });
});

describe('sanitizeVodItem', () => {
  test('limpa nome, capa e plot do item da API', () => {
    const out = sanitizeVodItem({ stream_id: 1, name: '<b>Duna</b>', stream_icon: 'javascript:x', cover: 'https://c/d.jpg', plot: '<script>x</script>ok' });
    expect(out.name).toBe('bDuna/b');
    expect(out.stream_icon).toBe('');
    expect(out.cover).toBe('https://c/d.jpg');
    expect(out.plot).toBe('scriptx/scriptok');
    expect(out.stream_id).toBe(1);
  });
});

describe('parseM3U', () => {
  test('limpa nome, categoria e logo maliciosos', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 tvg-logo="x&quot; onerror=&quot;alert(1)" group-title="<b>Esportes</b>",<img src=x onerror=alert(1)>ESPN\nhttp://srv/live/u/p/1.ts\n';
    const [ch] = parseM3U(m3u);
    expect(ch.name).toBe('img src=x onerror=alert(1)ESPN');
    expect(ch.category).toBe('bEsportes/b');
    expect(ch.logo).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/lib/m3u.test.ts`
Expected: FAIL com `Cannot find module './m3u'`.

- [ ] **Step 3: Implementar** (porta 1:1 do que já existe em `sintoniza-tv/sintoniza-tv.html`, funções `sanitizeLabel`/`sanitizeImageUrl`/`sanitizeVodItem`/`parseM3U` — mesma lógica, com tipos)

```ts
// sintoniza-tv-app/src/lib/m3u.ts
export interface Channel {
  id: number;
  name: string;
  category: string;
  logo: string | null;
  url: string;
}

export interface VodItem {
  [key: string]: unknown;
  name?: string;
  title?: string;
  plot?: string;
  category_name?: string;
  stream_icon?: string;
  cover?: string;
}

// Textos vindos do provedor (lista M3U / API Xtream) entram na interface;
// um nome como <img onerror=...> rodaria código com acesso ao bridge nativo
// do app. Limpamos na entrada: rótulo sem < > " e imagem só http(s) sem
// aspas/espaços (ver docs/superpowers/plans/2026-09-23-v8-downloads-pip-e-correcoes.md,
// Task 1, mesma correção portada para cá).
export function sanitizeLabel(text: unknown): string {
  return String(text == null ? '' : text).replace(/[<>"]/g, '').trim();
}

export function sanitizeImageUrl(url: unknown): string {
  const u = String(url || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : '';
}

export function sanitizeVodItem<T extends VodItem>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  (['name', 'title', 'plot', 'category_name'] as const).forEach((k) => {
    if (out[k] != null) out[k] = sanitizeLabel(out[k]) as T[typeof k];
  });
  (['stream_icon', 'cover'] as const).forEach((k) => {
    if (out[k] != null) out[k] = sanitizeImageUrl(out[k]) as T[typeof k];
  });
  return out;
}

let _idCounter = 1;

export function parseM3U(text: string): Channel[] {
  const channels: Channel[] = [];
  const lines = text.split(/\r?\n/);
  let extinf: { name: string; logo: string | null; category: string } | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const logoMatch = /tvg-logo="([^"]*)"/.exec(line);
      const groupMatch = /group-title="([^"]*)"/.exec(line);
      const tvgName = /tvg-name="([^"]*)"/.exec(line);
      const displayName = line.split(',').slice(1).join(',').trim();
      extinf = {
        name: sanitizeLabel(displayName || (tvgName ? tvgName[1] : 'Canal')) || 'Canal',
        logo: logoMatch ? (sanitizeImageUrl(logoMatch[1]) || null) : null,
        category: groupMatch ? (sanitizeLabel(groupMatch[1]) || 'Geral') : 'Geral',
      };
    } else if (line.trim() && !line.startsWith('#') && extinf) {
      channels.push({ id: _idCounter++, ...extinf, url: line.trim() });
      extinf = null;
    }
  }
  return channels;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/lib/m3u.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv-app/src/lib/m3u.ts sintoniza-tv-app/src/lib/m3u.test.ts
git commit -m "feat(tv-app): port M3U parsing and provider-text sanitization helpers"
```

---

### Tarefa 2: Portar os helpers de EPG (TDD) e registrar a mudança de estratégia de paridade

**Files:**
- Create: `sintoniza-tv-app/src/lib/epg.ts`
- Create: `sintoniza-tv-app/src/lib/epg.test.ts`

**Mudança importante em relação a hoje:** o repositório principal tem um teste (`tests/player/epg-helpers.test.js`) que exige que o bloco `<script id="epg-helpers">` seja **byte-a-byte idêntico** entre `sintoniza-link.html` e `sintoniza-tv/sintoniza-tv.html` — isso só faz sentido quando os dois são arquivos de texto colados um do outro. Aqui, `epg.ts` é um módulo TypeScript de verdade; não faz sentido nem é possível mantê-lo "byte idêntico" a um `<script>` inline. **A garantia de comportamento equivalente passa a ser por teste de comportamento** (mesmas entradas → mesmas saídas), no mesmo espírito do que `tests/vod/tv-vod-parity.test.js` já faz para os helpers de VOD hoje (compara resultado, não texto).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// sintoniza-tv-app/src/lib/epg.test.ts
import { describe, test, expect } from 'vitest';
import {
  decodeXmlEntities,
  normalizeChannelName,
  parseXmltvDate,
  extractXmltvChannels,
  extractXmltvProgrammes,
  buildNameToProgrammesIndex,
  getCurrentAndNextProgramme,
  isEpgCacheStale,
  formatProgrammeTimeRange,
  mergeEpgIndexes,
  resolveEpgProgrammes,
} from './epg';

test('decodeXmlEntities decodifica entidades comuns', () => {
  expect(decodeXmlEntities('A &amp; B &lt;tag&gt; &quot;x&quot;')).toBe('A & B <tag> "x"');
});

test('normalizeChannelName remove região, HD/SD, colchetes e normaliza', () => {
  expect(normalizeChannelName('São Paulo/SP  SporTV HD')).toBe('sportv');
  expect(normalizeChannelName('ESPN+ [H265]')).toBe('espn plus');
});

test('parseXmltvDate converte formato XMLTV para epoch', () => {
  const ms = parseXmltvDate('20260101120000 +0000');
  expect(new Date(ms).getUTCFullYear()).toBe(2026);
});

test('extractXmltvChannels e extractXmltvProgrammes leem um XMLTV simples', () => {
  const xml = `<tv><channel id="c1"><display-name lang="pt">Canal Um</display-name></channel>
    <programme channel="c1" start_timestamp="1700000000" stop_timestamp="1700003600"><title>Jornal</title></programme></tv>`;
  const channels = extractXmltvChannels(xml);
  expect(channels).toEqual([{ id: 'c1', displayName: 'Canal Um' }]);
  const programmes = extractXmltvProgrammes(xml);
  expect(programmes[0]).toMatchObject({ channelId: 'c1', title: 'Jornal' });
});

test('buildNameToProgrammesIndex e getCurrentAndNextProgramme encontram o programa atual', () => {
  const channels = [{ id: 'c1', displayName: 'Canal Um' }];
  const now = 1700001000000 / 1000 * 1000; // dentro da janela do programa
  const programmes = [{ channelId: 'c1', start: 1700000000000, stop: 1700003600000, title: 'Jornal' }];
  const index = buildNameToProgrammesIndex(channels, programmes, { nowMs: now });
  const { current } = getCurrentAndNextProgramme(index['canal um'], now);
  expect(current?.title).toBe('Jornal');
});

test('isEpgCacheStale respeita o TTL', () => {
  expect(isEpgCacheStale(0, 1000, 500)).toBe(true);
  expect(isEpgCacheStale(1000, 1200, 500)).toBe(false);
});

test('formatProgrammeTimeRange formata HH:mm–HH:mm', () => {
  const start = new Date(2026, 0, 1, 8, 0).getTime();
  const stop = new Date(2026, 0, 1, 9, 30).getTime();
  expect(formatProgrammeTimeRange(start, stop)).toBe('08:00–09:30');
});

test('mergeEpgIndexes prioriza o índice do provedor e completa com o suplementar', () => {
  const primary = { canal: [{ start: 1, stop: 2, title: 'A' }] };
  const supplementary = { canal: [{ start: 9, stop: 10, title: 'B' }], outro: [{ start: 1, stop: 2, title: 'C' }] };
  const merged = mergeEpgIndexes(primary, supplementary);
  expect(merged.canal[0].title).toBe('A');
  expect(merged.outro[0].title).toBe('C');
});

test('resolveEpgProgrammes usa apelidos quando o nome direto não bate', () => {
  const index = { 'premiere clubes': [{ start: 1, stop: 2, title: 'Jogo' }] };
  expect(resolveEpgProgrammes(index, 'premiere 1')?.[0].title).toBe('Jogo');
  expect(resolveEpgProgrammes(index, 'canal inexistente')).toBeNull();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/lib/epg.test.ts`
Expected: FAIL com `Cannot find module './epg'`.

- [ ] **Step 3: Implementar** (porta 1:1 do bloco `<script id="epg-helpers">` de `sintoniza-tv/sintoniza-tv.html` — mesma lógica, com tipos; comentários de contexto mantidos)

```ts
// sintoniza-tv-app/src/lib/epg.ts

export interface XmltvChannel { id: string; displayName: string; }
export interface Programme { channelId?: string; start: number; stop: number; title: string; }
export interface EpgIndex { [normalizedName: string]: Programme[]; }

export function decodeXmlEntities(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

export function normalizeChannelName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Feeds tipo epgshare01 prefixam o nome com a região da grade regional
    // ("São Paulo/SP  SporTV HD") - a região não faz parte do nome do canal.
    .replace(/^[^/\n]+\/[A-Za-z]{2}\s+/, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(fhd|uhd|4k|hd|sd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// XMLTV "YYYYMMDDHHmmss ±HHMM" -> epoch ms.
export function parseXmltvDate(str: string | null | undefined): number {
  if (!str) return NaN;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(String(str).trim());
  if (!m) return NaN;
  const offset = m[7] || '+0000';
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset[0]}${offset.slice(1, 3)}:${offset.slice(3, 5)}`;
  return Date.parse(iso);
}

const CHANNEL_ALIASES: Record<string, string> = {
  'premiere 1': 'premiere clubes',
  'premiere': 'premiere clubes',
  'sony movies': 'sony channel',
  'canal sony': 'sony channel',
};

export function resolveEpgProgrammes(index: EpgIndex, normalizedName: string): Programme[] | null {
  if (index[normalizedName]) return index[normalizedName];
  const alias = CHANNEL_ALIASES[normalizedName];
  if (alias && index[alias]) return index[alias];
  return null;
}

export function extractXmltvChannels(xmlText: string): XmltvChannel[] {
  const channels: XmltvChannel[] = [];
  const re = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText))) {
    const id = m[1];
    if (!id) continue;
    const nameMatch = /<display-name[^>]*>([^<]*)<\/display-name>/.exec(m[2]);
    if (!nameMatch) continue;
    channels.push({ id, displayName: decodeXmlEntities(nameMatch[1]) });
  }
  return channels;
}

export function extractXmltvProgrammes(xmlText: string): Programme[] {
  const programmes: Programme[] = [];
  const re = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText))) {
    const attrs = m[1];
    const body = m[2];
    const channelMatch = /channel="([^"]*)"/.exec(attrs);
    if (!channelMatch) continue;
    const startTsMatch = /start_timestamp="(\d+)"/.exec(attrs);
    const stopTsMatch = /stop_timestamp="(\d+)"/.exec(attrs);
    const startMatch = /\bstart="([^"]*)"/.exec(attrs);
    const stopMatch = /\bstop="([^"]*)"/.exec(attrs);
    const start = startTsMatch ? Number(startTsMatch[1]) * 1000 : (startMatch ? parseXmltvDate(startMatch[1]) : NaN);
    const stop = stopTsMatch ? Number(stopTsMatch[1]) * 1000 : (stopMatch ? parseXmltvDate(stopMatch[1]) : NaN);
    if (!isFinite(start) || !isFinite(stop)) continue;
    const titleMatch = /<title[^>]*>([^<]*)<\/title>/.exec(body);
    programmes.push({ channelId: channelMatch[1], start, stop, title: titleMatch ? decodeXmlEntities(titleMatch[1]) : '' });
  }
  return programmes;
}

export function mergeEpgIndexes(primary: EpgIndex, supplementary: EpgIndex): EpgIndex {
  const merged: EpgIndex = {};
  Object.keys(primary).forEach((name) => { merged[name] = primary[name]; });
  Object.keys(supplementary).forEach((name) => {
    if (!merged[name] || !merged[name].length) merged[name] = supplementary[name];
  });
  return merged;
}

export function buildNameToProgrammesIndex(
  channels: XmltvChannel[],
  programmes: Programme[],
  opts?: { nowMs?: number; keepPastMs?: number; keepFutureMs?: number }
): EpgIndex {
  const nowMs = opts?.nowMs ?? Date.now();
  const keepPastMs = opts?.keepPastMs ?? 60 * 60 * 1000;
  const keepFutureMs = opts?.keepFutureMs ?? 48 * 60 * 60 * 1000;

  const idToNames: Record<string, string[]> = {};
  channels.forEach((c) => {
    const norm = normalizeChannelName(c.displayName);
    if (!norm) return;
    if (!idToNames[c.id]) idToNames[c.id] = [];
    if (idToNames[c.id].indexOf(norm) === -1) idToNames[c.id].push(norm);
  });

  const index: EpgIndex = {};
  programmes.forEach((p) => {
    if (p.stop < nowMs - keepPastMs) return;
    if (p.start > nowMs + keepFutureMs) return;
    const names = idToNames[p.channelId!];
    if (!names) return;
    names.forEach((name) => {
      if (!index[name]) index[name] = [];
      index[name].push({ start: p.start, stop: p.stop, title: p.title });
    });
  });

  Object.keys(index).forEach((name) => {
    index[name].sort((a, b) => a.start - b.start);
  });

  return index;
}

export function getCurrentAndNextProgramme(programmes: Programme[] | undefined, nowMs: number): { current: Programme | null; next: Programme | null } {
  if (!programmes || !programmes.length) return { current: null, next: null };
  let current: Programme | null = null;
  let next: Programme | null = null;
  for (let i = 0; i < programmes.length; i++) {
    const p = programmes[i];
    if (p.start <= nowMs && nowMs < p.stop) {
      current = p;
      next = programmes[i + 1] || null;
      break;
    }
    if (p.start > nowMs) {
      next = p;
      break;
    }
  }
  return { current, next };
}

export function isEpgCacheStale(fetchedAtMs: number | null | undefined, nowMs: number, ttlMs: number): boolean {
  if (!fetchedAtMs) return true;
  return (nowMs - fetchedAtMs) >= ttlMs;
}

export function formatProgrammeTimeRange(startMs: number, stopMs: number): string {
  function fmt(ms: number) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return `${fmt(startMs)}–${fmt(stopMs)}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/lib/epg.test.ts`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv-app/src/lib/epg.ts sintoniza-tv-app/src/lib/epg.test.ts
git commit -m "feat(tv-app): port EPG/XMLTV helpers (behavior-equivalent, not byte-identical - see task notes)"
```

---

### Tarefa 3: Portar os helpers de Xtream/VOD (TDD)

**Files:**
- Create: `sintoniza-tv-app/src/lib/xtream.ts`
- Create: `sintoniza-tv-app/src/lib/xtream.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// sintoniza-tv-app/src/lib/xtream.test.ts
import { describe, test, expect } from 'vitest';
import { parseXtreamCredentials, xtreamApiUrl, buildVodStreamUrl, buildSeriesEpisodeUrl } from './xtream';

describe('parseXtreamCredentials', () => {
  test('extrai base/username/password de uma URL M3U Xtream válida', () => {
    const creds = parseXtreamCredentials('http://provedor.com:8080/get.php?username=user1&password=pass1&type=m3u_plus');
    expect(creds).toEqual({ base: 'http://provedor.com:8080', username: 'user1', password: 'pass1' });
  });

  test('retorna null quando username/password faltam', () => {
    expect(parseXtreamCredentials('http://provedor.com/get.php?type=m3u_plus')).toBeNull();
  });

  test('retorna null para URL não parseável', () => {
    expect(parseXtreamCredentials('não é uma url')).toBeNull();
  });
});

test('xtreamApiUrl monta a URL do player_api.php com username/password/action', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  const url = xtreamApiUrl(creds, 'get_live_categories');
  expect(url).toBe('http://p.com/player_api.php?username=u&password=p&action=get_live_categories');
});

test('xtreamApiUrl acrescenta parâmetros extras', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  const url = xtreamApiUrl(creds, 'get_vod_info', { vod_id: '42' });
  expect(url).toContain('vod_id=42');
});

test('buildVodStreamUrl monta a URL direta de movie/', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  expect(buildVodStreamUrl(creds, 42, 'mkv')).toBe('http://p.com/movie/u/p/42.mkv');
});

test('buildVodStreamUrl usa mp4 como extensão padrão', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  expect(buildVodStreamUrl(creds, 42)).toBe('http://p.com/movie/u/p/42.mp4');
});

test('buildSeriesEpisodeUrl monta a URL direta de series/', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  expect(buildSeriesEpisodeUrl(creds, 501, 'mkv')).toBe('http://p.com/series/u/p/501.mkv');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/lib/xtream.test.ts`
Expected: FAIL com `Cannot find module './xtream'`.

- [ ] **Step 3: Implementar**

```ts
// sintoniza-tv-app/src/lib/xtream.ts
export interface XtreamCreds { base: string; username: string; password: string; }

export function parseXtreamCredentials(m3uUrl: string): XtreamCreds | null {
  let url: URL;
  try {
    url = new URL(m3uUrl);
  } catch {
    return null;
  }
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!username || !password) return null;
  return { base: `${url.protocol}//${url.host}`, username, password };
}

export function xtreamApiUrl(creds: XtreamCreds, action: string, extraParams?: Record<string, string>): string {
  const params = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    action,
    ...(extraParams || {}),
  });
  return `${creds.base}/player_api.php?${params.toString()}`;
}

export function buildVodStreamUrl(creds: XtreamCreds, streamId: number, containerExtension?: string): string {
  const ext = containerExtension || 'mp4';
  return `${creds.base}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
}

export function buildSeriesEpisodeUrl(creds: XtreamCreds, episodeId: number, containerExtension?: string): string {
  const ext = containerExtension || 'mp4';
  return `${creds.base}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/lib/xtream.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv-app/src/lib/xtream.ts sintoniza-tv-app/src/lib/xtream.test.ts
git commit -m "feat(tv-app): port Xtream API URL builders"
```

---

### Tarefa 4: Navegação espacial (Norigin) + teclado on-screen, testados com Testing Library

**Files:**
- Create: `sintoniza-tv-app/src/components/FocusableRow.tsx`
- Create: `sintoniza-tv-app/src/components/FocusableRow.test.tsx`
- Create: `sintoniza-tv-app/src/components/OnScreenKeyboard.tsx`
- Create: `sintoniza-tv-app/src/components/OnScreenKeyboard.test.tsx`
- Create: `sintoniza-tv-app/vitest.setup.ts`

Esta tarefa substitui, de vez, os dois motores de D-pad escritos à mão que causaram os incidentes de 24/09 e 25/09 (`tv-nav.js` nunca carregado, depois a reimplementação inline que bloqueava setas dentro de campo de texto). A Norigin Spatial Navigation resolve foco por posição geométrica de verdade (mesma ideia do `tv-nav.js` bem escrito que never chegou a rodar) — mas mantida, testada e usada em produção por terceiros, não por nós sozinhos.

- [ ] **Step 1: Configurar o Vitest com jsdom**

```ts
// sintoniza-tv-app/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
```

Acrescentar ao `vite.config.ts` (dentro de `defineConfig({ ... })`, ao lado de `plugins`/`build`):

```ts
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
```

- [ ] **Step 2: Escrever o teste que falha, para `FocusableRow`**

```tsx
// sintoniza-tv-app/src/components/FocusableRow.test.tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { FocusableRow } from './FocusableRow';

beforeEach(() => {
  init({ debug: false, visualDebug: false });
});

describe('FocusableRow', () => {
  test('renderiza um item focável por card, e o primeiro recebe foco ao montar', async () => {
    render(
      <FocusableRow label="Canais ao vivo" items={[{ id: '1', title: 'Canal A' }, { id: '2', title: 'Canal B' }]} onSelect={() => {}} />
    );
    expect(screen.getByText('Canais ao vivo')).toBeInTheDocument();
    expect(screen.getByText('Canal A')).toBeInTheDocument();
    expect(screen.getByText('Canal B')).toBeInTheDocument();
  });

  test('aciona onSelect ao "clicar" (equivalente a pressionar OK) num item', () => {
    let selected: string | null = null;
    render(
      <FocusableRow
        label="Canais"
        items={[{ id: '1', title: 'Canal A' }]}
        onSelect={(id) => { selected = id; }}
      />
    );
    fireEvent.click(screen.getByText('Canal A'));
    expect(selected).toBe('1');
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/components/FocusableRow.test.tsx`
Expected: FAIL com `Cannot find module './FocusableRow'`.

- [ ] **Step 4: Implementar `FocusableRow`**

```tsx
// sintoniza-tv-app/src/components/FocusableRow.tsx
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

export interface RowItem { id: string; title: string; }

function Card({ item, onSelect }: { item: RowItem; onSelect: (id: string) => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: () => onSelect(item.id) });
  return (
    <div
      ref={ref as any}
      onClick={() => onSelect(item.id)}
      className={`tv-tile ${focused ? 'tv-tile--focused' : ''}`}
      role="button"
      tabIndex={0}
    >
      {item.title}
    </div>
  );
}

export function FocusableRow({ label, items, onSelect }: { label: string; items: RowItem[]; onSelect: (id: string) => void }) {
  const { ref, focusKey } = useFocusable();
  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref as any} className="tv-row">
        <h2 className="tv-row-label">{label}</h2>
        <div className="tv-row-track">
          {items.map((item) => (
            <Card key={item.id} item={item} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/components/FocusableRow.test.tsx`
Expected: `2 passed`.

- [ ] **Step 6: Escrever o teste que falha, para `OnScreenKeyboard`** (mesmo design validado em `docs/superpowers/plans/2026-09-24-tv-app-reconstrucao.md`: grade navegável, Espaço/Apagar/Limpar/Concluir)

```tsx
// sintoniza-tv-app/src/components/OnScreenKeyboard.test.tsx
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { OnScreenKeyboard } from './OnScreenKeyboard';

beforeEach(() => {
  init({ debug: false, visualDebug: false });
});

describe('OnScreenKeyboard', () => {
  test('digita letras clicando nas teclas e chama onChange com o valor acumulado', () => {
    const onChange = vi.fn();
    render(<OnScreenKeyboard value="" onChange={onChange} onDone={() => {}} label="URL da lista" />);
    fireEvent.click(screen.getByText('h'));
    expect(onChange).toHaveBeenCalledWith('h');
  });

  test('Apagar remove o último caractere', () => {
    const onChange = vi.fn();
    render(<OnScreenKeyboard value="abc" onChange={onChange} onDone={() => {}} label="URL" />);
    fireEvent.click(screen.getByText('← Apagar'));
    expect(onChange).toHaveBeenCalledWith('ab');
  });

  test('Limpar zera o campo', () => {
    const onChange = vi.fn();
    render(<OnScreenKeyboard value="abc" onChange={onChange} onDone={() => {}} label="URL" />);
    fireEvent.click(screen.getByText('Limpar'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  test('Concluir chama onDone', () => {
    const onDone = vi.fn();
    render(<OnScreenKeyboard value="abc" onChange={() => {}} onDone={onDone} label="URL" />);
    fireEvent.click(screen.getByText('Concluir'));
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/components/OnScreenKeyboard.test.tsx`
Expected: FAIL com `Cannot find module './OnScreenKeyboard'`.

- [ ] **Step 8: Implementar `OnScreenKeyboard`**

```tsx
// sintoniza-tv-app/src/components/OnScreenKeyboard.tsx
import { useState } from 'preact/hooks';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

const LAYOUT_LOWER = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  [':', '/', '.', '?', '=', '&', '-', '_', '@', '~'],
];
const LAYOUT_UPPER = LAYOUT_LOWER.map((row, i) => (i < 4 ? row.map((c) => c.toUpperCase()) : row));

function Key({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  const { ref, focused } = useFocusable({ onEnterPress: onPress });
  return (
    <button
      ref={ref as any}
      onClick={onPress}
      className={`tv-osk-key ${wide ? 'wide' : ''} ${focused ? 'tv-focus' : ''}`}
    >
      {label}
    </button>
  );
}

export function OnScreenKeyboard({
  value,
  onChange,
  onDone,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  onDone: () => void;
  label: string;
}) {
  const [upper, setUpper] = useState(false);
  const { ref, focusKey } = useFocusable();
  const layout = upper ? LAYOUT_UPPER : LAYOUT_LOWER;

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref as any} className="tv-osk" aria-label="Teclado virtual">
        <div className="tv-osk-label">{label}</div>
        <div className="tv-osk-display">{value}</div>
        <div className="tv-osk-grid">
          {layout.map((row, i) => (
            <div className="tv-osk-row" key={i}>
              {row.map((ch) => (
                <Key key={ch} label={ch} onPress={() => onChange(value + ch)} />
              ))}
            </div>
          ))}
          <div className="tv-osk-row">
            <Key label={upper ? '⇩ Minúscula' : '⇧ Maiúscula'} onPress={() => setUpper(!upper)} wide />
            <Key label="Espaço" onPress={() => onChange(value + ' ')} wide />
            <Key label="← Apagar" onPress={() => onChange(value.slice(0, -1))} wide />
            <Key label="Limpar" onPress={() => onChange('')} wide />
            <Key label="Concluir" onPress={onDone} wide />
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/components/OnScreenKeyboard.test.tsx`
Expected: `4 passed`.

- [ ] **Step 10: Commit**

```bash
git add sintoniza-tv-app/vitest.setup.ts sintoniza-tv-app/vite.config.ts sintoniza-tv-app/src/components/FocusableRow.tsx sintoniza-tv-app/src/components/FocusableRow.test.tsx sintoniza-tv-app/src/components/OnScreenKeyboard.tsx sintoniza-tv-app/src/components/OnScreenKeyboard.test.tsx
git commit -m "feat(tv-app): spatial navigation (Norigin) for rows and on-screen keyboard, replacing the hand-written focus engines"
```

---

### Tarefa 5: Scene de Configurações — revisível pela sidebar, nunca um portão bloqueante

Esta tarefa implementa diretamente a lição central dos dois incidentes anteriores: Configurações é uma tela comum, acessível a qualquer momento pela barra lateral — nunca um portão que bloqueia o app até ser preenchido, e nunca uma tela que trava porque o D-pad não alcança um botão.

**Files:**
- Create: `sintoniza-tv-app/src/scenes/SettingsScene.tsx`
- Create: `sintoniza-tv-app/src/scenes/SettingsScene.test.tsx`
- Create: `sintoniza-tv-app/src/hooks/useLocalStorage.ts`
- Create: `sintoniza-tv-app/src/hooks/useLocalStorage.test.ts`

- [ ] **Step 1: Escrever o teste que falha, para `useLocalStorage`**

```ts
// sintoniza-tv-app/src/hooks/useLocalStorage.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useLocalStorage } from './useLocalStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('useLocalStorage', () => {
  test('lê o valor salvo e permite atualizar', () => {
    localStorage.setItem('sint_url', 'http://x.com/lista.m3u');
    const { result } = renderHook(() => useLocalStorage('sint_url', ''));
    expect(result.current[0]).toBe('http://x.com/lista.m3u');

    act(() => result.current[1]('http://novo.com/lista.m3u'));
    expect(result.current[0]).toBe('http://novo.com/lista.m3u');
    expect(localStorage.getItem('sint_url')).toBe('http://novo.com/lista.m3u');
  });

  test('usa o valor padrão quando não há nada salvo', () => {
    const { result } = renderHook(() => useLocalStorage('sint_epg_url', ''));
    expect(result.current[0]).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/hooks/useLocalStorage.test.ts`
Expected: FAIL com `Cannot find module './useLocalStorage'`.

- [ ] **Step 3: Implementar `useLocalStorage`**

```ts
// sintoniza-tv-app/src/hooks/useLocalStorage.ts
import { useState, useCallback } from 'preact/hooks';

export function useLocalStorage(key: string, initial: string): [string, (next: string) => void] {
  const [value, setValue] = useState<string>(() => localStorage.getItem(key) ?? initial);

  const set = useCallback((next: string) => {
    localStorage.setItem(key, next);
    setValue(next);
  }, [key]);

  return [value, set];
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/hooks/useLocalStorage.test.ts`
Expected: `2 passed`.

- [ ] **Step 5: Escrever o teste que falha, para `SettingsScene`**

```tsx
// sintoniza-tv-app/src/scenes/SettingsScene.test.tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScene } from './SettingsScene';

beforeEach(() => {
  init({ debug: false, visualDebug: false });
  localStorage.clear();
});

describe('SettingsScene', () => {
  test('pré-preenche os campos com o que já está salvo', () => {
    localStorage.setItem('sint_url', 'http://ja-salvo.com/lista.m3u');
    render(<SettingsScene onSave={() => {}} />);
    expect(screen.getByText('http://ja-salvo.com/lista.m3u')).toBeInTheDocument();
  });

  test('abrir o teclado no campo M3U e digitar atualiza o valor exibido', () => {
    render(<SettingsScene onSave={() => {}} />);
    fireEvent.click(screen.getByTestId('field-m3u'));
    fireEvent.click(screen.getByText('h'));
    fireEvent.click(screen.getByText('t'));
    expect(screen.getByTestId('field-m3u')).toHaveTextContent('ht');
  });

  test('Salvar chama onSave com os três valores', () => {
    let saved: { m3u: string; epg: string; vod: string } | null = null;
    render(<SettingsScene onSave={(v) => { saved = v; }} />);
    fireEvent.click(screen.getByTestId('field-m3u'));
    fireEvent.click(screen.getByText('h'));
    fireEvent.click(screen.getByText('Concluir'));
    fireEvent.click(screen.getByText('Salvar e Carregar'));
    expect(saved).toEqual({ m3u: 'h', epg: '', vod: '' });
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/scenes/SettingsScene.test.tsx`
Expected: FAIL com `Cannot find module './SettingsScene'`.

- [ ] **Step 7: Implementar `SettingsScene`**

```tsx
// sintoniza-tv-app/src/scenes/SettingsScene.tsx
import { useState } from 'preact/hooks';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { useLocalStorage } from '../hooks/useLocalStorage';

type FieldKey = 'm3u' | 'epg' | 'vod';

function Field({ testId, label, value, onOpenKeyboard }: { testId: string; label: string; value: string; onOpenKeyboard: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onOpenKeyboard });
  return (
    <div className="tv-settings-field">
      <label>{label}</label>
      <div
        ref={ref as any}
        data-testid={testId}
        onClick={onOpenKeyboard}
        className={`tv-input ${focused ? 'tv-focus' : ''}`}
      >
        {value || 'Pressione OK para digitar'}
      </div>
    </div>
  );
}

export function SettingsScene({ onSave }: { onSave: (values: { m3u: string; epg: string; vod: string }) => void }) {
  const [m3u, setM3u] = useLocalStorage('sint_url', '');
  const [epg, setEpg] = useLocalStorage('sint_epg_url', '');
  const [vod, setVod] = useLocalStorage('sint_vod_url', '');
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const { ref, focusKey } = useFocusable();

  const values: Record<FieldKey, [string, (v: string) => void]> = {
    m3u: [m3u, setM3u],
    epg: [epg, setEpg],
    vod: [vod, setVod],
  };

  const { ref: saveRef, focused: saveFocused } = useFocusable({
    onEnterPress: () => onSave({ m3u, epg, vod }),
  });

  if (editing) {
    const [value, setValue] = values[editing];
    return (
      <OnScreenKeyboard
        label={editing === 'm3u' ? 'URL da lista M3U' : editing === 'epg' ? 'EPG' : 'Filmes e Séries'}
        value={value}
        onChange={setValue}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref as any} id="tv-settings-scene">
        <h2>Sintoniza — Configurações</h2>
        <p>Informe suas URLs para começar a assistir. Pressione OK sobre o campo para abrir o teclado.</p>
        <Field testId="field-m3u" label="URL da lista M3U" value={m3u} onOpenKeyboard={() => setEditing('m3u')} />
        <Field testId="field-epg" label="EPG — guia de programação (opcional)" value={epg} onOpenKeyboard={() => setEditing('epg')} />
        <Field testId="field-vod" label="Filmes e Séries — catálogo (opcional)" value={vod} onOpenKeyboard={() => setEditing('vod')} />
        <button
          ref={saveRef as any}
          className={`tv-btn ${saveFocused ? 'tv-focus' : ''}`}
          onClick={() => onSave({ m3u, epg, vod })}
        >
          Salvar e Carregar
        </button>
      </div>
    </FocusContext.Provider>
  );
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/scenes/SettingsScene.test.tsx`
Expected: `3 passed`.

- [ ] **Step 9: Commit**

```bash
git add sintoniza-tv-app/src/hooks/useLocalStorage.ts sintoniza-tv-app/src/hooks/useLocalStorage.test.ts sintoniza-tv-app/src/scenes/SettingsScene.tsx sintoniza-tv-app/src/scenes/SettingsScene.test.tsx
git commit -m "feat(tv-app): revisitable Settings scene (never a blocking onboarding gate)"
```

---

### Tarefa 6: Error Boundary + rede de segurança global (nunca mais uma tela preta sem explicação)

**Files:**
- Modify: `sintoniza-tv-app/src/ErrorBoundary.tsx` (substitui o provisório da Tarefa 0)
- Create: `sintoniza-tv-app/src/ErrorBoundary.test.tsx`

O `main.tsx` da Tarefa 0 já cobre erros FORA da árvore React (event handlers soltos, Promises sem `.catch`) via `window.onerror`/`unhandledrejection`. Esta tarefa cobre o que o Error Boundary do React/Preact resolve melhor: erros DURANTE a renderização de um componente — sem isso, um erro de render também deixa a tela em branco (o Error Boundary intercepta e mostra algo, em vez de desmontar tudo silenciosamente).

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// sintoniza-tv-app/src/ErrorBoundary.test.tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('falha proposital de teste');
}

describe('ErrorBoundary', () => {
  test('mostra a mensagem de erro em vez de deixar a tela em branco', () => {
    // Suprime o console.error do React/Preact sobre o erro capturado - já
    // esperamos e testamos esse erro, não precisa poluir a saída do teste.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );
    expect(screen.getByText('Erro ao iniciar o Sintoniza')).toBeInTheDocument();
    expect(screen.getByText(/falha proposital de teste/)).toBeInTheDocument();
  });

  test('renderiza os filhos normalmente quando não há erro', () => {
    render(
      <ErrorBoundary>
        <div>Tudo certo</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Tudo certo')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/ErrorBoundary.test.tsx`
Expected: FAIL (o `ErrorBoundary` provisório da Tarefa 0 não mostra mensagem nenhuma, só teria o erro não-capturado do preact levantando o teste, ou o texto não seria encontrado).

- [ ] **Step 3: Implementar**

```tsx
// sintoniza-tv-app/src/ErrorBoundary.tsx
import { Component, type ComponentChildren } from 'preact';

interface State { error: Error | null; }

export class ErrorBoundary extends Component<{ children: ComponentChildren }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#1a0000', color: '#ffdddd',
          fontFamily: 'monospace', padding: 48, fontSize: 22, lineHeight: 1.5, overflow: 'auto',
        }}>
          <h1 style={{ color: '#ff6666', fontSize: 32 }}>Erro ao iniciar o Sintoniza</h1>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 18, opacity: 0.85 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/ErrorBoundary.test.tsx`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add sintoniza-tv-app/src/ErrorBoundary.tsx sintoniza-tv-app/src/ErrorBoundary.test.tsx
git commit -m "feat(tv-app): real Error Boundary (renders the error instead of a silent blank screen)"
```

---

### Tarefa 7: Home scene, Detail scene, Player scene e App shell

Esta tarefa conecta as peças das Tarefas 1-6 num app navegável de ponta a ponta. Ela é maior e menos "TDD puro" porque é, principalmente, composição de componentes já testados — mas cada pedaço de lógica nova (o hook do player, a integração hls.js/mpegts.js) ganha teste próprio.

**Files:**
- Create: `sintoniza-tv-app/src/hooks/usePlayer.ts`
- Create: `sintoniza-tv-app/src/hooks/usePlayer.test.ts`
- Create: `sintoniza-tv-app/src/scenes/HomeScene.tsx`
- Create: `sintoniza-tv-app/src/scenes/DetailScene.tsx`
- Create: `sintoniza-tv-app/src/scenes/PlayerScene.tsx`
- Create: `sintoniza-tv-app/src/components/Sidebar.tsx`
- Modify: `sintoniza-tv-app/src/App.tsx`

- [ ] **Step 1: Escrever o teste que falha, para a lógica pura de `usePlayer`** (a parte que decide HLS vs MPEG-TS pela URL — a parte de I/O real com `hls.js`/`mpegts.js` é testada manualmente na TV, não em unitário, porque depende de um `<video>` de verdade)

```ts
// sintoniza-tv-app/src/hooks/usePlayer.test.ts
import { describe, test, expect } from 'vitest';
import { detectStreamType } from './usePlayer';

describe('detectStreamType', () => {
  test('.m3u8 é hls', () => {
    expect(detectStreamType('http://p.com/live/u/p/1.m3u8')).toEqual({ type: 'hls', url: 'http://p.com/live/u/p/1.m3u8' });
  });

  test('caminho /live/ ou /stream sem extensão reconhecida cai para hls', () => {
    expect(detectStreamType('http://p.com/live/u/p/1')).toEqual({ type: 'hls', url: 'http://p.com/live/u/p/1' });
  });

  test('.ts sem promoção possível cai para mpegts', () => {
    expect(detectStreamType('http://p.com/outro/u/p/1.ts')).toEqual({ type: 'mpegts', url: 'http://p.com/outro/u/p/1.ts' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd sintoniza-tv-app && npx vitest run src/hooks/usePlayer.test.ts`
Expected: FAIL com `Cannot find module './usePlayer'`.

- [ ] **Step 3: Implementar `usePlayer`** (a parte síncrona de decisão de tipo de stream, testável; o hook em si integra `hls.js`/`mpegts.js`, sem teste unitário — validado ao vivo na Tarefa 9)

```ts
// sintoniza-tv-app/src/hooks/usePlayer.ts
import { useRef, useCallback } from 'preact/hooks';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

export type StreamType = 'hls' | 'mpegts';

// Decide qual motor de reprodução usar pela URL. Promoção .ts -> .m3u8
// (padrão Xtream Codes) fica de fora daqui de propósito: aquilo depende de
// uma requisição de rede (fetch HEAD), então é assíncrono e vive dentro do
// hook, não nesta função pura.
export function detectStreamType(url: string): { type: StreamType; url: string } {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8')) return { type: 'hls', url };
  if (url.includes('/live/') || url.includes('/stream')) return { type: 'hls', url };
  return { type: 'mpegts', url };
}

export function usePlayer(videoRef: { current: HTMLVideoElement | null }) {
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);

  const release = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
  }, []);

  const play = useCallback((url: string) => {
    release();
    const video = videoRef.current;
    if (!video) return;
    const { type, url: finalUrl } = detectStreamType(url);
    if (type === 'hls' && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(finalUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else {
      const player = mpegts.createPlayer({ type: 'mse', isLive: true, url: finalUrl });
      player.attachMediaElement(video);
      player.load();
      player.play();
      mpegtsRef.current = player;
    }
  }, [videoRef, release]);

  return { play, release };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd sintoniza-tv-app && npx vitest run src/hooks/usePlayer.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Implementar `Sidebar`**

```tsx
// sintoniza-tv-app/src/components/Sidebar.tsx
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

export type SceneKey = 'home' | 'vod' | 'favs' | 'settings';

function Item({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onPress });
  return (
    <div
      ref={ref as any}
      onClick={onPress}
      className={`tv-sidebar-item ${active ? 'active' : ''} ${focused ? 'tv-focus' : ''}`}
    >
      {label}
    </div>
  );
}

export function Sidebar({ scene, onNavigate }: { scene: SceneKey; onNavigate: (s: SceneKey) => void }) {
  const { ref, focusKey } = useFocusable();
  return (
    <FocusContext.Provider value={focusKey}>
      <nav ref={ref as any} id="tv-sidebar">
        <Item label="Início" active={scene === 'home'} onPress={() => onNavigate('home')} />
        <Item label="Filmes e Séries" active={scene === 'vod'} onPress={() => onNavigate('vod')} />
        <Item label="Favoritos" active={scene === 'favs'} onPress={() => onNavigate('favs')} />
        <Item label="Configurações" active={scene === 'settings'} onPress={() => onNavigate('settings')} />
      </nav>
    </FocusContext.Provider>
  );
}
```

- [ ] **Step 6: Implementar `HomeScene`** (fileiras de canais/recentes/favoritos, reaproveitando `FocusableRow` da Tarefa 4 e `Channel` da Tarefa 1)

```tsx
// sintoniza-tv-app/src/scenes/HomeScene.tsx
import { FocusableRow } from '../components/FocusableRow';
import type { Channel } from '../lib/m3u';

export function HomeScene({
  channels,
  favoriteNames,
  onSelectChannel,
}: {
  channels: Channel[];
  // Favoritos são guardados pelo NOME do canal, não pelo id (mesma
  // convenção de sint_fav já usada em sintoniza-link.html e no vanilla
  // sintoniza-tv/sintoniza-tv.html - o id muda se a lista for recarregada
  // em ordem diferente, o nome não).
  favoriteNames: string[];
  onSelectChannel: (id: string) => void;
}) {
  const favorites = channels.filter((c) => favoriteNames.includes(c.name));

  return (
    <div id="tv-home">
      {favorites.length > 0 && (
        <FocusableRow
          label="Favoritos"
          items={favorites.map((c) => ({ id: String(c.id), title: c.name }))}
          onSelect={onSelectChannel}
        />
      )}
      <FocusableRow
        label="Canais ao vivo"
        items={
          channels.length
            ? channels.slice(0, 30).map((c) => ({ id: String(c.id), title: c.name }))
            : [{ id: 'empty', title: 'Nenhum canal carregado — abra Configurações' }]
        }
        onSelect={onSelectChannel}
      />
    </div>
  );
}
```

- [ ] **Step 7: Implementar `PlayerScene`**

```tsx
// sintoniza-tv-app/src/scenes/PlayerScene.tsx
import { useEffect, useRef } from 'preact/hooks';
import { usePlayer } from '../hooks/usePlayer';
import type { Channel } from '../lib/m3u';

export function PlayerScene({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { play, release } = usePlayer(videoRef);

  useEffect(() => {
    play(channel.url);
    return () => release();
  }, [channel.url, play, release]);

  return (
    <div id="tv-player-scene">
      <video ref={videoRef as any} autoPlay playsInline />
      <div id="tv-channel-info">
        <div className="tv-live-badge">AO VIVO</div>
        <div id="tv-channel-name">{channel.name}</div>
        <div id="tv-channel-category">{channel.category}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Implementar `DetailScene`** (ficha de série — placeholder funcional; a integração completa com a API `get_series_info` fica para quando o app tiver VOD ligado de verdade, fora do escopo desta rodada de migração)

```tsx
// sintoniza-tv-app/src/scenes/DetailScene.tsx
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

export function DetailScene({ title, plot, onPlay }: { title: string; plot: string; onPlay: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onPlay });
  return (
    <div id="tv-detail-scene">
      <h2 id="tv-detail-title">{title}</h2>
      <p id="tv-detail-plot">{plot}</p>
      <button ref={ref as any} onClick={onPlay} className={`tv-btn ${focused ? 'tv-focus' : ''}`}>
        Assistir
      </button>
    </div>
  );
}
```

- [ ] **Step 9: Implementar `App.tsx`** (substitui o provisório da Tarefa 0 — junta Sidebar + Settings + Home + Player num único estado de "scene atual", sem `react-router`: TV não navega por URL)

```tsx
// sintoniza-tv-app/src/App.tsx
import { useState, useEffect } from 'preact/hooks';
import { Sidebar, type SceneKey } from './components/Sidebar';
import { HomeScene } from './scenes/HomeScene';
import { SettingsScene } from './scenes/SettingsScene';
import { PlayerScene } from './scenes/PlayerScene';
import { parseM3U, type Channel } from './lib/m3u';
import { useLocalStorage } from './hooks/useLocalStorage';

export function App() {
  const [scene, setScene] = useState<SceneKey>('home');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playing, setPlaying] = useState<Channel | null>(null);
  // 'sint_fav' é a MESMA chave usada por sintoniza-link.html e pelo
  // sintoniza-tv/sintoniza-tv.html vanilla - guarda os nomes dos canais
  // favoritos, para o corte da Tarefa 10 não perder os favoritos que o
  // usuário já tinha salvo antes da migração.
  const [favNamesJson] = useLocalStorage('sint_fav', '[]');
  const [savedUrl] = useLocalStorage('sint_url', '');

  useEffect(() => {
    if (!savedUrl) return;
    fetch(savedUrl, { cache: 'no-store' })
      .then((r) => r.text())
      .then((text) => setChannels(parseM3U(text)))
      .catch(() => setChannels([]));
  }, [savedUrl]);

  if (playing) {
    return <PlayerScene channel={playing} />;
  }

  return (
    <div id="tv-app">
      <Sidebar scene={scene} onNavigate={setScene} />
      {scene === 'settings' ? (
        <SettingsScene
          onSave={({ m3u, epg, vod }) => {
            localStorage.setItem('sint_url', m3u);
            if (epg) localStorage.setItem('sint_epg_url', epg);
            if (vod) localStorage.setItem('sint_vod_url', vod);
            setScene('home');
            if (m3u) {
              fetch(m3u, { cache: 'no-store' })
                .then((r) => r.text())
                .then((text) => setChannels(parseM3U(text)))
                .catch(() => setChannels([]));
            }
          }}
        />
      ) : (
        <HomeScene
          channels={channels}
          favoriteNames={JSON.parse(favNamesJson || '[]')}
          onSelectChannel={(id) => {
            const ch = channels.find((c) => String(c.id) === id);
            if (ch) setPlaying(ch);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 10: Rodar a suíte inteira e confirmar que passa**

Run: `cd sintoniza-tv-app && npm test`
Expected: todos os testes passam (Tarefas 1-7).

- [ ] **Step 11: Commit**

```bash
git add sintoniza-tv-app/src
git commit -m "feat(tv-app): wire Home/Settings/Player scenes into the App shell"
```

---

### Tarefa 8: Empacotamento — `vite build` alimentando `ares-package`/`tizen package`, mais o teste de sintaxe automatizado no lugar certo

**Files:**
- Create: `sintoniza-tv-app/appinfo.json`
- Create: `sintoniza-tv-app/config.xml`
- Create: `sintoniza-tv-app/scripts/package-tv.mjs`
- Create: `sintoniza-tv-app/src/lib/__syntax-check__.test.ts`

- [ ] **Step 1: Copiar/adaptar `appinfo.json`** (do `sintoniza-tv/appinfo.json` atual — só o `main` continua apontando para `index.html`, que é exatamente o que o Vite gera)

```json
{
  "id": "com.sintoniza.iptv",
  "version": "2.0.0",
  "vendor": "Sintoniza",
  "type": "web",
  "main": "index.html",
  "title": "Sintoniza IPTV",
  "icon": "icon.png",
  "largeIcon": "icon.png",
  "uiRevision": 2,
  "requiredPermissions": ["media.operation"],
  "requiredACG": [],
  "resolution": {
    "resolutionWidth": 1920,
    "resolutionHeight": 1080
  }
}
```

- [ ] **Step 2: Copiar `config.xml`** (mesmo conteúdo do `sintoniza-tv/config.xml` atual, versão sincronizada com o `appinfo.json` acima)

- [ ] **Step 3: Escrever o script de empacotamento**

```js
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
```

- [ ] **Step 4: Rodar e confirmar**

Run: `cd sintoniza-tv-app && npm run package:tv`
Expected: `dist/index.html`, `dist/appinfo.json`, `dist/config.xml`, `dist/icon.png` presentes; nenhum erro.

- [ ] **Step 5: Escrever o teste que falha, para a verificação automática de sintaxe** (a MESMA proteção da Tarefa 1 do documento `docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md` — só que aqui ela roda contra a SAÍDA do build, que é o que realmente vai para a TV, e por isso é uma garantia mais forte do que checar o código-fonte)

```ts
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
    const files = require('node:fs').readdirSync(distDir).filter((f: string) => f.endsWith('-legacy.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(path.join(distDir, file), 'utf8');
      expect(() => acorn.parse(src, { ecmaVersion: 2019, sourceType: 'script', allowReturnOutsideFunction: true })).not.toThrow();
    }
  });
});
```

- [ ] **Step 6: Instalar o `acorn`** (é o mesmo parser já usado no repositório principal para essa mesma verificação — ver `docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md`, Tarefa 1)

```bash
cd sintoniza-tv-app
npm install -D acorn
```

- [ ] **Step 7: Rodar depois de um build e confirmar que passa**

Run: `cd sintoniza-tv-app && npm run build && npx vitest run src/lib/__syntax-check__.test.ts`
Expected: `1 passed` (ou `1 skipped` se rodado sem build antes — por isso o `describe.skipIf`).

- [ ] **Step 8: Commit**

```bash
git add sintoniza-tv-app/appinfo.json sintoniza-tv-app/config.xml sintoniza-tv-app/scripts/package-tv.mjs sintoniza-tv-app/src/lib/__syntax-check__.test.ts sintoniza-tv-app/package.json sintoniza-tv-app/package-lock.json
git commit -m "feat(tv-app): wire vite build into the existing ares-package/tizen package flow, plus a post-build syntax gate"
```

---

### Tarefa 9: Validação lado a lado no aparelho físico, antes de qualquer decisão de corte

**Não precisa da TV para as Tarefas 0-8.** Esta tarefa precisa, e só deve ser feita com autorização explícita do Gustavo (mesma regra de sempre).

- [ ] **Step 1: Empacotar com um `id` DIFERENTE do app vanilla**, para instalar os dois lado a lado sem um sobrescrever o outro. Em `sintoniza-tv-app/appinfo.json`, temporariamente:

```json
{ "id": "com.sintoniza.iptv.react", "title": "Sintoniza IPTV (React - teste)", ... }
```

- [ ] **Step 2: Empacotar e instalar**

```bash
cd sintoniza-tv-app
npm run package:tv
npx -y -p @webos-tools/cli ares-package dist -o "../app tv"
ares-install --device "Lg Tv" "../app tv/com.sintoniza.iptv.react_2.0.0_all.ipk"
ares-launch --device "Lg Tv" com.sintoniza.iptv.react
```

- [ ] **Step 2: Conectar o DevTools remoto ANTES de abrir** (mesma lição do incidente de 25/09 — nunca depois)

```bash
ares-inspect --device "Lg Tv" --app com.sintoniza.iptv.react
```

- [ ] **Step 3: Testar SÓ com D-pad físico** (sem tocar no modo ponteiro do Magic Remote): abrir Configurações pela sidebar, digitar as 3 URLs pelo teclado on-screen, salvar, ver a Home carregar, assistir um canal, voltar, reabrir o app do zero e confirmar que carrega sozinho.

- [ ] **Step 4: Comparar concretamente contra o vanilla**: os dois `.ipk` (vanilla `com.sintoniza.iptv` e React `com.sintoniza.iptv.react`) instalados ao mesmo tempo — qualquer diferença de comportamento deve ser investigada antes de prosseguir.

- [ ] **Step 5: Só depois de validado, trocar o `id` de volta para `com.sintoniza.iptv`** (assumindo o lugar do vanilla) e seguir para a Tarefa 10.

---

### Tarefa 10: Corte — o React vira o app de produção, o vanilla vira arquivo histórico

- [ ] **Step 1:** Confirmar com o Gustavo, explicitamente, que ele aprovou o app React no aparelho físico (mesma régua usada para promover uma branch de versão à `main` no resto do projeto).
- [ ] **Step 2:** Mover (não apagar) `sintoniza-tv/` para algo como `sintoniza-tv/README-DEPRECATED.md` explicando a migração e apontando para `sintoniza-tv-app/`, OU manter como está e só parar de gerar pacotes dele — decisão do Gustavo no momento, registrar a escolha aqui quando acontecer.
- [ ] **Step 3:** Atualizar `sintoniza-tv-app/appinfo.json`/`config.xml` de volta para `id: "com.sintoniza.iptv"` (produção).
- [ ] **Step 4:** Atualizar a memória do projeto (`sintoniza-versioning-workflow.md` ou equivalente) registrando que o app de TV agora é `sintoniza-tv-app/` (React/Preact + Vite), não mais `sintoniza-tv/` (vanilla).

---

## Checklist final de aceite (antes de considerar a migração pronta para o corte da Tarefa 10)

- [ ] `sintoniza-tv-app/` builda sem erro e gera `dist/` com um chunk `-legacy.js` (confirma que o `@vitejs/plugin-legacy` está ativo).
- [ ] Todos os testes de `sintoniza-tv-app` passam (`npm test`), incluindo o teste de sintaxe pós-build (Tarefa 8).
- [ ] Paridade de funcionalidade com o vanilla confirmada tela a tela: Início, Favoritos, Canais, Configurações revisável, teclado on-screen, reprodução ao vivo.
- [ ] Validado ao vivo, com D-pad físico apenas (sem modo ponteiro), no aparelho real do Gustavo, instalado lado a lado com o vanilla.
- [ ] Ícone do launcher corrigido (pendência arrastada desde `docs/superpowers/plans/2026-09-24-tv-app-reconstrucao.md`, seção 3.8) — usar `sintoniza-tv-app/public/icon.png` já no formato/composição corretos desde o início desta migração, para não arrastar a pendência de novo.
- [ ] Gustavo aprovou explicitamente antes do corte da Tarefa 10.

## Fontes consultadas nesta rodada de pesquisa

- [@vitejs/plugin-legacy — GitHub](https://github.com/vitejs/vite/tree/main/packages/plugin-legacy) e `registry.npmjs.org` (versão `8.2.3`, peer dependency `vite ^8.0.0`, confirmados ao vivo em 25/09/2026).
- [Preact vs React em 2025 — Medium](https://medium.com/@marketing_96787/preact-vs-react-in-2025-which-javascript-framework-delivers-the-best-performance-f2ded55808a4), [React vs Preact — DEV Community](https://dev.to/dct_technology/react-vs-preact-are-you-choosing-the-right-one-for-performance-in-2025-che), [Optimizing Performance in SmartTV Apps — TO THE NEW](https://www.tothenew.com/blog/optimizing-performance-in-smarttv-html-tv-apps).
- [Enact — LG webOS TV Developer](https://webostv.developer.lge.com), [From TV to Touch — GitNation](https://gitnation.com/contents/from-tv-to-touch-how-we-made-react-ui-work-across-every-input-mode).
- [Norigin Spatial Navigation — GitHub](https://github.com/NoriginMedia/Norigin-Spatial-Navigation) e `registry.npmjs.org` (pacotes `-core`/`-react`, versão `3.3.0`, peer dependency `react >=16.8.0`, confirmados ao vivo em 25/09/2026).
- [WICG/spatial-navigation](https://github.com/WICG/spatial-navigation) — navegação espacial ainda não nativa em nenhum navegador.
- `docs/superpowers/plans/2026-09-24-tv-app-reconstrucao.md` e `docs/superpowers/plans/2026-09-25-tv-app-boot-crash-e-boas-praticas.md` — os dois incidentes que motivam esta migração.
