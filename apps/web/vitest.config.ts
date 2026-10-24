import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Deux tests (`lib/agent/mobile-*.test.ts`) importent des fichiers de l'application mobile, dont le tsconfig hérite d'`expo` : sans ses dépendances
  // installées, Vite échouerait à le lire. Les tests n'ont besoin d'aucune option de tsconfig : on ne la cherche pas.
  esbuild: { tsconfigRaw: '{}' },
  test: { include: ['src/**/*.test.ts'] },
});
