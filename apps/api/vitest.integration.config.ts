import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from './vitest.shared.js';

/** Integrationstests starten echte Container (PostgreSQL, Mosquitto) über Testcontainers. */
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['test/integration/**/*.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 180_000,
      fileParallelism: false,
    },
  }),
);
