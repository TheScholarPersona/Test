import { BarcodeSchema, LotSchema, OutboundOrderStateSchema, QuantitySchema, SkuSchema, TransportOrderPrioritySchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { LocationReferenceSchema } from '../../layout/index.js';

export { pageOf };

export const OrderIdSchema = z.string().trim().regex(/^[A-Za-z0-9_.\-/]{1,40}$/, 'Auftragsnummer: Buchstaben, Ziffern, _ . - / (max. 40)');
export const OrderIdParam = z.object({ orderId: OrderIdSchema });
export const PickParam = z.object({ orderId: OrderIdSchema, pickId: z.uuid() });

export const CreateOutboundOrderSchema = z
  .strictObject({
    orderId: OrderIdSchema,
    customer: z.string().trim().min(1).max(100).optional(),
    priority: TransportOrderPrioritySchema.default('NORMAL'),
    target: LocationReferenceSchema.optional().meta({ description: 'Versand- oder Kommissionierplatz für Bewegungen/Transportaufträge' }),
    lines: z
      .array(
        z.strictObject({
          sku: SkuSchema,
          quantity: QuantitySchema.meta({ description: 'Bedarf in Basis- oder alternativer Einheit' }),
          lot: LotSchema.optional().meta({ description: 'Nur Bestand dieser Charge' }),
        }),
      )
      .min(1)
      .max(500),
  })
  .meta({ id: 'CreateOutboundOrder' });
export type CreateOutboundOrder = z.infer<typeof CreateOutboundOrderSchema>;

export const AllocateSchema = z
  .strictObject({
    transport: z.enum(['none', 'movement', 'transport-order']).default('none').meta({
      description: 'Für jede TU mit neuem Pick eine Lagerbewegung (Bediener) bzw. einen Transportauftrag (Anlage) zum Ziel des Auftrags anlegen',
    }),
  })
  .meta({ id: 'AllocateOutboundOrder' });
export type AllocateInput = z.infer<typeof AllocateSchema>;

export const ConfirmPickSchema = z
  .strictObject({
    quantity: QuantitySchema.optional().meta({ description: 'Entnommene Menge; ohne Angabe die zugeteilte. Weniger = Fehlmenge, Rest wird freigegeben' }),
    pickedBy: z.string().trim().min(1).max(100).optional(),
  })
  .meta({ id: 'ConfirmPick' });
export type ConfirmPickInput = z.infer<typeof ConfirmPickSchema>;

export const ReasonSchema = z.strictObject({ reason: z.string().trim().min(1).max(200).optional() }).meta({ id: 'OutboundReason' });
export type ReasonInput = z.infer<typeof ReasonSchema>;

export const OutboundQuerySchema = z.object({
  state: OutboundOrderStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type OutboundQuery = z.infer<typeof OutboundQuerySchema>;

export const PickQuerySchema = z.object({
  state: z.enum(['OPEN', 'PICKED', 'SHORT', 'CANCELLED']).default('OPEN'),
  barcode: BarcodeSchema.optional(),
  orderId: OrderIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PickQuery = z.infer<typeof PickQuerySchema>;

export const PickDtoSchema = z
  .object({
    id: z.uuid(),
    orderId: z.string(),
    lineNo: z.number().int(),
    sku: z.string(),
    stockItemId: z.uuid(),
    barcode: z.string(),
    locationId: z.string(),
    quantity: QuantitySchema,
    picked: QuantitySchema,
    state: z.enum(['OPEN', 'PICKED', 'SHORT', 'CANCELLED']),
    decisionId: z.uuid().nullable(),
    movementNumber: z.string().nullable(),
    transportOrderNumber: z.string().nullable(),
    transportNote: z.string().nullable(),
    pickedBy: z.string().nullable(),
    pickedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'OutboundPick' });
export type PickDto = z.infer<typeof PickDtoSchema>;

export const OutboundOrderDtoSchema = z
  .object({
    orderId: z.string(),
    customer: z.string().nullable(),
    priority: TransportOrderPrioritySchema,
    target: z.object({ id: z.uuid().nullable(), locationId: z.string() }).nullable(),
    state: OutboundOrderStateSchema,
    closeReason: z.string().nullable(),
    lines: z.array(
      z.object({
        lineNo: z.number().int(),
        sku: z.string(),
        lot: z.string().nullable(),
        state: z.enum(['OPEN', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'PICKED', 'SHORT', 'CANCELLED']),
        quantity: QuantitySchema,
        allocated: QuantitySchema,
        picked: QuantitySchema,
        open: QuantitySchema.meta({ description: 'Noch nicht zugeteilt' }),
      }),
    ),
    picks: z.array(PickDtoSchema),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'OutboundOrder' });
export type OutboundOrderDto = z.infer<typeof OutboundOrderDtoSchema>;
