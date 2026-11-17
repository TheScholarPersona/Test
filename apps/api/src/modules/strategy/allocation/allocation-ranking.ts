import { Quantity } from '@wms/shared';
import type { CandidateResult, Evaluation } from '../domain/types.js';

/**
 * Bestandsposten als Kandidat für eine Auslagerung. Harte Regeln (verfügbar,
 * TU freigegeben, Platz nicht für Auslagerung gesperrt, keine Inventur) sind
 * bereits geprüft und stehen in `violations`.
 */
export interface AllocationCandidate {
  id: string;
  barcode: string;
  locationId: string;
  available: string;
  unit: string;
  lot: string | null;
  bestBefore: string | null;
  /** Zugangszeitpunkt des Postens (Anlage), ISO-Zeitstempel. */
  receivedAt: string;
  /** Der Posten ist der einzige auf der TU und nichts davon reserviert: wird er ganz genommen, ist die TU leer. */
  wholeUnit: boolean;
  violations: { rule: string; message: string }[];
}

export type AllocationStrategyId = 'fifo' | 'fefo' | 'lifo' | 'partial-first' | 'full-unit';

export interface PlannedPick {
  key: string;
  barcode: string;
  locationId: string;
  quantity: string;
}

export interface AllocationEvaluation extends Evaluation {
  plan: PlannedPick[];
  allocated: string;
  shortfall: string;
}

const qty = (c: AllocationCandidate) => Quantity.of(c.available, c.unit);
const byText = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');
/** Ohne MHD ans Ende (FEFO), sonst früheres Datum zuerst. */
const byBestBefore = (a: AllocationCandidate, b: AllocationCandidate) =>
  a.bestBefore === b.bestBefore ? 0 : a.bestBefore === null ? 1 : b.bestBefore === null ? -1 : a.bestBefore.localeCompare(b.bestBefore);
const tieBreak = (a: AllocationCandidate, b: AllocationCandidate) => byText(a.barcode, b.barcode) || byText(a.id, b.id);

const ORDER: Record<Exclude<AllocationStrategyId, 'full-unit'>, (a: AllocationCandidate, b: AllocationCandidate) => number> = {
  fifo: (a, b) => a.receivedAt.localeCompare(b.receivedAt) || byBestBefore(a, b) || tieBreak(a, b),
  fefo: (a, b) => byBestBefore(a, b) || a.receivedAt.localeCompare(b.receivedAt) || tieBreak(a, b),
  lifo: (a, b) => b.receivedAt.localeCompare(a.receivedAt) || tieBreak(a, b),
  'partial-first': (a, b) => qty(a).compareTo(qty(b)) || a.receivedAt.localeCompare(b.receivedAt) || tieBreak(a, b),
};

/**
 * „Ganze TU bevorzugen“: so viele Posten wie möglich vollständig nehmen
 * (größte, die noch in den Restbedarf passt, zuerst), den Rest vom kleinsten
 * Posten, der ihn deckt. So verlassen ganze TUs das Lager und es bleiben
 * wenige Anbrüche.
 */
function fullUnitOrder(eligible: AllocationCandidate[], demand: Quantity): AllocationCandidate[] {
  const pool = [...eligible];
  const order: AllocationCandidate[] = [];
  let rest = demand;
  while (pool.length > 0 && !rest.isZero() && !rest.isNegative()) {
    const fitting = pool
      .filter((c) => qty(c).compareTo(rest) <= 0)
      .sort((a, b) => qty(b).compareTo(qty(a)) || ORDER.fifo(a, b));
    const covering = pool.filter((c) => qty(c).compareTo(rest) >= 0).sort((a, b) => qty(a).compareTo(qty(b)) || ORDER.fifo(a, b));
    // Deckt ein Posten den Rest genau, ist das die beste Wahl; sonst ganze Posten vor Anbruch.
    const next = covering.find((c) => qty(c).equals(rest)) ?? fitting[0] ?? covering[0]!;
    order.push(next);
    pool.splice(pool.indexOf(next), 1);
    rest = rest.subtract(qty(next));
  }
  // Nicht benötigte Posten in FIFO-Reihenfolge anhängen (für die Begründung).
  return [...order, ...pool.sort(ORDER.fifo)];
}

/** Ordnet geeignete Kandidaten nach Strategie und plant die Entnahmen, bis der Bedarf gedeckt ist. */
export function rankAllocation(candidates: AllocationCandidate[], strategy: AllocationStrategyId, demand: Quantity): AllocationEvaluation {
  const eligible = candidates.filter((c) => c.violations.length === 0);
  const ordered = strategy === 'full-unit' ? fullUnitOrder(eligible, demand) : [...eligible].sort(ORDER[strategy]);
  const plan: PlannedPick[] = [];
  let rest = demand;
  for (const c of ordered) {
    if (rest.isZero() || rest.isNegative()) break;
    const available = qty(c);
    const take = available.compareTo(rest) <= 0 ? available : rest;
    plan.push({ key: c.id, barcode: c.barcode, locationId: c.locationId, quantity: take.amount });
    rest = rest.subtract(take);
  }
  const planned = new Map(plan.map((p, i) => [p.key, { p, i }]));
  const result = (c: AllocationCandidate, rank: number | null): CandidateResult => ({
    key: c.id,
    label: `${c.barcode} @ ${c.locationId}`,
    eligible: c.violations.length === 0,
    violations: c.violations,
    score: rank === null ? null : ordered.length - rank,
    details: {
      available: c.available,
      lot: c.lot,
      bestBefore: c.bestBefore,
      receivedAt: c.receivedAt,
      wholeUnit: c.wholeUnit,
      ...(rank === null ? {} : { rank: rank + 1 }),
      ...(planned.has(c.id) ? { take: planned.get(c.id)!.p.quantity } : {}),
    },
  });
  const allocated = demand.subtract(rest.isNegative() ? Quantity.zero(demand.unit) : rest);
  const evaluation: AllocationEvaluation = {
    chosen: plan.length ? result(ordered[0]!, 0) : null,
    candidates: [...ordered.map((c, i) => result(c, i)), ...candidates.filter((c) => c.violations.length > 0).map((c) => result(c, null))],
    plan,
    allocated: allocated.amount,
    shortfall: (rest.isNegative() ? Quantity.zero(demand.unit) : rest).amount,
  };
  if (plan.length === 0) {
    evaluation.note = candidates.length === 0 ? 'Kein Bestand des Produkts gefunden' : 'Kein Bestandsposten erfüllt alle harten Regeln';
  } else if (!rest.isZero()) {
    evaluation.note = `Bedarf nur teilweise gedeckt, es fehlen ${rest.amount} ${demand.unit}`;
  }
  return evaluation;
}

/** Harte Regel Mindestrestlaufzeit: MHD muss mindestens `days` Tage nach `today` liegen (Posten ohne MHD gelten als unbegrenzt haltbar). */
export function shelfLifeViolation(bestBefore: string | null, today: string, days: number): { rule: string; message: string } | null {
  if (bestBefore === null || days <= 0) return null;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const min = limit.toISOString().slice(0, 10);
  return bestBefore < min ? { rule: 'REMAINING_SHELF_LIFE', message: `MHD ${bestBefore} liegt vor ${min} (Mindestrestlaufzeit ${days} Tage)` } : null;
}
