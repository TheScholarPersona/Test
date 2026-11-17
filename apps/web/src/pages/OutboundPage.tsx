import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { Feedback } from '../components/Feedback';
import { LocationSelect } from '../components/LocationSelect';
import { Empty, ErrorMessage, Panel, Quantity, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';
import { useCan } from '../auth/session';

type Transport = 'none' | 'movement' | 'transport-order';

function CreateOrder() {
  const [orderId, setOrderId] = useState('');
  const [customer, setCustomer] = useState('');
  const [sku, setSku] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [target, setTarget] = useState('');
  const create = useAction(
    () =>
      unwrap(
        api.POST('/v1/outbound-orders', {
          body: {
            orderId,
            ...(customer ? { customer } : {}),
            ...(target ? { target: { id: target } } : {}),
            lines: [{ sku, quantity: { amount, unit } }],
          },
        }),
      ),
    ['outbound'],
    () => `Auslagerauftrag ${orderId} angelegt`,
  );
  return (
    <Panel title="Auslagerauftrag anlegen">
      <Feedback message={create.message} />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          create.run(undefined);
        }}
      >
        <label>Auftrag<input value={orderId} onChange={(e) => setOrderId(e.target.value)} required /></label>
        <label>Kunde<input value={customer} onChange={(e) => setCustomer(e.target.value)} /></label>
        <label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} required /></label>
        <label>Menge<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
        <label>Einheit<input value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} required /></label>
        <LocationSelect value={target} onChange={setTarget} label="Versandplatz" required={false} />
        <button disabled={create.pending}>Anlegen</button>
      </form>
    </Panel>
  );
}

export function OutboundPage() {
  const can = useCan();
  const [selected, setSelected] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>('none');
  const orders = useQuery({ queryKey: ['outbound', 'orders'], queryFn: () => unwrap(api.GET('/v1/outbound-orders', { params: { query: { limit: 200 } } })) });
  const order = orders.data?.items.find((o) => o.orderId === selected);
  const path = { params: { path: { orderId: selected ?? '' } } };
  const allocate = useAction(() => unwrap(api.POST('/v1/outbound-orders/{orderId}/allocate', { ...path, body: { transport } })), ['outbound', 'stock'], () => 'Zuteilung gelaufen');
  const confirm = useAction(
    (a: { pickId: string; amount?: string; unit: string }) =>
      unwrap(
        api.POST('/v1/outbound-orders/{orderId}/picks/{pickId}/confirm', {
          params: { path: { orderId: selected ?? '', pickId: a.pickId } },
          body: a.amount === undefined ? { pickedBy: 'leitstand' } : { quantity: { amount: a.amount, unit: a.unit }, pickedBy: 'leitstand' },
        }),
      ),
    ['outbound', 'stock'],
    () => 'Pick quittiert',
  );
  const close = useAction(
    (kind: 'complete' | 'cancel') =>
      unwrap(kind === 'complete' ? api.POST('/v1/outbound-orders/{orderId}/complete', { ...path, body: {} }) : api.POST('/v1/outbound-orders/{orderId}/cancel', { ...path, body: {} })),
    ['outbound', 'stock'],
    (kind) => (kind === 'complete' ? 'Auftrag abgeschlossen' : 'Auftrag storniert'),
  );
  const closed = order?.state === 'COMPLETED' || order?.state === 'CANCELLED';

  return (
    <>
      <h1>Auslagerung</h1>
      <ErrorMessage error={orders.error} />
      {can('leitstand') && <CreateOrder />}
      <Panel title="Aufträge (neueste zuerst)">
        {orders.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Auftrag</th><th>Kunde</th><th>Zustand</th><th className="num">Positionen</th><th className="num">offene Picks</th><th>angelegt</th></tr></thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.orderId} className="clickable" onClick={() => setSelected(o.orderId)}>
                    <td className="mono">{o.orderId}</td>
                    <td>{o.customer ?? '–'}</td>
                    <td><StateBadge state={o.state} /></td>
                    <td className="num">{o.lines.length}</td>
                    <td className="num">{o.picks.filter((p) => p.state === 'OPEN').length}</td>
                    <td>{dateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Auslageraufträge.</Empty>
        )}
      </Panel>
      {order && (
        <Panel
          title={`Auftrag ${order.orderId}`}
          actions={
            !closed && can('leitstand') && (
              <div className="row">
                <select value={transport} onChange={(e) => setTransport(e.target.value as Transport)} aria-label="Transport">
                  <option value="none">ohne Transport</option>
                  <option value="movement">mit Lagerbewegung</option>
                  <option value="transport-order">mit Transportauftrag</option>
                </select>
                <button onClick={() => allocate.run(undefined)} disabled={allocate.pending}>Zuteilen</button>
                <button className="secondary" onClick={() => close.run('complete')}>Abschließen</button>
                <button className="danger" onClick={() => close.run('cancel')}>Stornieren</button>
              </div>
            )
          }
        >
          <Feedback message={allocate.message ?? confirm.message ?? close.message} />
          <div className="row" style={{ marginBottom: 12 }}>
            <StateBadge state={order.state} />
            {order.target && <span className="muted">Ziel {order.target.locationId}</span>}
            {order.closeReason && <span className="muted">{order.closeReason}</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pos.</th><th>SKU</th><th>Zustand</th><th className="num">Bedarf</th><th className="num">zugeteilt</th><th className="num">entnommen</th><th className="num">offen</th></tr></thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.lineNo}>
                    <td>{l.lineNo}</td>
                    <td>{l.sku}{l.lot ? ` (Charge ${l.lot})` : ''}</td>
                    <td><StateBadge state={l.state} /></td>
                    <td className="num"><Quantity q={l.quantity} /></td>
                    <td className="num"><Quantity q={l.allocated} /></td>
                    <td className="num"><Quantity q={l.picked} /></td>
                    <td className="num"><Quantity q={l.open} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: 16 }}>Picks</h2>
          {order.picks.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>TU</th><th>Platz</th><th className="num">Menge</th><th>Zustand</th><th>Transport</th><th /></tr></thead>
                <tbody>
                  {order.picks.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.barcode}</td>
                      <td className="mono">{p.locationId}</td>
                      <td className="num"><Quantity q={p.state === 'OPEN' ? p.quantity : p.picked} /></td>
                      <td><StateBadge state={p.state} /></td>
                      <td className="muted">{p.movementNumber ?? p.transportOrderNumber ?? p.transportNote ?? '–'}</td>
                      <td>
                        {p.state === 'OPEN' && can('lager', 'leitstand') && (
                          <div className="row">
                            <button onClick={() => confirm.run({ pickId: p.id, unit: p.quantity.unit })}>Quittieren</button>
                            <button className="secondary" onClick={() => confirm.run({ pickId: p.id, amount: '0', unit: p.quantity.unit })}>Fehlmenge</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Noch keine Picks – „Zuteilen“ wählt den Bestand per Auslagerstrategie.</Empty>
          )}
        </Panel>
      )}
    </>
  );
}
