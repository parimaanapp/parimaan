import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // `server-only`'s package.json `exports` map resolves to a throwing
      // `index.js` under every condition except `react-server` (the
      // condition Next's own RSC-aware bundler sets when building
      // server-side code, where it resolves to a no-op `empty.js`
      // instead). Setting that condition globally for Vitest's whole SSR
      // pipeline also flips `react` itself onto its unsupported
      // `react-server` subset, so instead this aliases `server-only`
      // specifically, leaving every other package's conditions alone —
      // Vitest has no RSC bundler, so it never resolves `server-only` to
      // the no-op on its own, and this is the narrowest fix for that gap.
      'server-only': path.resolve(here, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
