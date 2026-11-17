import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Ein Szenario darf so lange dauern wie der link-call-Timeout in Node-RED (60 s).
    testTimeout: 70_000,
    // Szenarien laufen nacheinander, damit sich Ereignisse nicht überlagern.
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['default', ['junit', { suiteName: 'Node-RED-Szenarien' }]],
    outputFile: { junit: '../../reports/e2e-junit.xml' },
  },
});
