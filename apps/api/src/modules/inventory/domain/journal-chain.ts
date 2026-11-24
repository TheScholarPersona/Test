/**
 * Hash-Kette und Merkle Tree über dem Buchungsjournal.
 *
 * Kette: `hash_n = SHA-256(hash_{n-1} ‖ kanonisch(Buchung n))`, Start mit 64 Nullen. Die Datenbank verkettet beim
 * Commit (Migration `journal_chain`); dieser Code rechnet unabhängig davon nach. Beide müssen dasselbe kanonische
 * Format verwenden (Version v1): Felder mit Längenpräfix `<Zeichen>:<Wert>`, `-` für leer, getrennt durch `|`.
 *
 * Merkle Tree je Tag (UTC) über die Hashes der Buchungen in `seq`-Reihenfolge, aufgebaut wie RFC 6962
 * (Certificate Transparency): Blatt = SHA-256(0x00 ‖ Hash), Knoten = SHA-256(0x01 ‖ links ‖ rechts), geteilt an der
 * größten Zweierpotenz kleiner n. Damit lässt sich eine einzelne Buchung mit wenigen Hashes gegen die Wurzel belegen.
 */
import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);
export const CHAIN_FORMAT = 'v1';

/** Felder einer Buchung, wie sie in die Kette eingehen (Datenbankdarstellung als Text). */
export interface ChainFields {
  seq: string;
  id: string;
  type: string;
  sku: string;
  barcode: string;
  /** `numeric(15,3)` als Text, z. B. `-4.000`. */
  quantity: string;
  unitCode: string;
  lot: string | null;
  /** `YYYY-MM-DD` oder `null`. */
  bestBefore: string | null;
  reference: string;
  /** UTC mit Mikrosekunden, z. B. `2026-11-21T08:15:00.123000Z`. */
  createdAt: string;
}

export const field = (value: string | null): string => (value === null ? '-' : `${[...value].length}:${value}`);

export function canonical(b: ChainFields): string {
  return [CHAIN_FORMAT, b.seq, b.id, b.type, b.sku, b.barcode, b.quantity, b.unitCode, b.lot, b.bestBefore, b.reference, b.createdAt]
    .map((v, i) => (i === 0 ? v : field(v)))
    .join('|');
}

export function chainHash(prevHash: string, b: ChainFields): string {
  return createHash('sha256').update(prevHash + canonical(b), 'utf8').digest('hex');
}

/** Eintrag im Änderungsprotokoll (Transporteinheiten, Bestandsposten), Format wie `wms_change_canonical`. */
export interface ChangeFields {
  seq: string;
  tableName: string;
  rowId: string;
  op: string;
  /** Herkunft (`api`, `migration`); `null` = an der Anwendung vorbei. */
  source: string | null;
  rowHash: string | null;
  at: string;
}

export function changeHash(prevHash: string, c: ChangeFields): string {
  const text = [CHAIN_FORMAT, ...[c.seq, c.tableName, c.rowId, c.op, c.source, c.rowHash, c.at].map(field)].join('|');
  return createHash('sha256').update(prevHash + text, 'utf8').digest('hex');
}

// --- Merkle Tree (RFC 6962) -----------------------------------------------------------

const sha = (...parts: Buffer[]): Buffer => createHash('sha256').update(Buffer.concat(parts)).digest();
const LEAF = Buffer.from([0]);
const NODE = Buffer.from([1]);
const leafHash = (hex: string): Buffer => sha(LEAF, Buffer.from(hex, 'hex'));
const nodeHash = (left: Buffer, right: Buffer): Buffer => sha(NODE, left, right);
/** Größte Zweierpotenz kleiner n (n ≥ 2). */
const split = (n: number): number => 2 ** Math.floor(Math.log2(n - 1));

function root(leaves: string[], from: number, to: number): Buffer {
  const n = to - from;
  if (n === 1) return leafHash(leaves[from]!);
  const k = split(n);
  return nodeHash(root(leaves, from, from + k), root(leaves, from + k, to));
}

/** Wurzel über die Buchungs-Hashes (hex); leere Menge → SHA-256 des Leerstrings. */
export function merkleRoot(hashes: string[]): string {
  return (hashes.length ? root(hashes, 0, hashes.length) : sha()).toString('hex');
}

/** Pfad vom Blatt `index` zur Wurzel (Geschwister-Hashes von unten nach oben). */
export function merkleProof(hashes: string[], index: number): string[] {
  if (index < 0 || index >= hashes.length) throw new RangeError(`Blatt ${index} gibt es nicht`);
  const path: string[] = [];
  const walk = (from: number, to: number, i: number): void => {
    const n = to - from;
    if (n === 1) return;
    const k = split(n);
    if (i < k) {
      walk(from, from + k, i);
      path.push(root(hashes, from + k, to).toString('hex'));
    } else {
      walk(from + k, to, i - k);
      path.push(root(hashes, from, from + k).toString('hex'));
    }
  };
  walk(0, hashes.length, index);
  return path;
}

/** Prüft einen Beweis ohne die übrigen Buchungen (RFC 9162, Abschnitt 2.1.3.2). */
export function verifyMerkleProof(hash: string, index: number, size: number, proof: string[], expectedRoot: string): boolean {
  if (index < 0 || index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leafHash(hash);
  for (const p of proof) {
    const sibling = Buffer.from(p, 'hex');
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(sibling, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, sibling);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && r.toString('hex') === expectedRoot;
}
