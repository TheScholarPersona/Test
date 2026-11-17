import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Ports aus der .env im Projektverzeichnis (dieselbe Datei wie für docker compose).
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const api = process.env['WMS_API_URL'] ?? `http://localhost:${process.env['WMS_API_PORT'] ?? '3000'}`;

/** Browser-Tests der Oberfläche gegen die laufende Umgebung (`pnpm stack:up`). */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['junit', { outputFile: '../../reports/web-e2e-junit.xml' }]],
  use: { baseURL: `${api}/ui/`, trace: 'off', locale: 'de-DE' },
  projects: [
    { name: 'leitstand', use: { ...devices['Desktop Chrome'] }, testIgnore: /scanner/ },
    { name: 'scanner', use: { ...devices['Pixel 7'] }, testMatch: /scanner/ },
  ],
});
