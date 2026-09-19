import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

// โปรเจกต์แยกของ spike (T-201) — ไม่เกี่ยวกับ web/ app จริง
// base: './' เพื่อให้ dist ถูก serve ที่ path ไหนก็ได้ (server.mjs)
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    rollupOptions: {
      input: {
        s1: resolve(dir, 'pages/s1/index.html'),
        s1remote: resolve(dir, 'pages/s1-remote/index.html'),
        s2: resolve(dir, 'pages/s2/index.html'),
        s3: resolve(dir, 'pages/s3/index.html'),
        s4: resolve(dir, 'pages/s4/index.html'),
        s5: resolve(dir, 'pages/s5/index.html'),
        s5blob: resolve(dir, 'pages/s5-blob/index.html'),
      },
    },
  },
});
