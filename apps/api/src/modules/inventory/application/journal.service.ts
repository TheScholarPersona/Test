import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/domain-error.js';
import { type ChainFields, chainHash, GENESIS_HASH, merkleProof, merkleRoot } from '../domain/journal-chain.js';

interface Row extends ChainFields {
  prevHash: string;
  hash: string;
}

const COLUMNS = `"seq"::text as "seq", "id"::text as "id", "type", "sku", "barcode", "quantity"::text as "quantity", "unit_code" as "unitCode",
  "lot", to_char("best_before", 'YYYY-MM-DD') as "bestBefore", "reference",
  to_char("created_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", "prev_hash" as "prevHash", "hash"`;
const BATCH = 5000;
const MAX_PROBLEMS = 100;

export type ChainProblemCode = 'CHAIN_GAP' | 'CHAIN_LINK_BROKEN' | 'CHAIN_HASH_MISMATCH' | 'HEAD_MISMATCH' | 'ANCHOR_MISMATCH' | 'DAY_ROOT_MISMATCH';
export interface ChainProblem {
  code: ChainProblemCode;
  seq: number | null;
  bookingId: string | null;
  message: string;
}
export interface Anchor {
  seq: number;
  hash: string;
}
export interface DayRoot {
  day: string;
  count: number;
  firstSeq: number | null;
  lastSeq: number | null;
  root: string;
}
export interface Verification {
  ok: boolean;
  checked: number;
  head: Anchor;
  /** Buchungen offener Transaktionen (noch nicht verkettet). */
  pending: number;
  problems: ChainProblem[];
  anchor: (Anchor & { ok: boolean }) | null;
  days: { day: string; expected: string; actual: string; ok: boolean }[];
}

/**
 * Buchungsjournal als Hash-Kette mit Merkle-Wurzel je Tag: Kopf und Tageswurzeln zum externen Verankern,
 * Nachweis einer einzelnen Buchung und vollständige Prüfung (rechnet jeden Hash unabhängig von der Datenbank nach).
 */
@Injectable()
export class JournalService {
  constructor(private readonly em: EntityManager) {}

  async head(): Promise<Anchor & { updatedAt: string }> {
    const [h] = await this.em.fork().execute<{ seq: string; hash: string; updatedAt: Date }[]>(`select "seq"::text as "seq", "hash", "updated_at" as "updatedAt" from "journal_head" where "id" = 1`);
    return { seq: Number(h!.seq), hash: h!.hash, updatedAt: new Date(h!.updatedAt).toISOString() };
  }

  async day(day: string): Promise<DayRoot> {
    const rows = await this.dayRows(day);
    return { day, count: rows.length, firstSeq: rows.length ? Number(rows[0]!.seq) : null, lastSeq: rows.length ? Number(rows.at(-1)!.seq) : null, root: merkleRoot(rows.map((r) => r.hash)) };
  }

  /** Merkle-Beweis einer Buchung gegen die Wurzel ihres Tages. */
  async proof(bookingId: string): Promise<{ bookingId: string; seq: number; hash: string; day: string; index: number; size: number; proof: string[]; root: string }> {
    const [row] = await this.em.fork().execute<Row[]>(`select ${COLUMNS} from "stock_booking" where "id"::text = ? and "seq" is not null`, [bookingId]);
    if (!row) throw new NotFoundError('BOOKING_NOT_FOUND', `Buchung ${bookingId} gibt es nicht oder sie ist noch nicht verkettet`, { bookingId });
    const day = row.createdAt.slice(0, 10);
    const hashes = (await this.dayRows(day)).map((r) => r.hash);
    const index = hashes.indexOf(row.hash);
    return { bookingId, seq: Number(row.seq), hash: row.hash, day, index, size: hashes.length, proof: merkleProof(hashes, index), root: merkleRoot(hashes) };
  }

  async verify(input: { anchor?: Anchor | undefined; days?: { day: string; root: string }[] | undefined } = {}): Promise<Verification> {
    const em = this.em.fork();
    const problems: ChainProblem[] = [];
    const add = (p: ChainProblem) => problems.length < MAX_PROBLEMS && problems.push(p);
    let prev = GENESIS_HASH;
    let expectedSeq = 1;
    let checked = 0;
    let anchorHash: string | null = null;
    for (let after = 0; ; ) {
      const rows = await em.execute<Row[]>(`select ${COLUMNS} from "stock_booking" where "seq" > ? order by "stock_booking"."seq" limit ${BATCH}`, [after]);
      for (const r of rows) {
        const seq = Number(r.seq);
        if (seq !== expectedSeq) add({ code: 'CHAIN_GAP', seq, bookingId: r.id, message: `Nummer ${expectedSeq}${seq > expectedSeq + 1 ? `–${seq - 1}` : ''} fehlt – Buchungen gelöscht?` });
        if (r.prevHash !== prev) add({ code: 'CHAIN_LINK_BROKEN', seq, bookingId: r.id, message: 'Vorgänger-Hash passt nicht – Buchung davor geändert, gelöscht oder eingefügt' });
        if (chainHash(r.prevHash, r) !== r.hash) add({ code: 'CHAIN_HASH_MISMATCH', seq, bookingId: r.id, message: 'Inhalt passt nicht zum Hash – Buchung nachträglich geändert' });
        if (input.anchor && seq === input.anchor.seq) anchorHash = r.hash;
        prev = r.hash;
        expectedSeq = seq + 1;
        checked++;
      }
      if (rows.length < BATCH) break;
      after = Number(rows.at(-1)!.seq);
    }
    const head = await this.head();
    if (head.seq !== checked || head.hash !== prev) {
      add({ code: 'HEAD_MISMATCH', seq: head.seq, bookingId: null, message: `Kopf (Nr. ${head.seq}) passt nicht zur letzten Buchung (Nr. ${expectedSeq - 1}) – Buchungen am Ende entfernt?` });
    }
    let anchor: Verification['anchor'] = null;
    if (input.anchor) {
      anchor = { ...input.anchor, ok: anchorHash === input.anchor.hash };
      if (!anchor.ok) add({ code: 'ANCHOR_MISMATCH', seq: input.anchor.seq, bookingId: null, message: anchorHash ? 'Hash weicht vom verankerten Stand ab – Kette neu berechnet?' : 'Verankerte Buchung fehlt' });
    }
    const days: Verification['days'] = [];
    for (const d of input.days ?? []) {
      const actual = (await this.day(d.day)).root;
      days.push({ day: d.day, expected: d.root, actual, ok: actual === d.root });
      if (actual !== d.root) add({ code: 'DAY_ROOT_MISMATCH', seq: null, bookingId: null, message: `Merkle-Wurzel vom ${d.day} weicht ab` });
    }
    const [{ pending }] = (await em.execute<{ pending: string }[]>(`select count(*)::text as "pending" from "stock_booking" where "seq" is null`)) as [{ pending: string }];
    return { ok: problems.length === 0, checked, head: { seq: head.seq, hash: head.hash }, pending: Number(pending), problems, anchor, days };
  }

  private dayRows(day: string): Promise<Row[]> {
    return this.em.fork().execute<Row[]>(
      `select ${COLUMNS} from "stock_booking" where "seq" is not null and ("created_at" at time zone 'UTC')::date = ?::date order by "stock_booking"."seq"`,
      [day],
    );
  }
}
