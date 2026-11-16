import { describe, expect, it } from 'vitest';
import { actionRank, bestAction, bestRoute, candidates, type PlaceKey } from '../../../src/modules/flow/domain/matching.js';

const loc = (id: string): PlaceKey => ({ kind: 'location', id });
const grp = (name: string): PlaceKey => ({ kind: 'group', name });

// Quelle: Platz WE1 in Gruppe WE › LAGER; Ziel: Platz H1 in Gruppe HRL-G1 › HRL › LAGER.
const sources = candidates('WE1', ['WE', 'LAGER']);
const targets = candidates('H1', ['HRL-G1', 'HRL', 'LAGER']);

describe('Kandidaten', () => {
  it('ordnet Platz vor Gruppe vor Elterngruppen', () => {
    expect(sources).toEqual([loc('WE1'), grp('WE'), grp('LAGER')]);
    expect(candidates(null, ['HRL', 'LAGER'])).toEqual([grp('HRL'), grp('LAGER')]);
  });
});

describe('Routensuche (Reihenfolge wie OpenWMS)', () => {
  const r = (routeId: string, source: PlaceKey, target: PlaceKey) => ({ routeId, source, target });
  const all = [
    r('G-G', grp('WE'), grp('HRL')),
    r('P-G', loc('WE1'), grp('HRL')),
    r('P-P', loc('WE1'), loc('H1')),
    r('G-P', grp('WE'), loc('H1')),
    r('ROOT', grp('LAGER'), grp('LAGER')),
  ];

  it.each([
    [['P-P', 'P-G', 'G-P', 'G-G', 'ROOT'], 'P-P'],
    [['P-G', 'G-P', 'G-G', 'ROOT'], 'P-G'],
    [['G-P', 'G-G', 'ROOT'], 'G-P'],
    [['G-G', 'ROOT'], 'G-G'],
    [['ROOT'], 'ROOT'],
  ])('wählt aus %j die spezifischste Route %s', (ids, expected) => {
    expect(bestRoute(all.filter((x) => ids.includes(x.routeId)), sources, targets)?.route.routeId).toBe(expected);
  });

  it('meldet keine Route, wenn Quelle oder Ziel nicht passen', () => {
    expect(bestRoute([r('X', grp('WA'), grp('HRL')), r('Y', grp('WE'), grp('VERSAND'))], sources, targets)).toBeNull();
  });

  it('liefert die Stufen für die Begründung und entscheidet Gleichstände eindeutig', () => {
    const match = bestRoute([r('B', grp('WE'), grp('HRL')), r('A', grp('WE'), grp('HRL'))], sources, targets);
    expect(match).toMatchObject({ route: { routeId: 'A' }, sourceRank: 1, targetRank: 2 });
  });
});

describe('Action-Matrix', () => {
  const places = candidates('C1', ['FT', 'LAGER']);
  const a = (name: string, place: PlaceKey | null, routeId: string | null) => ({ name, place, routeId });

  it('Ort vor Route: Platz+Route, Platz, Gruppe+Route, Gruppe, Eltern …, überall+Route, überall', () => {
    const ranks = [
      a('p-r', loc('C1'), 'R1'),
      a('p', loc('C1'), null),
      a('g-r', grp('FT'), 'R1'),
      a('g', grp('FT'), null),
      a('e', grp('LAGER'), null),
      a('x-r', null, 'R1'),
      a('x', null, null),
    ].map((x) => actionRank(x, places, 'R1'));
    expect(ranks).toEqual([...ranks].sort((m, n) => m! - n!));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('ignoriert Actions anderer Routen und fremder Orte', () => {
    expect(actionRank(a('r2', loc('C1'), 'R2'), places, 'R1')).toBeNull();
    expect(actionRank(a('route', loc('C1'), 'R1'), places, null)).toBeNull();
    expect(actionRank(a('fremd', grp('VERSAND'), null), places, 'R1')).toBeNull();
  });

  it('wählt die beste Action, ohne Route nur routenunabhängige', () => {
    const actions = [a('allgemein', null, null), a('ft', grp('FT'), null), a('r1', grp('FT'), 'R1')];
    expect(bestAction(actions, places, 'R1')?.name).toBe('r1');
    expect(bestAction(actions, places, null)?.name).toBe('ft');
    expect(bestAction([a('allgemein', null, null)], candidates('X', ['ANDERS']), null)?.name).toBe('allgemein');
    expect(bestAction([], places, null)).toBeNull();
  });
});
