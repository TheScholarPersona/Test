import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ports und Passwörter aus der .env im Projektverzeichnis (dieselbe Datei wie für docker compose).
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const apiUrl = process.env['WMS_API_URL'] ?? `http://localhost:${process.env['WMS_API_PORT'] ?? '3000'}`;
/** Gespeicherte admin-Sitzung (global-setup.ts); steht in .gitignore. */
export const ADMIN_STATE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));
