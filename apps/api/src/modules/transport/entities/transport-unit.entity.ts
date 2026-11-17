import { defineEntity, p } from '@mikro-orm/postgresql';
import { Location } from '../../layout/index.js';
import { TransportUnitType } from './transport-unit-type.entity.js';

export const TRANSPORT_UNIT_STATES = ['AVAILABLE', 'BLOCKED', 'QUALITY_CHECK'] as const;

/**
 * Transporteinheit (Palette, Behälter, …), identifiziert über den Barcode.
 * Steht immer auf genau einem Lagerplatz; gestapelte TUs stehen auf dem
 * Platz ihrer Basis und bewegen sich mit ihr.
 */
const TransportUnitSchema = defineEntity({
  name: 'TransportUnit',
  tableName: 'transport_unit',
  properties: {
    id: p.uuid().primary(),
    barcode: p.string().length(64).unique(),
    type: () => p.manyToOne(TransportUnitType).deleteRule('restrict').index(),
    state: p.enum(TRANSPORT_UNIT_STATES).default('AVAILABLE'),
    location: () => p.manyToOne(Location).deleteRule('restrict').index(),
    /** Geplantes Ziel (z. B. aus einem Transportauftrag); `null` = keines. */
    target: () => p.manyToOne(Location).nullable().deleteRule('set null').index(),
    /** TU, auf der diese TU steht. */
    parent: () => p.manyToOne(TransportUnit).nullable().deleteRule('restrict').index(),
    /** Gemessenes Bruttogewicht in KG; `null` = Leergewicht des Typs. */
    weightKg: p.decimal('string').precision(12).scale(3).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});

export class TransportUnit extends TransportUnitSchema.class {}
TransportUnitSchema.setClass(TransportUnit);
