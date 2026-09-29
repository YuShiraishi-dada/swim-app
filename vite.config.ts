import { defineConfig } from 'vite';

// base を相対パスにしておくと GitHub Pages の /<repo名>/ 配下でもそのまま動く
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
});
