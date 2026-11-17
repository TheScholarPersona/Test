import { expect, test } from './fixtures';

/** Leitstand-Seiten, deren Fachfunktionen die API-Tests prüfen – hier die Bedienung im Browser. */

test('Wareneingang: Avis anlegen, Ware erfassen, Auftrag abschließen', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const orderId = `PW-${fx.s}-WE`;
  const barcode = `PW-${fx.s}-WE1`;
  fx.onCleanup(async () => {
    const item = (await fx.api('GET', `/v1/stock?barcode=${barcode}`)).items[0];
    if (item) await fx.api('POST', `/v1/stock/${item.id}/corrections`, { delta: { amount: `-${item.quantity.amount}`, unit: 'PCS' }, reason: 'Aufräumen' });
    await fx.api('DELETE', `/v1/transport-units/${barcode}`).catch(() => undefined);
  });

  await page.goto('./wareneingang');
  const form = page.locator('section', { hasText: 'Avis anlegen' });
  await form.getByLabel('Auftrag').fill(orderId);
  await form.getByLabel('SKU').fill(w.sku);
  await form.getByLabel('Menge').fill('10');
  await form.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`Avis ${orderId} angelegt`)).toBeVisible();

  await page.getByRole('row', { name: new RegExp(orderId) }).click();
  const detail = page.locator('section', { hasText: `Auftrag ${orderId}` });
  await detail.getByLabel('Menge').fill('4');
  await detail.getByLabel('TU-Barcode').fill(barcode);
  await detail.getByLabel('TU-Typ (neue TU)').selectOption(w.unitType);
  await detail.getByLabel('Platz').selectOption({ label: `${w.a} (${w.group})` });
  await detail.getByRole('button', { name: 'Erfassen' }).click();
  await expect(page.getByText(`4 PCS ${w.sku} erfasst`)).toBeVisible();
  await expect(detail.getByRole('row', { name: new RegExp(`^1 ${w.sku}`) })).toContainText('IN_PROGRESS');

  await detail.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByText('Auftrag abgeschlossen')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(orderId) })).toContainText('PARTIALLY_COMPLETED');
  expect((await fx.api('GET', `/v1/stock?barcode=${barcode}`)).items[0].quantity.amount).toBe('4');
});

test('Transport: Lagerbewegung und Transportauftrag bedienen', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const barcode = `PW-${fx.s}-TR`;
  await fx.api('POST', '/v1/transport-units', { barcode, typeCode: w.unitType, location: { erpCode: w.a } });
  fx.onCleanup(() => fx.api('DELETE', `/v1/transport-units/${barcode}`));
  const movement = await fx.api('POST', '/v1/movements', { barcode, type: 'RELOCATION', target: { location: { erpCode: w.b } } });
  fx.onCleanup(() => fx.api('POST', `/v1/movements/${movement.number}/cancel`, {}).catch(() => undefined));

  await page.goto('./transport');
  const mvRow = page.getByRole('row', { name: new RegExp(movement.number) });
  await mvRow.getByRole('button', { name: 'Beginnen' }).click();
  await expect(page.getByText(`${movement.number}: start ausgeführt`)).toBeVisible();
  await expect(mvRow).toContainText('IN_PROGRESS');
  await mvRow.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByText(`${movement.number}: complete ausgeführt`)).toBeVisible();
  await expect(mvRow).toHaveCount(0);
  expect((await fx.api('GET', `/v1/movements/${movement.number}`)).state).toBe('DONE');

  const order = await fx.api('POST', '/v1/transport-orders', { barcode, target: { location: { erpCode: w.a } }, autoStart: false });
  fx.onCleanup(() => fx.api('POST', `/v1/transport-orders/${order.number}/cancel`, {}).catch(() => undefined));
  // Nach mehreren Aktionen zeigt die Seite die Meldung der zuletzt ausgeführten.
  await page.getByRole('button', { name: 'Wartende starten' }).click();
  await expect(page.getByRole('status')).toHaveText('Wartende Aufträge geprüft');
  const toRow = page.getByRole('row', { name: new RegExp(order.number) });
  await expect(toRow).toContainText('STARTED');
  await toRow.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('status')).toHaveText(`${order.number}: finish ausgeführt`);
  await expect(toRow).toHaveCount(0);
  expect((await fx.api('GET', `/v1/transport-orders/${order.number}`)).state).toBe('FINISHED');
});

