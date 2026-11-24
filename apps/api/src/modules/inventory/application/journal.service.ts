import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/domain-error.js';
import { type ChainFields, type ChangeFields, chainHash, changeHash, GENESIS_HASH, merkleProof, merkleRoot } from '../domain/journal-chain.js';

interface Row extends ChainFields {
  prevHash: string;
  hash: string;
}

const COLUMNS = `"seq"::text as "seq", "id"::text as "id", "type", "sku", "barcode", "quantity"::text as "quantity", "unit_code" as "unitCode",
  "lot", to_char("best_before", 'YYYY-MM-DD') as "bestBefore", "reference",
  to_char("created_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", "prev_hash" as "prevHash", "hash"`;
const BATCH = 5000;
const MAX_PROBLEMS = 100;

export type ChainProblemCode =
  | 'CHAIN_GAP'
  | 'CHAIN_LINK_BROKEN'
  | 'CHAIN_HASH_MISMATCH'
  | 'HEAD_MISMATCH'
  | 'ANCHOR_MISMATCH'
  | 'DAY_ROOT_MISMATCH'
  | 'STOCK_MISMATCH'
  | 'ROW_UNLOGGED'
  | 'ROW_MISSING'
  | 'ROW_CHANGED'
  | 'CHANGE_OUTSIDE_APP';
export interface ChainProblem {
  code: ChainProblemCode;
  /** `journal` (Buchungen), `changes` (Änderungsprotokoll) oder `state` (Abgleich der Tabellen). */
  chain: 'journal' | 'changes' | 'state';
  seq: number | null;
  /** Buchung, Zeile oder Bestandsschlüssel, auf den sich der Befund bezieht. */
  ref: string | null;
  message: string;
}
interface ChangeRow extends ChangeFields {
  prevHash: string;
  hash: string;
}
const CHANGE_COLUMNS = `"seq"::text as "seq", "table_name" as "tableName", "row_id"::text as "rowId", "op", "source", "row_hash" as "rowHash",
  to_char("at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "at", "prev_hash" as "prevHash", "hash"`;
/** Tabellen mit Änderungsprotokoll. */
const LOGGED_TABLES = ['transport_unit', 'stock_item'] as const;
export interface Anchor {
  seq: number;
  hash: string;
  /** Kopf des Änderungsprotokolls zum selben Zeitpunkt. */
  changes?: { seq: number; hash: string } | undefined;
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
  /** Geprüfte Einträge des Änderungsprotokolls. */
  changesChecked: number;
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

  async head(): Promise<{ seq: number; hash: string; changes: { seq: number; hash: string }; updatedAt: string }> {
    const rows = await this.em.fork().execute<{ id: number; seq: string; hash: string; updatedAt: Date }[]>(`select "id", "seq"::text as "seq", "hash", "updated_at" as "updatedAt" from "journal_head" order by "id"`);
    const [j, c] = [rows.find((r) => r.id === 1)!, rows.find((r) => r.id === 2)!];
    return { seq: Number(j.seq), hash: j.hash, changes: { seq: Number(c.seq), hash: c.hash }, updatedAt: new Date(j.updatedAt).toISOString() };
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

  /**
   * @param input.acceptedOutsideUpTo Protokolleinträge bis zu dieser Nummer, die an der Anwendung vorbei entstanden,
   *   sind geprüft und gelten als bekannt (z. B. nach einem untersuchten Vorfall oder einer Datenkorrektur).
   */
  async verify(
    input: { anchor?: Anchor | undefined; days?: { day: string; root: string }[] | undefined; acceptedOutsideUpTo?: number | undefined } = {},
  ): Promise<Verification> {
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
        if (seq !== expectedSeq) add({ code: 'CHAIN_GAP', seq, chain: 'journal', ref: r.id, message: `Nummer ${expectedSeq}${seq > expectedSeq + 1 ? `–${seq - 1}` : ''} fehlt – Buchungen gelöscht?` });
        if (r.prevHash !== prev) add({ code: 'CHAIN_LINK_BROKEN', seq, chain: 'journal', ref: r.id, message: 'Vorgänger-Hash passt nicht – Buchung davor geändert, gelöscht oder eingefügt' });
        if (chainHash(r.prevHash, r) !== r.hash) add({ code: 'CHAIN_HASH_MISMATCH', seq, chain: 'journal', ref: r.id, message: 'Inhalt passt nicht zum Hash – Buchung nachträglich geändert' });
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
      add({ code: 'HEAD_MISMATCH', seq: head.seq, chain: 'journal', ref: null, message: `Kopf (Nr. ${head.seq}) passt nicht zur letzten Buchung (Nr. ${expectedSeq - 1}) – Buchungen am Ende entfernt?` });
    }
    let anchor: Verification['anchor'] = null;
    if (input.anchor) {
      anchor = { ...input.anchor, ok: anchorHash === input.anchor.hash };
      if (!anchor.ok) add({ code: 'ANCHOR_MISMATCH', seq: input.anchor.seq, chain: 'journal', ref: null, message: anchorHash ? 'Hash weicht vom verankerten Stand ab – Kette neu berechnet?' : 'Verankerte Buchung fehlt' });
    }
    const days: Verification['days'] = [];
    for (const d of input.days ?? []) {
      const actual = (await this.day(d.day)).root;
      days.push({ day: d.day, expected: d.root, actual, ok: actual === d.root });
      if (actual !== d.root) add({ code: 'DAY_ROOT_MISMATCH', seq: null, chain: 'journal', ref: null, message: `Merkle-Wurzel vom ${d.day} weicht ab` });
    }
    const changesChecked = await this.verifyChanges(em, input.anchor?.changes, head.changes, add);
    if (input.anchor?.changes && anchor) anchor.ok = anchor.ok && !problems.some((p) => p.chain === 'changes' && p.code === 'ANCHOR_MISMATCH');
    await this.verifyState(em, add, input.acceptedOutsideUpTo ?? 0);
    await this.verifyStock(em, add);
    const [{ pending }] = (await em.execute<{ pending: string }[]>(`select count(*)::text as "pending" from "stock_booking" where "seq" is null`)) as [{ pending: string }];
    return { ok: problems.length === 0, checked, head: { seq: head.seq, hash: head.hash, changes: head.changes }, changesChecked, pending: Number(pending), problems, anchor, days };
  }

