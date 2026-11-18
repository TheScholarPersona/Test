import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { baseFlow, helper, next, nodes, startApi } from './support.mjs';

const example = (name) => readFileSync(new URL(`../examples/erp/${name}`, import.meta.url), 'utf8');
const receipt = { messageId: '0f8e7a6b-1111-4222-8333-944455556666', type: 'goods-receipt', occurredAt: '2026-11-18T09:30:00.000Z', data: { orderId: '4500004711', posNo: 1, sku: '100', quantity: { amount: '12', unit: 'PCS' }, barcode: 'T1', blind: false, captureId: '0f8e7a6b-1111-4222-8333-944455550000' } };
const snapshot = { messageId: '1f8e7a6b-1111-4222-8333-944455556666', type: 'stock-snapshot', occurredAt: '2026-11-18T23:00:00.000Z', data: { takenAt: '2026-11-18T23:00:00.000Z', items: [] } };

describe('ERP-Nodes', () => {
  let api;

  beforeAll(async () => {
    await new Promise((resolve) => helper.startServer(resolve));
    api = await startApi({
      'POST /v1/erp/inbound': (body) => ({ status: 200, body: { duplicate: body.messageId.endsWith('MUSTER-200'), message: { messageId: body.messageId, type: body.type, reference: body.data.sku ?? body.data.orderId, state: body.data.sku === 'MUSTER-200' ? 'FAILED' : 'PROCESSED', lastError: body.data.sku === 'MUSTER-200' ? 'X: y' : null } } }),
      'POST /v1/erp/outbound/claim?limit=20': { status: 200, body: { items: [{ id: 'm1', attempts: 0, message: receipt }, { id: 'm2', attempts: 0, message: snapshot }] } },
      'POST /v1/erp/messages/m1/ack': (body) => ({ status: 200, body: { id: 'm1', state: 'SENT', echo: body } }),
      'POST /v1/erp/messages/m1/nack': (body) => ({ status: 200, body: { id: 'm1', state: 'PENDING', echo: body } }),
      'POST /v1/erp/messages/m2/nack': (body) => ({ status: 200, body: { id: 'm2', state: 'PENDING', echo: body } }),
    });
  });
  afterEach(async () => {
    await helper.unload();
    api.requests.length = 0;
  });
  afterAll(async () => {
    await api.close();
    await new Promise((resolve) => helper.stopServer(resolve));
  });

  const load = (extra) => helper.load(nodes, baseFlow(api.url, extra));

  it('wms-erp-in übersetzt eine CSV-Datei und übergibt jede Nachricht einzeln', async () => {
    await load([{ id: 'n', type: 'wms-erp-in', server: 'cfg', format: 'csv', kind: 'product', messageIdPrefix: 'msg.filename', wires: [['out']] }]);
    const out = next(helper.getNode('out'));
    helper.getNode('n').receive({ payload: Buffer.from(example('artikel.csv')), filename: '/data/erp/in/artikel.csv' });
    const msg = await out;
    expect(api.requests.map((r) => r.body.messageId)).toEqual(['artikel.csv:MUSTER-100', 'artikel.csv:MUSTER-200']);
    expect(api.requests[0].authorization).toBeUndefined();
    expect(msg.payload).toMatchObject({ total: 2, processed: 1, failed: 1, duplicates: 1, results: [{ state: 'PROCESSED' }, { state: 'FAILED', lastError: 'X: y' }] });
  });

  it('wms-erp-in setzt den Packplatz für Auslieferungen aus SAP und meldet Formatfehler', async () => {
    await load([{ id: 'n', type: 'wms-erp-in', server: 'cfg', format: 'idoc', target: 'VS-01', errorOutput: true, outputs: 2, wires: [['out'], ['out2']] }]);
    const out = next(helper.getNode('out'));
    helper.getNode('n').receive({ payload: example('delvry.xml') });
    await out;
    expect(api.requests[0].body).toMatchObject({ messageId: 'IDOC-300001', type: 'outbound-order', data: { orderId: '80001234', target: 'VS-01' } });
    const err = next(helper.getNode('out2'));
    helper.getNode('n').receive({ payload: '<kaputt>' });
    expect((await err).wmsError).toMatchObject({ code: 'ERP_FORMAT' });
  });

  it('wms-erp-out gibt Rückmeldungen im Zielformat aus und meldet nicht übersetzbare sofort als Fehlversuch', async () => {
    await load([{ id: 'n', type: 'wms-erp-out', server: 'cfg', format: 'idoc', limit: '20', directory: '/data/erp/out/', options: '{"plant":"1100"}', wires: [['out']] }]);
    const out = next(helper.getNode('out'));
    helper.getNode('n').receive({ payload: 'tick' });
    const msg = await out;
    expect(msg.erp).toEqual({ id: 'm1', messageId: receipt.messageId, type: 'goods-receipt', attempts: 0 });
    expect(msg.filename).toBe('/data/erp/out/WMMBXY_20261118_0f8e7a6b.xml');
    expect(msg.payload).toContain('<WERKS>1100</WERKS>');
    await new Promise((r) => setTimeout(r, 100));
    expect(api.requests.find((r) => r.url === '/v1/erp/messages/m2/nack')?.body.error).toMatch(/Übersetzung: .*CSV oder JSON/);
  });

  it('wms-erp-ack bestätigt Erfolg mit Beleg und meldet HTTP-Fehler als Fehlversuch', async () => {
    await load([{ id: 'n', type: 'wms-erp-ack', server: 'cfg', erpReference: 'msg.payload.beleg', wires: [['out']] }]);
    let out = next(helper.getNode('out'));
    helper.getNode('n').receive({ erp: { id: 'm1' }, statusCode: 201, payload: { beleg: '5000000001' } });
    expect((await out).payload).toMatchObject({ state: 'SENT', echo: { erpReference: '5000000001' } });
    out = next(helper.getNode('out'));
    helper.getNode('n').receive({ erp: { id: 'm1' }, statusCode: 503, payload: 'ERP wartet' });
    expect((await out).payload).toMatchObject({ state: 'PENDING', echo: { error: 'HTTP 503: ERP wartet' } });
    out = next(helper.getNode('out'));
    helper.getNode('n').receive({ erp: { id: 'm1' }, error: { message: 'EACCES: Datei' } });
    expect((await out).payload.echo.error).toBe('EACCES: Datei');
  });
});
