import { useLive } from '../live/events';
import { Empty, time } from './ui';

/** Kurze, lesbare Zeile zu einem Ereignis. */
export function summarize(type: string, p: Record<string, any>): string {
  const q = (x: any) => (x && typeof x === 'object' && 'amount' in x ? `${x.amount} ${x.unit}` : '');
  switch (type) {
    case 'stock.received':
      return `${q(p.quantity)} ${p.sku} auf ${p.barcode}`;
    case 'stock.issued':
      return `Abgang ${q(p.quantity)} ${p.sku} von ${p.barcode}`;
    case 'stock.transferred':
      return `${q(p.quantity)} ${p.sku}: ${p.from} → ${p.to}`;
    case 'transport-unit.moved':
      return `${p.barcode}: ${p.from?.locationId ?? '?'} → ${p.location?.locationId ?? '?'}`;
    case 'transport-unit.error-reported':
      return `${p.barcode}: ${p.code}${p.message ? ` – ${p.message}` : ''}`;
    case 'shipment.changed':
      return `${p.number}: ${p.change}${p.barcode ? ` ${p.barcode}` : ''}`;
    case 'shipment.shipped':
      return `${p.number} ausgeliefert (${(p.units ?? []).length} TUs)`;
    case 'partner.created':
      return `${p.code} ${p.name}`;
    case 'partner.changed':
      return `${p.code}: ${(p.fields ?? []).join(', ')}`;
    case 'location.plc-state-changed':
      return `${p.plcCode ?? p.locationId}: ${p.plcState === 0 ? 'in Ordnung' : `Störung ${p.plcState}${p.text ? ` – ${p.text}` : ''}`}`;
    case 'flow.command':
      return `${p.barcode} → ${p.to?.plcCode ?? p.to?.locationId}`;
    case 'outbound-order.state-changed':
    case 'receiving-order.state-changed':
      return `${p.orderId}: ${p.before} → ${p.state}`;
    default:
      return String(p.number ?? p.orderId ?? p.barcode ?? p.sku ?? p.name ?? p.locationId ?? '');
  }
}

export function LiveFeed({ limit = 30, filter }: { limit?: number; filter?: (type: string) => boolean }) {
  const { events } = useLive();
  const shown = events.filter((e) => !filter || filter(e.type)).slice(0, limit);
  if (shown.length === 0) return <Empty>Noch keine Ereignisse seit dem Öffnen der Seite.</Empty>;
  return (
    <ul className="feed" aria-label="Ereignisse">
      {shown.map((e) => (
        <li key={e.id}>
          <time>{time(e.occurredAt)}</time>
          <span>
            <span className="badge neutral">{e.type}</span> {summarize(e.type, e.payload as Record<string, any>)}
          </span>
        </li>
      ))}
    </ul>
  );
}
