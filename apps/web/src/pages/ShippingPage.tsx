import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { useCan } from '../auth/session';
import { Feedback, latest } from '../components/Feedback';
import { addressLine, PartnerSelect } from '../components/PartnerSelect';
import { Empty, ErrorMessage, Panel, PdfLink, Quantity, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';

const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

function CreateShipment() {
  const [orderId, setOrderId] = useState('');
  const [carrierCode, setCarrierCode] = useState('');
  const [units, setUnits] = useState('');
  const create = useAction(
    () => unwrap(api.POST('/v1/shipments', { body: { orderId: orderId.trim(), ...(carrierCode ? { carrierCode } : {}), units: list(units) } })),
    ['shipments'],
    (_, s) => `Sendung ${s.number} angelegt`,
  );
  return (
    <Panel title="Sendung anlegen">
      <Feedback message={create.message} />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          create.run(undefined);
        }}
      >
        <label>Auslagerauftrag<input value={orderId} onChange={(e) => setOrderId(e.target.value)} required /></label>
        <PartnerSelect value={carrierCode} onChange={setCarrierCode} role="CARRIER" label="Spediteur" />
        <label>Versand-TUs<input value={units} onChange={(e) => setUnits(e.target.value)} placeholder="Barcodes, durch Komma getrennt" /></label>
        <button disabled={create.pending}>Anlegen</button>
      </form>
    </Panel>
  );
}

