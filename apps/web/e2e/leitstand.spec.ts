import { expect, test } from './fixtures';

test('Übersicht zeigt Systemzustand und Live-Verbindung', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  const system = page.locator('section', { hasText: 'System' });
  await expect(system.getByText('ok', { exact: true })).toBeVisible();
  await expect(system.getByText('verbunden')).toBeVisible();
});

test('Bestand zeigt Posten und aktualisiert sich live nach einem Abgang', async ({ page, fx }) => {
  const w = await fx.warehouse();
  await fx.stockedUnit(`PW-${fx.s}-T1`, w.sku, w.unitType, w.a, '30');
  await page.goto('./bestand');
  await page.getByLabel('SKU').fill(w.sku);
  const items = page.locator('section', { hasText: 'Bestandsposten' });
  const row = items.getByRole('row', { name: new RegExp(`PW-${fx.s}-T1`) });
  await expect(row).toContainText('30 PCS');
  // Abgang über die API – die Seite lädt durch das Live-Ereignis neu, ohne Reload.
  const item = (await fx.api('GET', `/v1/stock?barcode=PW-${fx.s}-T1`)).items[0];
  await fx.api('POST', `/v1/stock/${item.id}/issues`, { quantity: { amount: '1', unit: 'KAR' }, reference: 'playwright' });
  await expect(row).toContainText('24 PCS');
});

test('Auslagerauftrag: anlegen, zuteilen, quittieren', async ({ page, fx }) => {
  const w = await fx.warehouse();
  await fx.stockedUnit(`PW-${fx.s}-T1`, w.sku, w.unitType, w.a, '30');
  const active = (await fx.api('GET', '/v1/strategy-rule-sets?decisionPoint=allocation')).items.some((r: { status: string }) => r.status === 'ACTIVE');
  test.skip(!active, 'Kein aktiver Auslager-Regelsatz (pnpm demo:data oder das Szenario outbound-flow legen einen an)');
  const orderId = `PW-${fx.s}-AUF`;
  fx.onCleanup(() => fx.api('POST', `/v1/outbound-orders/${orderId}/cancel`, {}).catch(() => undefined));

  await page.goto('./auslagerung');
  const form = page.locator('section', { hasText: 'Auslagerauftrag anlegen' });
  await form.getByLabel('Auftrag').fill(orderId);
  await form.getByLabel('SKU').fill(w.sku);
  await form.getByLabel('Menge').fill('2');
  await form.getByLabel('Einheit').fill('KAR');
  await form.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`Auslagerauftrag ${orderId} angelegt`)).toBeVisible();

  await page.getByRole('row', { name: new RegExp(orderId) }).click();
  const detail = page.locator('section', { hasText: `Auftrag ${orderId}` });
  await detail.getByRole('button', { name: 'Zuteilen' }).click();
  await expect(detail.getByRole('row', { name: new RegExp(`PW-${fx.s}-T1`) })).toContainText('12 PCS');
  await detail.getByRole('button', { name: 'Quittieren' }).click();
  await expect(detail.getByText('COMPLETED').first()).toBeVisible();
  expect((await fx.api('GET', `/v1/stock?barcode=PW-${fx.s}-T1`)).items[0].quantity.amount).toBe('18');
});

test('Lagerplatz sperren zeigt die Sperre und hebt sie wieder auf', async ({ page, fx }) => {
  const w = await fx.warehouse();
  await page.goto('./lagerplaetze');
  await page.getByRole('button', { name: w.group }).click();
  const row = page.getByRole('row', { name: new RegExp(w.a) });
  await row.getByRole('button', { name: 'Ein sperren' }).click();
  await expect(row).toContainText('Ein gesperrt');
  await row.getByRole('button', { name: 'Ein frei' }).click();
  await expect(row).toContainText('Ein frei');
});
