import { Injectable } from '@nestjs/common';

export interface TransportUnitRef {
  id: string;
  barcode: string;
}

/** Liefert einen Grund, warum die TU nicht gelöscht werden darf, sonst `null`. */
export type TransportUnitRemovalCheck = (unit: TransportUnitRef) => Promise<string | null>;

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

  async objections(unit: TransportUnitRef): Promise<{ check: string; reason: string }[]> {
    const results = await Promise.all([...this.checks.entries()].map(async ([check, fn]) => ({ check, reason: await fn(unit) })));
    return results.filter((r): r is { check: string; reason: string } => r.reason !== null);
  }
}
