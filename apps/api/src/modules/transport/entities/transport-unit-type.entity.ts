import { defineEntity, p } from '@mikro-orm/postgresql';
import { LocationType } from '../../layout/index.js';

/** Art einer Transporteinheit, z. B. Euro-Palette oder Behälter. */
const TransportUnitTypeSchema = defineEntity({
  name: 'TransportUnitType',
  tableName: 'transport_unit_type',
  properties: {
    id: p.uuid().primary(),
    code: p.string().length(40).unique(),
    description: p.string().length(255).default(''),
    lengthMm: p.integer().nullable(),
    widthMm: p.integer().nullable(),
    heightMm: p.integer().nullable(),
    /** Leergewicht in KG; gilt als Gewicht einer TU ohne eigene Gewichtsangabe. */
    tareWeightKg: p.decimal('string').precision(12).scale(3).nullable(),
    /** Höchste Zuladung in KG (Bruttogewicht − Leergewicht). */
    maxPayloadKg: p.decimal('string').precision(12).scale(3).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class TransportUnitType extends TransportUnitTypeSchema.class {}
TransportUnitTypeSchema.setClass(TransportUnitType);

/**
 * Platzierungsregel: TUs dieses Typs dürfen auf Plätze des Platztyps.
 * Hat ein TU-Typ keine Regel, ist er überall erlaubt. `privilegeLevel`
 * dient später der Einlagerstrategie als Vorrang (höher = bevorzugt).
 */
const PlacementRuleSchema = defineEntity({
  name: 'TransportUnitPlacementRule',
  tableName: 'transport_unit_placement_rule',
  properties: {
    id: p.uuid().primary(),
    unitType: () => p.manyToOne(TransportUnitType).deleteRule('cascade').index(),
    locationType: () => p.manyToOne(LocationType).deleteRule('restrict').index(),
    privilegeLevel: p.integer().default(0),
  },
  uniques: [{ properties: ['unitType', 'locationType'] }],
});
export class TransportUnitPlacementRule extends PlacementRuleSchema.class {}
PlacementRuleSchema.setClass(TransportUnitPlacementRule);

/** Stapelregel: auf eine TU vom Basistyp dürfen bis zu `maxCount` TUs vom erlaubten Typ. */
const StackingRuleSchema = defineEntity({
  name: 'TransportUnitStackingRule',
  tableName: 'transport_unit_stacking_rule',
  properties: {
    id: p.uuid().primary(),
    baseType: () => p.manyToOne(TransportUnitType).deleteRule('cascade').index(),
    allowedType: () => p.manyToOne(TransportUnitType).deleteRule('restrict').index(),
    maxCount: p.integer(),
  },
  uniques: [{ properties: ['baseType', 'allowedType'] }],
});
export class TransportUnitStackingRule extends StackingRuleSchema.class {}
StackingRuleSchema.setClass(TransportUnitStackingRule);
