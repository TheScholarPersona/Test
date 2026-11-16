import { defineEntity, p } from '@mikro-orm/postgresql';
import { TransportUnit } from '../../transport/index.js';

/** Produkt (Artikel). Bestand wird in der Basiseinheit geführt. */
const ProductSchema = defineEntity({
  name: 'Product',
  tableName: 'product',
  properties: {
    id: p.uuid().primary(),
    sku: p.string().length(64).unique(),
    description: p.string().length(255).default(''),
    /** Einheit, in der Bestand geführt und erfasst wird, z. B. PCS oder KG. */
    baseUnit: p.string().length(10),
    /** Darf im Wareneingang mehr als avisiert angenommen werden? */
    overdeliveryAllowed: p.boolean().default(false),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class Product extends ProductSchema.class {}
ProductSchema.setClass(Product);

/**
 * Bestandsposten: Menge eines Produkts auf genau einer Transporteinheit,
 * unterschieden nach Charge und Mindesthaltbarkeit.
 */
const StockItemSchema = defineEntity({
  name: 'StockItem',
  tableName: 'stock_item',
  properties: {
    id: p.uuid().primary(),
    product: () => p.manyToOne(Product).deleteRule('restrict').index(),
    unit: () => p.manyToOne(TransportUnit).deleteRule('restrict').index(),
    quantity: p.decimal('string').precision(15).scale(3),
    unitCode: p.string().length(10),
    lot: p.string().length(64).nullable(),
    bestBefore: p.date().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class StockItem extends StockItemSchema.class {}
StockItemSchema.setClass(StockItem);

export const BOOKING_TYPES = ['RECEIPT', 'CORRECTION'] as const;

/**
 * Buchungsjournal: jede Bestandsänderung mit Bezug. Unveränderlich; Barcode
 * und SKU bleiben als Text erhalten, auch wenn TU oder Produkt später gelöscht werden.
 */
const StockBookingSchema = defineEntity({
  name: 'StockBooking',
  tableName: 'stock_booking',
  properties: {
    id: p.uuid().primary(),
    type: p.enum(BOOKING_TYPES),
    sku: p.string().length(64).index(),
    barcode: p.string().length(64).index(),
    /** Vorzeichenbehaftete Menge (Zugang positiv). */
    quantity: p.decimal('string').precision(15).scale(3),
    unitCode: p.string().length(10),
    lot: p.string().length(64).nullable(),
    bestBefore: p.date().nullable(),
    /** Fachlicher Bezug, z. B. `receiving:WE-4711/1` oder `receiving:blind`. */
    reference: p.string().length(120).index(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export class StockBooking extends StockBookingSchema.class {}
StockBookingSchema.setClass(StockBooking);
