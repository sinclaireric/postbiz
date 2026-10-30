import { defineConfig } from 'vitest/config';

// Quelques tests lisent un texte de 1,5 Mo ou une archive piégée, et le réseau local est réel : sur une machine chargée (plusieurs suites de tests en même temps) ils passent
// 5 secondes, alors qu'ils en prennent 2 seul. Le délai de 5 s par défaut ferait échouer un test juste.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 } });
