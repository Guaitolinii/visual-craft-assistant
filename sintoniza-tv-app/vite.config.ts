import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    preact(),
    legacy({
      targets: ['chrome >= 68', 'samsung >= 6'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
      modernPolyfills: true,
    }),
  ],
  build: {
    target: 'es2017',
    outDir: 'dist',
  },
});
