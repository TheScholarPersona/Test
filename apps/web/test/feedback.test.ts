import { describe, expect, it } from 'vitest';
import { latest } from '../src/components/Feedback';

describe('Rückmeldungen mehrerer Aktionen', () => {
  it('zeigt die zuletzt entstandene, unabhängig von der Reihenfolge der Aktionen', () => {
    const erste = { kind: 'success' as const, text: 'Bewegung abgeschlossen', at: 100 };
    const zweite = { kind: 'success' as const, text: 'Wartende Aufträge geprüft', at: 200 };
    expect(latest(erste, null, zweite)).toBe(zweite);
    expect(latest(zweite, erste)).toBe(zweite);
  });

  it('liefert nichts, wenn keine Aktion gemeldet hat', () => {
    expect(latest(null, null)).toBeNull();
  });
});
