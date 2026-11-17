import { describe, expect, it } from 'vitest';
import { barcode, erpCode, locationId } from '../src/identifiers.js';

describe('Kennungen', () => {
  it('akzeptiert gültige Barcodes und entfernt Leerraum', () => {
    expect(barcode(' TU-0001 ')).toBe('TU-0001');
  });

  it.each(['', 'TU 0001', 'TU#1', 'x'.repeat(65)])('lehnt ungültigen Barcode %j ab', (value) => {
    expect(() => barcode(value)).toThrow();
  });

  it('akzeptiert Lagerplatz-Koordinaten mit fünf Teilen', () => {
    expect(locationId('HL01/0001/0003/0002/0000')).toBe('HL01/0001/0003/0002/0000');
  });

  it.each(['HL01/0001/0003/0002', 'hl01/0001/0003/0002/0000', 'HL01//0003/0002/0000'])(
    'lehnt ungültige Lagerplatz-Kennung %j ab',
    (value) => {
      expect(() => locationId(value)).toThrow();
    },
  );

  it('akzeptiert ERP-Codes', () => {
    expect(erpCode('EP-001')).toBe('EP-001');
    expect(() => erpCode('')).toThrow();
  });
});