export function ShippingPage() {
  const can = useCan();
  const [selected, setSelected] = useState<string | null>(null);
  const [scan, setScan] = useState('');
  const [add, setAdd] = useState('');
  const shipments = useQuery({ queryKey: ['shipments'], queryFn: () => unwrap(api.GET('/v1/shipments', { params: { query: { limit: 200 } } })) });
  const shipment = shipments.data?.items.find((s) => s.number === selected);
  const path = { params: { path: { number: selected ?? '' } } };
  const load = useAction(
    (barcode: string) => unwrap(api.POST('/v1/shipments/{number}/load', { ...path, body: { barcode } })),
    ['shipments'],
    (barcode, s) => (s.state === 'LOADED' ? `${barcode} verladen – Sendung vollständig verladen` : `${barcode} verladen`),
  );
  const addUnit = useAction((barcode: string) => unwrap(api.POST('/v1/shipments/{number}/units', { ...path, body: { barcode } })), ['shipments'], (barcode) => `${barcode} aufgenommen`);
  const removeUnit = useAction(
    (barcode: string) => unwrap(api.DELETE('/v1/shipments/{number}/units/{barcode}', { params: { path: { number: selected ?? '', barcode } } })),
    ['shipments'],
    (barcode) => `${barcode} herausgenommen`,
  );
  const ship = useAction(() => unwrap(api.POST('/v1/shipments/{number}/ship', { ...path, body: {} })), ['shipments', 'stock', 'units'], () => 'Warenausgang gebucht');
  const cancel = useAction(() => unwrap(api.POST('/v1/shipments/{number}/cancel', { ...path, body: {} })), ['shipments'], () => 'Sendung storniert');
  const open = shipment?.state === 'OPEN';
  const active = open || shipment?.state === 'LOADED';

  return (
    <>
      <h1>Versand</h1>
      <ErrorMessage error={shipments.error} />
      {can('leitstand') && <CreateShipment />}
      <Panel title="Sendungen (neueste zuerst)">
        {shipments.data?.items.length ? (
          <div className="table-wrap">
            <table aria-label="Sendungen">
              <thead><tr><th>Sendung</th><th>Auftrag</th><th>Spediteur</th><th>Zustand</th><th className="num">TUs</th><th className="num">verladen</th><th>angelegt</th></tr></thead>
              <tbody>
                {shipments.data.items.map((s) => (
                  <tr key={s.number} className="clickable" onClick={() => setSelected(s.number)}>
                    <td className="mono">{s.number}</td>
                    <td className="mono">{s.orderId}</td>
                    <td>{s.carrierCode ?? '–'}</td>
                    <td><StateBadge state={s.state} /></td>
                    <td className="num">{s.counts.units}</td>
                    <td className="num">{s.counts.loaded}</td>
                    <td>{dateTime(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Sendungen.</Empty>
        )}
      </Panel>
      {shipment && (
        <Panel
          title={`Sendung ${shipment.number}`}
          actions={
            active && can('leitstand') ? (
              <div className="row">
                <button onClick={() => ship.run(undefined)} disabled={shipment.state !== 'LOADED' || ship.pending}>Warenausgang buchen</button>
                <button className="danger" onClick={() => cancel.run(undefined)}>Stornieren</button>
              </div>
            ) : undefined
          }
        >
          <Feedback message={latest(load.message, addUnit.message, removeUnit.message, ship.message, cancel.message)} />
          <div className="row" style={{ marginBottom: 12 }}>
            <StateBadge state={shipment.state} />
            <span className="muted">Lieferadresse: {addressLine(shipment.shipTo)}</span>
            {shipment.shippedAt && <span className="muted">ausgeliefert {dateTime(shipment.shippedAt)}</span>}
            {shipment.cancelReason && <span className="muted">{shipment.cancelReason}</span>}
          </div>
          <div className="row" style={{ marginBottom: 12 }} aria-label="Dokumente">
            <PdfLink href={`/v1/documents/delivery-note/${shipment.number}`}>Lieferschein</PdfLink>
            <PdfLink href={`/v1/documents/loading-list/${shipment.number}`}>Ladeliste</PdfLink>
            {shipment.units.length > 0 && <PdfLink href={`/v1/documents/shipping-labels/${shipment.number}`}>Versandetiketten</PdfLink>}
          </div>
          {open && (
            <div className="toolbar" style={{ marginBottom: 12 }}>
              {can('lager', 'leitstand') && (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (scan.trim()) load.run(scan.trim());
                    setScan('');
                  }}
                >
                  <label>Ladekontrolle: Barcode scannen<input value={scan} onChange={(e) => setScan(e.target.value)} autoComplete="off" /></label>
                  <button>Verladen</button>
                </form>
              )}
              {can('leitstand') && (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (add.trim()) addUnit.run(add.trim());
                    setAdd('');
                  }}
                >
                  <label>TU aufnehmen<input value={add} onChange={(e) => setAdd(e.target.value)} /></label>
                  <button className="secondary">Aufnehmen</button>
                </form>
              )}
            </div>
          )}
          {shipment.units.length ? (
            <div className="table-wrap">
              <table aria-label="TUs der Sendung">
                <thead><tr><th>TU</th><th>verladen</th><th>Inhalt</th><th /></tr></thead>
                <tbody>
                  {shipment.units.map((u) => (
                    <tr key={u.barcode}>
                      <td className="mono">{u.barcode}</td>
                      <td>{u.loaded ? `ja${u.loadedBy ? ` (${u.loadedBy})` : ''}` : 'nein'}</td>
                      <td>
                        {u.contents
                          ? u.contents.map((c, i) => (
                              <span key={i} style={{ marginRight: 8 }}>
                                <Quantity q={c.quantity} /> {c.sku}
                                {c.lot ? ` (Charge ${c.lot})` : ''}
                              </span>
                            ))
                          : '–'}
                      </td>
                      <td className="row">
                        {shipment.state !== 'SHIPPED' && <PdfLink href={`/v1/documents/unit-label/${encodeURIComponent(u.barcode)}`}>Palettenetikett</PdfLink>}
                        {active && can('leitstand') && <button className="secondary" onClick={() => removeUnit.run(u.barcode)}>Herausnehmen</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Noch keine TUs – Versand-TUs vom Packplatz aufnehmen.</Empty>
          )}
        </Panel>
      )}
    </>
  );
}
