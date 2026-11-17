import { z } from 'zod';
import { defineEvent } from './events.js';
import { QuantitySchema } from './quantity.js';

/** Events der Auslagerung. */

export const OutboundOrderStateSchema = z.enum(['CREATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'IN_PICKING', 'COMPLETED', 'CANCELLED']);

export const OutboundOrderCreatedEvent = defineEvent(
  'outbound-order.created',
  1,
  z.object({ orderId: z.string(), customer: z.string().nullable(), lines: z.number().int() }),
);

export const OutboundOrderStateChangedEvent = defineEvent(
  'outbound-order.state-changed',
  1,
  z.object({ orderId: z.string(), before: OutboundOrderStateSchema, state: OutboundOrderStateSchema }),
);

/** Zuteilung gelaufen: neue Picks und Positionen mit Fehlmenge. */
export const OutboundOrderAllocatedEvent = defineEvent(
  'outbound-order.allocated',
  1,
  z.object({
    orderId: z.string(),
    state: OutboundOrderStateSchema,
    picks: z.array(z.object({ pickId: z.uuid(), lineNo: z.number().int(), sku: z.string(), barcode: z.string(), locationId: z.string(), quantity: QuantitySchema })),
    shortfalls: z.array(z.object({ lineNo: z.number().int(), sku: z.string(), missing: QuantitySchema })),
  }),
);

/** Pick quittiert; `short` bei Fehlmenge (Rest der Reservierung freigegeben). */
export const OutboundPickConfirmedEvent = defineEvent(
  'outbound-pick.confirmed',
  1,
  z.object({ orderId: z.string(), pickId: z.uuid(), lineNo: z.number().int(), sku: z.string(), barcode: z.string(), quantity: QuantitySchema, short: z.boolean(), packedInto: z.string().nullable().optional() }),
);
