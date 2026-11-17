import { describe, expect, it } from 'vitest';
import {
  ChangeGroupLocksSchema,
  CreateLocationSchema,
  LocationQuerySchema,
  UpdateLocationSchema,
} from '../../../src/modules/layout/http/schemas.js';

const valid = { locationId: 'HL01/0001/0001/0001/0000', typeCode: 'PALETTE', groupName: 'GASSE-1' };

describe('CreateLocationSchema', () => {
  it('ergänzt Standardwerte', () => {
    expect(CreateLocationSchema.parse(valid)).toEqual({
      ...valid,
      erpCode: null,
      plcCode: null,
      description: '',
      sortOrder: 0,
      maxTransportUnits: 1,
      maxWeight: null,
    });
  });

  it('lehnt unbekannte Felder ab, statt sie still zu ignorieren', () => {
    expect(CreateLocationSchema.safeParse({ ...valid, maxTransportUnit: 2 }).success).toBe(false);
  });

  it.each([
    [{ amount: '1250.5', unit: 'KG' }, true],
    [{ amount: '0', unit: 'KG' }, true],
    [{ amount: '-1', unit: 'KG' }, false],
    [{ amount: '1.2345', unit: 'KG' }, false],
    [{ amount: '1234567890', unit: 'KG' }, false],
    [{ amount: '10', unit: 'T' }, false],
  ])('Höchstgewicht %j gültig: %s', (maxWeight, ok) => {
    expect(CreateLocationSchema.safeParse({ ...valid, maxWeight }).success).toBe(ok);
  });

  it('verlangt eine gültige Koordinate', () => {
    expect(CreateLocationSchema.safeParse({ ...valid, locationId: 'HL01/0001' }).success).toBe(false);
  });
});

describe('weitere Schemas', () => {
  it('Sperränderung braucht mindestens eine Richtung', () => {
    expect(ChangeGroupLocksSchema.safeParse({ reason: 'Wartung' }).success).toBe(false);
    expect(ChangeGroupLocksSchema.safeParse({ inbound: true, reason: 'Wartung' }).success).toBe(true);
  });

  it('Änderung eines Lagerplatzes erlaubt Koordinate nur zur Klarstellung', () => {
    expect(UpdateLocationSchema.parse({ locationId: valid.locationId, description: 'x' })).toEqual({
      locationId: valid.locationId,
      description: 'x',
    });
  });

  it('Suche liest Wahrheitswerte und Zahlen aus der Query', () => {
    expect(LocationQuerySchema.parse({ group: 'GASSE-1', includeSubgroups: 'true', limit: '10' })).toMatchObject({
      group: 'GASSE-1',
      includeSubgroups: true,
      limit: 10,
      offset: 0,
    });
  });
});
