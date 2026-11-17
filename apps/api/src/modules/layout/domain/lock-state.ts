/**
 * Sperrlogik der Lagerstruktur.
 *
 * Gespeichert wird nur die *eigene* Sperre je Gruppe und Platz. Die *wirksame*
 * Sperre ergibt sich aus der eigenen und der aller übergeordneten Gruppen.
 * Damit vererbt sich eine Sperre automatisch auf alle Untergruppen und Plätze,
 * und das Aufheben an der sperrenden Gruppe hebt sie überall auf – ohne
 * Zustandskopien in den Kindern.
 */

export type LockDirection = 'inbound' | 'outbound';

export const LOCK_DIRECTIONS: readonly LockDirection[] = ['inbound', 'outbound'];

export interface LockHolder {
  kind: 'location' | 'location-group';
  name: string;
}

/** Eintrag der Sperrkette: das Objekt selbst zuerst, dann die Gruppen nach oben. */
export interface LockChainEntry extends LockHolder {
  inboundBlocked: boolean;
  outboundBlocked: boolean;
}

export interface EffectiveLock {
  /** Eigene Sperre des Objekts. */
  own: boolean;
  /** Wirksame Sperre (eigene oder geerbte). */
  blocked: boolean;
  /** Nächstgelegenes Objekt, das sperrt (das Objekt selbst oder eine übergeordnete Gruppe). */
  blockedBy: LockHolder | null;
}

const flag = (entry: LockChainEntry, direction: LockDirection): boolean =>
  direction === 'inbound' ? entry.inboundBlocked : entry.outboundBlocked;

/** Wirksame Sperre für die Kette `[selbst, eltern, großeltern, …]`. */
export function effectiveLock(chain: readonly LockChainEntry[], direction: LockDirection): EffectiveLock {
  const [self] = chain;
  if (!self) {
    throw new Error('Sperrkette ist leer');
  }
  const holder = chain.find((entry) => flag(entry, direction));
  return {
    own: flag(self, direction),
    blocked: holder !== undefined,
    blockedBy: holder ? { kind: holder.kind, name: holder.name } : null,
  };
}

/**
 * Übergeordnete Gruppe, die eine Richtung sperrt – oder `null`.
 * Solange sie sperrt, darf das Objekt in dieser Richtung nicht entsperrt werden.
 */
export function inheritedLockHolder(chain: readonly LockChainEntry[], direction: LockDirection): LockHolder | null {
  const holder = chain.slice(1).find((entry) => flag(entry, direction));
  return holder ? { kind: holder.kind, name: holder.name } : null;
}
