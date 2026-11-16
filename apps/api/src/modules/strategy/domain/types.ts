import type { z } from 'zod';
import type { Facts, FieldCatalog } from './conditions.js';

/** Bewerteter Kandidat (z. B. ein Lagerplatz) einer Entscheidung. */
export interface CandidateResult {
  key: string;
  label: string;
  /** Erfüllt alle harten Regeln. */
  eligible: boolean;
  /** Verletzte harte Regeln (nur bei nicht geeigneten Kandidaten). */
  violations: { rule: string; message: string }[];
  /** Punktzahl der Strategie; höher = besser. `null` bei nicht geeigneten Kandidaten. */
  score: number | null;
  details?: Record<string, unknown>;
}

export interface Evaluation {
  chosen: CandidateResult | null;
  /** Alle geprüften Kandidaten, geeignete nach Punktzahl absteigend vorn. */
  candidates: CandidateResult[];
  /** Erklärung, falls kein Kandidat gewählt wurde. */
  note?: string;
}

/**
 * Eine Strategie für einen Entscheidungspunkt. Sie bewertet nur Kandidaten,
 * die die harten Regeln erfüllen; die harten Regeln selbst prüft der
 * Entscheidungspunkt, nicht die Strategie.
 */
export interface StrategyDefinition<Ctx, P = Record<string, unknown>> {
  id: string;
  description: string;
  paramsSchema: z.ZodType<P>;
  decide(ctx: Ctx, params: P): Promise<Evaluation>;
}

export interface DecisionPointDefinition<Ctx> {
  id: string;
  description: string;
  /** Felder, die Bedingungen in Regelsätzen verwenden dürfen. */
  fields: FieldCatalog;
  strategies: StrategyDefinition<Ctx, any>[];
}

/** Ergebnis der Kontextermittlung: Fakten für Bedingungen plus Daten für Strategien. */
export interface DecisionContext<Ctx> {
  subject: string;
  facts: Facts;
  data: Ctx;
}