  /** Kette des Änderungsprotokolls nachrechnen (wie das Journal). */
  private async verifyChanges(
    em: EntityManager,
    anchor: { seq: number; hash: string } | undefined,
    head: { seq: number; hash: string },
    add: (p: ChainProblem) => unknown,
  ): Promise<number> {
    let prev = GENESIS_HASH;
    let expectedSeq = 1;
    let checked = 0;
    let anchorHash: string | null = null;
    for (let after = 0; ; ) {
      const rows = await em.execute<ChangeRow[]>(`select ${CHANGE_COLUMNS} from "change_log" where "seq" > ? order by "change_log"."seq" limit ${BATCH}`, [after]);
      for (const r of rows) {
        const seq = Number(r.seq);
        const ref = `${r.tableName}:${r.rowId}`;
        if (seq !== expectedSeq) add({ code: 'CHAIN_GAP', chain: 'changes', seq, ref, message: `Protokolleintrag Nr. ${expectedSeq} fehlt – Einträge gelöscht?` });
        if (r.prevHash !== prev) add({ code: 'CHAIN_LINK_BROKEN', chain: 'changes', seq, ref, message: 'Vorgänger-Hash im Änderungsprotokoll passt nicht' });
        if (changeHash(r.prevHash, r) !== r.hash) add({ code: 'CHAIN_HASH_MISMATCH', chain: 'changes', seq, ref, message: 'Protokolleintrag nachträglich geändert' });
        if (anchor && seq === anchor.seq) anchorHash = r.hash;
        prev = r.hash;
        expectedSeq = seq + 1;
        checked++;
      }
      if (rows.length < BATCH) break;
      after = Number(rows.at(-1)!.seq);
    }
    if (head.seq !== checked || head.hash !== prev) add({ code: 'HEAD_MISMATCH', chain: 'changes', seq: head.seq, ref: null, message: 'Kopf des Änderungsprotokolls passt nicht zum letzten Eintrag' });
    if (anchor && anchorHash !== anchor.hash) {
      add({ code: 'ANCHOR_MISMATCH', chain: 'changes', seq: anchor.seq, ref: null, message: anchorHash ? 'Änderungsprotokoll weicht vom verankerten Stand ab' : 'Verankerter Protokolleintrag fehlt' });
    }
    return checked;
  }

