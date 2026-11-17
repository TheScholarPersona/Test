import { describe, expect, it } from 'vitest';
import {
  type Condition,
  ConditionSchema,
  evaluateCondition,
  type FieldCatalog,
  validateCondition,
} from '../../../src/modules/strategy/domain/conditions.js';

const catalog: FieldCatalog = {
  'unit.typeCode': { type: 'string', description: '' },
  'unit.weightKg': { type: 'decimal', description: '' },
  'unit.stackSize': { type: 'number', description: '' },
  'unit.blocked': { type: 'boolean', description: '' },
  'request.group': { type: 'string', description: '' },
};

const facts = { 'unit.typeCode': 'EURO', 'unit.weightKg': '0.3', 'unit.stackSize': 2, 'unit.blocked': false, 'request.group': null };

const parse = (c: unknown) => ConditionSchema.parse(c);
const holds = (c: unknown) => evaluateCondition(parse(c), facts, catalog);

describe('Bedingungen auswerten', () => {
  it.each([
    [{ always: true }, true],
    [{ field: 'unit.typeCode', op: 'eq', value: 'EURO' }, true],
    [{ field: 'unit.typeCode', op: 'neq', value: 'EURO' }, false],
    [{ field: 'unit.typeCode', op: 'in', value: ['BOX', 'EURO'] }, true],
    [{ field: 'unit.typeCode', op: 'notIn', value: ['BOX'] }, true],
    [{ field: 'unit.stackSize', op: 'gte', value: 2 }, true],
    [{ field: 'unit.stackSize', op: 'gt', value: 2 }, false],
    [{ field: 'unit.blocked', op: 'eq', value: false }, true],
    [{ field: 'request.group', op: 'exists' }, false],
    [{ not: { field: 'request.group', op: 'exists' } }, true],
  ])('%j → %s', (condition, expected) => {
    expect(holds(condition)).toBe(expected);
  });

  it('vergleicht Dezimalfelder exakt statt mit Gleitkomma', () => {
    // 0.1 + 0.2 als Gleitkomma wäre 0.30000000000000004 > 0.3
    expect(holds({ field: 'unit.weightKg', op: 'lte', value: '0.3' })).toBe(true);
    expect(holds({ field: 'unit.weightKg', op: 'eq', value: '0.30' })).toBe(true);
    expect(holds({ field: 'unit.weightKg', op: 'gt', value: 0.29 })).toBe(true);
  });

  it('kombiniert mit all und any', () => {
    expect(
      holds({
        all: [
          { field: 'unit.typeCode', op: 'eq', value: 'EURO' },
          { any: [{ field: 'unit.stackSize', op: 'gt', value: 5 }, { field: 'unit.blocked', op: 'eq', value: false }] },
        ],
      }),
    ).toBe(true);
  });

  it('behandelt fehlende Fakten als nicht erfüllt, außer bei neq und notIn', () => {
    expect(holds({ field: 'request.group', op: 'eq', value: 'X' })).toBe(false);
    expect(holds({ field: 'request.group', op: 'neq', value: 'X' })).toBe(true);
    expect(holds({ field: 'request.group', op: 'notIn', value: ['X'] })).toBe(true);
  });
});

describe('Bedingungen prüfen', () => {
  const errors = (c: unknown) => validateCondition(parse(c) as Condition, catalog);

  it('akzeptiert gültige Bedingungen', () => {
    expect(errors({ all: [{ field: 'unit.weightKg', op: 'gt', value: '100.5' }, { always: true }] })).toEqual([]);
  });

  it.each([
    [{ field: 'unit.farbe', op: 'eq', value: 'rot' }, 'unbekanntes Feld [unit.farbe]'],
    [{ field: 'unit.typeCode', op: 'gt', value: 'A' }, 'nicht zulässig'],
    [{ field: 'unit.typeCode', op: 'in', value: 'EURO' }, 'erwartet eine Liste'],
    [{ field: 'unit.typeCode', op: 'eq', value: ['EURO'] }, 'erwartet einen Einzelwert'],
    [{ field: 'unit.stackSize', op: 'eq', value: '2' }, 'passt nicht zum Typ number'],
    [{ field: 'unit.weightKg', op: 'gt', value: '1,5' }, 'passt nicht zum Typ decimal'],
    [{ field: 'unit.typeCode', op: 'eq' }, 'braucht einen Wert'],
    [{ field: 'request.group', op: 'exists', value: true }, 'erwartet keinen Wert'],
  ])('meldet Fehler in %j', (condition, message) => {
    expect(errors(condition).join()).toContain(message);
  });

  it('nennt den Pfad verschachtelter Fehler', () => {
    expect(errors({ any: [{ always: true }, { not: { field: 'x', op: 'exists' } }] })).toEqual([
      expect.stringContaining('when.any[1].not: unbekanntes Feld [x]'),
    ]);
  });

  it('lehnt unbekannte Schlüssel und Code-artige Inhalte schon im Schema ab', () => {
    expect(ConditionSchema.safeParse({ field: 'unit.typeCode', op: 'eq', value: 'EURO', script: 'x()' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ field: 'unit.typeCode', op: 'matches', value: '.*' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ always: false }).success).toBe(false);
  });
});
