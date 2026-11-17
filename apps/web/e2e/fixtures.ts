import { type APIRequestContext, test as base, expect } from '@playwright/test';

/** Testdaten über die öffentliche API, eindeutig je Lauf; `cleanup` räumt sie in umgekehrter Reihenfolge ab. */
export class Fixtures {
  readonly s = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  private readonly undo: (() => Promise<unknown>)[] = [];

  constructor(private readonly request: APIRequestContext) {}

  /** Absolute API-URL (baseURL zeigt auf /ui/). */
  url(path: string): string {
    return new URL(path, test.info().project.use.baseURL).toString();
  }

  async api<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<T> {
    const response = await this.request.fetch(this.url(path), { method, ...(data === undefined ? {} : { data }) });
    const text = await response.text();
    expect(response.ok(), `${method} ${path} → ${response.status()} ${text}`).toBe(true);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  onCleanup(fn: () => Promise<unknown>): void {
    this.undo.push(fn);
  }

  /** Lager mit zwei Plätzen (A frei, B mit Platz für eine TU), TU-Typ und Produkt in PCS (Karton = 6). */
  async warehouse() {
    const s = this.s;
    const names = { type: `PW-${s}`, group: `PW-${s}-G`, unitType: `PW-${s}`, sku: `PW-${s}-ART`, a: `PW-${s}-A`, b: `PW-${s}-B`, ship: `PW-${s}-V` };
    await this.api('POST', '/v1/location-types', { code: names.type });
    this.onCleanup(() => this.request.delete(this.url(`/v1/location-types/${names.type}`)));
    await this.api('POST', '/v1/location-groups', { name: names.group });
    this.onCleanup(() => this.request.delete(this.url(`/v1/location-groups/${names.group}`)));
    const ids: Record<string, string> = {};
    for (const [key, x, max] of [['a', 1, 10], ['b', 2, 1], ['ship', 9, 10]] as const) {
      const l = await this.api<{ id: string }>('POST', '/v1/locations', {
        locationId: `W${s.slice(-6)}/0001/000${x}/0001/0000`, erpCode: names[key], groupName: names.group, typeCode: names.type, maxTransportUnits: max,
      });
      ids[key] = l.id;
      this.onCleanup(() => this.request.delete(this.url(`/v1/locations/${l.id}`)));
    }
    await this.api('POST', '/v1/transport-unit-types', { code: names.unitType });
    this.onCleanup(() => this.request.delete(this.url(`/v1/transport-unit-types/${names.unitType}`)));
    await this.api('POST', '/v1/products', { sku: names.sku, baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '6' }] });
    return { ...names, ids };
  }

  /** TU mit Bestand anlegen; beim Aufräumen Restbestand ausbuchen und TU löschen. */
  async stockedUnit(barcode: string, sku: string, typeCode: string, location: string, amount: string) {
    await this.api('POST', '/v1/receiving-blind-captures', { sku, quantity: { amount, unit: 'PCS' }, unit: { barcode, typeCode }, location: { erpCode: location } });
    this.onCleanup(async () => {
      const stock = await (await this.request.get(this.url(`/v1/stock?barcode=${barcode}`))).json();
      for (const item of stock.items ?? []) {
        await this.request.post(this.url(`/v1/stock/${item.id}/corrections`), { data: { delta: { amount: `-${item.quantity.amount}`, unit: 'PCS' }, reason: 'Aufräumen' } });
      }
      await this.request.delete(this.url(`/v1/transport-units/${barcode}`));
    });
  }

  async cleanup(): Promise<void> {
    for (const fn of this.undo.reverse()) await fn().catch(() => undefined);
  }
}

export const test = base.extend<{ fx: Fixtures }>({
  // page.request teilt die Cookies (admin-Sitzung) mit dem Browser-Kontext.
  fx: async ({ page }, use) => {
    const fx = new Fixtures(page.request);
    await use(fx);
    await fx.cleanup();
  },
});
export { expect };
