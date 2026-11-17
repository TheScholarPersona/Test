import { expect, test } from './fixtures';

test('Scanner: TU bewegen, Regelverletzung als verständliche Meldung', async ({ page, fx }) => {
  const w = await fx.warehouse();
  await fx.stockedUnit(`PW-${fx.s}-T1`, w.sku, w.unitType, w.a, '6');
  await fx.stockedUnit(`PW-${fx.s}-T2`, w.sku, w.unitType, w.a, '6');
  await page.goto('./scanner');
  await expect(page).toHaveURL(/\/scanner\/bewegen$/);

  await page.getByLabel('TU scannen').fill(`PW-${fx.s}-T1`);
  await page.getByLabel('Platz scannen (ERP-Code)').fill(w.b);
  await page.getByRole('button', { name: 'Buchen' }).click();
  await expect(page.getByRole('status')).toContainText(`PW-${fx.s}-T1 steht auf ${w.b}`);
  // Fokus zurück im ersten Feld: der nächste Scan kann sofort kommen.
  await expect(page.getByLabel('TU scannen')).toBeFocused();

  // Platz B fasst nur eine TU.
  await page.getByLabel('TU scannen').fill(`PW-${fx.s}-T2`);
  await page.getByLabel('Platz scannen (ERP-Code)').fill(w.b);
  await page.getByRole('button', { name: 'Buchen' }).click();
  await expect(page.getByRole('alert')).toContainText('PLACEMENT_REJECTED');
});

test('Scanner: Wareneingang ohne Avis', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const barcode = `PW-${fx.s}-NEU`;
  fx.onCleanup(async () => {
    const item = (await fx.api('GET', `/v1/stock?barcode=${barcode}`)).items[0];
    if (item) await fx.api('POST', `/v1/stock/${item.id}/corrections`, { delta: { amount: `-${item.quantity.amount}`, unit: 'PCS' }, reason: 'Aufräumen' });
    await fx.api('DELETE', `/v1/transport-units/${barcode}`).catch(() => undefined);
  });
  await page.goto('./scanner/wareneingang');
  await page.getByLabel('Artikel (SKU)').fill(w.sku);
  await page.getByLabel('Menge').fill('3');
  await page.getByLabel('Einheit').fill('KAR');
  await page.getByLabel('TU scannen (leer = neue TU)').fill(barcode);
  await page.getByLabel('TU-Typ (nur neue TU)').fill(w.unitType);
  await page.getByLabel('Platz (ERP-Code)').fill(w.a);
  await page.getByRole('button', { name: 'Erfassen' }).click();
  // Wareneingang bucht in der Basiseinheit: Kartons werden abgelehnt, Stück angenommen.
  await expect(page.getByRole('alert')).toContainText('UNIT_MISMATCH');
  await page.getByLabel('Menge').fill('18');
  await page.getByLabel('Einheit').fill('PCS');
  await page.getByRole('button', { name: 'Erfassen' }).click();
  await expect(page.getByRole('status')).toContainText(`auf ${barcode} (Bestand 18)`);
});

test('Scanner: Pick quittieren mit TU-Kontrolle', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const barcode = `PW-${fx.s}-PK`;
  await fx.stockedUnit(barcode, w.sku, w.unitType, w.a, '30');
  const active = (await fx.api('GET', '/v1/strategy-rule-sets?decisionPoint=allocation')).items.some((r: { status: string }) => r.status === 'ACTIVE');
  test.skip(!active, 'Kein aktiver Auslager-Regelsatz (pnpm demo:data oder das Szenario outbound-flow legen einen an)');
  const orderId = `PW-${fx.s}-SCAN`;
  await fx.api('POST', '/v1/outbound-orders', { orderId, target: { erpCode: w.ship }, lines: [{ sku: w.sku, quantity: { amount: '1', unit: 'KAR' } }] });
  fx.onCleanup(() => fx.api('POST', `/v1/outbound-orders/${orderId}/cancel`, {}).catch(() => undefined));
  await fx.api('POST', `/v1/outbound-orders/${orderId}/allocate`, { transport: 'none' });

  await page.goto('./scanner/picken');
  await page.getByRole('button', { name: new RegExp(orderId) }).click();
  await page.getByLabel('TU scannen (Kontrolle)').fill('FALSCHE-TU');
  await page.getByRole('button', { name: 'Quittieren' }).click();
  await expect(page.getByRole('alert')).toContainText(`erwartet ${barcode}`);
  await page.getByLabel('TU scannen (Kontrolle)').fill(barcode);
  await page.getByRole('button', { name: 'Quittieren' }).click();
  await expect(page.getByRole('status')).toContainText(`von ${barcode} quittiert`);
  expect((await fx.api('GET', `/v1/stock?barcode=${barcode}`)).items[0].quantity.amount).toBe('24');
  expect((await fx.api('GET', `/v1/outbound-orders/${orderId}`)).state).toBe('COMPLETED');
});

