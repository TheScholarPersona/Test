import { compareDecimal, isDecimalString } from '@wms/shared';
import { z } from 'zod';

/**
 * Typisierte Bedingungen für Regelsätze.
 *
 * Bewusst kein frei ausführbarer Code: Bedingungen sind Daten, werden beim
 * Speichern gegen die Felder des Entscheidungspunkts geprüft und lassen sich
 * gefahrlos von Bedienern oder aus Node-RED pflegen.
 *
 *   { "always": true }
 *   { "field": "unit.typeCode", "op": "in", "value": ["EURO", "INDUSTRIE"] }
 *   { "all": [ … ] } · { "any": [ … ] } · { "not": … }
 */

export type FieldType = 'string' | 'number' | 'decimal' | 'boolean';

/** Bekannte Felder eines Entscheidungspunkts mit Typ und Beschreibung. */
export type FieldCatalog = Record<string, { type: FieldType; description: string }>;

export type Facts = Record<string, string | number | boolean | null>;

const COMPARISON_OPS = ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export interface Comparison {
  field: string;
  op: ComparisonOp;
  value?: string | number | boolean | (string | number | boolean)[] | undefined;
}

export type Condition =
  | { always: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Comparison;

// Rekursives Schema: Die feste ID macht daraus in OpenAPI eine selbstbezügliche Komponente ($ref).
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ always: z.literal(true) }),
    z.strictObject({ all: z.array(ConditionSchema).min(1).max(50) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1).max(50) }),
    z.strictObject({ not: ConditionSchema }),
    z.strictObject({
      field: z.string().min(1).max(100),
      op: z.enum(COMPARISON_OPS),
      value: z.union([Scalar, z.array(Scalar).min(1).max(200)]).optional(),
    }),
  ]),
).meta({ id: 'StrategyCondition', description: 'always | all | any | not | Vergleich { field, op, value }' });

const ORDERED: readonly ComparisonOp[] = ['gt', 'gte', 'lt', 'lte'];

/**
 * Prüft eine Bedingung gegen den Feldkatalog. Liefert verständliche
 * Fehlermeldungen mit Pfad, leer = gültig.
 */
export function validateCondition(condition: Condition, catalog: FieldCatalog, path = 'when'): string[] {
  if ('always' in condition) return [];
  if ('all' in condition) return condition.all.flatMap((c, i) => validateCondition(c, catalog, `${path}.all[${i}]`));
  if ('any' in condition) return condition.any.flatMap((c, i) => validateCondition(c, catalog, `${path}.any[${i}]`));
  if ('not' in condition) return validateCondition(condition.not, catalog, `${path}.not`);

  const field = catalog[condition.field];
  if (!field) {
    return [`${path}: unbekanntes Feld [${condition.field}], erlaubt: ${Object.keys(catalog).join(', ')}`];
  }
  const { op, value } = condition;
  if (op === 'exists') {
    return value === undefined ? [] : [`${path}: Operator exists erwartet keinen Wert`];
  }
  if (value === undefined) {
    return [`${path}: Operator ${op} braucht einen Wert`];
  }
  const isList = Array.isArray(value);
  if ((op === 'in' || op === 'notIn') !== isList) {
    return [`${path}: Operator ${op} ${isList ? 'erwartet einen Einzelwert' : 'erwartet eine Liste'}`];
  }
  if (ORDERED.includes(op) && (field.type === 'string' || field.type === 'boolean')) {
    return [`${path}: Operator ${op} ist für Feld [${condition.field}] vom Typ ${field.type} nicht zulässig`];
  }
  const values = isList ? value : [value];
  const wrong = values.filter((v) => !matchesType(v, field.type));
  return wrong.length > 0
    ? [`${path}: Wert ${JSON.stringify(wrong[0])} passt nicht zum Typ ${field.type} von Feld [${condition.field}]`]
    : [];
}

function matchesType(value: string | number | boolean, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'decimal':
      return isDecimalString(value) || (typeof value === 'number' && Number.isFinite(value));
  }
}

/** Wertet eine (zuvor validierte) Bedingung gegen Fakten aus. Fehlende Fakten sind `null`. */
export function evaluateCondition(condition: Condition, facts: Facts, catalog: FieldCatalog): boolean {
  if ('always' in condition) return true;
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, facts, catalog));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, facts, catalog));
  if ('not' in condition) return !evaluateCondition(condition.not, facts, catalog);

  const actual = facts[condition.field] ?? null;
  const type = catalog[condition.field]?.type ?? 'string';
  const { op, value } = condition;
  if (op === 'exists') return actual !== null;
  if (actual === null) return op === 'neq' || op === 'notIn';

  const equal = (expected: string | number | boolean) => compare(actual, expected, type) === 0;
  switch (op) {
    case 'eq':
      return equal(value as string | number | boolean);
    case 'neq':
      return !equal(value as string | number | boolean);
    case 'in':
      return (value as (string | number | boolean)[]).some(equal);
    case 'notIn':
      return !(value as (string | number | boolean)[]).some(equal);
    case 'gt':
      return compare(actual, value as number | string, type) > 0;
    case 'gte':
      return compare(actual, value as number | string, type) >= 0;
    case 'lt':
      return compare(actual, value as number | string, type) < 0;
    case 'lte':
      return compare(actual, value as number | string, type) <= 0;
  }
}

/** Dezimalfelder exakt vergleichen (kein Gleitkomma), sonst direkter Vergleich. */
function compare(actual: string | number | boolean, expected: string | number | boolean, type: FieldType): number {
  if (type === 'decimal') {
    return compareDecimal(String(actual), String(expected));
  }
  if (actual === expected) return 0;
  return actual < expected ? -1 : 1;
}
