import { Injectable } from '@nestjs/common';

export interface LocationRef {
  id: string;
  locationId: string;
}

/**
 * Prüft, ob ein Lagerplatz gelöscht werden darf. Gibt einen Grund zurück,
 * wenn nicht, sonst `null`.
 */
export type LocationRemovalCheck = (location: LocationRef) => Promise<string | null>;

/**
 * Andere Module melden hier ihre Einwände an (z. B. ab Schritt 2:
 * „Transporteinheit steht auf dem Platz“). Die Lagerstruktur selbst
 * kennt diese Module nicht.
 */
@Injectable()
export class LocationRemovalPolicy {
  private readonly checks = new Map<string, LocationRemovalCheck>();

  register(name: string, check: LocationRemovalCheck): void {
    this.checks.set(name, check);
  }

  async objections(location: LocationRef): Promise<{ check: string; reason: string }[]> {
    const results = await Promise.all(
      [...this.checks.entries()].map(async ([check, fn]) => ({ check, reason: await fn(location) })),
    );
    return results.filter((r): r is { check: string; reason: string } => r.reason !== null);
  }
}
