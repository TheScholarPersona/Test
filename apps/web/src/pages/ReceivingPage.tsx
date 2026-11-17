import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, unwrap } from '../api/client';
import { Feedback } from '../components/Feedback';
import { LocationSelect, UnitTypeSelect } from '../components/LocationSelect';
import { PartnerSelect } from '../components/PartnerSelect';
import { Empty, ErrorMessage, Panel, Quantity, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';
import { useCan } from '../auth/session';

function CreateOrder() {
  const [orderId, setOrderId] = useState('');
  const [sku, setSku] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [supplierCode, setSupplierCode] = useState('');
  const create = useAction(
    () =>
      unwrap(
        api.POST('/v1/receiving-orders', {
          body: { orderId, ...(supplierCode ? { supplierCode } : {}), positions: [{ kind: 'quantity', sku, quantity: { amount, unit } }] },
        }),
      ),
    ['receiving'],
    () => `Avis ${orderId} angelegt`,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.run(undefined);
  };
  return (
    <Panel title="Avis anlegen">
      <Feedback message={create.message} />
      <form className="toolbar" onSubmit={submit}>
        <label>Auftrag<input value={orderId} onChange={(e) => setOrderId(e.target.value)} required /></label>
        <PartnerSelect value={supplierCode} onChange={setSupplierCode} role="SUPPLIER" label="Lieferant (Partner)" />
        <label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} required /></label>
        <label>Menge<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
        <label>Einheit<input value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} required /></label>
        <button disabled={create.pending}>Anlegen</button>
      </form>
    </Panel>
  );
}

function CaptureForm({ orderId, defaultSku }: { orderId: string; defaultSku: string }) {
  const [sku, setSku] = useState(defaultSku);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [barcode, setBarcode] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [location, setLocation] = useState('');
  const [lot, setLot] = useState('');
  const capture = useAction(
    () =>
      unwrap(
        api.POST('/v1/receiving-orders/{orderId}/captures', {
          params: { path: { orderId } },
          body: {
            kind: 'quantity',
            sku,
            quantity: { amount, unit },
            unit: { ...(barcode ? { barcode } : {}), ...(typeCode ? { typeCode } : {}) },
            location: { id: location },
            ...(lot ? { lot } : {}),
          },
        }),
      ),
    ['receiving', 'stock'],
    () => `${amount} ${unit} ${sku} erfasst`,
  );
  return (
    <>
      <Feedback message={capture.message} />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          capture.run(undefined);
        }}
      >
        <label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} required /></label>
        <label>Menge<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
        <label>Einheit<input value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} required /></label>
        <label>TU-Barcode<input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="leer = neue TU" /></label>
        <UnitTypeSelect value={typeCode} onChange={setTypeCode} />
        <LocationSelect value={location} onChange={setLocation} />
        <label>Charge<input value={lot} onChange={(e) => setLot(e.target.value)} /></label>
        <button disabled={capture.pending}>Erfassen</button>
      </form>
    </>
  );
}

export function ReceivingPage() {
  const can = useCan();
  const [selected, setSelected] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ['receiving', 'orders'], queryFn: () => unwrap(api.GET('/v1/receiving-orders', { params: { query: { limit: 200 } } })) });
  const order = orders.data?.items.find((o) => o.orderId === selected);
  const close = useAction(
    (a: { kind: 'complete' | 'cancel' }) =>
      unwrap(a.kind === 'complete'
        ? api.POST('/v1/receiving-orders/{orderId}/complete', { params: { path: { orderId: selected! } }, body: {} })
        : api.POST('/v1/receiving-orders/{orderId}/cancel', { params: { path: { orderId: selected! } }, body: {} })),
    ['receiving'],
    (a) => (a.kind === 'complete' ? 'Auftrag abgeschlossen' : 'Auftrag storniert'),
  );
  return (
    <>
      <h1>Wareneingang</h1>
      <ErrorMessage error={orders.error} />
      {can('leitstand') && <CreateOrder />}
      <Panel title="Aufträge (neueste zuerst)">
        {orders.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Auftrag</th><th>Lieferant</th><th>Zustand</th><th className="num">Positionen</th><th>angelegt</th></tr></thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.orderId} className="clickable" onClick={() => setSelected(o.orderId)}>
                    <td className="mono">{o.orderId}</td>
                    <td>{o.supplier ?? '–'}</td>
                    <td><StateBadge state={o.state} /></td>
                    <td className="num">{o.positions.length}</td>
                    <td>{dateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Wareneingangsaufträge.</Empty>
        )}
      </Panel>
      {order && (
        <Panel
          title={`Auftrag ${order.orderId}`}
          actions={
            can('leitstand') && (
              <div className="row">
                <button className="secondary" onClick={() => close.run({ kind: 'complete' })}>Abschließen</button>
                <button className="danger" onClick={() => close.run({ kind: 'cancel' })}>Stornieren</button>
              </div>
            )
          }
        >
          <Feedback message={close.message} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pos.</th><th>SKU / TU</th><th>Zustand</th><th className="num">avisiert</th><th className="num">erfasst</th><th className="num">offen</th></tr></thead>
              <tbody>
                {order.positions.map((p) => (
                  <tr key={p.posNo}>
                    <td>{p.posNo}</td>
                    <td>{p.sku ?? p.expectedBarcode ?? p.typeCode}</td>
                    <td><StateBadge state={p.state} /></td>
                    <td className="num"><Quantity q={p.expected} /></td>
                    <td className="num"><Quantity q={p.received} /></td>
                    <td className="num"><Quantity q={p.open} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('lager', 'leitstand') && <h2 style={{ marginTop: 16 }}>Ware erfassen</h2>}
          {can('lager', 'leitstand') && <CaptureForm key={order.orderId} orderId={order.orderId} defaultSku={order.positions.find((p) => p.sku)?.sku ?? ''} />}
        </Panel>
      )}
    </>
  );
}
