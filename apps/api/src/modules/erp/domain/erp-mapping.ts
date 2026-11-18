import type { ErpOutboundMessage, EventEnvelope, QuantityDto } from '@wms/shared';

/** Ausgangsnachricht ohne ID und Zeitpunkt (verteilt über die Varianten, damit `type` und `data` zusammenpassen). */
export type Outbound = ErpOutboundMessage extends infer M ? (M extends unknown ? Omit<M, 'messageId' | 'occurredAt'> : never) : never;

const negate = (q: QuantityDto): QuantityDto => ({ ...q, amount: q.amount.startsWith('-') ? q.amount.slice(1) : `-${q.amount}` });

/**
 * Welche fachlichen Events werden zu Rückmeldungen ans ERP? Reine Funktion – ohne Datenbank, gut testbar.
 *
 * - `receiving.captured` → Wareneingang (nur mit Produkt und Menge)
 * - `shipment.shipped` → Warenausgang mit Inhalt je TU
 * - `stock.issued` mit Bezug `outbound:<Auftrag>/<Pos>` → Warenausgang direkt am Pick (ohne Versand)
 * - `stock.issued` mit anderem Bezug (außer `shipment:`) und `stock.corrected` → Bestandsänderung
 */
export function erpMessagesFor(envelope: EventEnvelope<unknown>): Outbound[] {
  const p = envelope.payload as Record<string, any>;
  switch (envelope.type) {
    case 'receiving.captured':
      if (!p['sku'] || !p['quantity']) return [];
      return [{ type: 'goods-receipt', data: { orderId: p['orderId'] ?? null, posNo: p['posNo'] ?? null, sku: p['sku'], quantity: p['quantity'], barcode: p['barcode'], blind: p['kind'] === 'blind', captureId: p['captureId'] } }];
    case 'shipment.shipped': {
      const lines = (p['units'] as { barcode: string; contents: { sku: string; quantity: QuantityDto; lot: string | null; bestBefore: string | null }[] }[]).flatMap((u) =>
        u.contents.map((c) => ({ sku: c.sku, quantity: c.quantity, lot: c.lot, bestBefore: c.bestBefore, barcode: u.barcode })),
      );
      return [{ type: 'goods-issue', data: { orderId: p['orderId'] ?? null, shipment: p['number'], carrierCode: p['carrierCode'] ?? null, lines } }];
    }
    case 'stock.issued': {
      const reference = String(p['reference'] ?? '');
      if (reference.startsWith('shipment:')) return []; // kommt gesammelt mit shipment.shipped
      const outbound = /^outbound:(.+)\/\d+$/.exec(reference);
      if (outbound) {
        return [{ type: 'goods-issue', data: { orderId: outbound[1]!, shipment: null, carrierCode: null, lines: [{ sku: p['sku'], quantity: p['quantity'], lot: null, bestBefore: null, barcode: p['barcode'] }] } }];
      }
      return [{ type: 'stock-change', data: { sku: p['sku'], barcode: p['barcode'], delta: negate(p['quantity']), reason: 'Abgang', reference: reference || null } }];
    }
    case 'stock.corrected':
      return [{ type: 'stock-change', data: { sku: p['sku'], barcode: p['barcode'], delta: p['delta'], reason: p['reason'] ?? 'Korrektur', reference: null } }];
    default:
      return [];
  }
}

/** Bezug für die Suche im Protokoll (Auftrag, Sendung oder Artikel). */
export function referenceOf(message: Outbound): string | null {
  switch (message.type) {
    case 'goods-receipt':
      return message.data.orderId ?? message.data.sku;
    case 'goods-issue':
      return message.data.shipment ?? message.data.orderId;
    case 'stock-change':
      return message.data.sku;
    default:
      return null;
  }
}

/** Wartezeit bis zum nächsten Zustellversuch: 30 s, 1 min, 2 min … höchstens 1 h. */
export function erpRetryDelayMs(attempts: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** Math.max(0, Math.min(attempts - 1, 20)));
}

export const ERP_LEASE_MS = 5 * 60_000;
