import { defineConfig } from 'vitest/config';

// Unit-Tests der Hilfsfunktionen; Browser-Tests laufen mit Playwright (e2e/).
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
