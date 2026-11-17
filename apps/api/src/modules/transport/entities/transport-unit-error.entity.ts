import { defineEntity, p } from '@mikro-orm/postgresql';
import { TransportUnit } from './transport-unit.entity.js';

/**
 * Fehlermeldung an einer Transporteinheit (OpenWMS `UnitError`). Bleibt als Historie erhalten:
 * Barcode und Platz werden mitgeschrieben, die Verknüpfung zur TU entfällt, wenn sie gelöscht wird.
 */
const TransportUnitErrorSchema = defineEntity({
  name: 'TransportUnitError',
  tableName: 'transport_unit_error',
  properties: {
    id: p.uuid().primary(),
    unit: () => p.manyToOne(TransportUnit).nullable().deleteRule('set null').index(),
    barcode: p.string().length(64).index(),
    code: p.string().length(60),
    message: p.string().length(200).nullable(),
    /** Platz der TU zum Zeitpunkt der Meldung (Koordinate). */
    locationId: p.string().length(54).nullable(),
    /** Melder, z. B. `user:anna`, `service:node-red` oder `device:SPS1`. */
    reportedBy: p.string().length(100).nullable(),
    reportedAt: p.datetime().onCreate(() => new Date()).index(),
    resolvedAt: p.datetime().nullable(),
    resolvedBy: p.string().length(100).nullable(),
    resolution: p.string().length(200).nullable(),
    version: p.integer().version(),
  },
});

export class TransportUnitError extends TransportUnitErrorSchema.class {}
TransportUnitErrorSchema.setClass(TransportUnitError);
