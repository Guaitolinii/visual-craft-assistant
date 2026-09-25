// sintoniza-tv-app/vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import legacy from '@vitejs/plugin-legacy';

// Preact + preact/compat (Decisão 2 do plano de migração): runtime ~3KB
// contra ~42KB do React puro, recomendado para o hardware fraco de TV.
// O alias abaixo é o que faz bibliotecas do ecossistema React (aqui, a
// Norigin Spatial Navigation, que só declara "react" como peer dependency)
// funcionarem sem precisar instalar o React de verdade.
export default defineConfig({
  // Sem isso, o Vite gera os caminhos de asset como absolutos a partir da
  // raiz ("/assets/..."), que funciona num servidor http mas quebra num
  // app local: o ipk roda como file:///.../applications/<id>/index.html,
  // e "/assets/..." vira file:///assets/... (raiz do sistema de arquivos
  // do aparelho, não a pasta do app) - confirmado ao vivo via o domínio
  // Network do CDP: "net::ERR_ACCESS_DENIED file:///assets/index-....css".
  // Por isso a tela ficava preta e sem nenhum erro de JavaScript: nem o
  // CSS nem os scripts chegavam a carregar. base:'./' gera caminhos
  // relativos ("./assets/..."), que resolvem certo em qualquer pasta.
  base: './',
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  plugins: [
    preact(),
    // renderModernChunks:false = NUNCA gera <script type="module">. É a
    // própria documentação do plugin que recomenda isso para apps que
    // rodam via protocolo file:// (o nosso caso, um .ipk instalado): o
    // domínio Network do CDP confirmou ao vivo que o CSS carregava normal,
    // mas as duas tags <script type="module"> nunca chegavam a gerar
    // NENHUMA requisição de rede - o motor trata módulo ES + file:// como
    // não confiável e recusa em silêncio, sem erro nenhum (nem
    // window.onerror pega isso). O bundle "legacy" é JS clássico (sem
    // type="module", carregado via SystemJS), então não esbarra nessa
    // restrição.
    legacy({
      targets: ['chrome >= 68', 'samsung >= 6'],
      renderModernChunks: false,
    }),
  ],
  build: {
    target: 'es2017',
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // O Vitest não reaproveita resolve.alias automaticamente para todo
    // pacote (a @noriginmedia/norigin-spatial-navigation-react, compilada
    // como .mjs, escapava do alias de cima e carregava um react de
    // verdade à parte, dando "Cannot read properties of null" porque
    // aquele react nunca é inicializado por ninguém). Repetir aqui fecha
    // o buraco.
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
    // Isso sozinho não bastou: por padrão o Vitest trata pacotes .mjs
    // como "externos" e deixa o Node resolvê-los direto, pulando por
    // cima do alias acima. Forçar esse pacote a passar pelo pipeline do
    // Vite (que aplica o alias) resolve de vez.
    server: {
      deps: {
        inline: [/@noriginmedia\//],
      },
    },
  },
});
