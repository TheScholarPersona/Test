import { ADMIN_STATE } from './env';
import { expect, test } from './fixtures';

/** Diese Tests starten ohne die gespeicherte admin-Sitzung. */
test.use({ storageState: { cookies: [], origins: [] } });

test('Anmeldung: falsches Passwort, Anmelden, Abmelden', async ({ page }) => {
  await page.goto('./');
  const form = page.getByRole('form', { name: 'Anmeldung' });
  await form.getByLabel('Benutzername').fill('admin');
  await form.getByLabel('Passwort').fill('ganz-sicher-falsch');
  await form.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await form.getByLabel('Passwort').fill(process.env['WMS_ADMIN_PASSWORD']!);
  await form.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Benutzer' })).toBeVisible();

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('form', { name: 'Anmeldung' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('form', { name: 'Anmeldung' })).toBeVisible();
});

test('Rolle lager: keine Benutzerverwaltung, kein Anlegen von Auslageraufträgen', async ({ page, browser, fx }) => {
  const username = `pw-${fx.s.toLowerCase()}`;
  const password = `lager-${fx.s}-passwort`;
  // Benutzer mit der admin-Sitzung (eigener Kontext) anlegen und am Ende sperren.
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const created = await admin.request.post(fx.url('/v1/users'), { data: { username, displayName: 'Playwright Lager', password, roles: ['lager'] } });
  expect(created.status()).toBe(201);

  try {
    await page.goto('./');
    const form = page.getByRole('form', { name: 'Anmeldung' });
    await form.getByLabel('Benutzername').fill(username);
    await form.getByLabel('Passwort').fill(password);
    await form.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByLabel('Angemeldet')).toContainText('lager');
    await expect(page.getByRole('link', { name: 'Benutzer', exact: true })).toHaveCount(0);

    await page.goto('./auslagerung');
    await expect(page.getByRole('heading', { name: 'Auslagerung' })).toBeVisible();
    await expect(page.getByText('Auslagerauftrag anlegen')).toHaveCount(0);

    await page.goto('./benutzer');
    await expect(page.getByRole('heading', { name: 'Benutzer' })).toHaveCount(0);
  } finally {
    await admin.request.patch(fx.url(`/v1/users/${username}`), { data: { active: false } });
    await admin.close();
  }
});

test('Konto: eigenes Passwort ändern und mit dem neuen anmelden', async ({ page, browser, fx }) => {
  const username = `pw-${fx.s.toLowerCase()}-k`;
  const first = `erstes-${fx.s}-pw`;
  const second = `zweites-${fx.s}-pw`;
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  expect((await admin.request.post(fx.url('/v1/users'), { data: { username, password: first, roles: ['lesen'] } })).status()).toBe(201);
  const login = async (password: string) => {
    const form = page.getByRole('form', { name: 'Anmeldung' });
    await form.getByLabel('Benutzername').fill(username);
    await form.getByLabel('Passwort').fill(password);
    await form.getByRole('button', { name: 'Anmelden' }).click();
  };
  try {
    await page.goto('./konto');
    await login(first);
    await expect(page.getByRole('heading', { name: 'Konto' })).toBeVisible();
    await page.getByLabel('Bisheriges Passwort').fill(first);
    await page.getByLabel('Neues Passwort (mind. 10 Zeichen)').fill(second);
    await page.getByRole('button', { name: 'Ändern' }).click();
    await expect(page.getByRole('status')).toContainText('Passwort geändert');

    await page.getByRole('button', { name: 'Abmelden' }).click();
    await login(first);
    await expect(page.getByRole('alert')).toBeVisible();
    await login(second);
    await expect(page.getByLabel('Angemeldet')).toContainText('lesen');
  } finally {
    await admin.request.patch(fx.url(`/v1/users/${username}`), { data: { active: false } });
    await admin.close();
  }
});
