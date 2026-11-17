import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STATE, apiUrl } from './e2e/env';

/** Browser-Tests der Oberfläche gegen die laufende Umgebung (`pnpm stack:up`), angemeldet als admin. */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['junit', { outputFile: '../../reports/web-e2e-junit.xml' }]],
  use: { baseURL: `${apiUrl}/ui/`, trace: 'off', locale: 'de-DE', storageState: ADMIN_STATE },
  projects: [
    { name: 'leitstand', use: { ...devices['Desktop Chrome'] }, testIgnore: /scanner/ },
    { name: 'scanner', use: { ...devices['Pixel 7'] }, testMatch: /scanner/ },
  ],
});
