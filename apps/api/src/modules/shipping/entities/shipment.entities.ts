import { defineEntity, p } from '@mikro-orm/postgresql';
import type { ShippedContent } from '../../inventory/index.js';

export const SHIPMENT_STATES = ['OPEN', 'LOADED', 'SHIPPED', 'CANCELLED'] as const;

/**
 * Sendung (OpenWMS: Shipping): versandfertige TUs eines Auslagerauftrags mit Lieferadresse und
 * Spediteur. Nach dem Warenausgang sind die TUs gelöscht; die Sendung behält ihren Inhalt.
 */
const ShipmentSchema = defineEntity({
  name: 'Shipment',
  tableName: 'shipment',
  properties: {
    id: p.uuid().primary(),
    /** Lesbare Nummer, z. B. SH00000001; zugleich interner Barcode der Sendung. */
    number: p.string().length(20).unique(),
    orderId: p.string().length(40).index(),
    customerCode: p.string().length(40).nullable(),
    shipToName: p.string().length(100).nullable(),
    shipToStreet: p.string().length(100).nullable(),
    shipToPostalCode: p.string().length(20).nullable(),
    shipToCity: p.string().length(100).nullable(),
    shipToCountry: p.string().length(2).nullable(),
    carrierCode: p.string().length(40).nullable(),
    state: p.enum(SHIPMENT_STATES).default('OPEN').index(),
    cancelReason: p.string().length(200).nullable(),
    createdBy: p.string().length(100).nullable(),
    loadedAt: p.datetime().nullable(),
    shippedAt: p.datetime().nullable(),
    shippedBy: p.string().length(100).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()).index(),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class Shipment extends ShipmentSchema.class {}
ShipmentSchema.setClass(Shipment);

/** TU einer Sendung. `contents` wird beim Warenausgang gefüllt (Historie). */
const ShipmentUnitSchema = defineEntity({
  name: 'ShipmentUnit',
  tableName: 'shipment_unit',
  properties: {
    id: p.uuid().primary(),
    shipment: () => p.manyToOne(Shipment).deleteRule('cascade').index(),
    barcode: p.string().length(64).index(),
    /** Ladekontrolle: beim Verladen gescannt. */
    loaded: p.boolean().default(false),
    loadedAt: p.datetime().nullable(),
    loadedBy: p.string().length(100).nullable(),
    contents: p.json<ShippedContent[]>().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export class ShipmentUnit extends ShipmentUnitSchema.class {}
ShipmentUnitSchema.setClass(ShipmentUnit);
