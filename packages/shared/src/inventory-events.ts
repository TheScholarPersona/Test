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
