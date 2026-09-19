import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: dir,
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'out',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        reactpdf: resolve(dir, 'reactpdf.html'),
        sdk: resolve(dir, 'sdk.html'),
        minisearch: resolve(dir, 'minisearch.html'),
        dompurify: resolve(dir, 'dompurify.html'),
        duckdb: resolve(dir, 'duckdb.html'),
        pdfjs: resolve(dir, 'pdfjs.html'),
      },
    },
  },
});
