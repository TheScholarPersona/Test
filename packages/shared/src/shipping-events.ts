import { z } from 'zod';
import { defineEvent } from './events.js';
import { QuantitySchema } from './quantity.js';

/** Events des Versands: Sendungen mit Ladekontrolle und Warenausgang. */

export const ShipmentStateSchema = z.enum(['OPEN', 'LOADED', 'SHIPPED', 'CANCELLED']);
export type ShipmentState = z.infer<typeof ShipmentStateSchema>;

/** Inhalt einer versendeten TU (Momentaufnahme beim Warenausgang). */
export const ShippedContentSchema = z.object({ sku: z.string(), quantity: QuantitySchema, lot: z.string().nullable(), bestBefore: z.string().nullable() });

export const ShipmentSnapshotSchema = z.object({
  number: z.string(),
  orderId: z.string(),
  carrierCode: z.string().nullable(),
  state: ShipmentStateSchema,
  units: z.array(z.object({ barcode: z.string(), loaded: z.boolean() })),
});

export const ShipmentCreatedEvent = defineEvent('shipment.created', 1, ShipmentSnapshotSchema);
/** TU aufgenommen/entfernt, TU verladen (Scan), alle verladen (`loaded`), storniert. */
export const ShipmentChangedEvent = defineEvent(
  'shipment.changed',
  1,
  ShipmentSnapshotSchema.extend({ change: z.enum(['unit-added', 'unit-removed', 'unit-loaded', 'loaded', 'cancelled']), barcode: z.string().nullable() }),
);
/** Warenausgang: Bestand ausgebucht, TUs gelöscht; der Inhalt bleibt hier und in der Sendung erhalten. */
export const ShipmentShippedEvent = defineEvent(
  'shipment.shipped',
  1,
  z.object({
    number: z.string(),
    orderId: z.string(),
    carrierCode: z.string().nullable(),
    units: z.array(z.object({ barcode: z.string(), contents: z.array(ShippedContentSchema) })),
  }),
);