  /**
   * Jede Zeile der protokollierten Tabellen muss dem letzten Protokolleintrag entsprechen: Zeile ohne Eintrag →
   * heimlich angelegt; Eintrag ohne Zeile → heimlich gelöscht; anderer Inhalt → heimlich geändert.
   */
  private async verifyState(em: EntityManager, add: (p: ChainProblem) => unknown, acceptedUpTo: number): Promise<void> {
    const current = LOGGED_TABLES.map((t) => `select '${t}'::text as "t", "id", wms_row_hash(to_jsonb(x)) as "h" from "${t}" x`).join(' union all ');
    const rows = await em.execute<{ t: string; id: string; problem: 'ROW_UNLOGGED' | 'ROW_MISSING' | 'ROW_CHANGED' }[]>(
      `with latest as (
         select distinct on ("table_name", "row_id") "table_name", "row_id", "op", "row_hash" from "change_log"
         where "seq" is not null order by "table_name", "row_id", "seq" desc),
       cur as (${current})
       select coalesce(c."t", l."table_name") as "t", coalesce(c."id", l."row_id")::text as "id",
         case when l."row_id" is null or (c."id" is not null and l."op" = 'DELETE') then 'ROW_UNLOGGED'
              when c."id" is null and l."op" <> 'DELETE' then 'ROW_MISSING'
              when c."id" is not null and c."h" <> l."row_hash" then 'ROW_CHANGED' end as "problem"
       from cur c full join latest l on l."table_name" = c."t" and l."row_id" = c."id"
       where (l."row_id" is null) or (c."id" is null and l."op" <> 'DELETE') or (c."id" is not null and (l."op" = 'DELETE' or c."h" <> l."row_hash"))
       limit ${MAX_PROBLEMS}`,
    );
    const outside = await em.execute<{ seq: string; tableName: string; rowId: string; op: string; at: Date }[]>(
      `select "seq"::text as "seq", "table_name" as "tableName", "row_id"::text as "rowId", "op", "at" from "change_log"
       where "seq" > ? and "source" is null order by "change_log"."seq" limit ${MAX_PROBLEMS}`,
      [acceptedUpTo],
    );
    for (const o of outside) {
      add({ code: 'CHANGE_OUTSIDE_APP', chain: 'changes', seq: Number(o.seq), ref: `${o.tableName}:${o.rowId}`, message: `${o.op} am ${new Date(o.at).toISOString()} an der Anwendung vorbei (direkt in der Datenbank)` });
    }
    const text = { ROW_UNLOGGED: 'Zeile ohne Protokolleintrag – an der Anwendung vorbei angelegt', ROW_MISSING: 'Zeile fehlt, aber nie gelöscht protokolliert', ROW_CHANGED: 'Inhalt weicht vom protokollierten Stand ab' };
    for (const r of rows) add({ code: r.problem, chain: 'state', seq: null, ref: `${r.t}:${r.id}`, message: text[r.problem] });
  }

  /**
   * Bestand = Summe der Buchungen: je TU (Barcode, nur Buchungen seit Anlage der TU), Produkt, Charge und MHD.
   * Buchungen früherer oder gelöschter TUs mit demselben Barcode müssen in Summe 0 ergeben – eine TU lässt sich nur
   * leer löschen. Bestand ohne passende Buchungen oder Buchungen ohne passenden Bestand sind ein Befund.
   */
  private async verifyStock(em: EntityManager, add: (p: ChainProblem) => unknown): Promise<void> {
    const rows = await em.execute<{ barcode: string; sku: string; lot: string | null; bestBefore: string | null; stock: string; booked: string; current: boolean }[]>(
      `with items as (
         select tu."barcode", p."sku", si."lot", si."best_before", sum(si."quantity") as "q"
         from "stock_item" si join "transport_unit" tu on tu."id" = si."unit_id" join "product" p on p."id" = si."product_id"
         group by 1, 2, 3, 4),
       booked as (
         select b."barcode", b."sku", b."lot", b."best_before", (tu."id" is not null) as "current", sum(b."quantity") as "q"
         from "stock_booking" b left join "transport_unit" tu on tu."barcode" = b."barcode" and b."created_at" >= tu."created_at"
         group by 1, 2, 3, 4, 5)
       select coalesce(i."barcode", b."barcode") as "barcode", coalesce(i."sku", b."sku") as "sku", coalesce(i."lot", b."lot") as "lot",
         to_char(coalesce(i."best_before", b."best_before"), 'YYYY-MM-DD') as "bestBefore",
         coalesce(i."q", 0)::text as "stock", coalesce(b."q", 0)::text as "booked", coalesce(b."current", true) as "current"
       from items i full join booked b on b."current" and b."barcode" = i."barcode" and b."sku" = i."sku"
         and b."lot" is not distinct from i."lot" and b."best_before" is not distinct from i."best_before"
       where coalesce(i."q", 0) <> coalesce(b."q", 0)
       limit ${MAX_PROBLEMS}`,
    );
    for (const r of rows) {
      add({
        code: 'STOCK_MISMATCH',
        chain: 'state',
        seq: null,
        ref: [r.barcode, r.sku, r.lot ?? '-', r.bestBefore ?? '-'].join('/'),
        message: r.current
          ? `Bestand ${r.stock}, laut Buchungen ${r.booked} – Bestand an den Buchungen vorbei geändert`
          : `Laut Buchungen ${r.booked} auf einer TU, die es nicht mehr gibt – TU samt Bestand an den Buchungen vorbei gelöscht`,
      });
    }
  }

  private dayRows(day: string): Promise<Row[]> {
    return this.em.fork().execute<Row[]>(
      `select ${COLUMNS} from "stock_booking" where "seq" is not null and ("created_at" at time zone 'UTC')::date = ?::date order by "stock_booking"."seq"`,
      [day],
    );
  }
}
