import { describe, expect, it } from 'vitest';
import { checkPlacement, KG, type PlacementInput } from '../../../src/modules/transport/domain/placement.js';
import { checkStacking, type StackingInput } from '../../../src/modules/transport/domain/stacking.js';

const base = (): PlacementInput => ({
  unit: { typeCode: 'EURO', allowedLocationTypes: [], stackWeight: KG('500') },
  source: { locationId: 'A/1/1/1/0', outboundBlocked: false, outboundBlockedBy: null },
  target: {
    locationId: 'B/1/1/1/0',
    typeCode: 'REGAL',
    inboundBlocked: false,
    inboundBlockedBy: null,
    maxTransportUnits: 1,
    maxWeight: KG('1000'),
    occupiedSlots: 0,
    currentWeight: KG('0'),
  },
});

const rules = (input: PlacementInput) => checkPlacement(input).map((v) => v.rule);

describe('checkPlacement', () => {
  it('erlaubt eine regelkonforme Platzierung', () => {
    expect(checkPlacement(base())).toEqual([]);
  });

  it('meldet Sperren an Quelle und Ziel mit dem Verursacher', () => {
    const input = base();
    input.source = { ...input.source!, outboundBlocked: true, outboundBlockedBy: 'GASSE-1' };
    input.target.inboundBlocked = true;
    input.target.inboundBlockedBy = 'HOCHREGAL';
    const violations = checkPlacement(input);
    expect(violations.map((v) => v.rule)).toEqual(['SOURCE_OUTBOUND_BLOCKED', 'TARGET_INBOUND_BLOCKED']);
    expect(violations[1]!.message).toContain('HOCHREGAL');
  });

  it('prüft beim Anlegen keine Quelle', () => {
    expect(rules({ ...base(), source: null })).toEqual([]);
  });

  it.each([
    [0, 1, []],
    [1, 1, ['LOCATION_FULL']],
    [1, 2, []],
    [2, 2, ['LOCATION_FULL']],
    [0, 0, ['LOCATION_FULL']],
  ] as const)('belegte Plätze %i bei Höchstzahl %i → %j', (occupied, max, expected) => {
    const input = base();
    input.target.occupiedSlots = occupied;
    input.target.maxTransportUnits = max;
    expect(rules(input)).toEqual(expected);
  });

  it('rechnet das Gewicht exakt dezimal und erlaubt genau das Höchstgewicht', () => {
    const input = base();
    input.target.currentWeight = KG('499.9');
    input.unit.stackWeight = KG('500.1');
    expect(rules(input)).toEqual([]);
    input.unit.stackWeight = KG('500.101');
    expect(checkPlacement(input)[0]).toMatchObject({ rule: 'WEIGHT_EXCEEDED', message: expect.stringContaining('1000.001') });
  });

  it('kennt Plätze ohne Gewichtsgrenze', () => {
    const input = base();
    input.target.maxWeight = null;
    input.unit.stackWeight = KG('99999');
    expect(rules(input)).toEqual([]);
  });

  it('wendet Platzierungsregeln nur an, wenn welche hinterlegt sind', () => {
    const input = base();
    input.unit.allowedLocationTypes = ['BODEN'];
    expect(rules(input)).toEqual(['PLACEMENT_NOT_ALLOWED']);
    input.unit.allowedLocationTypes = ['BODEN', 'REGAL'];
    expect(rules(input)).toEqual([]);
  });

  it('meldet alle Verstöße auf einmal', () => {
    const input = base();
    input.target.inboundBlocked = true;
    input.target.occupiedSlots = 1;
    input.target.currentWeight = KG('900');
    input.unit.allowedLocationTypes = ['BODEN'];
    expect(rules(input)).toEqual(['TARGET_INBOUND_BLOCKED', 'LOCATION_FULL', 'WEIGHT_EXCEEDED', 'PLACEMENT_NOT_ALLOWED']);
  });
});

const stacking = (): StackingInput => ({
  child: { barcode: 'C', typeCode: 'BOX', locationId: 'A', parentBarcode: null },
  parent: { barcode: 'P', typeCode: 'EURO', locationId: 'A', childCount: 0 },
  parentAncestors: [],
  rule: { maxCount: 2 },
});

describe('checkStacking', () => {
  it('erlaubt Stapeln mit passender Regel', () => {
    expect(checkStacking(stacking())).toEqual([]);
  });

  it('verbietet Stapeln ohne Regel und über die Höchstzahl', () => {
    expect(checkStacking({ ...stacking(), rule: null }).map((v) => v.rule)).toEqual(['STACKING_NOT_ALLOWED']);
    const full = stacking();
    full.parent.childCount = 2;
    expect(checkStacking(full).map((v) => v.rule)).toEqual(['STACK_FULL']);
  });

  it('verhindert Stapeln auf sich selbst und Zyklen', () => {
    const self = stacking();
    self.parent.barcode = 'C';
    expect(checkStacking(self).map((v) => v.rule)).toEqual(['STACK_ONTO_SELF']);
    expect(checkStacking({ ...stacking(), parentAncestors: ['X', 'C'] }).map((v) => v.rule)).toEqual(['STACK_CYCLE']);
  });

  it('verlangt denselben Platz und eine noch nicht gestapelte TU', () => {
    const input = stacking();
    input.child.locationId = 'B';
    input.child.parentBarcode = 'Q';
    expect(checkStacking(input).map((v) => v.rule)).toEqual(['ALREADY_STACKED', 'STACK_DIFFERENT_LOCATION']);
  });
});
