import { Quantity } from '@wms/shared';

/**
 * Prüft, ob eine Transporteinheit (samt aufgestapelter TUs) auf einen
 * Lagerplatz gestellt werden darf. Liefert *alle* verletzten Regeln,
 * damit Aufrufer (Bediener, Node-RED, Einlagerstrategie) den vollständigen
 * Grund sehen.
 */

export type PlacementRule =
  | 'SOURCE_OUTBOUND_BLOCKED'
  | 'TARGET_INBOUND_BLOCKED'
  | 'LOCATION_FULL'
  | 'WEIGHT_EXCEEDED'
  | 'PLACEMENT_NOT_ALLOWED'
  /** Nur bei der Platzvergabe: Platz ist von der automatischen Vergabe ausgenommen. */
  | 'ALLOCATION_BLOCKED'
  /** Nur bei der Platzvergabe: die Anlage meldet für den Platz eine Störung. */
  | 'PLC_FAULT';

export interface PlacementViolation {
  rule: PlacementRule;
  message: string;
}

export interface PlacementInput {
  unit: {
    typeCode: string;
    /** Erlaubte Platztypen laut Platzierungsregeln; leer = keine Einschränkung. */
    allowedLocationTypes: readonly string[];
    /** Gewicht der TU einschließlich aller auf ihr gestapelten TUs. */
    stackWeight: Quantity;
  };
  /** Aktueller Platz; `null` beim Anlegen einer neuen TU. */
  source: {
    locationId: string;
    outboundBlocked: boolean;
    outboundBlockedBy: string | null;
  } | null;
  target: {
    locationId: string;
    typeCode: string;
    inboundBlocked: boolean;
    inboundBlockedBy: string | null;
    /** Höchstzahl der direkt abgestellten TUs (0 = keine Abstellung erlaubt). */
    maxTransportUnits: number;
    /** Höchstgewicht in KG; `null` = unbegrenzt. */
    maxWeight: Quantity | null;
    /** Direkt abgestellte TUs ohne die zu prüfende. */
    occupiedSlots: number;
    /** Gewicht aller TUs auf dem Platz ohne den Stapel der zu prüfenden TU. */
    currentWeight: Quantity;
  };
}

export function checkPlacement(input: PlacementInput): PlacementViolation[] {
  const { unit, source, target } = input;
  const violations: PlacementViolation[] = [];

  if (source?.outboundBlocked) {
    violations.push({
      rule: 'SOURCE_OUTBOUND_BLOCKED',
      message: `Platz ${source.locationId} ist für Auslagerung gesperrt${source.outboundBlockedBy ? ` (durch ${source.outboundBlockedBy})` : ''}`,
    });
  }
  if (target.inboundBlocked) {
    violations.push({
      rule: 'TARGET_INBOUND_BLOCKED',
      message: `Platz ${target.locationId} ist für Einlagerung gesperrt${target.inboundBlockedBy ? ` (durch ${target.inboundBlockedBy})` : ''}`,
    });
  }
  if (target.occupiedSlots + 1 > target.maxTransportUnits) {
    violations.push({
      rule: 'LOCATION_FULL',
      message: `Platz ${target.locationId} ist voll (${target.occupiedSlots} von ${target.maxTransportUnits} TUs)`,
    });
  }
  if (target.maxWeight) {
    const total = target.currentWeight.add(unit.stackWeight);
    if (total.compareTo(target.maxWeight) > 0) {
      violations.push({
        rule: 'WEIGHT_EXCEEDED',
        message: `Gewicht auf Platz ${target.locationId} wäre ${total.amount} KG, erlaubt sind ${target.maxWeight.amount} KG`,
      });
    }
  }
  if (unit.allowedLocationTypes.length > 0 && !unit.allowedLocationTypes.includes(target.typeCode)) {
    violations.push({
      rule: 'PLACEMENT_NOT_ALLOWED',
      message: `TU-Typ ${unit.typeCode} darf nicht auf Platztyp ${target.typeCode} (erlaubt: ${unit.allowedLocationTypes.join(', ')})`,
    });
  }
  return violations;
}

export const KG = (amount: string | null | undefined): Quantity => Quantity.of(amount ?? '0', 'KG');
