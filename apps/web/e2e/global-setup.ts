import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { ADMIN_STATE, apiUrl } from './env';

/** Einmal als admin anmelden; Sitzungs-Cookie für alle Tests speichern. */
export default async function globalSetup(): Promise<void> {
  const password = process.env['WMS_ADMIN_PASSWORD'];
  if (!password) throw new Error('WMS_ADMIN_PASSWORD fehlt – pnpm env:init ausführen');
  const context = await request.newContext({ baseURL: apiUrl });
  const response = await context.post('/v1/auth/login', { data: { username: 'admin', password } });
  if (!response.ok()) throw new Error(`Anmeldung als admin fehlgeschlagen: HTTP ${response.status()} ${await response.text()}`);
  mkdirSync(dirname(ADMIN_STATE), { recursive: true });
  await context.storageState({ path: ADMIN_STATE });
  await context.dispose();
}
