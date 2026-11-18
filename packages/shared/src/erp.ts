import { z } from 'zod';
import { defineEvent } from './events.js';
import { BarcodeSchema, LotSchema, SkuSchema } from './identifiers.js';
import { QuantitySchema, UnitCodeSchema } from './quantity.js';

/**
 * Kanonisches, ERP-neutrales Nachrichtenformat. Node-RED übersetzt konkrete Formate (JSON-Webhook,
 * CSV, SAP IDoc) in dieses Format und zurück; das WMS kennt nur dieses.
 */

const Text = (max: number) => z.string().trim().min(1).max(max);
const OrderId = z.string().trim().regex(/^[A-Za-z0-9_.\-/]{1,40}$/);
const PartnerCode = z.string().trim().regex(/^[A-Za-z0-9_.\-/]{1,40}$/);
const Priority = z.enum(['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST']);

// --- Eingang (ERP → WMS) ------------------------------------------------------------------

export const ErpProductSchema = z.object({
  sku: SkuSchema,
  description: z.string().trim().max(255).optional(),
  baseUnit: UnitCodeSchema,
  overdeliveryAllowed: z.boolean().optional(),
  units: z.array(z.object({ unit: UnitCodeSchema, factor: z.string().regex(/^\d+(\.\d+)?$/) })).max(20).optional(),
});
export type ErpProduct = z.infer<typeof ErpProductSchema>;

export const ErpReceivingOrderSchema = z.object({
  orderId: OrderId,
  supplierCode: PartnerCode.optional(),
  supplier: Text(100).optional(),
  expectedAt: z.iso.datetime({ offset: true }).optional(),
  priority: Priority.optional(),
  details: z.record(z.string(), z.string()).optional(),
  positions: z
    .array(z.object({ posNo: z.number().int().min(1).optional(), sku: SkuSchema, quantity: QuantitySchema }))
    .min(1)
    .max(500),
});
export type ErpReceivingOrder = z.infer<typeof ErpReceivingOrderSchema>;

export const ErpOutboundOrderSchema = z.object({
  orderId: OrderId,
  customerCode: PartnerCode.optional(),
  customer: Text(100).optional(),
  priority: Priority.optional(),
  /** Versand- oder Packplatz als ERP-Code des Lagerplatzes. */
  target: Text(64).optional(),
  shipTo: z
    .object({ name: Text(100).optional(), street: Text(100).optional(), postalCode: Text(20).optional(), city: Text(100).optional(), country: z.string().regex(/^[A-Za-z]{2}$/).optional() })
    .optional(),
  lines: z.array(z.object({ sku: SkuSchema, quantity: QuantitySchema, lot: LotSchema.optional() })).min(1).max(500),
});
export type ErpOutboundOrder = z.infer<typeof ErpOutboundOrderSchema>;

const InboundBase = {
  /** Eindeutige Nachrichten-ID des Absenders; dieselbe ID wird nur einmal verarbeitet. */
  messageId: z.string().trim().min(1).max(100),
};

export const ErpInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...InboundBase, type: z.literal('product'), action: z.enum(['upsert']).default('upsert'), data: ErpProductSchema }),
  z.object({ ...InboundBase, type: z.literal('receiving-order'), action: z.enum(['create', 'cancel']).default('create'), data: ErpReceivingOrderSchema.or(z.object({ orderId: OrderId })) }),
  z.object({ ...InboundBase, type: z.literal('outbound-order'), action: z.enum(['create', 'cancel']).default('create'), data: ErpOutboundOrderSchema.or(z.object({ orderId: OrderId })) }),
]);
export type ErpInboundMessage = z.infer<typeof ErpInboundMessageSchema>;
export type ErpInboundMessageInput = z.input<typeof ErpInboundMessageSchema>;

// --- Ausgang (WMS → ERP) ------------------------------------------------------------------

export const ErpGoodsReceiptSchema = z.object({
  orderId: z.string().nullable(),
  posNo: z.number().int().nullable(),
  sku: z.string(),
  quantity: QuantitySchema,
  barcode: BarcodeSchema,
  /** Erfassung ohne Avis. */
  blind: z.boolean(),
  captureId: z.uuid(),
});

export const ErpGoodsIssueSchema = z.object({
  orderId: z.string().nullable(),
  /** Sendungsnummer; `null` bei Ausbuchung direkt am Pick (ohne Versand). */
  shipment: z.string().nullable(),
  carrierCode: z.string().nullable(),
  lines: z.array(z.object({ sku: z.string(), quantity: QuantitySchema, lot: z.string().nullable(), bestBefore: z.string().nullable(), barcode: z.string() })),
});

export const ErpStockChangeSchema = z.object({
  sku: z.string(),
  barcode: z.string(),
  /** Positiv = Zugang, negativ = Abgang. */
  delta: QuantitySchema,
  reason: z.string(),
  reference: z.string().nullable(),
});

export const ErpStockSnapshotSchema = z.object({
  takenAt: z.iso.datetime(),
  items: z.array(z.object({ sku: z.string(), lot: z.string().nullable(), quantity: QuantitySchema })),
});

export const ErpOutboundTypeSchema = z.enum(['goods-receipt', 'goods-issue', 'stock-change', 'stock-snapshot']);
export type ErpOutboundType = z.infer<typeof ErpOutboundTypeSchema>;

export const ErpOutboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ messageId: z.uuid(), type: z.literal('goods-receipt'), occurredAt: z.iso.datetime(), data: ErpGoodsReceiptSchema }),
  z.object({ messageId: z.uuid(), type: z.literal('goods-issue'), occurredAt: z.iso.datetime(), data: ErpGoodsIssueSchema }),
  z.object({ messageId: z.uuid(), type: z.literal('stock-change'), occurredAt: z.iso.datetime(), data: ErpStockChangeSchema }),
  z.object({ messageId: z.uuid(), type: z.literal('stock-snapshot'), occurredAt: z.iso.datetime(), data: ErpStockSnapshotSchema }),
]);
export type ErpOutboundMessage = z.infer<typeof ErpOutboundMessageSchema>;

// --- Events --------------------------------------------------------------------------------

/** Eine ERP-Nachricht ist endgültig fehlgeschlagen (Eingang: Verarbeitung; Ausgang: Zustellversuche aufgebraucht). */
export const ErpMessageFailedEvent = defineEvent(
  'erp-message.failed',
  1,
  z.object({ id: z.uuid(), direction: z.enum(['IN', 'OUT']), messageId: z.string(), type: z.string(), reference: z.string().nullable(), error: z.string() }),
);