test('Scanner: am Packplatz packen und mit Ladekontrolle verladen', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const source = `PW-${fx.s}-SQ`;
  const box = `PW-${fx.s}-SV`;
  await fx.stockedUnit(source, w.sku, w.unitType, w.a, '12');
  const active = (await fx.api('GET', '/v1/strategy-rule-sets?decisionPoint=allocation')).items.some((r: { status: string }) => r.status === 'ACTIVE');
  test.skip(!active, 'Kein aktiver Auslager-Regelsatz (pnpm demo:data oder das Szenario outbound-flow legen einen an)');
  await fx.api('POST', '/v1/transport-units', { barcode: box, typeCode: w.unitType, location: { erpCode: w.ship } });
  fx.onCleanup(async () => {
    const stock = await fx.api('GET', `/v1/stock?barcode=${box}`).catch(() => ({ items: [] }));
    for (const item of stock.items) await fx.api('POST', `/v1/stock/${item.id}/corrections`, { delta: { amount: `-${item.quantity.amount}`, unit: 'PCS' }, reason: 'Aufräumen' });
    await fx.api('DELETE', `/v1/transport-units/${box}`).catch(() => undefined);
  });
  const orderId = `PW-${fx.s}-SP`;
  await fx.api('POST', '/v1/outbound-orders', { orderId, target: { erpCode: w.ship }, lines: [{ sku: w.sku, quantity: { amount: '5', unit: 'PCS' } }] });
  fx.onCleanup(() => fx.api('POST', `/v1/outbound-orders/${orderId}/cancel`, {}).catch(() => undefined));
  await fx.api('POST', `/v1/outbound-orders/${orderId}/allocate`, { transport: 'none' });

  await page.goto('./scanner/packen');
  await page.getByLabel('Pick-TU scannen').fill(source);
  await expect(page.getByLabel('Pick', { exact: true })).toContainText(`Auftrag ${orderId}`);
  await page.getByLabel('Versand-TU scannen').fill(box);
  await page.getByRole('button', { name: 'Packen' }).click();
  await expect(page.getByRole('status')).toContainText(`5 PCS ${w.sku} auf ${box} gepackt`);
  await expect(page.getByLabel('Pick-TU scannen')).toBeFocused();
  expect((await fx.api('GET', `/v1/stock?barcode=${box}`)).items[0].quantity.amount).toBe('5');

  const shipment = await fx.api('POST', '/v1/shipments', { orderId, units: [box] });
  fx.onCleanup(() => fx.api('POST', `/v1/shipments/${shipment.number}/cancel`, {}).catch(() => undefined));
  await page.goto('./scanner/verladen');
  await page.getByLabel('Sendung scannen').fill(shipment.number);
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.getByLabel('Sendung', { exact: true })).toContainText('Verladen 0 von 1');
  await page.getByLabel('TU scannen (Verladen)').fill(source);
  await page.getByRole('button', { name: 'Verladen' }).click();
  await expect(page.getByRole('alert')).toContainText(`TU ${source} gehört nicht zur Sendung`);
  await page.getByLabel('TU scannen (Verladen)').fill(box);
  await page.getByRole('button', { name: 'Verladen' }).click();
  await expect(page.getByRole('status')).toContainText(`Sendung ${shipment.number} vollständig verladen`);
  await expect(page.getByLabel('Sendung', { exact: true })).toContainText('Verladen 1 von 1 · LOADED');
});
