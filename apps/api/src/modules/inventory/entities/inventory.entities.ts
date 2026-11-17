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
    /** Summe der Reservierungen auf diesem Posten; verfügbar = quantity − reserved. */
    reserved: p.decimal('string').precision(15).scale(3).default('0'),
    unitCode: p.string().length(10),
    lot: p.string().length(64).nullable(),
    bestBefore: p.date().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
  // Zusätzliche Absicherung in der Datenbank: nie mehr reserviert als vorhanden.
  checks: [{ name: 'stock_item_reserved_check', expression: 'reserved >= 0 and reserved <= quantity' }],
});
export class StockItem extends StockItemSchema.class {}
StockItemSchema.setClass(StockItem);

export const BOOKING_TYPES = ['RECEIPT', 'CORRECTION', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN'] as const;

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

/** Alternative Einheit eines Produkts: 1 `unitCode` = `factor` Basiseinheiten (z. B. 1 KAR = 12 PCS). */
const ProductUnitSchema = defineEntity({
  name: 'ProductUnit',
  tableName: 'product_unit',
  properties: {
    id: p.uuid().primary(),
    product: () => p.manyToOne(Product).deleteRule('cascade').index(),
    unitCode: p.string().length(10),
    factor: p.decimal('string').precision(15).scale(6),
  },
  uniques: [{ name: 'product_unit_unique', properties: ['product', 'unitCode'] }],
});
export class ProductUnit extends ProductUnitSchema.class {}
ProductUnitSchema.setClass(ProductUnit);

/** Reservierung von Bestand eines Postens für einen Bedarf (z. B. Auslagerauftrag). */
const StockReservationSchema = defineEntity({
  name: 'StockReservation',
  tableName: 'stock_reservation',
  properties: {
    id: p.uuid().primary(),
    item: () => p.manyToOne(StockItem).deleteRule('restrict').index(),
    quantity: p.decimal('string').precision(15).scale(3),
    unitCode: p.string().length(10),
    reference: p.string().length(120).index(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export class StockReservation extends StockReservationSchema.class {}
StockReservationSchema.setClass(StockReservation);

export const COUNT_STATES = ['OPEN', 'COUNTED', 'CLOSED', 'CANCELLED'] as const;

/**
 * Inventur einer TU. Solange sie offen oder gezählt ist, sind andere
 * Buchungen auf der TU gesperrt (Inventursperre).
 */
const StockCountSchema = defineEntity({
  name: 'StockCount',
  tableName: 'stock_count',
  properties: {
    id: p.uuid().primary(),
    number: p.string().length(20).unique(),
    barcode: p.string().length(64).index(),
    unit: () => p.manyToOne(TransportUnit).nullable().deleteRule('set null').index(),
    state: p.enum(COUNT_STATES).default('OPEN'),
    reference: p.string().length(120).nullable(),
    countedBy: p.string().length(100).nullable(),
    countedAt: p.datetime().nullable(),
    closedAt: p.datetime().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
  uniques: [
    // Höchstens eine laufende Inventur je TU.
    { name: 'stock_count_one_open_per_unit', properties: ['unit'], where: { state: { $in: ['OPEN', 'COUNTED'] } } },
  ],
});
export class StockCount extends StockCountSchema.class {}
StockCountSchema.setClass(StockCount);

/** Zeile einer Inventur: Soll (beim Öffnen) und Ist (gezählt) je Produkt, Charge und MHD. */
const StockCountLineSchema = defineEntity({
  name: 'StockCountLine',
  tableName: 'stock_count_line',
  properties: {
    id: p.uuid().primary(),
    count: () => p.manyToOne(StockCount).deleteRule('cascade').index(),
    sku: p.string().length(64),
    lot: p.string().length(64).nullable(),
    bestBefore: p.date().nullable(),
    unitCode: p.string().length(10),
    expected: p.decimal('string').precision(15).scale(3),
    counted: p.decimal('string').precision(15).scale(3).nullable(),
  },
});
export class StockCountLine extends StockCountLineSchema.class {}
StockCountLineSchema.setClass(StockCountLine);
