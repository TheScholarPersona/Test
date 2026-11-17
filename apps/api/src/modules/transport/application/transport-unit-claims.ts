import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/domain-error.js';
import type { TransportUnitRef } from './transport-unit-removal-policy.js';

/** Liefert eine Beschreibung, wenn die TU durch diesen Auftragstyp belegt ist, sonst `null`. */
export type TransportUnitClaimCheck = (em: EntityManager, unit: TransportUnitRef) => Promise<string | null>;

/**
 * Belegung einer TU durch Aufträge verschiedener Module (Lagerbewegung,
 * Transportauftrag). Eine TU wird immer nur von einem Auftrag gleichzeitig
 * gesteuert; sonst würden zwei Aufträge ihr Ziel gegenseitig überschreiben.
 *
 * Aufrufer sperren vorher die TU-Zeile (`TransportUnitService.lockRow`),
 * damit zwei gleichzeitige Anfragen die Prüfung nicht beide bestehen.
 */
@Injectable()
export class TransportUnitClaims {
  private readonly checks = new Map<string, TransportUnitClaimCheck>();

  register(name: string, check: TransportUnitClaimCheck): void {
    this.checks.set(name, check);
  }

  async claims(em: EntityManager, unit: TransportUnitRef, except?: string): Promise<{ claim: string; description: string }[]> {
    const result: { claim: string; description: string }[] = [];
    for (const [claim, check] of this.checks) {
      if (claim === except) continue;
      const description = await check(em, unit);
      if (description) result.push({ claim, description });
    }
    return result;
  }

  /** Wirft `TU_CLAIMED`, wenn ein anderer Auftragstyp als `except` die TU belegt. */
  async assertFree(em: EntityManager, unit: TransportUnitRef, except: string): Promise<void> {
    const claims = await this.claims(em, unit, except);
    if (claims.length > 0) {
      throw new ConflictError('TU_CLAIMED', `TU ${unit.barcode} ist belegt: ${claims.map((c) => c.description).join('; ')}`, {
        barcode: unit.barcode,
        claims,
      });
    }
  }
}
