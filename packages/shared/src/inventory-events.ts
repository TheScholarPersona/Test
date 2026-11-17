import { z } from 'zod';
import { defineEvent } from './events.js';
import { QuantitySchema } from './quantity.js';

/** Events des Bestandsmoduls. */

export const ProductSnapshotSchema = z.object({
  sku: z.string(),
  description: z.string(),
  baseUnit: z.string(),
  overdeliveryAllowed: z.boolean(),
});

export const ProductCreatedEvent = defineEvent('product.created', 1, ProductSnapshotSchema);
export const ProductUpdatedEvent = defineEvent('product.updated', 1, ProductSnapshotSchema);

/** Bestand korrigiert (z. B. Inventurdifferenz, Bruch). `onHand` 0 = Posten aufgelöst. */
export const StockCorrectedEvent = defineEvent(
  'stock.corrected',
  1,
  z.object({
    bookingId: z.uuid(),
    sku: z.string(),
    barcode: z.string(),
    delta: QuantitySchema,
    onHand: QuantitySchema,
    reason: z.string(),
  }),
);

/**
 * Bestand zugegangen (z. B. Wareneingang). `onHand` ist der Bestand dieses
 * Postens auf der TU nach der Buchung.
 */
export const StockReceivedEvent = defineEvent(
  'stock.received',
  1,
  z.object({
    bookingId: z.uuid(),
    sku: z.string(),
    barcode: z.string(),
    quantity: QuantitySchema,
    onHand: QuantitySchema,
    lot: z.string().nullable(),
    bestBefore: z.iso.date().nullable(),
    reference: z.string(),
  }),
);

/** Bestand abgegangen (z. B. Verbrauch, Versand). `quantity` positiv in der Basiseinheit. */
export const StockIssuedEvent = defineEvent(
  'stock.issued',
  1,
  z.object({
    bookingId: z.uuid(),
    sku: z.string(),
    barcode: z.string(),
    quantity: QuantitySchema,
    onHand: QuantitySchema,
    reference: z.string(),
    reservationId: z.uuid().nullable(),
  }),
);

/** Umbuchung zwischen zwei TUs (Abgang auf `from`, Zugang auf `to`). */
export const StockTransferredEvent = defineEvent(
  'stock.transferred',
  1,
  z.object({
    transferId: z.uuid(),
    sku: z.string(),
    from: z.string(),
    to: z.string(),
    quantity: QuantitySchema,
    lot: z.string().nullable(),
    bestBefore: z.iso.date().nullable(),
    reference: z.string(),
  }),
);

export const StockReservedEvent = defineEvent(
  'stock.reserved',
  1,
  z.object({ reservationId: z.uuid(), sku: z.string(), barcode: z.string(), quantity: QuantitySchema, reference: z.string() }),
);

/** Reservierung aufgehoben oder durch einen Abgang verbraucht (`consumed`). */
export const StockReservationReleasedEvent = defineEvent(
  'stock.reservation-released',
  1,
  z.object({ reservationId: z.uuid(), sku: z.string(), barcode: z.string(), quantity: QuantitySchema, consumed: z.boolean() }),
);

const CountState = z.enum(['OPEN', 'COUNTED', 'CLOSED', 'CANCELLED']);

/** Inventur einer TU: geöffnet (TU gesperrt), gezählt, abgeschlossen (Differenzen gebucht) oder abgebrochen. */
export const StockCountChangedEvent = defineEvent(
  'stock-count.changed',
  1,
  z.object({
    number: z.string(),
    barcode: z.string(),
    state: CountState,
    differences: z.number().int().meta({ description: 'Anzahl Zeilen mit Differenz (ab COUNTED)' }),
  }),
);
