import { defineEntity, p } from '@mikro-orm/postgresql';
import { Product } from '../../inventory/index.js';
import { ORDER_STATES, POSITION_STATES } from '../domain/receiving-rules.js';

/** Wareneingangsauftrag (Avis). Der Zustand wird aus den Positionen abgeleitet. */
const ReceivingOrderSchema = defineEntity({
  name: 'ReceivingOrder',
  tableName: 'receiving_order',
  properties: {
    id: p.uuid().primary(),
    orderId: p.string().length(64).unique(),
    supplier: p.string().length(100).nullable(),
    /** Geschäftspartner (Lieferant); Nummer statt Verweis, damit das Avis ihn überdauert. */
    supplierCode: p.string().length(40).nullable().index(),
    expectedAt: p.datetime().nullable(),
    state: p.enum(ORDER_STATES).default('OPEN'),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class ReceivingOrder extends ReceivingOrderSchema.class {}
ReceivingOrderSchema.setClass(ReceivingOrder);

export const POSITION_KINDS = ['QUANTITY', 'UNIT'] as const;

/**
 * Avisposition: entweder eine Menge eines Produkts (QUANTITY) oder eine
 * ganze Transporteinheit (UNIT), optional mit erwartetem Barcode.
 */
const ReceivingPositionSchema = defineEntity({
  name: 'ReceivingPosition',
  tableName: 'receiving_position',
  properties: {
    id: p.uuid().primary(),
    order: () => p.manyToOne(ReceivingOrder).deleteRule('cascade').index(),
    posNo: p.integer(),
    kind: p.enum(POSITION_KINDS),
    state: p.enum(POSITION_STATES).default('OPEN'),
    product: () => p.manyToOne(Product).nullable().deleteRule('restrict').index(),
    expectedQuantity: p.decimal('string').precision(15).scale(3).nullable(),
    receivedQuantity: p.decimal('string').precision(15).scale(3).default('0'),
    unitCode: p.string().length(10).nullable(),
    expectedBarcode: p.string().length(64).nullable(),
    unitTypeCode: p.string().length(40).nullable(),
    receivedBarcode: p.string().length(64).nullable(),
    closeReason: p.string().length(200).nullable(),
    version: p.integer().version(),
  },
  uniques: [{ properties: ['order', 'posNo'] }],
});
export class ReceivingPosition extends ReceivingPositionSchema.class {}
ReceivingPositionSchema.setClass(ReceivingPosition);

export const CAPTURE_KINDS = ['QUANTITY', 'UNIT', 'BLIND'] as const;

/** Einzelne Erfassung im Wareneingang (Historie; unveränderlich). */
const ReceivingCaptureSchema = defineEntity({
  name: 'ReceivingCapture',
  tableName: 'receiving_capture',
  properties: {
    id: p.uuid().primary(),
    kind: p.enum(CAPTURE_KINDS),
    order: () => p.manyToOne(ReceivingOrder).nullable().deleteRule('cascade').index(),
    posNo: p.integer().nullable(),
    sku: p.string().length(64).nullable(),
    quantity: p.decimal('string').precision(15).scale(3).nullable(),
    unitCode: p.string().length(10).nullable(),
    barcode: p.string().length(64).index(),
    locationId: p.string().length(54),
    lot: p.string().length(64).nullable(),
    bestBefore: p.date().nullable(),
    overdelivered: p.boolean().default(false),
    capturedBy: p.string().length(100).nullable(),
    movementNumber: p.string().length(20).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export class ReceivingCapture extends ReceivingCaptureSchema.class {}
ReceivingCaptureSchema.setClass(ReceivingCapture);
