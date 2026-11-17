import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Ports aus der .env im Projektverzeichnis (dieselbe Datei wie für docker compose).
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'WMS_');
  const api = `http://localhost:${env['WMS_API_PORT'] ?? '3000'}`;
  return {
    base: '/ui/',
    plugins: [react()],
    server: {
      port: Number(env['WMS_WEB_DEV_PORT'] ?? 5174),
      // Im Entwicklungsmodus gehen API-Aufrufe an die laufende API (gleicher Ursprung, kein CORS).
      proxy: { '/v1': api, '/health': api, '/openapi.json': api, '/test': api },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
