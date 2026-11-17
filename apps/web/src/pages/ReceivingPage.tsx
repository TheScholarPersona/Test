import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, unwrap } from '../api/client';
import { Feedback, latest } from '../components/Feedback';
import { LocationSelect, UnitTypeSelect } from '../components/LocationSelect';
import { PartnerSelect } from '../components/PartnerSelect';
import { Empty, ErrorMessage, Panel, Quantity, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';
import { useCan } from '../auth/session';

type Priority = 'HIGHEST' | 'HIGH' | 'NORMAL' | 'LOW' | 'LOWEST';
const PRIORITIES: [Priority, string][] = [
  ['HIGHEST', 'höchste'],
  ['HIGH', 'hoch'],
  ['NORMAL', 'normal'],
  ['LOW', 'niedrig'],
  ['LOWEST', 'niedrigste'],
];
const priorityText = (p: string) => PRIORITIES.find(([x]) => x === p)?.[1] ?? p;

function PrioritySelect({ value, onChange, label = 'Priorität' }: { value: Priority; onChange: (p: Priority) => void; label?: string }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Priority)}>
        {PRIORITIES.map(([p, text]) => <option key={p} value={p}>{text}</option>)}
      </select>
    </label>
  );
}

/** Priorität, Sperre und Detailattribute eines offenen Avis (Leitstand). */
function OrderSettings({ order }: { order: { orderId: string; priority: string; locked: boolean; lockReason: string | null; details: Record<string, string>; state: string } }) {
  const path = { params: { path: { orderId: order.orderId } } };
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const change = useAction(
    (body: { priority?: Priority; details?: Record<string, string | null> }) => unwrap(api.PATCH('/v1/receiving-orders/{orderId}', { ...path, body })),
    ['receiving'],
    () => 'Avis geändert',
  );
  const lock = useAction(
    (a: { locked: boolean; reason?: string }) =>
      unwrap(a.locked ? api.POST('/v1/receiving-orders/{orderId}/lock', { ...path, body: a.reason ? { reason: a.reason } : {} }) : api.POST('/v1/receiving-orders/{orderId}/unlock', path)),
    ['receiving'],
    (a) => (a.locked ? 'Avis gesperrt' : 'Avis entsperrt'),
  );
  const open = order.state === 'OPEN' || order.state === 'IN_PROGRESS';
  const details = Object.entries(order.details);
  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      <Feedback message={latest(change.message, lock.message)} />
      <div className="toolbar" style={{ marginBottom: 0 }}>
        {open ? <PrioritySelect value={order.priority as Priority} onChange={(priority) => change.run({ priority })} /> : <span>Priorität: {priorityText(order.priority)}</span>}
        {open &&
          (order.locked ? (
            <button className="secondary" onClick={() => lock.run({ locked: false })}>Entsperren</button>
          ) : (
            <button
              className="secondary"
              onClick={() => {
                const reason = window.prompt('Grund der Sperre (optional)') ?? undefined;
                lock.run({ locked: true, ...(reason ? { reason } : {}) });
              }}
            >
              Sperren
            </button>
          ))}
      </div>
      <div aria-label="Detailattribute">
        {details.length ? (
          <div className="row">
            {details.map(([k, v]) => (
              <span key={k} className="badge neutral">
                {k}: {v}
                {open && (
                  <button className="secondary" aria-label={`${k} entfernen`} style={{ padding: '0 6px', marginLeft: 6 }} onClick={() => change.run({ details: { [k]: null } })}>
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <span className="muted">Keine Detailattribute.</span>
        )}
      </div>
      {open && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim() && value.trim()) change.run({ details: { [key.trim()]: value.trim() } });
            setKey('');
            setValue('');
          }}
        >
          <label>Attribut<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="z. B. rampe" /></label>
          <label>Wert<input value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <button className="secondary">Attribut setzen</button>
        </form>
      )}
    </div>
  );
}

function CreateOrder() {
  const [orderId, setOrderId] = useState('');
  const [sku, setSku] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [supplierCode, setSupplierCode] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const create = useAction(
    () =>
      unwrap(
        api.POST('/v1/receiving-orders', {
          body: { orderId, priority, ...(supplierCode ? { supplierCode } : {}), positions: [{ kind: 'quantity', sku, quantity: { amount, unit } }] },
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
        <PrioritySelect value={priority} onChange={setPriority} />
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
  const [sort, setSort] = useState<'created' | 'priority'>('created');
  const orders = useQuery({ queryKey: ['receiving', 'orders', sort], queryFn: () => unwrap(api.GET('/v1/receiving-orders', { params: { query: { limit: 200, sort } } })) });
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
      <Panel
        title={sort === 'priority' ? 'Aufträge (nach Priorität und Termin)' : 'Aufträge (neueste zuerst)'}
        actions={
          <label>
            Sortierung
            <select value={sort} onChange={(e) => setSort(e.target.value as 'created' | 'priority')}>
              <option value="created">neueste zuerst</option>
              <option value="priority">nach Priorität</option>
            </select>
          </label>
        }
      >
        {orders.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Auftrag</th><th>Lieferant</th><th>Priorität</th><th>Zustand</th><th className="num">Positionen</th><th>angelegt</th></tr></thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.orderId} className="clickable" onClick={() => setSelected(o.orderId)}>
                    <td className="mono">{o.orderId}</td>
                    <td>{o.supplier ?? '–'}</td>
                    <td>{priorityText(o.priority)}</td>
                    <td>
                      <StateBadge state={o.state} />
                      {o.locked && <span className="badge bad" style={{ marginLeft: 6 }} title={o.lockReason ?? undefined}>gesperrt</span>}
                    </td>
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
          {order.locked && <div className="message error">Gesperrt{order.lockReason ? `: ${order.lockReason}` : ''} – Erfassung erst nach dem Entsperren.</div>}
          {can('leitstand') ? <OrderSettings order={order} /> : null}
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
