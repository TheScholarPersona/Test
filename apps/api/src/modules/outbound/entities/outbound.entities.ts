import { defineEntity, p } from '@mikro-orm/postgresql';
import { Product } from '../../inventory/index.js';
import { Location } from '../../layout/index.js';
import { LINE_STATES, ORDER_STATES, OUTBOUND_PRIORITIES, PICK_STATES } from '../domain/outbound-rules.js';

/** Auslagerauftrag (z. B. Kundenauftrag): Bedarf je Produkt, optional mit Versandplatz. */
const OutboundOrderSchema = defineEntity({
  name: 'OutboundOrder',
  tableName: 'outbound_order',
  properties: {
    id: p.uuid().primary(),
    orderId: p.string().length(40).unique(),
    customer: p.string().length(100).nullable(),
    /** Geschäftspartner (Kunde); Nummer statt Verweis, damit der Auftrag ihn überdauert. */
    customerCode: p.string().length(40).nullable().index(),
    /** Lieferadresse als Momentaufnahme bei Anlage. */
    shipToName: p.string().length(100).nullable(),
    shipToStreet: p.string().length(100).nullable(),
    shipToPostalCode: p.string().length(20).nullable(),
    shipToCity: p.string().length(100).nullable(),
    shipToCountry: p.string().length(2).nullable(),
    priority: p.enum(OUTBOUND_PRIORITIES).default('NORMAL'),
    /** Ziel der Lagerbewegungen/Transportaufträge (z. B. Versandplatz); `null`, wenn gelöscht oder nicht angegeben. */
    target: () => p.manyToOne(Location).nullable().deleteRule('set null').index(),
    targetCoordinate: p.string().length(54).nullable(),
    state: p.enum(ORDER_STATES).default('CREATED'),
    closeReason: p.string().length(200).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class OutboundOrder extends OutboundOrderSchema.class {}
OutboundOrderSchema.setClass(OutboundOrder);

/** Position: Bedarf eines Produkts in der Basiseinheit, optional mit geforderter Charge. */
const OutboundLineSchema = defineEntity({
  name: 'OutboundLine',
  tableName: 'outbound_line',
  properties: {
    id: p.uuid().primary(),
    order: () => p.manyToOne(OutboundOrder).deleteRule('cascade').index(),
    lineNo: p.integer(),
    product: () => p.manyToOne(Product).deleteRule('restrict').index(),
    quantity: p.decimal('string').precision(15).scale(3),
    unitCode: p.string().length(10),
    lot: p.string().length(64).nullable(),
    /** Offene Picks plus entnommene Menge. */
    allocated: p.decimal('string').precision(15).scale(3).default('0'),
    picked: p.decimal('string').precision(15).scale(3).default('0'),
    state: p.enum(LINE_STATES).default('OPEN'),
  },
  uniques: [{ name: 'outbound_line_no_unique', properties: ['order', 'lineNo'] }],
});
export class OutboundLine extends OutboundLineSchema.class {}
OutboundLineSchema.setClass(OutboundLine);

/**
 * Entnahme (Pick): zugeteilte Menge eines Bestandspostens, reserviert bis zur
 * Quittung. Barcode und Platz bleiben als Text erhalten.
 */
const OutboundPickSchema = defineEntity({
  name: 'OutboundPick',
  tableName: 'outbound_pick',
  properties: {
    id: p.uuid().primary(),
    line: () => p.manyToOne(OutboundLine).deleteRule('cascade').index(),
    stockItemId: p.uuid().index(),
    reservationId: p.uuid().nullable(),
    barcode: p.string().length(64).index(),
    locationCoordinate: p.string().length(54),
    quantity: p.decimal('string').precision(15).scale(3),
    picked: p.decimal('string').precision(15).scale(3).default('0'),
    state: p.enum(PICK_STATES).default('OPEN'),
    decisionId: p.uuid().nullable(),
    movementNumber: p.string().length(20).nullable(),
    transportOrderNumber: p.string().length(20).nullable(),
    /** Warum keine Bewegung bzw. kein Transportauftrag angelegt wurde. */
    transportNote: p.string().length(200).nullable(),
    pickedBy: p.string().length(100).nullable(),
    pickedAt: p.datetime().nullable(),
    /** Versand-TU, auf die am Packplatz gepackt wurde (gleich `barcode`, wenn die ganze TU versendet wird). */
    packedInto: p.string().length(64).nullable().index(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export class OutboundPick extends OutboundPickSchema.class {}
OutboundPickSchema.setClass(OutboundPick);
