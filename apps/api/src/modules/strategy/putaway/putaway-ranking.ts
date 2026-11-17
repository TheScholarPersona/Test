import type { CandidateResult, Evaluation } from '../domain/types.js';

/** Geprüfter Lagerplatz als Kandidat für die Einlagerung (in Sortierreihenfolge geliefert). */
export interface PutawayCandidate {
  id: string;
  locationId: string;
  sortOrder: number;
  typeCode: string;
  maxTransportUnits: number;
  occupiedSlots: number;
  /** Vorrang des Platztyps laut Platzierungsregel des TU-Typs (0 = keiner). */
  privilegeLevel: number;
  /** Verletzte harte Regeln; leer = geeignet. */
  violations: { rule: string; message: string }[];
}

export interface Weights {
  sortOrder: number;
  emptiness: number;
  privilege: number;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function toResult(c: PutawayCandidate, score: number | null, details: Record<string, unknown> = {}): CandidateResult {
  return {
    key: c.id,
    label: c.locationId,
    eligible: c.violations.length === 0,
    violations: c.violations,
    score,
    details: { sortOrder: c.sortOrder, occupiedSlots: c.occupiedSlots, maxTransportUnits: c.maxTransportUnits, privilegeLevel: c.privilegeLevel, ...details },
  };
}

function finish(scored: CandidateResult[], rejected: CandidateResult[], emptyNote: string): Evaluation {
  const eligible = scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const evaluation: Evaluation = { chosen: eligible[0] ?? null, candidates: [...eligible, ...rejected] };
  if (!evaluation.chosen) {
    evaluation.note = emptyNote;
  }
  return evaluation;
}

const noneNote = (candidates: PutawayCandidate[]) =>
  candidates.length === 0 ? 'Die Suchgruppe enthält keine Lagerplätze' : 'Kein Lagerplatz erfüllt alle harten Regeln';

/** Erster geeigneter Platz in Sortierreihenfolge (`sortOrder`, dann Koordinate). */
export function rankFirstFree(candidates: PutawayCandidate[]): Evaluation {
  const eligible = candidates.filter((c) => c.violations.length === 0);
  const scored = eligible.map((c, rank) => toResult(c, eligible.length - rank, { rank: rank + 1 }));
  const rejected = candidates.filter((c) => c.violations.length > 0).map((c) => toResult(c, null));
  return finish(scored, rejected, noneNote(candidates));
}

/**
 * Gewichtete Bewertung geeigneter Plätze, jeweils normiert auf 0…1:
 * - sortOrder: frühe Plätze in der Sortierung bevorzugt
 * - emptiness: leerere Plätze bevorzugt (1 − belegt/Höchstzahl)
 * - privilege: Platztypen mit höherem Vorrang laut Platzierungsregel bevorzugt
 * Gleichstand entscheidet die Sortierreihenfolge.
 */
export function rankWeighted(candidates: PutawayCandidate[], weights: Weights): Evaluation {
  const eligible = candidates.filter((c) => c.violations.length === 0);
  const maxPrivilege = Math.max(0, ...eligible.map((c) => c.privilegeLevel));
  const scored = eligible.map((c, rank) => {
    const components = {
      sortOrder: eligible.length > 1 ? 1 - rank / (eligible.length - 1) : 1,
      emptiness: c.maxTransportUnits > 0 ? 1 - c.occupiedSlots / c.maxTransportUnits : 0,
      privilege: maxPrivilege > 0 ? c.privilegeLevel / maxPrivilege : 0,
    };
    const score =
      weights.sortOrder * components.sortOrder + weights.emptiness * components.emptiness + weights.privilege * components.privilege;
    // Winziger Abzug je Rang macht die Reihenfolge bei Gleichstand eindeutig, ohne die Gewichtung zu verfälschen.
    return toResult(c, round(score - rank * 1e-6), {
      rank: rank + 1,
      components: { sortOrder: round(components.sortOrder), emptiness: round(components.emptiness), privilege: round(components.privilege) },
    });
  });
  const rejected = candidates.filter((c) => c.violations.length > 0).map((c) => toResult(c, null));
  return finish(scored, rejected, noneNote(candidates));
}
