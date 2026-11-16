import { describe, expect, it } from 'vitest';
import { type PutawayCandidate, rankFirstFree, rankWeighted } from '../../../src/modules/strategy/putaway/putaway-ranking.js';

const candidate = (locationId: string, overrides: Partial<PutawayCandidate> = {}): PutawayCandidate => ({
  id: `id-${locationId}`,
  locationId,
  sortOrder: 0,
  typeCode: 'REGAL',
  maxTransportUnits: 2,
  occupiedSlots: 0,
  privilegeLevel: 0,
  violations: [],
  ...overrides,
});
const full = { violations: [{ rule: 'LOCATION_FULL', message: 'voll' }] };

describe('first-free', () => {
  it('wählt den ersten geeigneten Platz in Sortierreihenfolge', () => {
    const result = rankFirstFree([candidate('A', full), candidate('B'), candidate('C')]);
    expect(result.chosen?.label).toBe('B');
    expect(result.candidates.map((c) => [c.label, c.eligible])).toEqual([
      ['B', true],
      ['C', true],
      ['A', false],
    ]);
    expect(result.candidates[2]!.violations[0]!.rule).toBe('LOCATION_FULL');
  });

  it('erklärt, warum nichts gewählt wurde', () => {
    expect(rankFirstFree([])).toMatchObject({ chosen: null, note: 'Die Suchgruppe enthält keine Lagerplätze' });
    expect(rankFirstFree([candidate('A', full)])).toMatchObject({ chosen: null, note: 'Kein Lagerplatz erfüllt alle harten Regeln' });
  });
});

describe('weighted', () => {
  const places = [
    candidate('A', { occupiedSlots: 1 }), // früh, halb voll
    candidate('B', { occupiedSlots: 0 }), // leer
    candidate('C', { occupiedSlots: 0, privilegeLevel: 10 }), // leer und bevorzugter Platztyp
  ];

  it('nur Sortierung: wie first-free', () => {
    expect(rankWeighted(places, { sortOrder: 1, emptiness: 0, privilege: 0 }).chosen?.label).toBe('A');
  });

  it('Füllgrad: bevorzugt leere Plätze, bei Gleichstand der frühere', () => {
    expect(rankWeighted(places, { sortOrder: 0, emptiness: 1, privilege: 0 }).chosen?.label).toBe('B');
  });

  it('Vorrang: bevorzugt den Platztyp mit höherem privilegeLevel', () => {
    const result = rankWeighted(places, { sortOrder: 1, emptiness: 1, privilege: 3 });
    expect(result.chosen?.label).toBe('C');
    expect(result.chosen?.details?.['components']).toEqual({ sortOrder: 0, emptiness: 1, privilege: 1 });
  });

  it('bewertet nur geeignete Plätze', () => {
    const result = rankWeighted([candidate('A', full), candidate('B')], { sortOrder: 1, emptiness: 1, privilege: 1 });
    expect(result.chosen?.label).toBe('B');
    expect(result.candidates.find((c) => c.label === 'A')?.score).toBeNull();
  });
});
