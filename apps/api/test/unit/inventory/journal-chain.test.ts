import { describe, expect, it } from 'vitest';
import { type ChainFields, canonical, chainHash, GENESIS_HASH, merkleProof, merkleRoot, verifyMerkleProof } from '../../../src/modules/inventory/domain/journal-chain.js';

const booking = (seq: number, quantity = '-4.000'): ChainFields => ({
  seq: String(seq),
  id: `00000000-0000-0000-0000-00000000000${seq}`,
  type: 'ISSUE',
  sku: 'MILCH',
  barcode: 'P-1',
  quantity,
  unitCode: 'PCS',
  lot: null,
  bestBefore: '2026-12-01',
  reference: 'outbound:A-1/1',
  createdAt: '2026-11-21T08:15:00.123000Z',
});

describe('Hash-Kette', () => {
  it('schreibt Felder mit Längenpräfix, damit Verschiebungen zwischen Feldern auffallen', () => {
    expect(canonical(booking(1))).toBe('v1|1:1|36:00000000-0000-0000-0000-000000000001|5:ISSUE|5:MILCH|3:P-1|6:-4.000|3:PCS|-|10:2026-12-01|14:outbound:A-1/1|27:2026-11-21T08:15:00.123000Z');
    expect(canonical({ ...booking(1), sku: 'MILCH|3', barcode: '' })).not.toBe(canonical({ ...booking(1), sku: 'MILCH', barcode: '3|' }));
  });

  it('ändert jeden folgenden Hash, wenn eine Buchung geändert wird', () => {
    const h1 = chainHash(GENESIS_HASH, booking(1));
    const h2 = chainHash(h1, booking(2));
    const forged = chainHash(GENESIS_HASH, booking(1, '-40.000'));
    expect(forged).not.toBe(h1);
    expect(chainHash(forged, booking(2))).not.toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Merkle Tree (RFC 6962)', () => {
  const hashes = Array.from({ length: 7 }, (_, i) => chainHash(GENESIS_HASH, booking(i + 1)));

  it('belegt jede Buchung mit wenigen Hashes gegen die Wurzel', () => {
    for (const size of [1, 2, 3, 5, 7]) {
      const leaves = hashes.slice(0, size);
      const r = merkleRoot(leaves);
      leaves.forEach((h, i) => {
        const proof = merkleProof(leaves, i);
        expect(proof.length).toBeLessThanOrEqual(Math.ceil(Math.log2(size)));
        expect(verifyMerkleProof(h, i, size, proof, r)).toBe(true);
      });
    }
  });

  it('lehnt geänderte Buchungen, falsche Position und falsche Wurzel ab', () => {
    const r = merkleRoot(hashes);
    const proof = merkleProof(hashes, 3);
    expect(verifyMerkleProof(hashes[4]!, 3, 7, proof, r)).toBe(false);
    expect(verifyMerkleProof(hashes[3]!, 2, 7, proof, r)).toBe(false);
    expect(verifyMerkleProof(hashes[3]!, 3, 7, proof, merkleRoot(hashes.slice(0, 6)))).toBe(false);
    expect(merkleRoot([...hashes.slice(0, 3), hashes[4]!, hashes[3]!, ...hashes.slice(5)])).not.toBe(r);
  });
});
