import { defineConfig } from 'vitest/config';

// Node-RED läuft als ein Server je Testdatei; Tests nacheinander.
export default defineConfig({ test: { include: ['test/**/*.test.mjs'], fileParallelism: false, testTimeout: 10000 } });