test('Materialfluss: Konfiguration ansehen und Geräte-Ereignis im Probelauf senden', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const plcCode = `PW${fx.s}`;
  const location = await fx.api('POST', '/v1/locations', { locationId: `F${fx.s.slice(-6)}/0001/0001/0001/0000`, plcCode, groupName: w.group, typeCode: w.type });
  fx.onCleanup(() => fx.api('DELETE', `/v1/locations/${location.id}`));
  const routeId = `PW-${fx.s}`;
  await fx.api('POST', '/v1/flow/routes', { routeId, description: 'Playwright', source: { group: w.group }, target: { group: w.group } });
  fx.onCleanup(() => fx.api('DELETE', `/v1/flow/routes/${routeId}`));
  const action = `pw-${fx.s.toLowerCase()}`;
  await fx.api('POST', '/v1/flow/actions', { name: action, eventType: 'error', routeId, place: { group: w.group }, program: 'interrupt-order' });
  fx.onCleanup(() => fx.api('DELETE', `/v1/flow/actions/${action}`));

  await page.goto('./materialfluss');
  const panel = (title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(panel('Routen').getByText(routeId, { exact: true })).toBeVisible();
  await expect(panel('Action-Matrix').getByRole('row', { name: new RegExp(action) })).toContainText(`Gruppe ${w.group}`);

  const form = page.locator('section', { hasText: 'Geräte-Ereignis senden' });
  await form.getByLabel('Anlagen-Code (plcCode)').fill(plcCode);
  await form.getByLabel('TU-Barcode').fill(`PW-${fx.s}-UNBEKANNT`);
  await expect(form.getByLabel('Probelauf')).toBeChecked();
  await form.getByRole('button', { name: 'Senden' }).click();
  await expect(form.getByRole('list', { name: 'Begründung' })).toContainText('Ergebnis:');
});

test('Ereignisse: zeigt Live-Ereignisse und filtert nach Typ', async ({ page, fx }) => {
  await page.goto('./ereignisse');
  await expect(page.getByText('verbunden')).toBeVisible();
  const code = `PW-${fx.s}-EV`;
  await fx.api('POST', '/v1/location-types', { code });
  fx.onCleanup(() => fx.api('DELETE', `/v1/location-types/${code}`));
  await fx.api('POST', '/v1/location-groups', { name: `PW-${fx.s}-EVG` });
  fx.onCleanup(() => fx.api('DELETE', `/v1/location-groups/PW-${fx.s}-EVG`));

  const feed = page.getByRole('list', { name: 'Ereignisse' });
  await expect(feed).toContainText('location-type.created');
  await expect(feed).toContainText('location-group.created');
  await page.getByLabel('Typ enthält').fill('location-type');
  await expect(feed).toContainText('location-type.created');
  await expect(feed).not.toContainText('location-group.created');
});

test('Benutzer: anlegen mit Rolle, Rollen ansehen, sperren', async ({ page, fx }) => {
  const username = `pw-${fx.s.toLowerCase()}-u`;
  fx.onCleanup(() => fx.api('PATCH', `/v1/users/${username}`, { active: false }).catch(() => undefined));
  await page.goto('./benutzer');
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Rollen', exact: true }) })).toContainText('Nur ansehen');

  const form = page.locator('section', { hasText: 'Benutzer anlegen' });
  await form.getByLabel('Benutzername').fill(username);
  await form.getByLabel('Name', { exact: true }).fill('Playwright Lesen');
  await form.getByLabel('Startpasswort (mind. 10 Zeichen)').fill(`lesen-${fx.s}-pw`);
  await form.getByLabel('lager', { exact: true }).uncheck(); // Vorauswahl der Seite
  await form.getByLabel('lesen', { exact: true }).check();
  await form.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`Benutzer ${username} angelegt`)).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(username) });
  await expect(row).toContainText('aktiv');
  await row.getByRole('button', { name: 'Sperren' }).click();
  await expect(row).toContainText('gesperrt');
  expect((await fx.api('GET', '/v1/users')).find((u: { username: string }) => u.username === username)).toMatchObject({ active: false, roles: ['lesen'] });
});

