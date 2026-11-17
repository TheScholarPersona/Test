import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

export interface TransportUnitRef {
  id: string;
  barcode: string;
}

/**
 * Liefert einen Grund, warum die TU nicht gelöscht werden darf, sonst `null`. `em` ist der
 * EntityManager der löschenden Transaktion, damit die Prüfung deren Änderungen sieht.
 */
export type TransportUnitRemovalCheck = (unit: TransportUnitRef, em: EntityManager) => Promise<string | null>;

/**
 * Andere Module melden hier Einwände gegen das Löschen einer TU an
 * (ab Schritt 5: laufender Transportauftrag).
 */
@Injectable()
export class TransportUnitRemovalPolicy {
  private readonly checks = new Map<string, TransportUnitRemovalCheck>();

  register(name: string, check: TransportUnitRemovalCheck): void {
    this.checks.set(name, check);
  }

  async objections(unit: TransportUnitRef, em: EntityManager): Promise<{ check: string; reason: string }[]> {
    const results: { check: string; reason: string | null }[] = [];
    // nacheinander: dieselbe Verbindung der Transaktion verträgt keine parallelen Abfragen
    for (const [check, fn] of this.checks) results.push({ check, reason: await fn(unit, em) });
    return results.filter((r): r is { check: string; reason: string } => r.reason !== null);
  }
}
