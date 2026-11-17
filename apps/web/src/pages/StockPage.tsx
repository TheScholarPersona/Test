import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { Empty, ErrorMessage, Panel, Quantity, dateTime } from '../components/ui';

export function StockPage() {
  const [by, setBy] = useState<'product' | 'location'>('product');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const summary = useQuery({
    queryKey: ['stock', 'summary', by, sku],
    queryFn: () => unwrap(api.GET('/v1/stock/summary', { params: { query: { by, ...(sku ? { sku } : {}), limit: 500 } } })),
  });
  const items = useQuery({
    queryKey: ['stock', 'items', sku, barcode],
    queryFn: () => unwrap(api.GET('/v1/stock', { params: { query: { ...(sku ? { sku } : {}), ...(barcode ? { barcode } : {}), limit: 500 } } })),
  });
  const journal = useQuery({
    queryKey: ['stock', 'journal', sku, barcode],
    queryFn: () => unwrap(api.GET('/v1/stock-bookings', { params: { query: { ...(sku ? { sku } : {}), ...(barcode ? { barcode } : {}), limit: 30 } } })),
  });

  return (
    <>
      <h1>Bestand</h1>
      <div className="toolbar">
        <label>
          SKU
          <input value={sku} onChange={(e) => setSku(e.target.value.trim())} placeholder="alle" />
        </label>
        <label>
          TU-Barcode
          <input value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} placeholder="alle" />
        </label>
        <label>
          Summen
          <select value={by} onChange={(e) => setBy(e.target.value as 'product' | 'location')}>
            <option value="product">je Produkt</option>
            <option value="location">je Platz und Produkt</option>
          </select>
        </label>
      </div>
      <ErrorMessage error={summary.error ?? items.error ?? journal.error} />
      <Panel title="Summen">
        {summary.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{by === 'location' && <th>Platz</th>}<th>SKU</th><th className="num">Bestand</th><th className="num">reserviert</th><th className="num">verfügbar</th><th className="num">Posten</th><th className="num">TUs</th></tr>
              </thead>
              <tbody>
                {summary.data.items.map((r) => (
                  <tr key={`${r.location?.id ?? ''}-${r.sku}`} className="clickable" onClick={() => setSku(r.sku)}>
                    {by === 'location' && <td className="mono">{r.location?.locationId}</td>}
                    <td>{r.sku}</td>
                    <td className="num"><Quantity q={r.onHand} /></td>
                    <td className="num"><Quantity q={r.reserved} /></td>
                    <td className="num"><Quantity q={r.available} /></td>
                    <td className="num">{r.items}</td>
                    <td className="num">{r.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Kein Bestand{sku ? ` für ${sku}` : ''}.</Empty>
        )}
      </Panel>
      <Panel title={`Bestandsposten (${items.data?.total ?? 0})`}>
        {items.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>SKU</th><th>TU</th><th>Platz</th><th className="num">Menge</th><th className="num">verfügbar</th><th>Charge</th><th>MHD</th></tr>
              </thead>
              <tbody>
                {items.data.items.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => setBarcode(i.barcode)}>
                    <td>{i.sku}</td>
                    <td className="mono">{i.barcode}</td>
                    <td className="mono">{i.location.locationId}</td>
                    <td className="num"><Quantity q={i.quantity} /></td>
                    <td className="num"><Quantity q={i.available} /></td>
                    <td>{i.lot ?? '–'}</td>
                    <td>{i.bestBefore ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Posten.</Empty>
        )}
      </Panel>
      <Panel title="Buchungsjournal (neueste zuerst)">
        {journal.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Zeit</th><th>Art</th><th>SKU</th><th>TU</th><th className="num">Menge</th><th>Bezug</th></tr>
              </thead>
              <tbody>
                {journal.data.items.map((b) => (
                  <tr key={b.id}>
                    <td>{dateTime(b.createdAt)}</td>
                    <td><span className="badge neutral">{b.type}</span></td>
                    <td>{b.sku}</td>
                    <td className="mono">{b.barcode}</td>
                    <td className="num"><Quantity q={b.quantity} /></td>
                    <td className="mono">{b.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Buchungen.</Empty>
        )}
      </Panel>
    </>
  );
}