test('Störungen: Anlagenzustand eines Platzes und Fehlermeldung an einer TU', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const barcode = `PW-${fx.s}-ST`;
  await fx.api('POST', '/v1/transport-units', { barcode, typeCode: w.unitType, location: { erpCode: w.a } });
  fx.onCleanup(() => fx.api('DELETE', `/v1/transport-units/${barcode}`));
  fx.onCleanup(() => fx.api('PATCH', `/v1/locations/${w.ids['b']}/plc-state`, { plcState: 0 }));
  await fx.api('PATCH', `/v1/locations/${w.ids['b']}/plc-state`, { plcState: 12, text: `Lichtschranke ${fx.s}` });
  await fx.api('POST', `/v1/transport-units/${barcode}/errors`, { code: 'KONTUR', message: `Überstand ${fx.s}` });

  await page.goto('./');
  const faults = page.getByRole('table', { name: 'Störungen' });
  await expect(faults.getByRole('row', { name: new RegExp(`Lichtschranke ${fx.s}`) })).toContainText('Anlage 12');
  const row = faults.getByRole('row', { name: new RegExp(barcode) });
  await expect(row).toContainText('KONTUR');
  await row.getByRole('button', { name: 'Erledigt' }).click();
  await expect(page.getByRole('status')).toHaveText(`Fehlermeldung an ${barcode} erledigt`);
  await expect(row).toHaveCount(0);

  await page.goto('./lagerplaetze');
  await page.getByRole('button', { name: w.group }).click();
  await expect(page.getByRole('row', { name: new RegExp(w.b) })).toContainText('Störung 12');
});

test('Bewegungsgruppen: bilden, zuteilen, beginnen und zurückgeben', async ({ page, fx }) => {
  const w = await fx.warehouse();
  const numbers: string[] = [];
  for (const n of [1, 2]) {
    const barcode = `PW-${fx.s}-G${n}`;
    await fx.api('POST', '/v1/transport-units', { barcode, typeCode: w.unitType, location: { erpCode: w.a } });
    fx.onCleanup(() => fx.api('DELETE', `/v1/transport-units/${barcode}`));
    const m = await fx.api('POST', '/v1/movements', { barcode, type: 'RELOCATION', target: { location: { erpCode: w.ship } } });
    fx.onCleanup(() => fx.api('POST', `/v1/movements/${m.number}/cancel`, {}).catch(() => undefined));
    numbers.push(m.number);
  }
  const operator = `stapler-${fx.s.toLowerCase()}`;

  await page.goto('./transport');
  for (const n of numbers) await page.getByLabel(`${n} auswählen`).check();
  await page.getByLabel('Bediener').fill(operator);
  await page.getByRole('button', { name: 'Gruppe bilden (2)' }).click();
  await expect(page.getByRole('status')).toHaveText('Bewegungsgruppe mit 2 Bewegungen gebildet');

  const row = page.getByRole('table', { name: 'Bewegungsgruppen' }).getByRole('row', { name: new RegExp(operator) });
  await expect(row).toContainText('2 offen');
  await row.getByRole('button', { name: 'Beginnen' }).click();
  await expect(row).toContainText('2 in Arbeit');
  for (const n of numbers) expect((await fx.api('GET', `/v1/movements/${n}`)).assignedTo).toBe(operator);
  await row.getByRole('button', { name: 'Zurückgeben' }).click();
  await expect(page.getByRole('status')).toContainText('zurückgegeben');
  for (const n of numbers) expect((await fx.api('GET', `/v1/movements/${n}`)).state).toBe('OPEN');
});
