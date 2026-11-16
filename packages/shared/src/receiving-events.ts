import { z } from 'zod';
import { defineEvent } from './events.js';
import { QuantitySchema } from './quantity.js';

/** Events des Wareneingangs. */

export const ReceivingOrderStateSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED']);
export const ReceivingPositionStateSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'SHORT', 'CANCELLED']);

export const ReceivingOrderCreatedEvent = defineEvent(
  'receiving-order.created',
  1,
  z.object({ orderId: z.string(), supplier: z.string().nullable(), positions: z.number().int() }),
);

export const ReceivingOrderStateChangedEvent = defineEvent(
  'receiving-order.state-changed',
  1,
  z.object({ orderId: z.string(), before: ReceivingOrderStateSchema, state: ReceivingOrderStateSchema }),
);

export const ReceivingPositionStateChangedEvent = defineEvent(
  'receiving-position.state-changed',
  1,
  z.object({
    orderId: z.string(),
    posNo: z.number().int(),
    before: ReceivingPositionStateSchema,
    state: ReceivingPositionStateSchema,
    reason: z.string().optional(),
  }),
);

/** Wareneingang erfasst – gegen eine Avisposition oder blind (`orderId` null). */
export const GoodsCapturedEvent = defineEvent(
  'receiving.captured',
  1,
  z.object({
    captureId: z.uuid(),
    orderId: z.string().nullable(),
    posNo: z.number().int().nullable(),
    kind: z.enum(['quantity', 'unit', 'blind']),
    sku: z.string().nullable(),
    quantity: QuantitySchema.nullable(),
    barcode: z.string(),
    overdelivered: z.boolean(),
    movementNumber: z.string().nullable(),
  }),
);
