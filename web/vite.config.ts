import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rutas relativas: funciona en GitHub Pages sin saber el nombre del repo
  base: './',
  test: { environment: 'node' },
});
